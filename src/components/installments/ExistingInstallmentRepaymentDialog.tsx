import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CreditCard,
  FileText,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  ShoppingBag,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { PaymentLinkSuccessPanel } from "@/components/payment/PaymentLinkSuccessPanel";
import {
  escapeTelegramHtml,
  sendPaymentLinkToTelegram,
} from "@/lib/sendPaymentLinkToTelegram";
import { cn } from "@/lib/utils";
import { normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";
import type { UiPlan } from "@/hooks/useContactInstallmentsData";

type Quote = {
  fingerprint: string;
  payment_type: "one_time" | "subscription";
  remaining_minor: number;
  schedule_minor: number[];
  interval_days: number;
  replaces_live_mandate: boolean;
  preserves_purchase: true;
  changes_access: false;
};

type BusyAction = "recover" | "quote" | "create" | "create_and_send" | "send" | null;

interface ExistingInstallmentRepaymentDialogProps {
  plan: UiPlan;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  telegramUserId?: number | null;
}

const money = (minor: number, currency = "BYN") =>
  `${(minor / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;

const countLabel = (count: number) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "платёж";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "платежа";
  return "платежей";
};

const ERROR_MESSAGES: Record<string, string> = {
  autopay_requires_equal_remaining_payments:
    "Для автоплатежей остаток должен делиться на равные платежи.",
  repayment_below_minimum: "Один платёж не может быть меньше 1 BYN.",
  repayment_quote_changed:
    "Баланс рассрочки изменился. Закройте окно, обновите карточку и рассчитайте график заново.",
  installment_agreement_requires_review:
    "Эта рассрочка требует ручной проверки перед созданием новой ссылки.",
  installment_multiple_live_mandates:
    "Найдено несколько активных автосписаний. Сначала нужна ручная проверка.",
};

export function ExistingInstallmentRepaymentDialog({
  plan,
  userId,
  userName,
  userEmail,
  telegramUserId,
}: ExistingInstallmentRepaymentDialogProps) {
  // Для погашения существующей рассрочки владелец выбранной сделки —
  // единственный канонический получатель. Контактный prop может быть устаревшим
  // после merge/перепривязки профиля и не должен переопределять order.user_id.
  const resolvedUserId = plan.userId || userId || null;
  const naturalRemainingCount = Math.max(
    1,
    Math.ceil(plan.remainingTotal / Math.max(plan.perPayment, 1)),
  );
  const defaultCount = Math.max(2, naturalRemainingCount);
  const [open, setOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<"one_time" | "subscription">(
    naturalRemainingCount >= 2 ? "subscription" : "one_time",
  );
  const [count, setCount] = useState(defaultCount);
  const [reason, setReason] = useState(
    "Клиент запросил новую ссылку и переразбиение остатка рассрочки",
  );
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const requestId = useRef(crypto.randomUUID());
  const activeLookupDone = useRef(false);

  const resetQuote = () => {
    setQuote(null);
    setLink(null);
    setReplaceConfirmed(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && busyAction) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      resetQuote();
      requestId.current = crypto.randomUUID();
      activeLookupDone.current = false;
    }
  };

  const selectedCount = paymentType === "one_time" ? 1 : count;

  useEffect(() => {
    if (!open || activeLookupDone.current) return;
    activeLookupDone.current = true;
    let cancelled = false;

    const recoverActiveLink = async () => {
      setBusyAction("recover");
      try {
        const { data, error } = await supabase.functions.invoke(
          "admin-create-public-link",
          {
            body: {
              repayment: {
                action: "get_active",
                order_id: plan.orderId,
                payment_type: paymentType,
              },
            },
          },
        );
        if (error || data?.success === false || data?.error) {
          throw new Error(
            error
              ? await normalizeEdgeFunctionErrorAsync(error, data)
              : data?.error || "Не удалось проверить существующую ссылку",
          );
        }
        const active = data?.active_link;
        if (!cancelled && active?.public_url && active?.quote) {
          const activeQuote = active.quote as Quote;
          setPaymentType(activeQuote.payment_type);
          setCount(Math.max(2, activeQuote.schedule_minor.length));
          setQuote(activeQuote);
          setLink(String(active.public_url));
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Не удалось проверить существующую ссылку",
          );
        }
      } finally {
        if (!cancelled) setBusyAction(null);
      }
    };

    void recoverActiveLink();
    return () => {
      cancelled = true;
    };
  }, [open, paymentType, plan.orderId]);

  const requestQuote = async () => {
    setBusyAction("quote");
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-create-public-link",
        {
          body: {
            repayment: {
              action: "quote",
              order_id: plan.orderId,
              payment_type: paymentType,
              count: selectedCount,
              interval_days: 30,
            },
          },
        },
      );
      if (error || data?.success === false || data?.error) {
        throw new Error(
          error
            ? await normalizeEdgeFunctionErrorAsync(error, data)
            : data?.error || "Не удалось рассчитать график",
        );
      }
      setQuote(data.quote as Quote);
      setLink(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось рассчитать график";
      toast.error(ERROR_MESSAGES[message] || message);
    } finally {
      setBusyAction(null);
    }
  };

  const buildTelegramMessage = (createdQuote: Quote) => {
    const typeLine =
      createdQuote.payment_type === "subscription"
        ? `Автоплатежи · ${createdQuote.schedule_minor.length} ${countLabel(createdQuote.schedule_minor.length)} · каждые ${createdQuote.interval_days} дней`
        : "Разовый платёж всего остатка";
    return `💳 <b>Оплата остатка по рассрочке</b>

📦 Продукт: ${escapeTelegramHtml(plan.productName)}
📋 Тариф: ${escapeTelegramHtml(plan.tariffName)}
💰 Остаток: ${money(createdQuote.remaining_minor, plan.currency)}
📅 Тип: ${typeLine}`;
  };

  const sendLink = async (paymentUrl: string, createdQuote: Quote) => {
    if (!resolvedUserId) throw new Error("У контакта нет пользователя для отправки");
    await sendPaymentLinkToTelegram({
      userId: resolvedUserId,
      paymentUrl,
      message: buildTelegramMessage(createdQuote),
    });
  };

  const createLink = async (sendImmediately: boolean) => {
    if (!quote) return;
    setBusyAction(sendImmediately ? "create_and_send" : "create");
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-create-public-link",
        {
          body: {
            repayment: {
              action: "create",
              order_id: plan.orderId,
              payment_type: paymentType,
              count: selectedCount,
              interval_days: 30,
              expected_fingerprint: quote.fingerprint,
              replace_mandate_confirmed: replaceConfirmed,
              request_id: requestId.current,
              reason: reason.trim(),
            },
          },
        },
      );
      if (error || data?.success === false || data?.error) {
        throw new Error(
          error
            ? await normalizeEdgeFunctionErrorAsync(error, data)
            : data?.error || "Не удалось создать ссылку",
        );
      }

      const publicUrl = String(data.public_url);
      setLink(publicUrl);

      if (sendImmediately) {
        try {
          await sendLink(publicUrl, quote);
          toast.success("Ссылка создана и отправлена клиенту в Telegram");
        } catch (telegramError) {
          toast.warning(
            `Ссылка создана, но отправка в Telegram не удалась: ${
              telegramError instanceof Error ? telegramError.message : "неизвестная ошибка"
            }`,
          );
        }
      } else {
        toast.success("Ссылка на оплату создана");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось создать ссылку";
      toast.error(ERROR_MESSAGES[message] || message);
    } finally {
      setBusyAction(null);
    }
  };

  const sendCreatedLink = async () => {
    if (!link || !quote) return;
    setBusyAction("send");
    try {
      await sendLink(link, quote);
      toast.success("Ссылка отправлена клиенту в Telegram");
    } catch (error) {
      toast.error(
        `Не удалось отправить ссылку: ${
          error instanceof Error ? error.message : "неизвестная ошибка"
        }`,
      );
    } finally {
      setBusyAction(null);
    }
  };

  const isCountValid = Number.isInteger(count) && count >= 2 && count <= 60;
  const canCreate =
    Boolean(quote) &&
    !busyAction &&
    reason.trim().length > 0 &&
    (!quote?.replaces_live_mandate || replaceConfirmed);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="gap-1.5"
          disabled={plan.uiStatus !== "active" || plan.remainingTotal <= 0}
        >
          <Link2 className="h-3.5 w-3.5" />
          Создать ссылку на остаток
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[min(94vw,760px)] overflow-y-auto overflow-x-hidden p-4 sm:max-w-[760px] sm:p-6">
        <DialogHeader className="pr-6 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <WalletCards className="h-5 w-5 text-primary" />
            </span>
            Оплата по существующей рассрочке
          </DialogTitle>
          <DialogDescription className="leading-5">
            Платёж погасит остаток этой сделки. Новый продукт, новая сделка и дополнительный доступ не создаются.
          </DialogDescription>
        </DialogHeader>

        {link && quote ? (
          <div className="pt-2">
            <PaymentLinkSuccessPanel
              url={link}
              summary={(
                <>
                  <span className="font-medium text-foreground">{plan.productName}</span>
                  <span> · {plan.tariffName}</span>
                  <br />
                  <span>
                    {quote.payment_type === "subscription"
                      ? `${quote.schedule_minor.length} × ${money(quote.schedule_minor[0], plan.currency)}`
                      : money(quote.remaining_minor, plan.currency)}
                  </span>
                </>
              )}
              canSendTelegram={Boolean(telegramUserId && resolvedUserId)}
              isSendingTelegram={busyAction === "send"}
              onSendTelegram={sendCreatedLink}
            />
            <Button
              type="button"
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => handleOpenChange(false)}
            >
              Готово
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              {(userName || userEmail) && (
                <div className="rounded-xl border bg-muted/35 p-3 sm:p-4">
                  <p className="truncate font-medium">{userName || "Клиент"}</p>
                  {userEmail && (
                    <p className="truncate text-sm text-muted-foreground">{userEmail}</p>
                  )}
                </div>
              )}

              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
                    <ShoppingBag className="h-4 w-4 text-indigo-500" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Выбранная сделка
                    </p>
                    <p className="mt-1 font-semibold leading-5">{plan.productName}</p>
                    <p className="text-sm text-muted-foreground">Тариф «{plan.tariffName}»</p>
                  </div>
                  {plan.orderNumber && (
                    <span className="hidden max-w-36 truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground sm:block">
                      {plan.orderNumber}
                    </span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-muted/45 p-3">
                    <p className="text-xs text-muted-foreground">Стоимость</p>
                    <p className="mt-1 font-semibold">{plan.effectiveTotal.toFixed(2)} {plan.currency}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-500/[0.07] p-3">
                    <p className="text-xs text-muted-foreground">Оплачено</p>
                    <p className="mt-1 font-semibold text-emerald-700 dark:text-emerald-400">
                      {plan.paidTotal.toFixed(2)} {plan.currency}
                    </p>
                  </div>
                  <div className="col-span-2 rounded-lg bg-primary/[0.07] p-3 sm:col-span-1">
                    <p className="text-xs text-muted-foreground">Остаток</p>
                    <p className="mt-1 text-lg font-bold text-primary">
                      {plan.remainingTotal.toFixed(2)} {plan.currency}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-card p-4 space-y-3">
                <Label>Как принять остаток</Label>
                <RadioGroup
                  value={paymentType}
                  onValueChange={(value) => {
                    const nextType = value as typeof paymentType;
                    setPaymentType(nextType);
                    if (nextType === "subscription" && count < 2) setCount(defaultCount);
                    resetQuote();
                  }}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <Label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 font-normal transition-colors",
                      paymentType === "one_time" && "border-primary bg-primary/[0.05] ring-1 ring-primary",
                    )}
                  >
                    <RadioGroupItem value="one_time" className="mt-0.5" />
                    <span>
                      <span className="flex items-center gap-2 font-medium">
                        <CreditCard className="h-4 w-4" /> Разовый платёж
                      </span>
                      <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                        Клиент оплачивает весь остаток один раз
                      </span>
                    </span>
                  </Label>
                  <Label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 font-normal transition-colors",
                      paymentType === "subscription" && "border-primary bg-primary/[0.05] ring-1 ring-primary",
                    )}
                  >
                    <RadioGroupItem value="subscription" className="mt-0.5" />
                    <span>
                      <span className="flex items-center gap-2 font-medium">
                        <RefreshCw className="h-4 w-4" /> Автоплатежи
                      </span>
                      <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                        Первый платёж сейчас, остальные каждые 30 дней
                      </span>
                    </span>
                  </Label>
                </RadioGroup>

                {paymentType === "subscription" && (
                  <div className="space-y-2 pt-1">
                    <Label htmlFor="repayment-count">Количество оставшихся платежей</Label>
                    <Input
                      id="repayment-count"
                      type="number"
                      min={2}
                      max={60}
                      value={count}
                      onChange={(event) => {
                        setCount(Number(event.target.value));
                        resetQuote();
                      }}
                    />
                    <p className="text-xs leading-4 text-muted-foreground">
                      Остаток будет разделён поровну. Интервал между списаниями — 30 дней.
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-xl border bg-card p-4 space-y-2">
                <Label htmlFor="repayment-reason" className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Причина изменения графика
                </Label>
                <Textarea
                  id="repayment-reason"
                  value={reason}
                  maxLength={1000}
                  rows={2}
                  onChange={(event) => setReason(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Причина сохранится в журнале действий по сделке.
                </p>
              </div>

              {quote && (
                <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4 text-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <p className="font-semibold">Новый график</p>
                    <span className="ml-auto rounded-full bg-background px-2 py-1 text-xs text-muted-foreground">
                      Итого {money(quote.remaining_minor, plan.currency)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {quote.schedule_minor.map((amount, index) => (
                      <div
                        key={`${index}-${amount}`}
                        className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5"
                      >
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {index + 1}
                          </span>
                          {index === 0 ? "Сегодня" : `Через ${quote.interval_days * index} дней`}
                        </span>
                        <b>{money(amount, plan.currency)}</b>
                      </div>
                    ))}
                  </div>

                  {quote.replaces_live_mandate && (
                    <Label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 font-normal">
                      <Checkbox
                        checked={replaceConfirmed}
                        onCheckedChange={(checked) => setReplaceConfirmed(checked === true)}
                        className="mt-0.5"
                      />
                      <span className="leading-5">
                        После первого успешного платежа заменить прежнее автосписание новым, чтобы исключить двойное списание.
                      </span>
                    </Label>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              {!quote ? (
                <>
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                    Отмена
                  </Button>
                  <Button
                    type="button"
                    onClick={requestQuote}
                    disabled={
                      Boolean(busyAction) ||
                      !reason.trim() ||
                      (paymentType === "subscription" && !isCountValid)
                    }
                  >
                    {busyAction === "quote" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Рассчитать график
                  </Button>
                </>
              ) : (
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" onClick={resetQuote} disabled={Boolean(busyAction)}>
                    Изменить
                  </Button>
                  <Button
                    type="button"
                    variant={telegramUserId && resolvedUserId ? "outline" : "default"}
                    onClick={() => createLink(false)}
                    disabled={!canCreate}
                  >
                    {busyAction === "create" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" />
                    )}
                    Создать ссылку
                  </Button>
                  {telegramUserId && resolvedUserId && (
                    <Button
                      type="button"
                      className="sm:col-span-2"
                      onClick={() => createLink(true)}
                      disabled={!canCreate}
                    >
                      {busyAction === "create_and_send" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Создать и отправить в Telegram
                    </Button>
                  )}
                </div>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
