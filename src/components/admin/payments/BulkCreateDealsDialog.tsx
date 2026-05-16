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
import { Layers, Loader2, AlertTriangle, CheckCircle, XCircle, History, User } from "lucide-react";
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

interface FailedItem {
  paymentUid: string;
  profileName: string;
  profileEmail: string | null;
  reason: string;
}

interface CreateResult {
  success: number;
  failed: number;
  skipped: number;
  totalProcessed: number;
  chunksProcessed: number;
  chunksTotal: number;
  failedItems: FailedItem[];
  stopReason?: string;
}

export function BulkCreateDealsDialog({
  open,
  onOpenChange,
  selectedPayments,
  onSuccess,
}: BulkCreateDealsDialogProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chunkInfo, setChunkInfo] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  // Auto-chunking config: no upper limit on selection
  const CHUNK_SIZE = 50;
  const CHUNK_PAUSE_MS = 500;
  const WARN_THRESHOLD = 500;
  
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
      setChunkInfo(null);
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
      setChunkInfo(null);
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

    setIsCreating(true);
    setProgress(0);
    setChunkInfo(null);

    const currentUser = (await supabase.auth.getUser()).data.user;
    const productCode = selectedProduct?.code || 'DEAL';
    const now = new Date();

    let success = 0;
    let failed = 0;
    let stopped = false;
    let stopReason: string | undefined;
    const failedItems: FailedItem[] = [];

    // Get existing deal counts per profile for this product
    const profileIds = groupedPayments.map(g => g.profileId);
    const { data: existingCounts } = await supabase
      .from('orders_v2')
      .select('profile_id')
      .eq('product_id', productId)
      .in('profile_id', profileIds)
      .in('status', ['paid', 'refunded', 'canceled']);

    const countMap = new Map<string, number>();
    (existingCounts || []).forEach(o => {
      countMap.set(o.profile_id, (countMap.get(o.profile_id) || 0) + 1);
    });

    // Pre-load profiles in one query (avoid N+1 on big batches)
    const profileMap = new Map<string, { id: string; user_id: string | null; email: string | null }>();
    {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, user_id, email')
        .in('id', profileIds);
      (profilesData || []).forEach(p => profileMap.set(p.id, p as any));
    }

    // Flatten ordered list: keep group order, payments stay grouped by profile
    type FlatItem = { group: GroupedPayment; payment: UnifiedPayment; indexInGroup: number };
    const flat: FlatItem[] = [];
    for (const group of groupedPayments) {
      group.payments.forEach((payment, indexInGroup) => {
        flat.push({ group, payment, indexInGroup });
      });
    }

    const total = flat.length;
    const chunksTotal = Math.ceil(total / CHUNK_SIZE);
    let chunksProcessed = 0;
    let processed = 0;

    // STOP-guard counters
    let consecutiveFailures = 0;
    let consecutiveTimeouts = 0;
    const TIMEOUT_RE = /timeout|network|fetch|aborted|failed to fetch/i;

    const recordFail = (item: FlatItem, reason: string) => {
      failed++;
      failedItems.push({
        paymentUid: item.payment.uid,
        profileName: item.group.profileName,
        profileEmail: item.group.profileEmail,
        reason,
      });
      consecutiveFailures++;
      if (TIMEOUT_RE.test(reason)) consecutiveTimeouts++;
      else consecutiveTimeouts = 0;
    };

    const recordSuccess = () => {
      success++;
      consecutiveFailures = 0;
      consecutiveTimeouts = 0;
    };

    const checkStop = (): boolean => {
      if (processed >= 10 && failed / processed > 0.2) {
        stopReason = `Cumulative error rate > 20% (${failed}/${processed})`;
        return true;
      }
      if (consecutiveFailures >= 10) {
        stopReason = `10 consecutive failures`;
        return true;
      }
      if (consecutiveTimeouts >= 3) {
        stopReason = `3 consecutive network/timeout errors`;
        return true;
      }
      return false;
    };

    for (let chunkIdx = 0; chunkIdx < chunksTotal; chunkIdx++) {
      if (stopped) break;
      const chunk = flat.slice(chunkIdx * CHUNK_SIZE, (chunkIdx + 1) * CHUNK_SIZE);
      setChunkInfo({ current: chunkIdx + 1, total: chunksTotal });

      for (const item of chunk) {
        if (stopped) break;
        const { group, payment, indexInGroup } = item;
        const profile = profileMap.get(group.profileId);

        if (!profile) {
          recordFail(item, 'Профиль не найден');
          processed++;
          setProgress(Math.round((processed / total) * 100));
          if (checkStop()) { stopped = true; break; }
          continue;
        }

        const baseCount = countMap.get(group.profileId) || 0;
        const profileShort = getProfileShort(group.profileName, group.profileEmail);
        const dealSequence = baseCount + 1; // sequence based on live count
        const orderNumber = generateOrderNumber(dealSequence, productCode, profileShort);

        const paidAt = new Date(payment.paid_at || payment.created_at);
        const accessStart = paidAt;
        const accessEnd = addDays(paidAt, 30);
        const isExpired = accessEnd < now;
        const isGhost = !profile.user_id;
        const shouldGrantAccess = grantAccess && !isGhost && !isExpired;

        try {
          const { data: newOrder, error: orderError } = await supabase
            .from('orders_v2')
            .insert({
              order_number: orderNumber,
              user_id: profile.user_id || null,
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

          // Link payment to order
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

          // Grant access via canonical fulfillment (PATCH A/B/C)
          // Telegram идёт canonical через access_rules; прямой telegram-grant-access из UI запрещён.
          if (shouldGrantAccess && profile.user_id) {
            try {
              const { data: grantResult, error: grantError } = await supabase.functions.invoke(
                'grant-access-for-order',
                { body: { orderId: newOrder.id, source: 'admin_bulk_from_payments' } }
              );
              if (grantError || grantResult?.error) {
                console.error('grant-access-for-order error', newOrder.id, grantError, grantResult);
              }
            } catch (grantErr) {
              console.error('grant-access-for-order call failed:', grantErr);
            }

            const gcOfferId = selectedTariff?.getcourse_offer_id || selectedTariff?.getcourse_offer_code;
            if (gcOfferId) {
              await supabase.functions.invoke('test-getcourse-sync', {
                body: {
                  orderId: newOrder.id,
                  email: profile.email,
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

          recordSuccess();
          countMap.set(group.profileId, (countMap.get(group.profileId) || 0) + 1);
        } catch (e: any) {
          recordFail(item, e?.message || String(e));
        }

        processed++;
        setProgress(Math.round((processed / total) * 100));

        if (checkStop()) {
          stopped = true;
          toast.error(`Остановлено: ${stopReason}`);
          break;
        }

        // tiny pause inside chunk
        if (indexInGroup < chunk.length - 1) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      chunksProcessed++;

      // Pause between chunks (skip after last)
      if (!stopped && chunkIdx < chunksTotal - 1) {
        await new Promise(r => setTimeout(r, CHUNK_PAUSE_MS));
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
        eligible_count: eligiblePayments.length,
        chunk_size: CHUNK_SIZE,
        chunks_total: chunksTotal,
        chunks_processed: chunksProcessed,
        created_count: success,
        failed_count: failed,
        skipped_count: skippedCount,
        grant_access: grantAccess,
        stopped,
        stop_reason: stopReason,
      },
    });

    setResult({
      success,
      failed,
      skipped: skippedCount,
      totalProcessed: processed,
      chunksProcessed,
      chunksTotal,
      failedItems,
      stopReason,
    });
    setIsCreating(false);
    setChunkInfo(null);

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
            <Layers className="h-5 w-5 text-indigo-500" />
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

          {/* Big-batch warning */}
          {!isCreating && !result && eligiblePayments.length > WARN_THRESHOLD && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Будет создано много сделок (<strong>{eligiblePayments.length}</strong>) — выполнение
                займёт несколько минут. Не закрывайте окно до завершения.
              </AlertDescription>
            </Alert>
          )}

          {/* Progress */}
          {isCreating && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>
                  Создание сделок...
                  {chunkInfo && (
                    <span className="ml-1 text-muted-foreground">
                      Чанк {chunkInfo.current} из {chunkInfo.total}
                    </span>
                  )}
                </span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  Создано: {result.success}
                </span>
                <span className="flex items-center gap-1 text-red-600">
                  <XCircle className="h-4 w-4" />
                  Ошибок: {result.failed}
                </span>
                {result.skipped > 0 && (
                  <span className="text-muted-foreground">
                    Пропущено: {result.skipped}
                  </span>
                )}
                <span className="text-muted-foreground">
                  Обработано: {result.totalProcessed} · Чанков: {result.chunksProcessed}/{result.chunksTotal}
                </span>
              </div>

              {result.stopReason && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Остановлено: {result.stopReason}</AlertDescription>
                </Alert>
              )}

              {result.failedItems.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Ошибки по контактам:</div>
                  <ScrollArea className="h-32 rounded border bg-background/50">
                    <div className="text-xs space-y-1 p-2">
                      {Object.entries(
                        result.failedItems.reduce<Record<string, FailedItem[]>>((acc, item) => {
                          const key = `${item.profileName}${item.profileEmail ? ` <${item.profileEmail}>` : ''}`;
                          (acc[key] ||= []).push(item);
                          return acc;
                        }, {})
                      ).map(([contact, items]) => (
                        <div key={contact} className="border-b border-border/50 pb-1 last:border-0">
                          <div className="font-medium">{contact} ({items.length})</div>
                          {items.map((it, i) => (
                            <div key={i} className="text-muted-foreground pl-3">
                              · {it.paymentUid.slice(0, 8)}: {it.reason}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {!result && eligiblePayments.length > CHUNK_SIZE && !isCreating && (
            <div className="text-xs text-muted-foreground sm:mr-auto">
              Будет обработано чанками по {CHUNK_SIZE} (всего {Math.ceil(eligiblePayments.length / CHUNK_SIZE)})
            </div>
          )}
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
                  <Layers className="h-4 w-4 mr-2" />
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
