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
  Plus
} from "lucide-react";

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
  const [isTelegramLoading, setIsTelegramLoading] = useState(false);

  // Load products
  const { data: products } = useQuery({
    queryKey: ["products-for-edit-sub"],
    queryFn: async () => {
      const { data } = await supabase.from("products_v2").select("id, name, telegram_club_id").eq("is_active", true).order("name");
      return data || [];
    },
    enabled: open,
  });

  // Load tariffs for selected product
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-edit-sub", formData.product_id],
    queryFn: async () => {
      if (!formData.product_id) return [];
      const { data } = await supabase.from("tariffs").select("id, name").eq("product_id", formData.product_id).eq("is_active", true).order("name");
      return data || [];
    },
    enabled: !!formData.product_id,
  });

  // Load ALL offers for selected tariff (including inactive)
  const { data: tariffOffers } = useQuery({
    queryKey: ["tariff-offers-all-edit", formData.tariff_id],
    queryFn: async () => {
      if (!formData.tariff_id) return [];
      const { data } = await supabase
        .from("tariff_offers")
        .select("id, offer_type, button_label, amount, is_active")
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

  // Get club name
  const currentClubId = formData.telegram_club_id || productTelegramClubId;
  const currentClub = telegramClubs?.find(c => c.id === currentClubId);

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
    }
  }, [subscription]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!subscription?.id) throw new Error("No subscription ID");
      
      const { error } = await supabase
        .from("subscriptions_v2")
        .update({
          status: formData.status as any,
          product_id: formData.product_id || null,
          tariff_id: formData.tariff_id || null,
          access_start_at: dateRange?.from?.toISOString(),
          access_end_at: dateRange?.to?.toISOString() || null,
          meta: {
            ...(subscription.meta as object || {}),
            offer_id: formData.offer_id || undefined,
            telegram_club_id: formData.telegram_club_id || undefined,
            last_edit_comment: formData.comment || undefined,
            last_edit_at: new Date().toISOString(),
          },
        })
        .eq("id", subscription.id);
      
      if (error) throw error;

      // Update entitlements if dates changed
      if (subscription.user_id && subscription.product_id) {
        const { data: product } = await supabase
          .from("products_v2")
          .select("code")
          .eq("id", formData.product_id || subscription.product_id)
          .single();

        if (product?.code) {
          await supabase.from("entitlements").upsert({
            user_id: subscription.user_id,
            product_code: product.code,
            expires_at: dateRange?.to?.toISOString() || null,
            status: formData.status === "active" || formData.status === "trial" ? "active" : "expired",
          }, { onConflict: "user_id,product_code" });
        }
      }

      // Update telegram_access active_until if dates changed
      if (telegramAccess && dateRange?.to) {
        await supabase
          .from("telegram_access")
          .update({ active_until: dateRange.to.toISOString() })
          .eq("id", telegramAccess.id);
      }
    },
    onSuccess: () => {
      toast.success("Подписка обновлена");
      queryClient.invalidateQueries({ queryKey: ["contact-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["telegram-access-edit"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  // Create telegram_access record if doesn't exist
  const createTelegramAccess = async () => {
    if (!subscription?.user_id || !currentClubId) return;
    
    setIsTelegramLoading(true);
    try {
      // Create access record
      const { error } = await supabase.from("telegram_access").insert({
        user_id: subscription.user_id,
        club_id: currentClubId,
        active_until: dateRange?.to?.toISOString() || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        state_chat: "pending",
        state_channel: "pending",
      });
      
      if (error && !error.message.includes("duplicate")) throw error;
      
      await refetchTelegram();
      toast.success("Telegram доступ создан");
    } catch (err) {
      toast.error("Ошибка: " + (err as Error).message);
    } finally {
      setIsTelegramLoading(false);
    }
  };

  // Manual Telegram grant
  const grantTelegramAccess = async () => {
    if (!subscription?.user_id || !currentClubId) return;
    
    setIsTelegramLoading(true);
    try {
      // If no access record exists, create one first
      if (!telegramAccess) {
        await supabase.from("telegram_access").insert({
          user_id: subscription.user_id,
          club_id: currentClubId,
          active_until: dateRange?.to?.toISOString() || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          state_chat: "granted",
          state_channel: "granted",
        });
      } else {
        // Update existing
        await supabase
          .from("telegram_access")
          .update({ 
            state_chat: "granted", 
            state_channel: "granted",
            active_until: dateRange?.to?.toISOString() || telegramAccess.active_until,
          })
          .eq("id", telegramAccess.id);
      }

      // Also call the edge function to actually grant access in Telegram
      const { error } = await supabase.functions.invoke("telegram-grant-access", {
        body: {
          userId: subscription.user_id,
          clubId: currentClubId,
          accessUntil: dateRange?.to?.toISOString() || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      
      if (error) console.error("Grant function error:", error);
      
      await refetchTelegram();
      toast.success("Доступ в Telegram выдан");
    } catch (err) {
      toast.error("Ошибка выдачи доступа: " + (err as Error).message);
    } finally {
      setIsTelegramLoading(false);
    }
  };

  // Manual Telegram revoke
  const revokeTelegramAccess = async () => {
    if (!subscription?.user_id || !currentClubId || !telegramAccess) return;
    
    setIsTelegramLoading(true);
    try {
      const { error } = await supabase.functions.invoke("telegram-revoke-access", {
        body: {
          userId: subscription.user_id,
          clubId: currentClubId,
        },
      });
      
      if (error) console.error("Revoke function error:", error);
      
      await supabase
        .from("telegram_access")
        .update({ state_chat: "revoked", state_channel: "revoked" })
        .eq("id", telegramAccess.id);
      
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

  if (!subscription) return null;

  const days = dateRange?.from && dateRange?.to 
    ? differenceInDays(dateRange.to, dateRange.from) + 1 
    : 0;

  const currentStatus = STATUS_OPTIONS.find(s => s.value === formData.status);
  const hasTelegramClub = !!currentClubId;
  const isTelegramGranted = telegramAccess?.state_chat === "granted" || telegramAccess?.state_channel === "granted";

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
                      isTelegramGranted ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          <Check className="w-3 h-3 mr-1" />
                          Доступ выдан
                        </Badge>
                      ) : (
                        <Badge className="bg-red-500/10 text-red-600 border-red-500/20">
                          <X className="w-3 h-3 mr-1" />
                          Отозван
                        </Badge>
                      )
                    ) : (
                      <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
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
                      onClick={createTelegramAccess}
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
