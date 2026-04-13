import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { 
  Loader2, 
  CalendarIcon, 
  Package, 
  Layers, 
  Gift, 
  Clock, 
  MessageSquare,
  Send,
  Users,
  Check,
  X,
  RefreshCw,
  Link2,
  Plus,
  BookOpen,
  AlertTriangle,
  Eye
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

interface EditSubscriptionDialogProps {
  subscription: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const STATUS_OPTIONS = [
  { value: "active", label: "Активна", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  { value: "trial", label: "Пробный период", color: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  { value: "expired", label: "Истекла", color: "bg-gray-500/10 text-gray-600 border-gray-500/20" },
  { value: "cancelled", label: "Отменена", color: "bg-red-500/10 text-red-600 border-red-500/20" },
  { value: "paused", label: "Приостановлена", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
];

export function EditSubscriptionDialog({ 
  subscription, 
  open, 
  onOpenChange, 
  onSuccess 
}: EditSubscriptionDialogProps) {
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [formData, setFormData] = useState({
    status: "",
    product_id: "",
    tariff_id: "",
    offer_id: "",
    comment: "",
    telegram_club_id: "",
  });
  const [nextChargeAt, setNextChargeAt] = useState<Date | undefined>();
  const [isTelegramLoading, setIsTelegramLoading] = useState(false);
  const [isGCLoading, setIsGCLoading] = useState(false);

  // Load products
  const { data: products } = useQuery({
    queryKey: ["products-for-edit-sub"],
    queryFn: async () => {
      const { data } = await supabase.from("products_v2").select("id, name, telegram_club_id").eq("is_active", true).order("name");
      return data || [];
    },
    enabled: open,
  });

  // Load tariffs for selected product (with getcourse_offer_id)
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-edit-sub", formData.product_id],
    queryFn: async () => {
      if (!formData.product_id) return [];
      const { data } = await supabase
        .from("tariffs")
        .select("id, name, getcourse_offer_id")
        .eq("product_id", formData.product_id)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: !!formData.product_id,
  });

  // Load ALL offers for selected tariff (including inactive, with getcourse_offer_id)
  const { data: tariffOffers } = useQuery({
    queryKey: ["tariff-offers-all-edit", formData.tariff_id],
    queryFn: async () => {
      if (!formData.tariff_id) return [];
      const { data } = await supabase
        .from("tariff_offers")
        .select("id, offer_type, button_label, amount, is_active, getcourse_offer_id")
        .eq("tariff_id", formData.tariff_id)
        .order("sort_order");
      return data || [];
    },
    enabled: !!formData.tariff_id,
  });

  // Load all Telegram clubs for selection
  const { data: telegramClubs } = useQuery({
    queryKey: ["telegram-clubs-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("telegram_clubs")
        .select("id, club_name, is_active")
        .eq("is_active", true)
        .order("club_name");
      return data || [];
    },
    enabled: open,
  });

  // Get the product's default telegram club
  const selectedProduct = products?.find(p => p.id === formData.product_id);
  const productTelegramClubId = selectedProduct?.telegram_club_id;

  // Load Telegram access state - look up by user AND club from product
  const { data: telegramAccess, refetch: refetchTelegram } = useQuery({
    queryKey: ["telegram-access-edit", subscription?.user_id, formData.telegram_club_id || productTelegramClubId],
    queryFn: async () => {
      if (!subscription?.user_id) return null;
      
      const clubIdToCheck = formData.telegram_club_id || productTelegramClubId;
      if (!clubIdToCheck) return null;

      const { data } = await supabase
        .from("telegram_access")
        .select("*")
        .eq("user_id", subscription.user_id)
        .eq("club_id", clubIdToCheck)
        .maybeSingle();
      return data;
    },
    enabled: !!subscription?.user_id && open && !!(formData.telegram_club_id || productTelegramClubId),
  });

  // Get order GC status
  const { data: orderData, refetch: refetchOrder } = useQuery({
    queryKey: ["order-gc-status", subscription?.order_id],
    queryFn: async () => {
      if (!subscription?.order_id) return null;
      const { data } = await supabase
        .from("orders_v2")
        .select("meta, customer_email, gc_next_retry_at")
        .eq("id", subscription.order_id)
        .maybeSingle();
      return data;
    },
    enabled: !!subscription?.order_id && open,
  });

  // Get club name
  const currentClubId = formData.telegram_club_id || productTelegramClubId;
  const currentClub = telegramClubs?.find(c => c.id === currentClubId);

  // GC status from order meta
  const gcSyncStatus = (orderData?.meta as any)?.gc_sync_status;
  const gcOrderId = (orderData?.meta as any)?.gc_order_id;
  const gcDealNumber = (orderData?.meta as any)?.gc_deal_number;
  const gcSyncedAt = (orderData?.meta as any)?.gc_synced_at;
  const gcSyncError = (orderData?.meta as any)?.gc_sync_error;
  const gcSyncErrorType = (orderData?.meta as any)?.gc_sync_error_type;
  const gcNextRetryAt = orderData?.gc_next_retry_at;
  const hasEmail = !!orderData?.customer_email;

  // NOTE: We no longer check hasGCOffer on frontend - let getcourse-grant-access decide
  // This avoids confusion when order.meta.offer_id differs from currently selected tariff/offer

  useEffect(() => {
    if (subscription) {
      setFormData({
        status: subscription.status || "",
        product_id: subscription.product_id || "",
        tariff_id: subscription.tariff_id || "",
        offer_id: (subscription.meta as any)?.offer_id || "",
        comment: "",
        telegram_club_id: (subscription.meta as any)?.telegram_club_id || "",
      });
      setDateRange({
        from: new Date(subscription.access_start_at),
        to: subscription.access_end_at ? new Date(subscription.access_end_at) : undefined,
      });
      // Initialize next_charge_at
      setNextChargeAt(subscription.next_charge_at ? new Date(subscription.next_charge_at) : undefined);
    }
  }, [subscription]);
  
  // Auto-sync: when access_end_at changes, align next_charge_at (if auto_renew is on)
  useEffect(() => {
    if (subscription?.auto_renew && dateRange?.to) {
      setNextChargeAt(dateRange.to);
    }
  }, [dateRange?.to, subscription?.auto_renew]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!subscription?.id) throw new Error("No subscription ID");
      
      // PATCH TG-SUBSCRIPTION-SAVE-FALSE-GRANT: Diff-only UPDATE
      // Only send fields that actually changed to prevent trigger from firing on no-op saves
      const changes: Record<string, any> = {};
      
      if (formData.status !== subscription.status) {
        changes.status = formData.status;
      }
      if ((formData.product_id || null) !== (subscription.product_id || null)) {
        changes.product_id = formData.product_id || null;
      }
      if ((formData.tariff_id || null) !== (subscription.tariff_id || null)) {
        changes.tariff_id = formData.tariff_id || null;
      }
      
      // Compare dates carefully to avoid toISOString() precision mismatch
      const newStartAt = dateRange?.from?.toISOString();
      const newEndAt = dateRange?.to?.toISOString() || null;
      const newNextCharge = nextChargeAt?.toISOString() || null;
      
      if (newStartAt && newStartAt !== subscription.access_start_at) {
        changes.access_start_at = newStartAt;
      }
      // Compare date portions only (ignore sub-second precision)
      const oldEndDate = subscription.access_end_at ? subscription.access_end_at.substring(0, 10) : null;
      const newEndDate = newEndAt ? newEndAt.substring(0, 10) : null;
      if (newEndDate !== oldEndDate) {
        changes.access_end_at = newEndAt;
      }
      
      const oldNextCharge = subscription.next_charge_at ? subscription.next_charge_at.substring(0, 10) : null;
      const newNextChargeDate = newNextCharge ? newNextCharge.substring(0, 10) : null;
      if (newNextChargeDate !== oldNextCharge) {
        changes.next_charge_at = newNextCharge;
      }

      // Always update meta (lightweight, doesn't trigger access)
      const newMeta = {
        ...(subscription.meta as object || {}),
        offer_id: formData.offer_id || undefined,
        telegram_club_id: formData.telegram_club_id || undefined,
        last_edit_comment: formData.comment || undefined,
        last_edit_at: new Date().toISOString(),
      };
      changes.meta = newMeta;
      
      // Check if only meta changed (no access-relevant fields)
      const accessRelevantKeys = Object.keys(changes).filter(k => k !== 'meta');
      if (accessRelevantKeys.length === 0 && !formData.comment) {
        toast.info("Нет значимых изменений для сохранения");
        return;
      }

      const { error } = await supabase
        .from("subscriptions_v2")
        .update(changes)
        .eq("id", subscription.id);
      
      if (error) throw error;

      // Update entitlements if dates or status changed
      if (subscription.user_id && (changes.access_end_at !== undefined || changes.status !== undefined || changes.product_id !== undefined)) {
        const resolvedProductId = formData.product_id || subscription.product_id;
        const { data: product } = await supabase
          .from("products_v2")
          .select("id, code")
          .eq("id", resolvedProductId)
          .single();

        if (product?.code) {
          await supabase.from("entitlements").upsert({
            user_id: subscription.user_id,
            product_code: product.code,
            product_id: product.id,
            expires_at: dateRange?.to?.toISOString() || null,
            status: formData.status === "active" || formData.status === "trial" ? "active" : "expired",
          }, { onConflict: "user_id,product_code" });
        }
      }

      // PATCH TG-SUBSCRIPTION-SAVE-FALSE-GRANT: REMOVED direct write to telegram_access.active_until
      // All access state changes go through backend edge functions only
    },
    onSuccess: () => {
      toast.success("Подписка обновлена");
      queryClient.invalidateQueries({ queryKey: ["contact-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["telegram-access-edit"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(normalizeEdgeFunctionError(error));
    },
  });

  // PATCH B: Direct insert into telegram_access REMOVED.
  // All Telegram access creation must go through the canonical backend path (telegram-grant-access).
  // The old createTelegramAccess() wrote state_chat='pending' without calling backend,
  // creating false-pending records with no invite link or audit trail.

  // Manual Telegram grant — PATCH TG-SUBSCRIPTION-SAVE-FALSE-GRANT: Only via backend
  const grantTelegramAccess = async () => {
    if (!subscription?.user_id || !currentClubId) return;
    
    setIsTelegramLoading(true);
    try {
      const adminUser = (await supabase.auth.getUser()).data.user;
      
      // PATCH: All grant operations go through backend edge function ONLY
      // No direct writes to telegram_access from UI
      const { data, error } = await supabase.functions.invoke("telegram-grant-access", {
        body: {
          user_id: subscription.user_id,
          club_id: currentClubId,
          valid_until: dateRange?.to?.toISOString() || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          is_manual: true,
          admin_id: adminUser?.id,
        },
      });
      
      if (error) {
        console.error("Grant function error:", error);
        toast.error("Ошибка выдачи доступа");
        return;
      }

      if (data?.blocked) {
        toast.warning(`Выдача заблокирована: ${data.reason || 'неизвестная причина'}`);
        return;
      }
      
      await refetchTelegram();
      toast.success("Доступ в Telegram выдан");
    } catch (err) {
      toast.error("Ошибка выдачи доступа: " + (err as Error).message);
    } finally {
      setIsTelegramLoading(false);
    }
  };

  // Manual Telegram revoke — PATCH TG-REVOKE-FALSE-REGRANT: Backend truth wins
  const revokeTelegramAccess = async () => {
    if (!subscription?.user_id || !currentClubId || !telegramAccess) return;
    
    setIsTelegramLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-revoke-access", {
        body: {
          user_id: subscription.user_id,
          club_id: currentClubId,
          is_manual: true,
          admin_id: (await supabase.auth.getUser()).data.user?.id,
        },
      });
      
      if (error) {
        console.error("Revoke function error:", error);
        toast.error("Ошибка отзыва доступа");
        return;
      }

      // PATCH TG-REVOKE-FALSE-REGRANT: Backend response is source of truth
      // If backend says blocked — show warning, do NOT change local state
      if (data?.blocked) {
        toast.warning(`Отзыв заблокирован: ${data.reason || 'у пользователя есть активный доступ'}. Локальный статус не изменён.`);
        return;
      }

      // Only refetch from backend — NO direct update to telegram_access
      await refetchTelegram();
      toast.success("Доступ в Telegram отозван");
    } catch (err) {
      toast.error("Ошибка отзыва: " + (err as Error).message);
    } finally {
      setIsTelegramLoading(false);
    }
  };

  // Sync Telegram access (re-check and update)
  const syncTelegramAccess = async () => {
    setIsTelegramLoading(true);
    try {
      await refetchTelegram();
      toast.success("Статус Telegram обновлён");
    } catch (err) {
      toast.error("Ошибка синхронизации");
    } finally {
      setIsTelegramLoading(false);
    }
  };

  // GetCourse grant access
  const grantGetCourseAccess = async (force = false) => {
    if (!subscription?.order_id) return;
    
    setIsGCLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("getcourse-grant-access", {
        body: { order_id: subscription.order_id, force },
      });
      
      if (error) throw error;
      
      if (data?.ok) {
        if (data.status === 'success') {
          toast.success("Отправлено в GetCourse");
        } else if (data.status === 'skipped') {
          toast.warning(`Пропущено: ${data.skipped_reason || data.error}`);
        } else {
          toast.error(data.error || "Ошибка синхронизации");
        }
      } else {
        toast.error(data?.error || "Ошибка синхронизации");
      }
      
      await refetchOrder();
    } catch (err) {
      toast.error("Ошибка: " + (err as Error).message);
    } finally {
      setIsGCLoading(false);
    }
  };

  // GetCourse dry-run
  const dryRunGetCourse = async () => {
    if (!subscription?.order_id) return;
    
    setIsGCLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("getcourse-grant-access", {
        body: { order_id: subscription.order_id, dry_run: true, force: true },
      });
      
      if (error) throw error;
      
      if (data?.dry_run_result) {
        const result = data.dry_run_result;
        if (result.eligible) {
          toast.success(
            `Готов к отправке: email=${result.resolved_email}, offer_id=${result.resolved_offer_id}, deal_number=${result.deal_number}`,
            { duration: 5000 }
          );
        } else {
          toast.warning(`Не готов: ${result.reason}`, { duration: 5000 });
        }
      }
    } catch (err) {
      toast.error("Ошибка: " + (err as Error).message);
    } finally {
      setIsGCLoading(false);
    }
  };

  // Refresh GC status
  const refreshGCStatus = async () => {
    setIsGCLoading(true);
    await refetchOrder();
    setIsGCLoading(false);
    toast.success("Статус GetCourse обновлён");
  };

  if (!subscription) return null;

  const days = dateRange?.from && dateRange?.to 
    ? differenceInDays(dateRange.to, dateRange.from) + 1 
    : 0;

  const currentStatus = STATUS_OPTIONS.find(s => s.value === formData.status);
  const hasTelegramClub = !!currentClubId;
  // Определить статус доступа: granted, pending, revoked или none
  const telegramStatus = (() => {
    if (!telegramAccess) return 'none';
    const chatState = telegramAccess.state_chat;
    const channelState = telegramAccess.state_channel;
    
    if (chatState === 'granted' || channelState === 'granted') return 'granted';
    if (chatState === 'pending' || channelState === 'pending') return 'pending';
    if (chatState === 'revoked' || channelState === 'revoked') return 'revoked';
    return 'unknown';
  })();
  const isTelegramGranted = telegramStatus === 'granted';
  const hasOrderId = !!subscription?.order_id;

  // GC disabled reasons - only disable if no order (dry-run shows other reasons)
  const gcDisabledReason = !hasOrderId 
    ? "Нет связанного заказа" 
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden border-0 shadow-2xl shadow-primary/10">
        {/* Glass Header */}
        <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-transparent backdrop-blur-xl border-b border-border/50 px-6 py-5">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent" />
          <DialogHeader className="relative">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-semibold flex items-center gap-2">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <Layers className="w-5 h-5" />
                </div>
                Редактирование подписки
              </DialogTitle>
              {currentStatus && (
                <Badge className={cn("font-medium", currentStatus.color)}>
                  {currentStatus.label}
                </Badge>
              )}
            </div>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Status */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Статус
            </Label>
            <Select value={formData.status} onValueChange={(v) => setFormData(prev => ({ ...prev, status: v }))}>
              <SelectTrigger className="h-11 bg-background/50 backdrop-blur-sm border-border/60 hover:border-primary/40 transition-colors">
                <SelectValue placeholder="Выберите статус" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full", opt.value === "active" ? "bg-emerald-500" : opt.value === "trial" ? "bg-amber-500" : opt.value === "cancelled" ? "bg-red-500" : "bg-gray-400")} />
                      {opt.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Product & Tariff */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Package className="w-4 h-4 text-muted-foreground" />
                Продукт
              </Label>
              <Select 
                value={formData.product_id} 
                onValueChange={(v) => setFormData(prev => ({ ...prev, product_id: v, tariff_id: "", telegram_club_id: "" }))}
              >
                <SelectTrigger className="h-11 bg-background/50 backdrop-blur-sm border-border/60 hover:border-primary/40 transition-colors">
                  <SelectValue placeholder="Выберите" />
                </SelectTrigger>
                <SelectContent>
                  {products?.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                Тариф
              </Label>
              <Select 
                value={formData.tariff_id} 
                onValueChange={(v) => setFormData(prev => ({ ...prev, tariff_id: v, offer_id: "" }))}
                disabled={!formData.product_id}
              >
                <SelectTrigger className="h-11 bg-background/50 backdrop-blur-sm border-border/60 hover:border-primary/40 transition-colors">
                  <SelectValue placeholder="Выберите" />
                </SelectTrigger>
                <SelectContent>
                  {tariffs?.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Offer selection */}
          {formData.tariff_id && (
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Gift className="w-4 h-4 text-muted-foreground" />
                Оффер (кнопка оплаты)
              </Label>
              <Select 
                value={formData.offer_id} 
                onValueChange={(v) => setFormData(prev => ({ ...prev, offer_id: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger className="h-11 bg-background/50 backdrop-blur-sm border-border/60 hover:border-primary/40 transition-colors">
                  <SelectValue placeholder="Выберите оффер (опционально)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Без оффера</SelectItem>
                  {tariffOffers?.map(offer => (
                    <SelectItem key={offer.id} value={offer.id}>
                      <div className="flex items-center gap-2">
                        {offer.offer_type === "trial" ? (
                          <Gift className="w-4 h-4 text-amber-500" />
                        ) : (
                          <span className="text-emerald-500">💳</span>
                        )}
                        {offer.button_label} ({offer.amount} BYN)
                        {!offer.is_active && <span className="text-muted-foreground text-xs">(неактивен)</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Оффер сохраняется в meta для синхронизации с GetCourse
              </p>
            </div>
          )}

          {/* Date Range */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-muted-foreground" />
              Период доступа
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full h-11 justify-start text-left font-normal bg-background/50 backdrop-blur-sm border-border/60 hover:border-primary/40 transition-colors",
                    !dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "dd.MM.yy")} — {format(dateRange.to, "dd.MM.yy")}
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {days} дн.
                        </Badge>
                      </>
                    ) : (
                      format(dateRange.from, "dd.MM.yy")
                    )
                  ) : (
                    <span>Выберите период</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={1}
                  locale={ru}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Next Charge Date - only show if auto_renew is enabled */}
          {subscription?.auto_renew && (
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
                Следующее списание
                <span className="text-xs text-muted-foreground">(авто-синхр. с датой доступа)</span>
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full h-11 justify-start text-left font-normal bg-background/50 backdrop-blur-sm border-border/60 hover:border-primary/40 transition-colors",
                      !nextChargeAt && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {nextChargeAt ? format(nextChargeAt, "dd.MM.yyyy") : "Не установлено"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="single"
                    selected={nextChargeAt}
                    onSelect={setNextChargeAt}
                    locale={ru}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          <Separator className="my-4" />

          {/* Telegram Access Control */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Send className="w-4 h-4 text-muted-foreground" />
              Telegram доступ
            </Label>
            
            {/* Club selector */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                Клуб Telegram
              </Label>
              <Select 
                value={formData.telegram_club_id || productTelegramClubId || ""} 
                onValueChange={(v) => setFormData(prev => ({ ...prev, telegram_club_id: v === "__default__" ? "" : v }))}
              >
                <SelectTrigger className="h-10 bg-background/50 backdrop-blur-sm border-border/60 hover:border-primary/40 transition-colors">
                  <SelectValue placeholder="Выберите клуб" />
                </SelectTrigger>
                <SelectContent>
                  {productTelegramClubId && (
                    <SelectItem value="__default__">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-primary" />
                        По умолчанию (из продукта)
                      </div>
                    </SelectItem>
                  )}
                  {telegramClubs?.map(club => (
                    <SelectItem key={club.id} value={club.id}>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        {club.club_name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {hasTelegramClub ? (
              <div className="rounded-xl border border-border/60 bg-background/30 backdrop-blur-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {currentClub?.club_name || "Клуб"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {telegramAccess ? (
                      telegramStatus === 'granted' ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          <Check className="w-3 h-3 mr-1" />
                          Доступ выдан
                        </Badge>
                      ) : telegramStatus === 'pending' ? (
                        <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                          <Clock className="w-3 h-3 mr-1" />
                          Ожидает присоединения
                        </Badge>
                      ) : (
                        <Badge className="bg-red-500/10 text-red-600 border-red-500/20">
                          <X className="w-3 h-3 mr-1" />
                          Отозван
                        </Badge>
                      )
                    ) : (
                      <Badge className="bg-muted text-muted-foreground border-border">
                        Не привязан
                      </Badge>
                    )}
                  </div>
                </div>

                {telegramAccess?.active_until && (
                  <div className="text-xs text-muted-foreground">
                    Доступ до: {format(new Date(telegramAccess.active_until), "dd.MM.yyyy HH:mm", { locale: ru })}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  {!telegramAccess ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={grantTelegramAccess}
                      disabled={isTelegramLoading}
                      className="flex-1 bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                    >
                      {isTelegramLoading ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-1" />
                      )}
                      Привязать
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={grantTelegramAccess}
                        disabled={isTelegramLoading}
                        className="flex-1 bg-emerald-500/10 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/20"
                      >
                        {isTelegramLoading ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4 mr-1" />
                        )}
                        Выдать
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={revokeTelegramAccess}
                        disabled={isTelegramLoading}
                        className="flex-1 bg-red-500/10 border-red-500/30 text-red-600 hover:bg-red-500/20"
                      >
                        {isTelegramLoading ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <X className="w-4 h-4 mr-1" />
                        )}
                        Отозвать
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={syncTelegramAccess}
                    disabled={isTelegramLoading}
                    className="px-3"
                  >
                    <RefreshCw className={cn("w-4 h-4", isTelegramLoading && "animate-spin")} />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-amber-600">
                  <Users className="w-5 h-5" />
                  <span className="text-sm font-medium">Выберите Telegram клуб выше</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Привяжите клуб к подписке для управления доступом
                </p>
              </div>
            )}
          </div>

          <Separator className="my-4" />

          {/* GetCourse Access Control */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              GetCourse доступ
            </Label>

            {hasOrderId ? (
              <div className="rounded-xl border border-border/60 bg-background/30 backdrop-blur-sm p-4 space-y-3">
                {/* Status display */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Статус синхронизации</span>
                  {gcSyncStatus === 'success' ? (
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                      <Check className="w-3 h-3 mr-1" />
                      Синхронизировано
                    </Badge>
                  ) : gcSyncStatus === 'failed' ? (
                    <Badge className="bg-red-500/10 text-red-600 border-red-500/20">
                      <X className="w-3 h-3 mr-1" />
                      Ошибка
                    </Badge>
                  ) : gcSyncStatus === 'skipped' ? (
                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Пропущено
                    </Badge>
                  ) : (
                    <Badge className="bg-gray-500/10 text-gray-600 border-gray-500/20">
                      Не отправлено
                    </Badge>
                  )}
                </div>

                {/* GC details */}
                <div className="space-y-1 text-xs text-muted-foreground">
                  {gcOrderId && (
                    <div>GC Order ID: <span className="font-mono">{gcOrderId}</span></div>
                  )}
                  {gcDealNumber && (
                    <div>Deal Number: <span className="font-mono">{gcDealNumber}</span></div>
                  )}
                  {gcSyncedAt && (
                    <div>Последняя попытка: {format(new Date(gcSyncedAt), "dd.MM.yyyy HH:mm", { locale: ru })}</div>
                  )}
                  {gcNextRetryAt && new Date(gcNextRetryAt) > new Date() && (
                    <div className="text-amber-600">
                      Повтор доступен с: {format(new Date(gcNextRetryAt), "dd.MM.yyyy HH:mm", { locale: ru })}
                    </div>
                  )}
                </div>

                {/* Error message */}
                {gcSyncError && (
                  <div className="text-xs text-red-500 bg-red-500/5 rounded-lg p-2">
                    <span className="font-medium">Ошибка:</span> {gcSyncError}
                    {gcSyncErrorType === 'rate_limit' && (
                      <span className="block mt-1 text-amber-600">
                        Лимит API GetCourse. Попробуйте через 24 часа.
                      </span>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                {(() => {
                  const shouldForce = gcSyncStatus === 'failed' || gcSyncStatus === 'skipped';
                  return (
                    <div className="flex gap-2 pt-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => grantGetCourseAccess(shouldForce)}
                                disabled={isGCLoading || !!gcDisabledReason}
                                className="w-full bg-blue-500/10 border-blue-500/30 text-blue-600 hover:bg-blue-500/20"
                              >
                                {isGCLoading ? (
                                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                ) : (
                                  <Send className="w-4 h-4 mr-1" />
                                )}
                                {shouldForce ? 'Повторить' : 'Отправить'}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          {gcDisabledReason && (
                            <TooltipContent>
                              <p>{gcDisabledReason}</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>

                  {/* Force resend button (for success cases) */}
                  {gcSyncStatus === 'success' && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => grantGetCourseAccess(true)}
                            disabled={isGCLoading}
                            className="px-3 bg-amber-500/10 border-amber-500/30 text-amber-600 hover:bg-amber-500/20"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Отправить повторно (force)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={dryRunGetCourse}
                          disabled={isGCLoading}
                          className="px-3"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Проверить (dry-run)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshGCStatus}
                    disabled={isGCLoading}
                    className="px-3"
                  >
                    <RefreshCw className={cn("w-4 h-4", isGCLoading && "animate-spin")} />
                      </Button>
                    </div>
                  );
                })()}

                {/* Validation messages */}
                {gcDisabledReason && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {gcDisabledReason}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-xs text-muted-foreground">
                  Нет связанного заказа для синхронизации с GetCourse
                </p>
              </div>
            )}
          </div>

          <Separator className="my-4" />

          {/* Comment */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              Комментарий к изменениям
            </Label>
            <Textarea
              value={formData.comment}
              onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))}
              placeholder="Причина изменения..."
              className="min-h-[60px] resize-none bg-background/50 backdrop-blur-sm border-border/60"
            />
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 bg-muted/30 border-t border-border/50">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button 
            onClick={() => updateMutation.mutate()} 
            disabled={updateMutation.isPending}
            className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20"
          >
            {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
