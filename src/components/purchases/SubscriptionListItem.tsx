import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronRight, CheckCircle, XCircle, Clock, CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getSubscriptionStatusLabel } from "@/lib/subscriptionStatusLabels";

interface Subscription {
  id: string;
  status: string;
  is_trial: boolean;
  access_start_at: string;
  access_end_at: string | null;
  trial_end_at: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  next_charge_at: string | null;
  created_at: string;
  auto_renew?: boolean;
  auto_renew_disabled_by?: string | null;
  auto_renew_disabled_at?: string | null;
  products_v2: {
    id: string;
    name: string;
    code: string;
  } | null;
  tariffs: {
    name: string;
    code: string;
  } | null;
  payment_methods: {
    brand: string | null;
    last4: string | null;
  } | null;
}

interface SubscriptionListItemProps {
  subscription: Subscription;
  onClick: () => void;
}

export function SubscriptionListItem({ subscription, onClick }: SubscriptionListItemProps) {
  const isCanceled = !!subscription.canceled_at;
  const isExpired = subscription.access_end_at && new Date(subscription.access_end_at) < new Date();
  // REPAIR-BEPAID-ACCESS-2026-05 v3: подписки expired/superseded не должны выглядеть как «живые».
  const isInactive = isExpired || subscription.status === 'expired' || subscription.status === 'superseded';

  const formatShortDate = (dateString: string) => {
    return format(new Date(dateString), "d MMM yyyy", { locale: ru });
  };

  const getStatusBadge = () => {
    if (isExpired) {
      return (
        <Badge variant="secondary" className="text-xs">
          Истекла
        </Badge>
      );
    }
    if (isCanceled) {
      return (
        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-900/20">
          Не продлевается
        </Badge>
      );
    }
    if (subscription.status === "trial") {
      return (
        <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          Пробный период
        </Badge>
      );
    }
    if (subscription.status === "active") {
      return (
        <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          Активна
        </Badge>
      );
    }
    const fallback = getSubscriptionStatusLabel(subscription.status);
    const cls =
      fallback.kind === "warning"
        ? "text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-900/20"
        : fallback.kind === "danger"
        ? "text-red-700 border-red-300 bg-red-50 dark:bg-red-900/20"
        : "";
    return <Badge variant="outline" className={`text-xs ${cls}`}>{fallback.label}</Badge>;
  };

  return (
    <button
      onClick={onClick}
      className="group w-full flex items-start justify-between gap-3 p-4 sm:p-5 rounded-xl border border-border/60 bg-card hover:border-primary/30 hover:shadow-sm transition-all text-left min-w-0 overflow-hidden"
    >
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-foreground text-sm sm:text-base break-words leading-snug min-w-0">
            {subscription.products_v2?.name || subscription.products_v2?.code} — {subscription.tariffs?.name}
          </h3>
          <div className="shrink-0">{getStatusBadge()}</div>
        </div>

        {subscription.auto_renew === false && subscription.auto_renew_disabled_by && (
          <Badge variant="outline" className="text-[10px] sm:text-xs text-amber-600 border-amber-300">
            Автопродление откл. {subscription.auto_renew_disabled_by === 'admin' ? 'админом' : 'клиентом'}
          </Badge>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground">
          {subscription.access_end_at && (
            <span>Действует до: {formatShortDate(subscription.access_end_at)}</span>
          )}
          {!isInactive && subscription.payment_methods?.brand && subscription.payment_methods?.last4 && (
            <span className="flex items-center gap-1">
              <CreditCard className="h-3.5 w-3.5" />
              **** {subscription.payment_methods.last4}
            </span>
          )}
        </div>

        {!isInactive && subscription.is_trial && subscription.trial_end_at && (
          <div className="text-xs text-blue-600 dark:text-blue-400">
            Пробный период до: {formatShortDate(subscription.trial_end_at)}
            {subscription.next_charge_at && (
              <span className="ml-2">• Списание: {formatShortDate(subscription.next_charge_at)}</span>
            )}
          </div>
        )}
        {isCanceled && subscription.cancel_at && (
          <p className="text-xs text-amber-600">
            Доступ сохранится до {formatShortDate(subscription.cancel_at)}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0 mt-1 group-hover:text-primary transition-colors" />
    </button>
  );
}
