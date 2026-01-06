import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronRight, CheckCircle, XCircle, Clock, CreditCard, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Order {
  id: string;
  order_number: string;
  final_price: number;
  currency: string;
  status: string;
  is_trial: boolean;
  trial_end_at: string | null;
  customer_email: string | null;
  created_at: string;
  meta: Record<string, any> | null;
  purchase_snapshot: Record<string, any> | null;
  products_v2: {
    name: string;
    code: string;
  } | null;
  tariffs: {
    name: string;
    code: string;
  } | null;
  payments_v2: Array<{
    id: string;
    status: string;
    provider_payment_id: string | null;
    card_brand: string | null;
    card_last4: string | null;
    provider_response: {
      transaction?: {
        receipt_url?: string;
      };
    } | null;
  }>;
}

interface OrderListItemProps {
  order: Order;
  onDownloadReceipt: (order: Order) => void;
  onOpenBePaidReceipt: (url: string) => void;
}

export function OrderListItem({ order, onDownloadReceipt, onOpenBePaidReceipt }: OrderListItemProps) {
  const payment = order.payments_v2?.[0];
  const isPaid = order.status === "paid" || payment?.status === "succeeded";
  const receiptUrl = payment?.provider_response?.transaction?.receipt_url;

  const formatShortDate = (dateString: string) => {
    return format(new Date(dateString), "d MMM yyyy, HH:mm", { locale: ru });
  };

  const getStatusBadge = () => {
    if (order.status === "refunded") {
      return (
        <Badge className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
          Возврат
        </Badge>
      );
    }
    if (order.is_trial && isPaid) {
      return (
        <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          Триал
        </Badge>
      );
    }
    if (isPaid) {
      return (
        <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          Оплачено
        </Badge>
      );
    }
    if (order.status === "failed" || payment?.status === "failed") {
      return (
        <Badge variant="destructive" className="text-xs">
          Ошибка
        </Badge>
      );
    }
    if (order.status === "pending" || order.status === "processing") {
      return (
        <Badge variant="secondary" className="text-xs">
          В обработке
        </Badge>
      );
    }
    return <Badge variant="outline" className="text-xs">{order.status}</Badge>;
  };

  const getProductName = (): string => {
    const productName = order.products_v2?.name || order.products_v2?.code || "";
    const tariffName = order.tariffs?.name || order.purchase_snapshot?.tariff_name || "";
    
    if (productName && tariffName) {
      return `${productName} — ${tariffName}`;
    }
    if (productName) return productName;
    if (order.is_trial) return "Пробный период";
    return order.order_number;
  };

  const getPaymentMethod = () => {
    if (order.is_trial && order.final_price === 0) {
      return "Пробный период";
    }
    if (payment?.card_brand && payment?.card_last4) {
      return `${payment.card_brand} **** ${payment.card_last4}`;
    }
    return "Карта";
  };

  return (
    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium text-foreground truncate">{getProductName()}</h3>
          {getStatusBadge()}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mt-1 text-sm text-muted-foreground">
          <span>{formatShortDate(order.created_at)}</span>
          <span className="font-medium text-foreground">
            {order.final_price.toFixed(2)} {order.currency}
          </span>
          <span className="flex items-center gap-1">
            <CreditCard className="h-3 w-3" />
            {getPaymentMethod()}
          </span>
        </div>
      </div>
      {isPaid && (
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {receiptUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpenBePaidReceipt(receiptUrl);
              }}
              title="Чек bePaid"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Чек</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
