import { useEffect, useState } from "react";
import { format } from "date-fns";
import { SHEET_SHELL_CLASS } from "@/lib/sheetShell";
import { ru } from "date-fns/locale";
import { CreditCard, Download, Ban, RotateCcw, CheckCircle, XCircle, Clock, FileText, ChevronRight, ExternalLink, AlertTriangle, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getSubscriptionStatusLabel } from "@/lib/subscriptionStatusLabels";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SubscriptionDocumentActions } from "./SubscriptionDocumentActions";
import { StripePortalButton } from "./StripePortalButton";


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
  /** Последний оплаченный order_id этой подписки — для канонических документов. */
  lastPaidOrderId?: string | null;
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
  lastPaidOrderId,
  isProcessing,
}: SubscriptionDetailSheetProps) {

  // Hooks must be called unconditionally (no early `if (!subscription) return`).
  const subId = subscription?.id ?? null;
  const productId = subscription?.products_v2?.id ?? null;

  // Eligibility: backend SOT for whether resume is allowed.
  type Eligibility = {
    resume_available: boolean;
    reason: 'ok' | 'not_needed' | 'no_payment_method' | 'provider_dead' | 'provider_check_failed' | null;
    provider_state: string | null;
    has_card: boolean;
    cta_product_id: string | null;
    cta_tariff_id: string | null;
  };
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);

  useEffect(() => {
    if (!subId) { setEligibility(null); return; }
    let cancelled = false;
    setEligibilityLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('subscription-actions', {
          body: { action: 'check-resume', subscription_id: subId },
        });
        if (cancelled) return;
        if (error || !data?.success) {
          setEligibility(null);
        } else {
          setEligibility({
            resume_available: !!data.resume_available,
            reason: data.reason ?? null,
            provider_state: data.provider_state ?? null,
            has_card: !!data.has_card,
            cta_product_id: data.cta_product_id ?? null,
            cta_tariff_id: data.cta_tariff_id ?? null,
          });
        }
      } catch {
        if (!cancelled) setEligibility(null);
      } finally {
        if (!cancelled) setEligibilityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [subId]);

  if (!subscription) return null;

  const isCanceled = !!subscription.canceled_at;
  const isExpired = subscription.access_end_at && new Date(subscription.access_end_at) < new Date();
  const isActive = !isExpired && (subscription.status === "active" || subscription.status === "trial");
  const autoRenewOff = subscription.auto_renew === false;
  // Show resume slot whenever auto-renew is off OR cancellation is scheduled — backend decides what to render inside.
  const resumeSlotApplicable = isActive && (isCanceled || autoRenewOff);
  const buildPurchaseHref = (): string => {
    const pid = eligibility?.cta_product_id ?? productId;
    const code = subscription.products_v2?.code;
    if (code) return `/${code}#tariffs`;
    if (pid) return `/?product=${pid}#tariffs`;
    return '/#pricing';
  };

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
    const fallback = getSubscriptionStatusLabel(subscription.status);
    const cls =
      fallback.kind === "warning"
        ? "text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-900/20"
        : fallback.kind === "danger"
        ? "text-red-700 border-red-300 bg-red-50 dark:bg-red-900/20"
        : "";
    return <Badge variant="outline" className={cls}>{fallback.label}</Badge>;
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

  const showRenew = isExpired || isCanceled || (subscription.access_end_at &&
    new Date(subscription.access_end_at).getTime() - Date.now() < 14 * 24 * 60 * 60 * 1000);

  const visiblePayments = subscription.payments?.filter(p => p.status === 'succeeded' || p.status === 'failed') ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={SHEET_SHELL_CLASS}>
        {/* Header — компактный, с цветным фоном и статусом в одной строке */}
        <SheetHeader className="px-5 sm:px-6 pt-6 pb-5 bg-gradient-to-br from-muted/40 to-muted/10 border-b border-border/40 space-y-2">
          <div className="flex items-start justify-between gap-3 pr-8">
            <SheetTitle className="text-left text-lg sm:text-xl break-words leading-tight">
              {subscription.products_v2?.name || subscription.products_v2?.code} — {subscription.tariffs?.name}
            </SheetTitle>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <SheetDescription className="text-left text-xs sm:text-sm m-0">
              {subscription.is_trial ? "Пробный период" : "Подписка"}
            </SheetDescription>
            {getStatusBadge()}
          </div>
        </SheetHeader>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
          {/* Dates card */}
          <div className="rounded-xl border border-border/50 bg-card divide-y divide-border/40">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-xs sm:text-sm text-muted-foreground shrink-0">Активирована</span>
              <span className="text-sm font-medium text-right break-words">{formatDate(subscription.access_start_at)}</span>
            </div>

            {subscription.access_end_at && (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs sm:text-sm text-muted-foreground shrink-0">Действует до</span>
                <span className={`text-sm font-medium text-right break-words ${isExpired ? "text-destructive" : isCanceled ? "text-amber-600" : ""}`}>
                  {formatDate(subscription.access_end_at)}
                </span>
              </div>
            )}

            {subscription.next_charge_at && !isCanceled && isActive && (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs sm:text-sm text-muted-foreground shrink-0">Следующее списание</span>
                <span className="text-sm font-medium text-right break-words">{formatShortDate(subscription.next_charge_at)}</span>
              </div>
            )}

            {isCanceled && subscription.cancel_at && (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs sm:text-sm text-muted-foreground shrink-0">Доступ до</span>
                <span className="text-sm font-medium text-right break-words text-amber-600">{formatDate(subscription.cancel_at)}</span>
              </div>
            )}

            {subscription.auto_renew === false && subscription.auto_renew_disabled_by && (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs sm:text-sm text-muted-foreground shrink-0">Автопродление</span>
                <span className="text-sm font-medium text-right break-words text-amber-600">
                  Отключено {subscription.auto_renew_disabled_by === 'admin' ? 'админом' : 'вами'}
                  {subscription.auto_renew_disabled_at && (
                    <span className="text-xs ml-1 text-muted-foreground">
                      ({formatShortDate(subscription.auto_renew_disabled_at)})
                    </span>
                  )}
                </span>
              </div>
            )}

            {subscription.payment_methods?.brand && subscription.payment_methods?.last4 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs sm:text-sm text-muted-foreground shrink-0">Способ оплаты</span>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  {subscription.payment_methods.brand.toUpperCase()} **** {subscription.payment_methods.last4}
                </div>
              </div>
            )}
          </div>

          {/* Payments history card */}
          {visiblePayments.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <h4 className="text-xs sm:text-sm font-medium px-4 py-3 bg-muted/30 border-b border-border/40">
                История платежей
              </h4>
              <div className="divide-y divide-border/40">
                {visiblePayments.map((payment) => {
                  const paymentReceiptUrl = (payment as any).receipt_url || payment.provider_response?.transaction?.receipt_url;
                  return (
                    <div key={payment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium">
                          {payment.amount.toFixed(2)} {payment.currency}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatShortDate(payment.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {paymentReceiptUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            title={payment.status === 'succeeded' ? 'Чек bePaid' : 'Чек ошибки bePaid'}
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
        </div>

        {/* Sticky footer with actions */}
        <div className="border-t border-border/50 bg-background/95 backdrop-blur px-5 sm:px-6 py-4 space-y-2">
          {/* Канонические документы (если есть оплаченный order) */}
          <SubscriptionDocumentActions orderId={lastPaidOrderId} />

          {/* Phase 3.3 — Stripe Customer Portal (self-service). Виден только для provider=stripe. */}
          <StripePortalButton subscriptionV2Id={subscription.id} />

          {receiptUrl && (
            <Button
              variant="default"
              className="w-full gap-2"
              onClick={() => window.open(receiptUrl, '_blank')}
            >
              <ExternalLink className="h-4 w-4" />
              Чек bePaid
            </Button>
          )}

          {/* Legacy виртуальная квитанция — показываем ТОЛЬКО когда нет реального
              эквайрингового чека (для будущих безналичных/рассрочечных сценариев). */}
          {!receiptUrl && (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => onDownloadReceipt(subscription)}
            >
              <Download className="h-4 w-4" />
              Скачать квитанцию
            </Button>
          )}


          {showRenew && (
            <Button
              variant="secondary"
              className="w-full gap-2"
              onClick={() => { window.location.href = '/#pricing'; }}
            >
              <RotateCcw className="h-4 w-4" />
              Продлить подписку
            </Button>
          )}

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

          {resumeSlotApplicable && eligibility?.resume_available && (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => onResume(subscription)}
              disabled={isProcessing || eligibilityLoading}
            >
              <RotateCcw className="h-4 w-4" />
              Возобновить подписку
            </Button>
          )}

          {resumeSlotApplicable && eligibility && !eligibility.resume_available && eligibility.reason !== 'not_needed' && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {eligibility.reason === 'no_payment_method' && 'Эту подписку нельзя возобновить — нужно заново привязать карту или оформить новую подписку.'}
                  {eligibility.reason === 'provider_dead' && 'Подписка отменена на стороне платёжной системы. Возобновить нельзя — оформите новую.'}
                  {eligibility.reason === 'provider_check_failed' && 'Не удалось проверить статус подписки у провайдера. Попробуйте позже или оформите новую подписку.'}
                </span>
              </div>
              <Button
                variant="default"
                className="w-full gap-2"
                onClick={() => { window.location.href = buildPurchaseHref(); }}
                disabled={isProcessing}
              >
                <ShoppingCart className="h-4 w-4" />
                Оформить новую подписку
              </Button>
            </div>
          )}

        </div>
      </SheetContent>
    </Sheet>
  );
}
