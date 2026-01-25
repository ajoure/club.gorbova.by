import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { type BillingReportItem } from "@/hooks/useBillingReport";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import {
  User,
  Mail,
  Phone,
  Package,
  CreditCard,
  Bell,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface BillingDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BillingReportItem | null;
  date: string;
}

export function BillingDetailSheet({ open, onOpenChange, item, date }: BillingDetailSheetProps) {
  const navigate = useNavigate();

  // Fetch notification history
  const { data: notificationHistory, isLoading: notificationsLoading } = useQuery({
    queryKey: ["billing-detail-notifications", item?.user_id, date],
    enabled: !!item?.user_id && open,
    queryFn: async () => {
      if (!item?.user_id) return [];

      const { data, error } = await supabase
        .from("telegram_logs")
        .select("id, event_type, action, status, created_at, message_text, error_message")
        .eq("user_id", item.user_id)
        .gte("created_at", startOfDay(parseISO(date)).toISOString())
        .lte("created_at", endOfDay(parseISO(date)).toISOString())
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch charge history from audit_logs
  const { data: chargeHistory, isLoading: chargeLoading } = useQuery({
    queryKey: ["billing-detail-charges", item?.user_id, date],
    enabled: !!item?.user_id && open,
    queryFn: async () => {
      if (!item?.user_id) return [];

      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, meta, created_at")
        .eq("target_user_id", item.user_id)
        .or("action.ilike.%charge%,action.ilike.%payment%,action.ilike.%subscription%")
        .gte("created_at", startOfDay(parseISO(date)).toISOString())
        .lte("created_at", endOfDay(parseISO(date)).toISOString())
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data || [];
    },
  });

  const handleGoToContact = () => {
    if (item?.profile_id) {
      navigate(`/admin/contacts?contact=${item.profile_id}`);
      onOpenChange(false);
    }
  };

  const getEventLabel = (eventType: string | null, action: string | null): string => {
    const type = eventType || action || "";
    const labels: Record<string, string> = {
      subscription_reminder_7d: "Напоминание (7 дней)",
      subscription_reminder_3d: "Напоминание (3 дня)",
      subscription_reminder_1d: "Напоминание (1 день)",
      subscription_no_card_warning: "Предупреждение: нет карты",
      renewal_success: "Успешное продление",
      renewal_failure: "Ошибка продления",
    };
    return labels[type] || type || "—";
  };

  const getEventIcon = (eventType: string | null) => {
    const type = eventType || "";
    if (type.includes("reminder")) return <Bell className="h-4 w-4 text-blue-500" />;
    if (type.includes("warning")) return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    if (type.includes("success")) return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (type.includes("failure")) return <XCircle className="h-4 w-4 text-destructive" />;
    return <Bell className="h-4 w-4 text-muted-foreground" />;
  };

  const getActionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      "subscription.charge_attempt": "Попытка списания",
      "subscription.charge_success": "Успешное списание",
      "subscription.charge_failed": "Ошибка списания",
      "subscription.renewed": "Подписка продлена",
      "subscription.payment_method_auto_linked": "Карта автопривязана",
      "payment.succeeded": "Платёж успешен",
      "payment.failed": "Платёж не прошёл",
    };
    return labels[action] || action;
  };

  if (!item) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {item.full_name || "Клиент"}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-4 pr-4">
          <div className="space-y-6">
            {/* Contact Info */}
            <div className="space-y-2">
              {item.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{item.email}</span>
                </div>
              )}
              {item.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{item.phone}</span>
                </div>
              )}
              {item.product_name && (
                <div className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span>{item.product_name}</span>
                  {item.tariff_name && (
                    <Badge variant="outline" className="ml-1">{item.tariff_name}</Badge>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono">{item.amount} {item.currency}</span>
              </div>
            </div>

            {item.profile_id && (
              <Button variant="outline" size="sm" onClick={handleGoToContact}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Открыть карточку контакта
              </Button>
            )}

            <Separator />

            {/* Charge Status */}
            <div>
              <h4 className="text-sm font-medium mb-3">Статус списания</h4>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-base py-1">
                  Попыток: {item.charge_attempts}
                </Badge>
                {item.last_charge_error ? (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Ошибка
                  </Badge>
                ) : item.status === "active" ? (
                  <Badge className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Успешно
                  </Badge>
                ) : (
                  <Badge variant="secondary">{item.status}</Badge>
                )}
              </div>
              {item.last_charge_error && (
                <div className="mt-2 p-3 bg-destructive/10 rounded-md text-sm text-destructive">
                  <strong>Ошибка:</strong> {item.last_charge_error}
                </div>
              )}
              {item.last_charge_at && (
                <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Последняя попытка: {format(parseISO(item.last_charge_at), "HH:mm:ss", { locale: ru })}
                </div>
              )}
            </div>

            <Separator />

            {/* Notification History */}
            <div>
              <h4 className="text-sm font-medium mb-3">История уведомлений</h4>
              {notificationsLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : notificationHistory && notificationHistory.length > 0 ? (
                <div className="space-y-2">
                  {notificationHistory.map((notif) => (
                    <div
                      key={notif.id}
                      className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg"
                    >
                      {getEventIcon(notif.event_type)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {getEventLabel(notif.event_type, notif.action)}
                          </span>
                          <Badge
                            variant={notif.status === "success" ? "default" : "destructive"}
                            className={cn(
                              "text-xs",
                              notif.status === "success" && "bg-green-600"
                            )}
                          >
                            {notif.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {format(parseISO(notif.created_at), "HH:mm:ss", { locale: ru })}
                        </div>
                        {notif.error_message && (
                          <div className="text-xs text-destructive mt-1">
                            {notif.error_message}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-lg">
                  Нет уведомлений за выбранную дату
                </div>
              )}
            </div>

            <Separator />

            {/* Charge/Payment History */}
            <div>
              <h4 className="text-sm font-medium mb-3">История действий</h4>
              {chargeLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : chargeHistory && chargeHistory.length > 0 ? (
                <div className="space-y-2">
                  {chargeHistory.map((log) => {
                    const meta = log.meta as Record<string, unknown> | null;
                    const isSuccess =
                      log.action.includes("success") || log.action.includes("renewed");
                    const isFailed = log.action.includes("failed");

                    return (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg"
                      >
                        {isSuccess ? (
                          <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                        ) : isFailed ? (
                          <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">
                            {getActionLabel(log.action)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(parseISO(log.created_at), "HH:mm:ss", { locale: ru })}
                          </div>
                          {meta?.error && (
                            <div className="text-xs text-destructive mt-1">
                              {String(meta.error)}
                            </div>
                          )}
                          {meta?.amount && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Сумма: {String(meta.amount)} {String(meta.currency || "BYN")}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-lg">
                  Нет событий за выбранную дату
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
