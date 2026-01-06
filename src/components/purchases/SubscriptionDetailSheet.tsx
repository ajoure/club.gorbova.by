import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CreditCard, Download, Ban, RotateCcw, CheckCircle, XCircle, Clock, FileText, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  card_brand: string | null;
  card_last4: string | null;
  provider_response?: {
    transaction?: {
      receipt_url?: string;
    };
  } | null;
}

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
  payments?: Payment[];
}

interface SubscriptionDetailSheetProps {
  subscription: Subscription | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: (sub: Subscription) => void;
  onResume: (sub: Subscription) => void;
  onDownloadReceipt: (sub: Subscription) => void;
  receiptUrl?: string | null;
  isProcessing: boolean;
}

export function SubscriptionDetailSheet({
  subscription,
  open,
  onOpenChange,
  onCancel,
  onResume,
  onDownloadReceipt,
  receiptUrl,
  isProcessing,
}: SubscriptionDetailSheetProps) {
  if (!subscription) return null;

  const isCanceled = !!subscription.canceled_at;
  const isExpired = subscription.access_end_at && new Date(subscription.access_end_at) < new Date();
  const isActive = !isExpired && (subscription.status === "active" || subscription.status === "trial");

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), "d MMMM yyyy, HH:mm", { locale: ru });
  };

  const formatShortDate = (dateString: string) => {
    return format(new Date(dateString), "d MMM yyyy", { locale: ru });
  };

  const getStatusBadge = () => {
    if (isExpired) {
      return (
        <Badge variant="secondary">
          <Clock className="mr-1 h-3 w-3" />
          Истекла
        </Badge>
      );
    }
    if (isCanceled) {
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-300">
          <XCircle className="mr-1 h-3 w-3" />
          Отменена (не продлевается)
        </Badge>
      );
    }
    if (subscription.status === "trial") {
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          <Clock className="mr-1 h-3 w-3" />
          Пробный период
        </Badge>
      );
    }
    if (subscription.status === "active") {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle className="mr-1 h-3 w-3" />
          Активна
        </Badge>
      );
    }
    return <Badge variant="outline">{subscription.status}</Badge>;
  };

  const getPaymentStatusBadge = (status: string) => {
    if (status === "succeeded") {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          Оплачено
        </Badge>
      );
    }
    if (status === "failed") {
      return <Badge variant="destructive">Ошибка</Badge>;
    }
    if (status === "processing" || status === "pending") {
      return <Badge variant="secondary">В обработке</Badge>;
    }
    return <Badge variant="outline">{status}</Badge>;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader className="pr-10">
          <SheetTitle className="text-left truncate">
            {subscription.products_v2?.name || subscription.products_v2?.code} — {subscription.tariffs?.name}
          </SheetTitle>
          <SheetDescription className="text-left">
            {subscription.is_trial ? "Пробный период" : "Подписка"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Статус</span>
            {getStatusBadge()}
          </div>

          <Separator />

          {/* Dates */}
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Активирована</span>
              <span className="font-medium">{formatDate(subscription.access_start_at)}</span>
            </div>

            {subscription.access_end_at && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Действует до</span>
                <span className={`font-medium ${isExpired ? "text-destructive" : isCanceled ? "text-amber-600" : ""}`}>
                  {formatDate(subscription.access_end_at)}
                </span>
              </div>
            )}

            {subscription.next_charge_at && !isCanceled && isActive && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Следующее списание</span>
                <span className="font-medium">{formatShortDate(subscription.next_charge_at)}</span>
              </div>
            )}

            {isCanceled && subscription.cancel_at && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Доступ до</span>
                <span className="font-medium text-amber-600">{formatDate(subscription.cancel_at)}</span>
              </div>
            )}
          </div>

          <Separator />

          {/* Payment method */}
          {subscription.payment_methods?.brand && subscription.payment_methods?.last4 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Способ оплаты</span>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  {subscription.payment_methods.brand.toUpperCase()} **** {subscription.payment_methods.last4}
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Payments history */}
          {subscription.payments && subscription.payments.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-3">История платежей</h4>
              <div className="space-y-2">
                {subscription.payments.map((payment) => {
                  const paymentReceiptUrl = payment.provider_response?.transaction?.receipt_url;
                  return (
                    <div
                      key={payment.id}
                      className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {payment.amount.toFixed(2)} {payment.currency}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatShortDate(payment.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {paymentReceiptUrl && payment.status === "succeeded" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => window.open(paymentReceiptUrl, '_blank')}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {getPaymentStatusBadge(payment.status)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 pt-4">
            {/* Download receipt - prioritize real bePaid receipt */}
            {receiptUrl ? (
              <Button 
                variant="default" 
                className="w-full gap-2"
                onClick={() => window.open(receiptUrl, '_blank')}
              >
                <Download className="h-4 w-4" />
                Скачать чек
              </Button>
            ) : (
              <Button 
                variant="outline" 
                className="w-full gap-2"
                onClick={() => onDownloadReceipt(subscription)}
              >
                <Download className="h-4 w-4" />
                Скачать квитанцию
              </Button>
            )}

            {/* Cancel or Resume */}
            {isActive && !isCanceled && (
              <Button
                variant="ghost"
                className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onCancel(subscription)}
                disabled={isProcessing}
              >
                <Ban className="h-4 w-4" />
                Отменить подписку
              </Button>
            )}

            {isCanceled && isActive && (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => onResume(subscription)}
                disabled={isProcessing}
              >
                <RotateCcw className="h-4 w-4" />
                Возобновить подписку
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
