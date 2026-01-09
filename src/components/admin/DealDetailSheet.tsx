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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EditDealDialog } from "./EditDealDialog";

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
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600" },
  failed: { label: "Ошибка", color: "bg-red-500/20 text-red-600" },
  refunded: { label: "Возврат", color: "bg-muted text-muted-foreground" },
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
    enabled: !!deal?.id,
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
    enabled: !!deal?.id,
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
      
      // 1. Get subscription IDs linked to this order
      const { data: subscriptions } = await supabase
        .from("subscriptions_v2")
        .select("id")
        .eq("order_id", deal.id);
      
      const subscriptionIds = subscriptions?.map(s => s.id) || [];
      
      // 2. Delete installment payments for these subscriptions
      if (subscriptionIds.length > 0) {
        await supabase.from("installment_payments").delete().in("subscription_id", subscriptionIds);
      }
      
      // 3. Delete subscriptions
      await supabase.from("subscriptions_v2").delete().eq("order_id", deal.id);
      
      // 4. Delete payments
      await supabase.from("payments_v2").delete().eq("order_id", deal.id);

      // 5. Delete order
      const { error } = await supabase.from("orders_v2").delete().eq("id", deal.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Сделка удалена");
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
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
                <SheetTitle className="text-lg sm:text-xl truncate">Сделка #{deal.order_number}</SheetTitle>
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
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span>{profile?.full_name || "—"}</span>
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
              </CardContent>
            </Card>

            {/* Payments */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  Оплаты
                </CardTitle>
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
                      const receiptUrl = (payment as any)?.provider_response?.transaction?.receipt_url as
                        | string
                        | undefined;

                      return (
                        <div
                          key={payment.id}
                          className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50"
                        >
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
                            {receiptUrl && (
                              <Button variant="outline" size="sm" asChild>
                                <a href={receiptUrl} target="_blank" rel="noopener noreferrer">
                                  <Download className="w-4 h-4 mr-2" />
                                  Чек
                                </a>
                              </Button>
                            )}
                          </div>
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
                    {subscription.next_charge_at && (
                      <>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Следующее списание</span>
                          <span>{format(new Date(subscription.next_charge_at), "dd.MM.yy")}</span>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Подписка не создана
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
    </Sheet>
  );
}
