import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Package, Loader2, AlertTriangle, CheckCircle, XCircle, History, User } from "lucide-react";
import { format, addDays, differenceInDays } from "date-fns";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";
import { formatContactName } from "@/lib/nameUtils";

interface BulkCreateDealsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPayments: UnifiedPayment[];
  onSuccess: () => void;
}

interface GroupedPayment {
  profileId: string;
  profileName: string;
  profileEmail: string | null;
  isGhost: boolean;
  payments: UnifiedPayment[];
}

interface CreateResult {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export function BulkCreateDealsDialog({
  open,
  onOpenChange,
  selectedPayments,
  onSuccess,
}: BulkCreateDealsDialogProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<CreateResult | null>(null);
  
  // Form state
  const [productId, setProductId] = useState("");
  const [tariffId, setTariffId] = useState("");
  const [grantAccess, setGrantAccess] = useState(false);
  
  // Data
  const [products, setProducts] = useState<any[]>([]);
  const [tariffs, setTariffs] = useState<any[]>([]);

  // Load products
  useEffect(() => {
    if (open) {
      loadProducts();
      setResult(null);
      setProgress(0);
    }
  }, [open]);

  // Load tariffs when product changes
  useEffect(() => {
    if (productId) {
      loadTariffs(productId);
    } else {
      setTariffs([]);
      setTariffId("");
    }
  }, [productId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setProductId("");
      setTariffId("");
      setGrantAccess(false);
      setResult(null);
      setProgress(0);
    }
  }, [open]);

  const loadProducts = async () => {
    const { data } = await supabase
      .from("products_v2")
      .select("id, name, code, telegram_club_id")
      .eq("is_active", true)
      .order("name");
    setProducts(data || []);
  };

  const loadTariffs = async (prodId: string) => {
    const { data } = await supabase
      .from("tariffs")
      .select("id, name, code, getcourse_offer_id, getcourse_offer_code, access_days")
      .eq("product_id", prodId)
      .eq("is_active", true)
      .order("name");
    setTariffs(data || []);
  };

  // Filter eligible payments (have profile_id, no order_id yet, successful status)
  const eligiblePayments = useMemo(() => {
    const successStatuses = ['successful', 'succeeded', 'paid', 'completed'];
    return selectedPayments.filter(p => 
      p.profile_id && 
      !p.order_id &&
      successStatuses.includes((p.status_normalized || '').toLowerCase())
    );
  }, [selectedPayments]);

  // Group by profile
  const groupedPayments = useMemo(() => {
    const groups = new Map<string, GroupedPayment>();
    
    for (const payment of eligiblePayments) {
      if (!payment.profile_id) continue;
      
      if (!groups.has(payment.profile_id)) {
        groups.set(payment.profile_id, {
          profileId: payment.profile_id,
          profileName: payment.profile_name || payment.profile_email || 'Неизвестно',
          profileEmail: payment.profile_email,
          isGhost: payment.is_ghost,
          payments: [],
        });
      }
      groups.get(payment.profile_id)!.payments.push(payment);
    }
    
    // Sort payments by date within each group
    for (const group of groups.values()) {
      group.payments.sort((a, b) => 
        new Date(a.paid_at || a.created_at).getTime() - 
        new Date(b.paid_at || b.created_at).getTime()
      );
    }
    
    return Array.from(groups.values());
  }, [eligiblePayments]);

  // Calculate stats
  const stats = useMemo(() => {
    const now = new Date();
    const threshold = addDays(now, -30);
    
    let historical = 0;
    let recent = 0;
    let totalAmount = 0;
    
    for (const payment of eligiblePayments) {
      const paidAt = new Date(payment.paid_at || payment.created_at);
      const accessEnd = addDays(paidAt, 30);
      
      if (accessEnd < now) {
        historical++;
      } else {
        recent++;
      }
      totalAmount += payment.amount;
    }
    
    return { historical, recent, totalAmount };
  }, [eligiblePayments]);

  const skippedCount = selectedPayments.length - eligiblePayments.length;
  const selectedProduct = products.find(p => p.id === productId);
  const selectedTariff = tariffs.find(t => t.id === tariffId);

  // Generate order number with sequence
  const generateOrderNumber = (sequence: number, productCode: string, profileShort: string) => {
    const timestamp = Date.now().toString(36).toUpperCase().slice(-6);
    return `${sequence}-${productCode}-${profileShort}-${timestamp}`;
  };

  // Get profile short code (first letters of first and last name, or email prefix)
  const getProfileShort = (name: string | null, email: string | null): string => {
    if (name) {
      const parts = name.split(' ').filter(p => p.length > 0);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      } else if (parts.length === 1 && parts[0].length >= 2) {
        return parts[0].slice(0, 2).toUpperCase();
      }
    }
    if (email) {
      const prefix = email.split('@')[0];
      return prefix.slice(0, 2).toUpperCase();
    }
    return 'XX';
  };

  const handleCreate = async () => {
    if (!productId || !tariffId) {
      toast.error("Выберите продукт и тариф");
      return;
    }
    
    if (eligiblePayments.length === 0) {
      toast.error("Нет подходящих платежей для создания сделок");
      return;
    }

    // STOP-guard: max 100 per batch
    const BATCH_LIMIT = 100;
    if (eligiblePayments.length > BATCH_LIMIT) {
      toast.error(`Максимум ${BATCH_LIMIT} платежей за раз. Выбрано: ${eligiblePayments.length}`);
      return;
    }

    setIsCreating(true);
    setProgress(0);
    
    const currentUser = (await supabase.auth.getUser()).data.user;
    const productCode = selectedProduct?.code || 'DEAL';
    const now = new Date();
    
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];
    let stopped = false;
    
    // Get existing deal counts per profile for this product
    const profileIds = groupedPayments.map(g => g.profileId);
    const { data: existingCounts } = await supabase
      .from('orders_v2')
      .select('profile_id')
      .eq('product_id', productId)
      .in('profile_id', profileIds)
      .in('status', ['paid', 'refunded', 'canceled']);
    
    // Build count map
    const countMap = new Map<string, number>();
    (existingCounts || []).forEach(o => {
      countMap.set(o.profile_id, (countMap.get(o.profile_id) || 0) + 1);
    });

    let processed = 0;
    const total = eligiblePayments.length;

    for (const group of groupedPayments) {
      if (stopped) break;
      
      const baseCount = countMap.get(group.profileId) || 0;
      const profileShort = getProfileShort(group.profileName, group.profileEmail);
      
      // Get profile data for user_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, user_id, email')
        .eq('id', group.profileId)
        .single();
      
      if (!profile) {
        for (const payment of group.payments) {
          failed++;
          errors.push(`${payment.uid.slice(0, 8)}: Профиль не найден`);
          processed++;
          setProgress(Math.round((processed / total) * 100));
        }
        continue;
      }

      for (let i = 0; i < group.payments.length; i++) {
        if (stopped) break;
        
        const payment = group.payments[i];
        const dealSequence = baseCount + i + 1;
        const orderNumber = generateOrderNumber(dealSequence, productCode, profileShort);
        
        const paidAt = new Date(payment.paid_at || payment.created_at);
        const accessStart = paidAt;
        const accessEnd = addDays(paidAt, 30);
        const isExpired = accessEnd < now;
        const isGhost = !profile.user_id;
        
        // Determine if we should grant access
        const shouldGrantAccess = grantAccess && !isGhost && !isExpired;
        
        try {
          // 1. Create order with historical created_at
          // NOTE: user_id must be null for ghost profiles (where profile.user_id is null)
          // Never use profile.id as user_id - they are different entities
          const { data: newOrder, error: orderError } = await supabase
            .from('orders_v2')
            .insert({
              order_number: orderNumber,
              user_id: profile.user_id || null, // Ghost profiles get null user_id
              profile_id: profile.id,
              product_id: productId,
              tariff_id: tariffId,
              customer_email: profile.email,
              base_price: payment.amount,
              final_price: payment.amount,
              paid_amount: payment.amount,
              currency: payment.currency,
              status: 'paid',
              is_trial: false,
              created_at: paidAt.toISOString(),
              meta: {
                source: 'admin_bulk_from_payments',
                created_by: currentUser?.id,
                payment_id: payment.id,
                payment_source: payment.rawSource,
                deal_sequence: dealSequence,
                is_historical: isExpired,
                deal_only: !shouldGrantAccess,
              },
            })
            .select()
            .single();

          if (orderError) throw orderError;

          // 2. Link payment to order
          if (payment.rawSource === 'queue') {
            await supabase
              .from('payment_reconcile_queue')
              .update({ matched_order_id: newOrder.id, matched_profile_id: profile.id })
              .eq('id', payment.id);
          } else {
            await supabase
              .from('payments_v2')
              .update({ order_id: newOrder.id, profile_id: profile.id, user_id: profile.user_id })
              .eq('id', payment.id);
          }

          // 3. Grant access if applicable
          if (shouldGrantAccess && profile.user_id) {
            const days = differenceInDays(accessEnd, accessStart) + 1;
            
            // Create subscription
            const { data: activeCard } = await supabase
              .from('payment_methods')
              .select('id')
              .eq('user_id', profile.user_id)
              .eq('status', 'active')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            await supabase.from('subscriptions_v2').insert({
              user_id: profile.user_id,
              order_id: newOrder.id,
              product_id: productId,
              tariff_id: tariffId,
              status: 'active',
              is_trial: false,
              access_start_at: accessStart.toISOString(),
              access_end_at: accessEnd.toISOString(),
              next_charge_at: accessEnd.toISOString(),
              auto_renew: true,
              payment_method_id: activeCard?.id || null,
              meta: {
                recurring_amount: payment.amount,
                recurring_currency: payment.currency,
                created_from: 'admin_bulk_from_payments',
              },
            });

            // Grant Telegram access if product has club
            // NOTE: telegram-grant-access function already creates telegram_access_grants record
            // Do NOT insert manually to avoid duplicates!
            if (selectedProduct?.telegram_club_id) {
              await supabase.functions.invoke('telegram-grant-access', {
                body: {
                  user_id: profile.user_id,
                  club_id: selectedProduct.telegram_club_id,
                  duration_days: days,
                  source: 'admin_bulk_from_payments',
                  source_id: newOrder.id,
                  is_manual: true,
                  tariff_name: selectedTariff?.name,
                  product_name: selectedProduct?.name,
                },
              });
            }

            // Sync to GetCourse
            const gcOfferId = selectedTariff?.getcourse_offer_id || selectedTariff?.getcourse_offer_code;
            if (gcOfferId) {
              await supabase.functions.invoke('test-getcourse-sync', {
                body: {
                  orderId: newOrder.id,
                  email: profile.email,
                  // Guard: if gcOfferId is a non-numeric string, pass as-is
                  offerId: (() => {
                    if (typeof gcOfferId === 'number') return gcOfferId;
                    if (typeof gcOfferId === 'string') {
                      const parsed = parseInt(gcOfferId, 10);
                      return isNaN(parsed) ? gcOfferId : parsed;
                    }
                    return null;
                  })(),
                  tariffCode: selectedTariff?.code || 'admin_bulk',
                },
              });
            }
          }

          success++;
          
          // Update count for next iteration
          countMap.set(group.profileId, (countMap.get(group.profileId) || 0) + 1);
          
        } catch (e: any) {
          failed++;
          errors.push(`${payment.uid.slice(0, 8)}: ${e.message}`);
        }
        
        processed++;
        setProgress(Math.round((processed / total) * 100));
        
        // STOP-guard: >20% errors after 10 processed
        if (processed >= 10 && failed / processed > 0.2) {
          stopped = true;
          toast.error(`Остановлено: слишком много ошибок (${Math.round((failed / processed) * 100)}%)`);
        }
        
        // Small delay between operations
        if (i < group.payments.length - 1) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      actor_user_id: currentUser?.id,
      action: 'admin.bulk_create_deals_from_payments',
      meta: {
        product_id: productId,
        product_name: selectedProduct?.name,
        tariff_id: tariffId,
        tariff_name: selectedTariff?.name,
        total_selected: selectedPayments.length,
        eligible: eligiblePayments.length,
        success,
        failed,
        skipped: skippedCount,
        grant_access: grantAccess,
        stopped,
      },
    });

    setResult({ success, failed, skipped: skippedCount, errors: errors.slice(0, 10) });
    setIsCreating(false);

    if (success > 0) {
      toast.success(`Создано сделок: ${success} из ${eligiblePayments.length}`);
      onSuccess();
    } else if (failed > 0) {
      toast.error(`Ошибки при создании сделок: ${failed}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Создать сделки из платежей
          </DialogTitle>
          <DialogDescription>
            Массовое создание сделок для выбранных платежей с автоматической нумерацией
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-sm text-muted-foreground">Выбрано платежей</div>
              <div className="text-2xl font-bold">{selectedPayments.length}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-sm text-muted-foreground">Подходит для создания</div>
              <div className="text-2xl font-bold text-green-600">{eligiblePayments.length}</div>
            </div>
          </div>

          {/* Skipped info */}
          {skippedCount > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Пропущено: <strong>{skippedCount}</strong> платежей 
                (уже имеют сделку, без контакта или неуспешные)
              </AlertDescription>
            </Alert>
          )}

          {/* Contacts preview */}
          {groupedPayments.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Контакты ({groupedPayments.length})</Label>
              <ScrollArea className="h-24 rounded-md border p-2">
                <div className="space-y-1">
                  {groupedPayments.map(g => (
                    <div key={g.profileId} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3" />
                        <span>{g.profileName}</span>
                        {g.isGhost && <Badge variant="outline" className="text-xs">Ghost</Badge>}
                      </div>
                      <span className="text-muted-foreground">{g.payments.length} платежей</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Product selection */}
          <div className="space-y-2">
            <Label>Продукт</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите продукт" />
              </SelectTrigger>
              <SelectContent>
                {products.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tariff selection */}
          {productId && tariffs.length > 0 && (
            <div className="space-y-2">
              <Label>Тариф</Label>
              <Select value={tariffId} onValueChange={setTariffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите тариф" />
                </SelectTrigger>
                <SelectContent>
                  {tariffs.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Historical stats */}
          {eligiblePayments.length > 0 && (
            <div className="p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-2 text-sm">
                <History className="h-4 w-4 text-amber-500" />
                <span>
                  Исторические (&gt;30 дней): <strong>{stats.historical}</strong>
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Будут созданы только сделки без доступа
              </div>
            </div>
          )}

          {/* Access checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="grantAccess"
              checked={grantAccess}
              onCheckedChange={(checked) => setGrantAccess(checked === true)}
            />
            <label htmlFor="grantAccess" className="text-sm font-medium leading-none">
              Выдать доступ (только для платежей &lt; 30 дней, не ghost)
            </label>
          </div>

          {/* Progress */}
          {isCreating && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Создание сделок...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  {result.success}
                </span>
                <span className="flex items-center gap-1 text-red-600">
                  <XCircle className="h-4 w-4" />
                  {result.failed}
                </span>
                {result.skipped > 0 && (
                  <span className="text-muted-foreground">
                    Пропущено: {result.skipped}
                  </span>
                )}
              </div>
              {result.errors.length > 0 && (
                <ScrollArea className="h-20">
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {result.errors.map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result ? 'Закрыть' : 'Отмена'}
          </Button>
          {!result && (
            <Button 
              onClick={handleCreate} 
              disabled={isCreating || !productId || !tariffId || eligiblePayments.length === 0}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Создание...
                </>
              ) : (
                <>
                  <Package className="h-4 w-4 mr-2" />
                  Создать {eligiblePayments.length} сделок
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
