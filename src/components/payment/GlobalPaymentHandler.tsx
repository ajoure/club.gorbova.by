import { courseAccessEndForPurchase, hasFixedExclusiveCourseEnd } from '../../../supabase/functions/_shared/course-access-window';
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  CheckCircle,
  CreditCard,
  Loader2,
  MessageCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { ru } from "date-fns/locale";
import { formatInTimeZone } from 'date-fns-tz';

interface OrderInfo {
  order_id: string;
  order_number: string;
  final_price: number;
  currency: string;
  product_name: string;
  tariff_name: string;
  access_days: number;
  access_start_at: string;
  access_end_at: string;
  created_at: string;
  is_trial: boolean;
  zg27_installment?: boolean;
  zg27_mandate_state?: string;
  access_end_exclusive?: boolean;
}

type FlowState = "processing" | "success" | "setup_failed";

type OrderRow = {
  id: string;
  status: string;
  order_number: string;
  final_price: number;
  currency: string;
  created_at: string;
  is_trial: boolean;
  trial_end_at: string | null;
  meta: { trial_days?: number; offer_id?: string; zg27_installment?: unknown; zg27_mandate_state?: string } | null;
  products_v2: { name: string } | null;
  purchase_snapshot?: unknown;
  tariffs: { name: string; access_days: number | null; trial_days: number | null; meta?: unknown } | null;
  payments_v2: Array<{ status: string | null }>;
};

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 60000;

// The canonical hosted checkout returns status=success/decline/fail, while
// saved-card and older callers return payment=*. Both enter receipt polling;
// a URL status itself never confirms payment or activates a subscription.
function paymentReturnState(params: URLSearchParams): string | null {
  const explicit = params.get('payment');
  if (explicit) return explicit;
  if (!params.get('order')) return null;
  const states: Record<string, string> = { success: 'processing', decline: 'failed', fail: 'failed' };
  return states[params.get('status') ?? ''] ?? null;
}

export function GlobalPaymentHandler() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [successOpen, setSuccessOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [flowState, setFlowState] = useState<FlowState>("processing");
  const [checking, setChecking] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);

  const pollIntervalRef = useRef<number | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  };

  const clearPaymentParams = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("payment");
    next.delete("status");
    next.delete("order");
    setSearchParams(next);
  };

  const formatCurrency = (amount: number, currency: string) => {
    const symbols: Record<string, string> = {
      BYN: "Br",
      USD: "$",
      EUR: "€",
      RUB: "₽",
    };
    return `${amount} ${symbols[currency] || currency}`;
  };

  const buildOrderInfo = (data: OrderRow): OrderInfo => {
    const now = new Date();
    const isTrial = !!data.is_trial;
    const trialEndAtRaw = data.trial_end_at;
    const metaTrialDays = data.meta?.trial_days;

    const tariffAccessDays = data.tariffs?.access_days || 30;
    const tariffTrialDays = data.tariffs?.trial_days || 5;

    // For trial: priority - trial_end_at > meta.trial_days > tariff.trial_days
    let accessEndAt: Date;
    let accessDays: number;

    if (isTrial) {
      if (trialEndAtRaw) {
        accessEndAt = new Date(trialEndAtRaw);
        accessDays = Math.max(1, differenceInCalendarDays(accessEndAt, now));
      } else {
        accessDays = metaTrialDays || tariffTrialDays || 5;
        accessEndAt = addDays(now, accessDays);
      }
    } else {
      accessDays = tariffAccessDays;
      accessEndAt = courseAccessEndForPurchase(data.tariffs?.meta, data.purchase_snapshot) || addDays(now, accessDays);
    }

    return {
      order_id: data.id,
      order_number: data.order_number,
      final_price: Number(data.final_price),
      currency: data.currency,
      product_name: data.products_v2?.name || "Продукт",
      tariff_name: data.tariffs?.name || (isTrial ? "Пробный период" : "Тариф"),
      access_days: accessDays,
      access_start_at: now.toISOString(),
      access_end_at: accessEndAt.toISOString(),
      created_at: data.created_at,
      is_trial: isTrial,
      zg27_installment: !!data.meta?.zg27_installment,
      zg27_mandate_state: data.meta?.zg27_mandate_state,
      access_end_exclusive: hasFixedExclusiveCourseEnd(data.tariffs?.meta, data.purchase_snapshot),
    };
  };

  const fetchOrderOnce = async (): Promise<OrderRow | null> => {
    if (!user) return null;

    const orderIdParam = searchParams.get("order");

    let query = supabase
      .from("orders_v2")
      .select(
        `
        id,
        status,
        order_number,
        final_price,
        currency,
        created_at,
        purchase_snapshot,
        is_trial,
        trial_end_at,
        meta,
        products_v2 (name),
        tariffs (name, access_days, trial_days, meta),
        payments_v2 (status)
      `
      )
      .eq("user_id", user.id);

    if (orderIdParam) {
      query = query.eq("id", orderIdParam);
    } else {
      query = query.order("created_at", { ascending: false }).limit(1);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;

    return (data as unknown as OrderRow) || null;
  };

  const startPolling = async () => {
    stopPolling();
    setTimedOut(false);
    setChecking(true);
    setOrderInfo(null);
    setFlowState("processing");

    const tick = async () => {
      try {
        const order = await fetchOrderOnce();
        if (!order) return;

        const paymentStatus = order.payments_v2?.[0]?.status || null;
        const isPaid = order.status === "paid" || paymentStatus === "succeeded";
        const isFailed = order.status === "failed" || paymentStatus === "failed";

        if (isPaid) {
          if (order.meta?.zg27_installment && order.meta.zg27_mandate_state !== 'ready') {
            if (order.meta.zg27_mandate_state === 'setup_failed') {
              setOrderInfo(buildOrderInfo(order));
              setFlowState('setup_failed');
              setChecking(false);
              stopPolling();
            }
            return;
          }
          setOrderInfo(buildOrderInfo(order));
          setFlowState("success");
          setChecking(false);
          stopPolling();
          return;
        }

        if (isFailed) {
          setChecking(false);
          stopPolling();
          setSuccessOpen(false);
          setFailedOpen(true);
          return;
        }

        // still pending / processing
        setFlowState("processing");
      } catch (e) {
        console.error("Error checking payment status:", e);
      }
    };

    await tick();

    pollIntervalRef.current = window.setInterval(tick, POLL_INTERVAL_MS);
    pollTimeoutRef.current = window.setTimeout(() => {
      setTimedOut(true);
      setChecking(false);
      stopPolling();
    }, POLL_TIMEOUT_MS);
  };

  useEffect(() => {
    const paymentParam = paymentReturnState(searchParams);

    // Skip if no payment param
    if (!paymentParam) {
      return;
    }

    if (paymentParam === "failed") {
      stopPolling();
      setFailedOpen(true);
      setSuccessOpen(false);
      setOrderInfo(null);
      setChecking(false);
      return;
    }

    if (paymentParam === "success" || paymentParam === "processing") {
      setFailedOpen(false);
      setSuccessOpen(true);
      setOrderInfo(null);
      setFlowState("processing");

      if (user) {
        startPolling();
      } else {
        // If user session was lost during 3DS redirect, we cannot read protected order data.
        setChecking(false);
      }
      return;
    }
  }, [searchParams, user]);

  // Separate effect to handle dialog closing when payment param is removed
  useEffect(() => {
    const paymentParam = paymentReturnState(searchParams);
    if (!paymentParam && (successOpen || failedOpen)) {
      stopPolling();
      setSuccessOpen(false);
      setFailedOpen(false);
      setOrderInfo(null);
      setChecking(false);
      setTimedOut(false);
    }
  }, [searchParams]);

  useEffect(() => () => stopPolling(), []);

  const goToPurchases = () => {
    queryClient.invalidateQueries({ queryKey: ["user-orders-v2"] });
    queryClient.invalidateQueries({ queryKey: ["user-subscriptions-v2"] });
    clearPaymentParams();
    if (location.pathname !== "/purchases") {
      window.location.href = "/purchases";
    }
  };

  const handleSuccessClose = () => {
    setSuccessOpen(false);
    clearPaymentParams();
    // Refresh purchases/subscriptions after confirmed success
    queryClient.invalidateQueries({ queryKey: ["user-orders-v2"] });
    queryClient.invalidateQueries({ queryKey: ["user-subscriptions-v2"] });
  };

  const handleFailedClose = () => {
    setFailedOpen(false);
    clearPaymentParams();
  };

  const formatDateRu = (dateIso: string) => format(new Date(dateIso), "d MMMM yyyy", { locale: ru });

  return (
    <>
      {/* Processing / Success Dialog - modal that user must interact with */}
      <Dialog open={successOpen} onOpenChange={() => {}}>
        <DialogContent 
          className="sm:max-w-md" 
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              {flowState === 'setup_failed' ? <XCircle className="h-6 w-6 text-destructive" /> : flowState === "success" ? (
                <CheckCircle className="h-6 w-6 text-green-500" />
              ) : (
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              )}
              {flowState === 'setup_failed' ? 'Подписка не подтверждена' : flowState === "success" ? "Оплата подтверждена!" : "Проверяем оплату..."}
            </DialogTitle>
          </DialogHeader>

          {!user ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Мы вернули вас после 3‑D Secure, но сессия входа не сохранилась. Войдите в аккаунт — и мы покажем итог по заказу.
              </p>
              <Button className="w-full" onClick={() => window.location.href = "/auth?redirectTo=%2Fpurchases"}>
                Войти и открыть «Мои покупки»
              </Button>
            </div>
          ) : flowState === 'setup_failed' ? (
            <div className="space-y-4">
              <p className="text-sm">Платёж получен, но обязательную подписку с автосписаниями подтвердить не удалось. Доступ по рассрочке ещё не открыт. Не оплачивайте первый взнос повторно — обратитесь в поддержку с номером заказа {orderInfo?.order_number}.</p>
              <Button className="w-full" onClick={goToPurchases}>Открыть заказ в моих покупках</Button>
              <Button variant="outline" className="w-full" onClick={handleSuccessClose}>Закрыть</Button>
            </div>
          ) : flowState === "processing" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
                <p className="text-sm text-foreground">Ждём подтверждение платежа от банка и платёжного сервиса.</p>
                {timedOut && (
                  <p className="text-sm text-muted-foreground">
                    Проверка заняла больше минуты. Это нормально для некоторых банков — статус появится в «Моих покупках».
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Button className="w-full" onClick={goToPurchases}>
                  Перейти в мои покупки
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setTimedOut(false);
                    startPolling();
                  }}
                  disabled={checking}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Обновить статус
                </Button>
              </div>
            </div>
          ) : orderInfo ? (
            <div className="space-y-4">
              {/* Success banner */}
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4">
                <p className="text-sm text-green-800 dark:text-green-200 font-medium">
                  🎉 Поздравляем! Ваш платёж успешно обработан.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <CreditCard className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{orderInfo.product_name}</p>
                    <p className="text-sm text-muted-foreground truncate">{orderInfo.tariff_name}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
                  <div className="space-y-1">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">Тип доступа:</span> {orderInfo.is_trial ? "Пробный период" : "Полный доступ"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      С {formatDateRu(orderInfo.access_start_at)} по {orderInfo.access_end_exclusive
                        ? formatInTimeZone(new Date(Date.parse(orderInfo.access_end_at) - 1), 'Europe/Minsk', 'd MMMM yyyy', { locale: ru })
                        : formatDateRu(orderInfo.access_end_at)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm bg-muted/50 rounded-lg p-3">
                <span className="text-muted-foreground">{orderInfo.zg27_installment ? 'Всего по заказу:' : 'Сумма платежа:'}</span>
                <span className="font-semibold text-foreground text-lg">
                  {formatCurrency(orderInfo.final_price, orderInfo.currency)}
                </span>
              </div>

              {orderInfo.zg27_installment && <p className="rounded-lg border p-3 text-sm">
                Подписка подтверждена. Первый платёж получен, оставшиеся взносы будут списываться автоматически по согласованному графику. После последнего платежа списания прекращаются.
              </p>}

              <div className="flex flex-col gap-2">
                <Button className="w-full" onClick={goToPurchases}>
                  Перейти в мои покупки
                </Button>
                <Button variant="outline" className="w-full" onClick={handleSuccessClose}>
                  Закрыть
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4">
                <p className="text-sm text-green-800 dark:text-green-200">
                  Платёж успешно подтверждён!
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Детали заказа загружаются. Проверьте раздел «Мои покупки».
              </p>
              <div className="flex flex-col gap-2">
                <Button className="w-full" onClick={goToPurchases}>
                  Перейти в мои покупки
                </Button>
                <Button variant="outline" className="w-full" onClick={handleSuccessClose}>
                  Закрыть
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Failed Dialog */}
      <Dialog open={failedOpen} onOpenChange={(isOpen) => !isOpen && handleFailedClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <XCircle className="h-6 w-6 text-destructive" />
              Платёжная форма вернула отказ
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
              <p className="text-sm text-foreground">
                Проверьте актуальный статус заказа в «Моих покупках». Если деньги уже списались, не оплачивайте повторно — дождитесь подтверждения или обратитесь в поддержку.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={() => { handleFailedClose(); goToPurchases(); }} className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Проверить статус в моих покупках
              </Button>

              <Button variant="outline" onClick={handleFailedClose} className="w-full">
                <MessageCircle className="mr-2 h-4 w-4" />
                Закрыть
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

