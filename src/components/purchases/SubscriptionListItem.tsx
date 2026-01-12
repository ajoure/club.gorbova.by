import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronRight, CheckCircle, XCircle, Clock, CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
    return <Badge variant="outline" className="text-xs">{subscription.status}</Badge>;
  };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium text-foreground truncate">
            {subscription.products_v2?.name || subscription.products_v2?.code} — {subscription.tariffs?.name}
          </h3>
          {getStatusBadge()}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mt-1 text-sm text-muted-foreground">
          {subscription.access_end_at && (
            <span>Действует до: {formatShortDate(subscription.access_end_at)}</span>
          )}
          {subscription.payment_methods?.brand && subscription.payment_methods?.last4 && (
            <span className="flex items-center gap-1">
              <CreditCard className="h-3 w-3" />
              **** {subscription.payment_methods.last4}
            </span>
          )}
        </div>
        {/* Trial info */}
        {subscription.is_trial && subscription.trial_end_at && (
          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            Пробный период до: {formatShortDate(subscription.trial_end_at)}
            {subscription.next_charge_at && (
              <span className="ml-2">
                • Следующее списание: {formatShortDate(subscription.next_charge_at)}
              </span>
            )}
          </div>
        )}
        {isCanceled && subscription.cancel_at && (
          <p className="text-xs text-amber-600 mt-1">
            Доступ сохранится до {formatShortDate(subscription.cancel_at)}
          </p>
        )}
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 ml-2" />
    </button>
  );
}
