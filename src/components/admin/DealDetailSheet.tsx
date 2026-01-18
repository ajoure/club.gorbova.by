import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package,
  Calendar,
  CreditCard,
  User,
  Mail,
  Phone,
  MessageCircle,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Copy,
  Download,
  Shield,
  Handshake,
  ExternalLink,
  Pencil,
  Trash2,
  RefreshCw,
  Receipt,
  Undo2,
  Search,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EditDealDialog } from "./EditDealDialog";
import { LinkPaymentDialog } from "./payments/LinkPaymentDialog";
import { GrantAccessFromDealDialog } from "./GrantAccessFromDealDialog";

interface DealDetailSheetProps {
  deal: any | null;
  profile: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Черновик", color: "bg-muted text-muted-foreground", icon: Clock },
  pending: { label: "Ожидает оплаты", color: "bg-amber-500/20 text-amber-600", icon: Clock },
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600", icon: CheckCircle },
  partial: { label: "Частично оплачен", color: "bg-blue-500/20 text-blue-600", icon: AlertTriangle },
  cancelled: { label: "Отменён", color: "bg-red-500/20 text-red-600", icon: XCircle },
  refunded: { label: "Возврат", color: "bg-red-500/20 text-red-600", icon: XCircle },
  expired: { label: "Истёк", color: "bg-muted text-muted-foreground", icon: XCircle },
};

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает", color: "bg-amber-500/20 text-amber-600" },
  processing: { label: "Обработка", color: "bg-blue-500/20 text-blue-600" },
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600" },
  succeeded: { label: "Оплачен", color: "bg-green-500/20 text-green-600" },
  failed: { label: "Ошибка", color: "bg-red-500/20 text-red-600" },
  refunded: { label: "Возврат", color: "bg-muted text-muted-foreground" },
  canceled: { label: "Отменён", color: "bg-muted text-muted-foreground" },
};

const ACTION_LABELS: Record<string, string> = {
  "subscription.purchased": "Покупка подписки",
  "subscription.created": "Подписка создана",
  "subscription.activated": "Подписка активирована",
  "subscription.canceled": "Подписка отменена",
  "subscription.expired": "Подписка истекла",
  "admin.subscription.refund": "Возврат средств",
  "admin.subscription.extend": "Продление доступа",
  "admin.subscription.cancel": "Отмена подписки",
  "admin.grant_access": "Выдача доступа",
  "admin.revoke_access": "Отзыв доступа",
  "payment.success": "Успешная оплата",
  "payment.failed": "Ошибка оплаты",
  "trial.started": "Начало триала",
  "trial.ended": "Окончание триала",
};

const getActionLabel = (action: string): string => {
  return ACTION_LABELS[action] || action;
};

export function DealDetailSheet({ deal, profile, open, onOpenChange, onDeleted }: DealDetailSheetProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fetchingDocs, setFetchingDocs] = useState(false);
  const [linkPaymentDialogOpen, setLinkPaymentDialogOpen] = useState(false);
  const [grantAccessDialogOpen, setGrantAccessDialogOpen] = useState(false);
  
  // Fetch bePaid docs mutation
  const fetchBepaidDocsMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.functions.invoke('bepaid-get-payment-docs', {
        body: { order_id: orderId, force_refresh: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.status === 'success') {
        toast.success('Документы получены из bePaid');
        queryClient.invalidateQueries({ queryKey: ['deal-payments', deal?.id] });
      } else if (data?.status === 'skipped') {
        toast.info('Документы уже загружены');
      } else {
        toast.error(data?.error || 'Ошибка получения документов');
      }
    },
    onError: (error: any) => {
      toast.error('Ошибка: ' + error.message);
    },
  });
  
  // Fetch full payments for this deal
  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: ["deal-payments", deal?.id],
    queryFn: async () => {
      if (!deal?.id) return [];
      const { data, error } = await supabase
        .from("payments_v2")
        .select("*")
        .eq("order_id", deal.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!deal?.id && open,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Fetch subscription for this deal
  const { data: subscription } = useQuery({
    queryKey: ["deal-subscription", deal?.id],
    queryFn: async () => {
      if (!deal?.id) return null;
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select("*")
        .eq("order_id", deal.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!deal?.id && open,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Fetch audit logs for this deal with actor info
  const { data: auditLogs, isLoading: auditLoading } = useQuery({
    queryKey: ["deal-audit", deal?.id],
    queryFn: async () => {
      if (!deal?.id) return [];
      const { data: logs, error } = await supabase
        .from("audit_logs")
        .select("*")
        .or(`meta->>order_id.eq.${deal.id},meta->>orderId.eq.${deal.id}`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      
      // Fetch actor profiles for the logs
      const actorIds = [...new Set(logs.map(l => l.actor_user_id).filter(Boolean))];
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", actorIds);
        
        const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
        return logs.map(log => ({
          ...log,
          actor_profile: profileMap.get(log.actor_user_id) || null
        }));
      }
      
      return logs.map(log => ({ ...log, actor_profile: null }));
    },
    enabled: !!deal?.id,
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} скопирован`);
  };

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deal?.id) throw new Error("No deal ID");
      
      console.log(`[DealDetailSheet] Starting deletion of deal: ${deal.id}`);

      // 0. Load order snapshot for notifications + telegram revoke + GetCourse cancel
      const { data: order, error: orderError } = await supabase
        .from("orders_v2")
        .select("id, user_id, product_id, order_number, status, customer_email, products_v2(name, code, telegram_club_id)")
        .eq("id", deal.id)
        .single();

      if (orderError) {
        console.error("[DealDetailSheet] Error fetching order:", orderError);
        throw new Error(`Не удалось найти сделку: ${orderError.message}`);
      }
      
      if (!order) {
        throw new Error("Сделка не найдена или уже удалена");
      }

      console.log(`[DealDetailSheet] Found order to delete:`, order.order_number);

      // 0.5 Cancel in GetCourse for paid orders BEFORE deleting
      if (order.status === "paid") {
        await supabase.functions
          .invoke("getcourse-cancel-deal", {
            body: { order_id: order.id, reason: "deal_deleted_by_admin" },
          })
          .catch(err => console.error("[DealDetailSheet] GetCourse cancel error:", err));
      }

      // 1. Get subscription IDs linked to this order
      const { data: subscriptions, error: subsError } = await supabase
        .from("subscriptions_v2")
        .select("id")
        .eq("order_id", order.id);

      if (subsError) {
        console.error("[DealDetailSheet] Error fetching subscriptions:", subsError);
      }

      const subscriptionIds = subscriptions?.map((s) => s.id) || [];
      console.log(`[DealDetailSheet] Found ${subscriptionIds.length} subscriptions to delete`);

      // 2. Delete installment payments for these subscriptions
      if (subscriptionIds.length > 0) {
        const { error: installError } = await supabase
          .from("installment_payments")
          .delete()
          .in("subscription_id", subscriptionIds);
        
        if (installError) {
          console.error("[DealDetailSheet] Error deleting installments:", installError);
        }
      }

      // 3. Delete subscriptions
      if (subscriptionIds.length > 0) {
        const { error: subsDeleteError } = await supabase
          .from("subscriptions_v2")
          .delete()
          .eq("order_id", order.id);
        
        if (subsDeleteError) {
          console.error("[DealDetailSheet] Error deleting subscriptions:", subsDeleteError);
          throw new Error(`Ошибка удаления подписок: ${subsDeleteError.message}`);
        }
        console.log(`[DealDetailSheet] Deleted subscriptions`);
      }

      // 4. Delete entitlements for affected user & product
      const orderProductCode = (order.products_v2 as any)?.code;
      if (order.user_id && orderProductCode) {
        const { error: entError } = await supabase
          .from("entitlements")
          .delete()
          .eq("user_id", order.user_id)
          .eq("product_code", orderProductCode);
        
        if (entError) {
          console.error("[DealDetailSheet] Error deleting entitlements:", entError);
        }
      }

      // 4.1 Check for other active deals before revoking Telegram access
      const telegramClubId = (order.products_v2 as any)?.telegram_club_id;
      
      if (order.user_id && telegramClubId) {
        // Check if user has other active deals with same product
        const { count: otherActiveDeals } = await supabase
          .from('orders_v2')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', order.user_id)
          .eq('product_id', order.product_id)
          .eq('status', 'paid')
          .neq('id', order.id);

        // Check for other active subscriptions
        const { count: activeSubscriptions } = await supabase
          .from('subscriptions_v2')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', order.user_id)
          .eq('product_id', order.product_id)
          .in('status', ['active', 'trial'])
          .neq('order_id', order.id);

        // Only revoke Telegram if no other active deals/subscriptions
        if (!otherActiveDeals && !activeSubscriptions) {
          await supabase.functions
            .invoke("telegram-revoke-access", {
              body: { user_id: order.user_id, club_id: telegramClubId, reason: "deal_deleted" },
            })
            .catch(console.error);
        } else {
          console.log(`[DealDetailSheet] Skipping TG revoke: user has ${otherActiveDeals} other deals, ${activeSubscriptions} active subs`);
        }
      }

      // 4.2 Notify super_admins about deal deletion
      const productName = (order.products_v2 as any)?.name || "Продукт";
      await supabase.functions
        .invoke("telegram-notify-admins", {
          body: {
            message:
              `🗑 <b>Сделка удалена</b>\n\n` +
              `📧 ${order.customer_email || "N/A"}\n` +
              `📦 ${productName}\n` +
              `🧾 ${order.order_number}`,
            parse_mode: "HTML",
          },
        })
        .catch(console.error);

      // 5. Delete payments
      const { error: paymentsError } = await supabase
        .from("payments_v2")
        .delete()
        .eq("order_id", order.id);
      
      if (paymentsError) {
        console.error("[DealDetailSheet] Error deleting payments:", paymentsError);
      } else {
        console.log(`[DealDetailSheet] Deleted payments`);
      }

      // 6. Delete order - CRITICAL STEP
      console.log(`[DealDetailSheet] Attempting to delete order: ${order.id}`);
      const { error } = await supabase
        .from("orders_v2")
        .delete()
        .eq("id", order.id);
      
      if (error) {
        console.error("[DealDetailSheet] CRITICAL: Failed to delete order:", error);
        throw new Error(`Не удалось удалить сделку: ${error.message}. Код: ${error.code}`);
      }
      
      console.log(`[DealDetailSheet] Successfully deleted order ${order.order_number}`);
    },
    onSuccess: () => {
      toast.success("Сделка удалена");
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (error: any) => {
      console.error("[DealDetailSheet] Delete mutation error:", error);
      toast.error("Ошибка: " + (error?.message || String(error)));
    },
  });

  if (!deal) return null;

  const statusConfig = STATUS_CONFIG[deal.status] || { label: deal.status, color: "bg-muted", icon: Clock };
  const StatusIcon = statusConfig.icon;
  const product = deal.products_v2 as any;
  const tariff = deal.tariffs as any;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col">
        <SheetHeader className="p-4 sm:p-6 pb-4 pr-14 sm:pr-16 border-b">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shrink-0">
                <Handshake className="w-5 h-5 sm:w-7 sm:h-7 text-primary" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-lg sm:text-xl flex items-center gap-2">
                  Сделка 
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(deal.order_number, "Номер сделки");
                    }}
                    className="font-mono hover:bg-primary/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                    title="Скопировать номер без #"
                  >
                    #{deal.order_number}
                  </button>
                </SheetTitle>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {format(new Date(deal.created_at), "dd MMMM yyyy, HH:mm", { locale: ru })}
                </p>
              </div>
            </div>
            <Badge className={`${statusConfig.color} shrink-0 mt-1 text-xs`}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {statusConfig.label}
            </Badge>
          </div>
          
          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
              <Pencil className="w-3 h-3 mr-1" />
              Редактировать
            </Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="w-3 h-3 mr-1" />
              Удалить
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Deal Info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Данные сделки
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Продукт</span>
                  <span className="font-medium">{product?.name || "—"}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Тариф</span>
                  <span className="font-medium">{tariff?.name || "—"}</span>
                </div>
                {tariff?.access_days && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Период</span>
                      <span>{tariff.access_days} дней</span>
                    </div>
                  </>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Базовая цена</span>
                  <span>
                    {new Intl.NumberFormat("ru-BY", { style: "currency", currency: deal.currency }).format(Number(deal.base_price))}
                  </span>
                </div>
                {deal.discount_percent && Number(deal.discount_percent) > 0 && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Скидка</span>
                      <span className="text-green-600">-{deal.discount_percent}%</span>
                    </div>
                  </>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Итого</span>
                  <span className="font-bold text-lg">
                    {new Intl.NumberFormat("ru-BY", { style: "currency", currency: deal.currency }).format(Number(deal.final_price))}
                  </span>
                </div>
                {deal.is_trial && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Trial до</span>
                      <Badge variant="outline" className="text-blue-600 border-blue-500/30">
                        {deal.trial_end_at ? format(new Date(deal.trial_end_at), "dd.MM.yy") : "—"}
                      </Badge>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Contact Info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Контакт
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      const contactUserId = profile?.user_id || deal?.user_id;
                      if (!contactUserId) return;
                      onOpenChange(false);
                      navigate(`/admin/contacts?contact=${contactUserId}&from=deals`);
                    }}
                    disabled={!(profile?.user_id || deal?.user_id)}
                    className={cn(
                      "flex items-center gap-2 text-left",
                      (profile?.user_id || deal?.user_id) && "cursor-pointer hover:underline text-primary",
                      !(profile?.user_id || deal?.user_id) && "cursor-default"
                    )}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={profile?.avatar_url} alt={profile?.full_name} />
                      <AvatarFallback>
                        <User className="w-4 h-4 text-muted-foreground" />
                      </AvatarFallback>
                    </Avatar>
                    <span>
                      {profile?.full_name 
                        || (profile?.name && profile?.surname ? `${profile.name} ${profile.surname}` : null)
                        || profile?.name
                        || deal?.meta?.customer_full_name
                        || deal?.meta?.card_holder
                        || deal?.customer_email 
                        || profile?.email 
                        || deal?.customer_phone 
                        || profile?.phone 
                        || "—"}
                    </span>
                    {(profile?.user_id || deal?.user_id) && <ExternalLink className="w-3 h-3" />}
                  </button>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <span>{deal.customer_email || profile?.email || "—"}</span>
                  </div>
                  {(deal.customer_email || profile?.email) && (
                    <Button variant="ghost" size="sm" onClick={() => copyToClipboard(deal.customer_email || profile?.email, "Email")}>
                      <Copy className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{deal.customer_phone || profile?.phone || "—"}</span>
                  </div>
                </div>
                
                {/* Customer data from bePaid import (from meta) */}
                {deal.meta && (deal.meta.customer_full_name || deal.meta.customer_email || deal.meta.customer_phone || deal.meta.card_holder) && (
                  <>
                    <Separator />
                    <div className="bg-muted/50 p-3 rounded-lg space-y-2">
                      <div className="text-xs font-medium text-muted-foreground uppercase mb-2">
                        Данные из платёжной системы
                      </div>
                      {deal.meta.customer_full_name && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">ФИО клиента:</span>
                          <span>{deal.meta.customer_full_name}</span>
                        </div>
                      )}
                      {deal.meta.customer_email && deal.meta.customer_email !== deal.customer_email && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Email bePaid:</span>
                          <span>{deal.meta.customer_email}</span>
                        </div>
                      )}
                      {deal.meta.customer_phone && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Телефон bePaid:</span>
                          <span>{deal.meta.customer_phone}</span>
                        </div>
                      )}
                      {deal.meta.card_holder && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Владелец карты:</span>
                          <span>{deal.meta.card_holder}</span>
                        </div>
                      )}
                      {deal.meta.purchased_at && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Дата покупки:</span>
                          <span>{format(new Date(deal.meta.purchased_at), "dd.MM.yyyy HH:mm", { locale: ru })}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Payments */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    Оплаты {payments?.length ? `(${payments.length})` : ""}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLinkPaymentDialogOpen(true)}
                  >
                    <Search className="w-3 h-3 mr-1" />
                    Привязать платёж
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {paymentsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : !payments?.length ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Нет платежей
                  </div>
                ) : (
                  <div className="space-y-3">
                    {payments.map((payment) => {
                      const paymentStatusConfig =
                        PAYMENT_STATUS_CONFIG[payment.status] || { label: payment.status, color: "bg-muted" };
                      // Priority: new receipt_url column > fallback to provider_response
                      const receiptUrl = (payment as any)?.receipt_url || 
                                        (payment as any)?.provider_response?.transaction?.receipt_url;
                      const isBepaid = (payment as any)?.provider === 'bepaid';
                      const refunds = ((payment as any)?.refunds || []) as any[];
                      const refundedAmount = Number((payment as any)?.refunded_amount) || 0;

                      return (
                        <div
                          key={payment.id}
                          className="p-3 rounded-lg bg-muted/50 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">
                                  {new Intl.NumberFormat("ru-BY", {
                                    style: "currency",
                                    currency: payment.currency,
                                  }).format(Number(payment.amount))}
                                </span>
                                <Badge className={cn("text-xs", paymentStatusConfig.color)}>
                                  {paymentStatusConfig.label}
                                </Badge>
                                {refundedAmount > 0 && (
                                  <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                                    <Undo2 className="w-3 h-3 mr-1" />
                                    -{refundedAmount.toFixed(2)}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {payment.card_brand && `${payment.card_brand} •••• ${payment.card_last4}`}
                                {payment.installment_number && ` • Платёж ${payment.installment_number}`}
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                              <div className="text-xs text-muted-foreground">
                                {payment.paid_at
                                  ? format(new Date(payment.paid_at), "dd.MM.yy HH:mm")
                                  : format(new Date(payment.created_at), "dd.MM.yy HH:mm")}
                              </div>
                              <div className="flex items-center gap-1">
                                {receiptUrl ? (
                                  <Button variant="outline" size="sm" asChild>
                                    <a href={receiptUrl} target="_blank" rel="noopener noreferrer">
                                      <Receipt className="w-4 h-4 mr-2" />
                                      Чек
                                    </a>
                                  </Button>
                                ) : isBepaid && (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => fetchBepaidDocsMutation.mutate(deal.id)}
                                    disabled={fetchBepaidDocsMutation.isPending}
                                  >
                                    {fetchBepaidDocsMutation.isPending ? (
                                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                      <Download className="w-4 h-4 mr-2" />
                                    )}
                                    Получить чек
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          {/* Refunds section */}
                          {refunds.length > 0 && (
                            <div className="border-t pt-2 mt-2">
                              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                                <Undo2 className="w-3 h-3" />
                                Возвраты ({refunds.length})
                              </div>
                              <div className="space-y-1">
                                {refunds.map((refund: any, idx: number) => (
                                  <div key={refund.refund_id || idx} className="flex items-center justify-between text-xs bg-orange-500/5 p-2 rounded">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">
                                        {refund.amount?.toFixed(2)} {refund.currency || 'BYN'}
                                      </span>
                                      <Badge 
                                        variant="outline" 
                                        className={cn(
                                          "text-[10px]",
                                          refund.status === 'succeeded' && "text-green-600 border-green-300",
                                          refund.status === 'pending' && "text-amber-600 border-amber-300",
                                          refund.status === 'failed' && "text-red-600 border-red-300"
                                        )}
                                      >
                                        {refund.status === 'succeeded' ? 'Выполнен' : 
                                         refund.status === 'pending' ? 'В обработке' : 
                                         refund.status === 'failed' ? 'Ошибка' : refund.status}
                                      </Badge>
                                      {refund.reason && (
                                        <span className="text-muted-foreground">{refund.reason}</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-muted-foreground">
                                        {refund.created_at && format(new Date(refund.created_at), "dd.MM.yy HH:mm")}
                                      </span>
                                      {refund.receipt_url && (
                                        <Button variant="ghost" size="sm" className="h-6 px-2" asChild>
                                          <a href={refund.receipt_url} target="_blank" rel="noopener noreferrer">
                                            <Receipt className="w-3 h-3" />
                                          </a>
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Refresh from bePaid button */}
                          {isBepaid && payment.status === 'succeeded' && (
                            <div className="flex justify-end pt-1">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                className="text-xs h-7"
                                onClick={() => fetchBepaidDocsMutation.mutate(deal.id)}
                                disabled={fetchBepaidDocsMutation.isPending}
                              >
                                <RefreshCw className={cn("w-3 h-3 mr-1", fetchBepaidDocsMutation.isPending && "animate-spin")} />
                                Обновить из bePaid
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Access / Subscription */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Доступ
                </CardTitle>
              </CardHeader>
              <CardContent>
                {subscription ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Статус</span>
                      <Badge variant={subscription.status === "active" ? "default" : "secondary"}>
                        {subscription.status}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Начало</span>
                      <span>{format(new Date(subscription.access_start_at), "dd.MM.yy")}</span>
                    </div>
                    {subscription.access_end_at && (
                      <>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Окончание</span>
                          <span>{format(new Date(subscription.access_end_at), "dd.MM.yy")}</span>
                        </div>
                      </>
                    )}
                    {/* Next charge date with fallback calculation */}
                    {(() => {
                      // Check if auto-renewal is active
                      const isCanceled = subscription.status === 'canceled' || subscription.status === 'expired';
                      const autoRenewalOff = subscription.auto_renew === false;
                      
                      if (isCanceled || autoRenewalOff) {
                        return (
                          <>
                            <Separator />
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Списание</span>
                              <span className="text-xs text-muted-foreground">Автопродление выключено</span>
                            </div>
                          </>
                        );
                      }
                      
                      // Priority: next_charge_at from subscription
                      if (subscription.next_charge_at) {
                        return (
                          <>
                            <Separator />
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Следующее списание</span>
                              <span>{format(new Date(subscription.next_charge_at), "dd.MM.yy")}</span>
                            </div>
                          </>
                        );
                      }
                      
                      // Fallback: calculate from last payment + billing period
                      // Default to access_end_at - 3 days (standard billing logic)
                      if (subscription.access_end_at && subscription.status === 'active') {
                        const accessEnd = new Date(subscription.access_end_at);
                        const calculatedChargeDate = new Date(accessEnd.getTime() - 3 * 24 * 60 * 60 * 1000);
                        
                        // Only show if in the future
                        if (calculatedChargeDate > new Date()) {
                          return (
                            <>
                              <Separator />
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Списание (расчёт)</span>
                                <span className="text-amber-600">{format(calculatedChargeDate, "dd.MM.yy")}</span>
                              </div>
                            </>
                          );
                        }
                      }
                      
                      return null;
                    })()}
                  </div>
                ) : (
                  <div className="text-center py-4 space-y-3">
                    <p className="text-muted-foreground text-sm">Подписка не создана</p>
                    {deal.status === "paid" && deal.user_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setGrantAccessDialogOpen(true)}
                      >
                        <Shield className="w-4 h-4 mr-2" />
                        Выдать доступ
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Audit */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  История действий
                </CardTitle>
              </CardHeader>
              <CardContent>
                {auditLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : !auditLogs?.length ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Нет записей
                  </div>
                ) : (
                  <div className="space-y-2">
                    {auditLogs.slice(0, 5).map((log: any) => (
                      <div key={log.id} className="p-3 rounded-lg bg-muted/30 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-sm">{getActionLabel(log.action)}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(log.created_at), "dd.MM HH:mm")}
                          </span>
                        </div>
                        {log.actor_profile && (
                          <div className="text-xs text-muted-foreground">
                            <span>Выполнил: </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (!log.actor_user_id) return;
                                onOpenChange(false);
                                navigate(`/admin/contacts?contact=${log.actor_user_id}`);
                              }}
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              {log.actor_profile.full_name || log.actor_profile.email || "Сотрудник"}
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ID Info */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">ID сделки</span>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(deal.id, "ID")}>
                    <code className="text-xs mr-2">{deal.id.slice(0, 8)}...</code>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </SheetContent>
      
      {/* Edit Dialog */}
      <EditDealDialog
        deal={deal}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-deals"] })}
      />
      
      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сделку?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Будут удалены: сделка #{deal.order_number}, связанные платежи и подписки.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Link Payment Dialog */}
      <LinkPaymentDialog
        open={linkPaymentDialogOpen}
        onOpenChange={setLinkPaymentDialogOpen}
        orderId={deal.id}
        orderNumber={deal.order_number}
        orderAmount={deal.final_price}
        orderCurrency={deal.currency}
        profileId={deal.profile_id}
        userId={deal.user_id}
        existingPaymentsCount={payments?.length || 0}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["deal-payments", deal.id] });
          queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
          setLinkPaymentDialogOpen(false);
        }}
      />
      
      {/* Grant Access Dialog */}
      <GrantAccessFromDealDialog
        open={grantAccessDialogOpen}
        onOpenChange={setGrantAccessDialogOpen}
        deal={{
          id: deal.id,
          order_number: deal.order_number,
          user_id: deal.user_id,
          profile_id: deal.profile_id,
          product_id: deal.product_id,
          tariff_id: deal.tariff_id,
          status: deal.status,
        }}
        tariff={tariff ? { access_days: tariff.access_days, name: tariff.name } : null}
        existingSubscription={subscription}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["deal-subscription", deal.id] });
          queryClient.invalidateQueries({ queryKey: ["deal-audit", deal.id] });
        }}
      />
    </Sheet>
  );
}
