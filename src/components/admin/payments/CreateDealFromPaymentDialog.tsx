import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Package, CalendarIcon, Loader2, Search, User, Ghost, Plus } from "lucide-react";
import { format, addDays, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { formatContactName } from "@/lib/nameUtils";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

interface Contact {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

interface CreateDealFromPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  rawSource: 'queue' | 'payments_v2';
  amount?: number;
  currency?: string;
  paidAt?: string;
  profileId?: string | null;
  onSuccess: () => void;
}

export function CreateDealFromPaymentDialog({ 
  open, 
  onOpenChange, 
  paymentId, 
  rawSource,
  amount = 0,
  currency = "BYN",
  paidAt,
  profileId,
  onSuccess 
}: CreateDealFromPaymentDialogProps) {
  const [saving, setSaving] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  
  // Form state
  const [finalAmount, setFinalAmount] = useState(amount);
  const [finalCurrency, setFinalCurrency] = useState(currency);
  const [grantAccess, setGrantAccess] = useState(false);
  const [productId, setProductId] = useState("");
  const [tariffId, setTariffId] = useState("");
  const [accessDays, setAccessDays] = useState(30);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const dealDate = paidAt ? new Date(paidAt) : new Date();
    return {
      from: dealDate,
      to: addDays(dealDate, 30),
    };
  });

  // Products and tariffs
  const [products, setProducts] = useState<any[]>([]);
  const [tariffs, setTariffs] = useState<any[]>([]);

  // Load initial contact if profileId provided
  useEffect(() => {
    if (open && profileId) {
      loadContact(profileId);
    }
  }, [open, profileId]);

  // Load products
  useEffect(() => {
    if (open) {
      loadProducts();
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

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedContact(null);
      setContactSearch("");
      setContactResults([]);
      setFinalAmount(amount);
      setFinalCurrency(currency);
      setGrantAccess(false);
      setProductId("");
      setTariffId("");
      setAccessDays(30);
      const dealDate = paidAt ? new Date(paidAt) : new Date();
      setDateRange({ from: dealDate, to: addDays(dealDate, 30) });
    }
  }, [open, amount, currency, paidAt]);

  const loadContact = async (id: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, user_id, email, full_name, first_name, last_name, phone")
      .eq("id", id)
      .single();
    if (data) setSelectedContact(data);
  };

  const loadProducts = async () => {
    const { data } = await supabase
      .from("products_v2")
      .select("id, name, code")
      .eq("is_active", true)
      .order("name");
    setProducts(data || []);
  };

  const loadTariffs = async (prodId: string) => {
    const { data } = await supabase
      .from("tariffs")
      .select("id, name, code")
      .eq("product_id", prodId)
      .eq("is_active", true)
      .order("name");
    setTariffs(data || []);
  };

  const searchContacts = async () => {
    if (!contactSearch.trim()) return;
    setSearchingContacts(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, user_id, email, full_name, first_name, last_name, phone")
        .or(`email.ilike.%${contactSearch}%,phone.ilike.%${contactSearch}%,full_name.ilike.%${contactSearch}%`)
        .order("full_name")
        .limit(20);
      if (error) throw error;
      setContactResults(data || []);
    } catch (e: any) {
      toast.error(`Ошибка поиска: ${e.message}`);
    } finally {
      setSearchingContacts(false);
    }
  };

  const handleDaysChange = (days: number) => {
    setAccessDays(days);
    if (dateRange?.from) {
      setDateRange({
        from: dateRange.from,
        to: addDays(dateRange.from, days - 1),
      });
    }
  };

  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range);
    if (range?.from && range?.to) {
      setAccessDays(differenceInDays(range.to, range.from) + 1);
    }
  };

  // formatContactName imported from @/lib/nameUtils - extended for email fallback
  const formatContactDisplay = (c: Contact) => {
    const name = formatContactName(c);
    return name === "—" ? (c.email || "Без имени") : name;
  };

  // PATCH 13.5: Запрет создания сделки из неуспешного платежа
  const getPaymentStatus = async (): Promise<string | null> => {
    if (rawSource === 'queue') {
      const { data } = await supabase
        .from('payment_reconcile_queue')
        .select('status')
        .eq('id', paymentId)
        .single();
      return data?.status || null;
    } else {
      const { data } = await supabase
        .from('payments_v2')
        .select('status')
        .eq('id', paymentId)
        .single();
      return data?.status || null;
    }
  };

  const handleCreate = async () => {
    if (!selectedContact) {
      toast.error("Выберите контакт");
      return;
    }
    if (!productId || !tariffId) {
      toast.error("Выберите продукт и тариф");
      return;
    }
    if (!dateRange?.from || !dateRange?.to) {
      toast.error("Выберите период");
      return;
    }

    // PATCH 13.5: Проверка статуса платежа — нельзя создавать сделки из failed платежей
    const failedStatuses = ['failed', 'declined', 'error', 'cancelled', 'expired', 'incomplete'];
    const paymentStatus = await getPaymentStatus();
    if (paymentStatus && failedStatuses.includes(paymentStatus.toLowerCase())) {
      toast.error(`Нельзя создать сделку из неуспешного платежа (статус: ${paymentStatus})`);
      return;
    }

    const isGhostContact = !selectedContact.user_id;
    const isExpired = dateRange.to < new Date();
    
    // Ghost contacts cannot have access granted
    if (isGhostContact && grantAccess) {
      toast.error("Ghost-контактам нельзя выдать доступ. Снимите галочку 'Выдать доступ'");
      return;
    }

    // Expired deals cannot have access granted
    if (isExpired && grantAccess) {
      toast.error("Срок доступа истёк. Нельзя выдать доступ по истёкшей сделке");
      return;
    }

    setSaving(true);
    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      const accessStart = dateRange.from;
      const accessEnd = dateRange.to;
      const days = differenceInDays(accessEnd, accessStart) + 1;
      const now = new Date();

      // Get tariff and product data
      const [{ data: tariff }, { data: product }] = await Promise.all([
        supabase.from("tariffs").select("getcourse_offer_code, getcourse_offer_id, code, name").eq("id", tariffId).single(),
        supabase.from("products_v2").select("telegram_club_id, code, name").eq("id", productId).single(),
      ]);

      // 1. Create order
      const orderUserId = isGhostContact ? selectedContact.id : selectedContact.user_id;
      const orderNumber = `PAY-${now.getFullYear().toString().slice(-2)}-${Date.now().toString(36).toUpperCase()}`;
      
      const { data: newOrder, error: orderError } = await supabase.from("orders_v2").insert({
        order_number: orderNumber,
        user_id: orderUserId,
        profile_id: selectedContact.id,
        product_id: productId,
        tariff_id: tariffId,
        customer_email: selectedContact.email,
        base_price: finalAmount,
        final_price: finalAmount,
        paid_amount: finalAmount,
        currency: finalCurrency,
        status: "paid",
        is_trial: false,
        created_at: accessStart.toISOString(),
        deal_date: accessStart.toISOString(),
        meta: { 
          source: "admin_from_payment", 
          created_by: currentUser?.id,
          payment_id: paymentId,
          payment_source: rawSource,
          is_ghost: isGhostContact,
          deal_only: !grantAccess,
        },
      }).select().single();

      if (orderError) throw orderError;

      // 2. Link payment to the new order
      if (rawSource === 'queue') {
        await supabase.from("payment_reconcile_queue").update({
          matched_order_id: newOrder.id,
          matched_profile_id: selectedContact.id,
        }).eq("id", paymentId);
      } else {
        await supabase.from("payments_v2").update({
          order_id: newOrder.id,
          profile_id: selectedContact.id,
          user_id: orderUserId,
        }).eq("id", paymentId);
      }

      // 3. Create payment record if needed (for queue payments)
      if (rawSource === 'queue') {
        await supabase.from("payments_v2").insert({
          order_id: newOrder.id,
          user_id: orderUserId,
          amount: finalAmount,
          currency: finalCurrency,
          status: "succeeded",
          provider: "admin",
          paid_at: accessStart.toISOString(),
          created_at: accessStart.toISOString(),
          meta: { source: "admin_from_payment", queue_payment_id: paymentId },
        });
      }

      // 4. Grant access via canonical fulfillment (grant-access-for-order)
      // PATCH A/B/C: canonical orderId; Telegram выдаётся canonical path (через access_rules),
      // никаких прямых telegram-grant-access в UI.
      let subscriptionId: string | null = null;
      let grantSuccess = false;
      let grantErrorCode: string | null = null;
      if (grantAccess && !isGhostContact && selectedContact.user_id) {
        try {
          const { data: grantResult, error: grantError } = await supabase.functions.invoke(
            "grant-access-for-order",
            {
              body: {
                orderId: newOrder.id,
                source: "admin_from_payment",
              },
            }
          );

          if (grantError || grantResult?.error) {
            grantErrorCode = (grantResult?.error as string) || (grantError as any)?.message || "unknown";
            console.error("grant-access-for-order error:", grantError, grantResult);
            toast.warning(
              normalizeEdgeFunctionError(
                grantError ?? grantResult,
                "Сделка создана, но автоматическая выдача доступа не сработала. Используйте кнопку 'Выдать доступ' на сделке."
              )
            );
          } else {
            subscriptionId = grantResult?.subscription_id || null;
            grantSuccess = true;
          }
        } catch (grantErr) {
          grantErrorCode = (grantErr as any)?.message || "exception";
          console.error("grant-access-for-order call failed:", grantErr);
          toast.warning("Сделка создана, но выдача доступа требует ручного действия.");
        }

        // Telegram access идёт canonical path через grant-access-for-order → access_rules
        // → telegram-grant-access. Прямой вызов из UI запрещён (mem://architecture/telegram/canonical-grant-write-path).

        // GetCourse sync
        const gcOfferId = tariff?.getcourse_offer_id || tariff?.getcourse_offer_code;
        if (gcOfferId) {
          await supabase.functions.invoke("test-getcourse-sync", {
            body: {
              orderId: newOrder.id,
              email: selectedContact.email,
              offerId: (() => {
                if (typeof gcOfferId === 'number') return gcOfferId;
                if (typeof gcOfferId === 'string') {
                  const parsed = parseInt(gcOfferId, 10);
                  return isNaN(parsed) ? gcOfferId : parsed;
                }
                return null;
              })(),
              tariffCode: tariff?.code || "admin_from_payment",
            },
          });
        }
      }

      // 5. Audit log
      const dateStr = `${format(accessStart, "dd.MM.yy")} — ${format(accessEnd, "dd.MM.yy")}`;
      await supabase.from("audit_logs").insert({
        actor_user_id: currentUser?.id,
        action: grantAccess ? "admin.create_deal_with_access_from_payment" : "admin.create_deal_from_payment",
        target_user_id: isGhostContact ? null : selectedContact.user_id,
        meta: { 
          order_id: newOrder.id,
          order_number: orderNumber,
          payment_id: paymentId,
          payment_source: rawSource,
          product_name: product?.name,
          tariff_name: tariff?.name,
          amount: finalAmount,
          currency: finalCurrency,
          access_start: accessStart.toISOString(),
          access_end: accessEnd.toISOString(),
          is_ghost: isGhostContact,
          subscription_id: subscriptionId,
        },
      });

      // 6. Notify admins about new deal
      try {
        const contactName = selectedContact.full_name || selectedContact.email || 'Неизвестно';
        const notifyMessage = 
          `📝 <b>Новая сделка из платежа</b>\n\n` +
          `👤 ${contactName}\n` +
          `📧 ${selectedContact.email || 'N/A'}\n` +
          `📦 ${product?.name || 'Продукт'}\n` +
          `🏷️ ${tariff?.name || 'Тариф'}\n` +
          `💵 ${finalAmount} ${finalCurrency}\n` +
          `📅 ${dateStr}\n` +
          `🆔 ${orderNumber}\n` +
          (grantAccess ? '✅ Доступ выдан' : '📋 Только сделка') +
          `\n👨‍💼 Создал: ${currentUser?.email || 'Неизвестно'}`;

        await supabase.functions.invoke('telegram-notify-admins', {
          body: { message: notifyMessage, parse_mode: 'HTML' },
        });
      } catch (notifyErr) {
        console.error('Failed to notify admins:', notifyErr);
      }

      toast.success(grantAccess 
        ? `Сделка создана и доступ выдан (${dateStr})` 
        : `Сделка создана (${dateStr})`);
      onSuccess();
    } catch (e: any) {
      console.error("Create deal error:", e);
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Создать сделку из платежа
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Contact Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Контакт</Label>
            {selectedContact ? (
              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  {selectedContact.user_id ? (
                    <User className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <Ghost className="h-5 w-5 text-amber-500" />
                  )}
                  <div>
                    <p className="font-medium">{formatContactDisplay(selectedContact)}</p>
                    <p className="text-sm text-muted-foreground">{selectedContact.email}</p>
                  </div>
                  {!selectedContact.user_id && (
                    <Badge variant="outline" className="text-xs">Ghost</Badge>
                  )}
                </div>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setSelectedContact(null)}
                >
                  Изменить
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Поиск по email, телефону, имени..."
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchContacts()}
                  />
                  <Button onClick={searchContacts} disabled={searchingContacts}>
                    {searchingContacts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {contactResults.length > 0 && (
                  <ScrollArea className="h-[150px] border rounded-md">
                    <div className="p-2 space-y-1">
                      {contactResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setSelectedContact(c);
                            setContactResults([]);
                          }}
                          className="w-full text-left p-2 rounded hover:bg-muted flex items-center gap-2"
                        >
                          {c.user_id ? (
                            <User className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Ghost className="h-4 w-4 text-amber-500" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{formatContactName(c)}</p>
                            <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                          </div>
                          {!c.user_id && (
                            <Badge variant="outline" className="text-xs shrink-0">Ghost</Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
          </div>

          {/* Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Сумма</Label>
              <Input
                type="number"
                value={finalAmount}
                onChange={(e) => setFinalAmount(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>Валюта</Label>
              <Select value={finalCurrency} onValueChange={setFinalCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BYN">BYN</SelectItem>
                  <SelectItem value="RUB">RUB</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Product & Tariff */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Продукт</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите продукт" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Тариф</Label>
              <Select value={tariffId} onValueChange={setTariffId} disabled={!productId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите тариф" />
                </SelectTrigger>
                <SelectContent>
                  {tariffs.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date Range */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Период сделки / доступа</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  className="w-20 h-8 text-sm"
                  value={accessDays}
                  onChange={(e) => handleDaysChange(Number(e.target.value))}
                  min={1}
                />
                <span className="text-sm text-muted-foreground">дней</span>
              </div>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "dd.MM.yyyy", { locale: ru })} — {format(dateRange.to, "dd.MM.yyyy", { locale: ru })}
                      </>
                    ) : (
                      format(dateRange.from, "dd.MM.yyyy", { locale: ru })
                    )
                  ) : (
                    "Выберите период"
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={handleDateRangeChange}
                  numberOfMonths={2}
                  locale={ru}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Grant Access Checkbox */}
          {selectedContact && selectedContact.user_id && dateRange?.to && new Date(dateRange.to) >= new Date() && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="grantAccess"
                checked={grantAccess}
                onCheckedChange={(checked) => setGrantAccess(checked === true)}
              />
              <Label htmlFor="grantAccess" className="text-sm cursor-pointer">
                Выдать доступ (создать подписку, синхронизировать с интеграциями)
              </Label>
            </div>
          )}
          
          {selectedContact && !selectedContact.user_id && (
            <div className="text-sm text-muted-foreground bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
              <Ghost className="inline h-4 w-4 mr-1" />
              Ghost-контакт — только сделка, без выдачи доступа
            </div>
          )}

          {/* Expired warning */}
          {dateRange?.to && new Date(dateRange.to) < new Date() && (
            <div className="text-sm text-orange-600 bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg border border-orange-200 dark:border-orange-800">
              ⚠️ Срок доступа истёк. Сделка будет создана только для истории (статус "Оплачен", но без выдачи доступа).
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleCreate} disabled={saving || !selectedContact || !productId || !tariffId}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Создать сделку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
