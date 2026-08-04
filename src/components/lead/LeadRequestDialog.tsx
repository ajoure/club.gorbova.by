import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2, Send, MessageCircle, Mail } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { InlineAuthForm } from "@/components/auth/InlineAuthForm";
import { TelegramCompactCard } from "@/components/telegram/TelegramCompactCard";
import {
  useTelegramLinkStatus,
} from "@/hooks/useTelegramLink";
import type { BankInstallmentRuntime } from "@/lib/bankInstallment";
import { startBankInstallment } from "@/lib/startBankInstallment";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import { useComposableQuoteSummary } from "@/hooks/useComposableQuoteSummary";
import { getAccessAwareUrl } from "@/utils/accessAlias";

interface LeadRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  addonOfferIds?: string[];
  offerLabel?: string;
  /** Название продукта — показывается в подзаголовке шапки как контекст. */
  productName?: string;
  /** Название тарифа — показывается в подзаголовке. */
  tariffName?: string;
  /** Дополнительная ценовая метка (напр. "Бесплатно" или "по договорённости"). */
  priceLabel?: string;
  commentPlaceholder?: string;
  successMessage?: string;
  /** Bank-installment mode: after submit, show HTML message and a CTA leading to the bank. */
  bankLinkUrl?: string;
  bankLinkLabel?: string;
  bankMessageHtml?: string;
  /**
   * Sprint B: если оффер настроен на runtime-провайдера (РР),
   * submit ведёт в public-rr-installment-initiate и клиент редиректится
   * на payment_url. Legacy external_link используется только как fallback
   * при ошибке runtime.
   */
  bankInstallmentRuntime?: BankInstallmentRuntime;
}

type Step = "auth" | "details" | "telegram" | "success";

interface DetailsForm {
  name: string;
  phone: string;
  comment: string;
  website: string; // honeypot
}

const emptyDetails: DetailsForm = {
  name: "",
  phone: "",
  comment: "",
  website: "",
};

export function LeadRequestDialog({
  open,
  onOpenChange,
  offerId,
  addonOfferIds = [],
  offerLabel,
  productName,
  tariffName,
  priceLabel,
  commentPlaceholder,
  successMessage,
  bankLinkUrl,
  bankLinkLabel,
  bankMessageHtml,
  bankInstallmentRuntime,
}: LeadRequestDialogProps) {
  const { user, session } = useAuth();
  const { data: telegramStatus, refetch: refetchTelegram } = useTelegramLinkStatus();
  const quoteSummary = useComposableQuoteSummary({
    open,
    offerId,
    addonOfferIds,
  });

  const contextSubtitle = [productName, tariffName].filter(Boolean).join(" · ");
  const headerSubtitle = contextSubtitle && (offerLabel || priceLabel)
    ? `${contextSubtitle} — ${offerLabel || priceLabel}`
    : contextSubtitle || null;

  const [step, setStep] = useState<Step>(user ? "details" : "auth");
  const [details, setDetails] = useState<DetailsForm>(emptyDetails);
  const [submitting, setSubmitting] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [customerCreditMinor, setCustomerCreditMinor] = useState(0);
  const [useCustomerCredit, setUseCustomerCredit] = useState(false);
  const openedAtRef = useRef<number>(Date.now());
  // Tracks previous `open` value so reset only fires on closed → open.
  // PATCH-INLINE-OTP-FIX-BROKEN-FLOW v3: auth session updates (user/session
  // refetch, telegram status changes) MUST NOT reset the step while the
  // dialog is already open — that was the root of the "form reappears after
  // OTP" regression. See .lovable/proofs/inline_otp_email_sender_root_fix_2026_07.md.
  const wasOpenRef = useRef<boolean>(false);

  // Reset state only on the closed → open transition. Independent of user/session.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      openedAtRef.current = Date.now();
      setDetails(emptyDetails);
      setProfileLoaded(false);
      setStep(user ? "details" : "auth");
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Pre-fill from profile once authenticated.
  useEffect(() => {
    if (!open || !user || profileLoaded) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setDetails((d) => ({
        ...d,
        name: d.name || data?.full_name || "",
        phone: d.phone || data?.phone || "",
      }));
      setProfileLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user, profileLoaded]);

  useEffect(() => {
    if (!open || !user || !bankInstallmentRuntime?.enabled) return;
    (async () => {
      const { data, error } = await (supabase.rpc as any)('referral_get_my_customer_credit');
      if (!error) setCustomerCreditMinor(Math.max(0, Number(data?.available_minor ?? 0)));
    })();
  }, [open, user, bankInstallmentRuntime?.enabled]);

  const canSubmit = useMemo(
    () => details.name.trim().length > 0 && details.phone.trim().length >= 5,
    [details.name, details.phone],
  );

  const handleAuthenticated = () => {
    setStep("details");
  };

  const handleSubmitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      // Sprint B: если оффер настроен на runtime bank installment (РР),
      // идём в public-rr-installment-initiate и редиректим на payment_url.
      // Legacy external_link не показывается, чтобы не было двух ссылок сразу.
      if (bankInstallmentRuntime?.enabled) {
        const email = session?.user?.email || "";
        if (!email) {
          throw new Error("email_required");
        }
        try {
          const res = await startBankInstallment({
            offerId,
            addonOfferIds,
            runtime: bankInstallmentRuntime,
            legacyBankLinkUrl: bankLinkUrl,
            legacyBankLinkLabel: bankLinkLabel,
            legacyBankMessageHtml: bankMessageHtml,
            contact: {
              name: details.name.trim(),
              phone: details.phone.trim(),
              email,
              comment: details.comment.trim() || null,
            },
            customerCreditRequestedMinor: useCustomerCredit ? customerCreditMinor : 0,
          });
          if (res.mode === "runtime") {
            window.location.href = getAccessAwareUrl(res.paymentUrl);
            return;
          }
          // Резолвер вернул legacy — маловероятно при enabled, но подстрахуемся.
          if (res.bankLinkUrl) {
            window.location.href = getAccessAwareUrl(res.bankLinkUrl);
            return;
          }
          throw new Error("no_payment_url_and_no_legacy_link");
        } catch (rrErr) {
          console.error("[LeadRequestDialog] rr initiate failed", rrErr);
          toast.error(
            "Не удалось создать заявку в банк. Открываем резервную страницу оформления.",
          );
          if (bankLinkUrl) {
            window.location.href = getAccessAwareUrl(bankLinkUrl);
            return;
          }
          throw rrErr;
        }
      }

      const { data, error } = await supabase.functions.invoke(
        "submit-lead-request",
        {
          body: {
            offer_id: offerId,
            name: details.name.trim(),
            phone: details.phone.trim(),
            comment: details.comment.trim() || null,
            website: details.website,
            form_opened_at: openedAtRef.current,
          },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Decide next step: telegram prompt if not linked, else success.
      await refetchTelegram();
      const status = telegramStatus?.status;
      if (status !== "active") {
        setStep("telegram");
      } else {
        setStep("success");
      }
    } catch (err) {
      console.error("[LeadRequestDialog] submit failed", err);
      toast.error(
        "Не удалось отправить заявку. Попробуйте ещё раз или напишите нам напрямую.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinishTelegram = () => setStep("success");


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === "auth" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Введите email
              </DialogTitle>
              {headerSubtitle && (
                <DialogDescription className="text-sm text-muted-foreground">
                  {headerSubtitle}
                </DialogDescription>
              )}
            </DialogHeader>
            <InlineAuthForm
              initialEmail={session?.user?.email || ""}
              onAuthenticated={handleAuthenticated}
              emailCtaLabel="Отправить"
              loginCtaLabel="Войти и оставить заявку"
              signupCtaLabel="Создать аккаунт"
            />
          </>
        )}

        {step === "details" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                {offerLabel || "Оставить заявку"}
              </DialogTitle>
              <DialogDescription>
                {headerSubtitle
                  ? `${headerSubtitle}. Проверьте контактные данные — менеджер свяжется с вами.`
                  : "Проверьте контактные данные — менеджер свяжется с вами."}
              </DialogDescription>
            </DialogHeader>
            {quoteSummary.items.length > 0 && quoteSummary.total != null && (
              <OrderSummary
                items={quoteSummary.items}
                currency={quoteSummary.currency}
                total={quoteSummary.total}
                subtotal={quoteSummary.subtotal ?? undefined}
                adjustmentAmount={quoteSummary.adjustmentAmount}
                density="admin"
                className="mb-2"
              />
            )}
            <form onSubmit={handleSubmitLead} className="space-y-4">
              {/* honeypot */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={details.website}
                onChange={(e) =>
                  setDetails({ ...details, website: e.target.value })
                }
                style={{
                  position: "absolute",
                  left: "-9999px",
                  width: 1,
                  height: 1,
                  opacity: 0,
                }}
              />
              {bankInstallmentRuntime?.enabled && (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Данные заявителя
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Укажите данные лица, которое подаёт заявку на рассрочку в
                    банк. Это можете быть вы, супруг(а) или другой родственник.
                    Доступ к продукту всё равно откроется вашему аккаунту{session?.user?.email ? ` (${session.user.email})` : ""}.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="lead-name">Имя заявителя *</Label>
                <Input
                  id="lead-name"
                  value={details.name}
                  onChange={(e) =>
                    setDetails({ ...details, name: e.target.value })
                  }
                  maxLength={100}
                  required
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lead-phone">Телефон заявителя *</Label>
                <Input
                  id="lead-phone"
                  type="tel"
                  value={details.phone}
                  onChange={(e) =>
                    setDetails({ ...details, phone: e.target.value })
                  }
                  placeholder="+375291234567"
                  maxLength={20}
                  required
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lead-comment">Комментарий</Label>
                <Textarea
                  id="lead-comment"
                  value={details.comment}
                  onChange={(e) =>
                    setDetails({ ...details, comment: e.target.value })
                  }
                  maxLength={1000}
                  rows={3}
                  placeholder={commentPlaceholder}
                />
              </div>
              {!bankInstallmentRuntime?.enabled && (
                <p className="text-xs text-muted-foreground">
                  Email <strong>{session?.user?.email}</strong> уже привязан к
                  вашему аккаунту и будет использован для связи.
                </p>
              )}
              {bankInstallmentRuntime?.enabled && customerCreditMinor > 0 && (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-primary/5 p-3">
                  <Checkbox checked={useCustomerCredit} onCheckedChange={(checked) => setUseCustomerCredit(checked === true)} className="mt-0.5" />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">Использовать накопленную скидку</span>
                    <span className="block text-xs text-muted-foreground">Доступно {(customerCreditMinor / 100).toFixed(2)} BYN</span>
                  </span>
                </label>
              )}
              <Button
                type="submit"
                disabled={!canSubmit || submitting}
                className="w-full"
              >
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Отправка…</>
                ) : (
                  <><Send className="mr-2 h-4 w-4" /> Отправить заявку</>
                )}
              </Button>
            </form>
          </>
        )}

        {step === "telegram" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" />
                Заявка принята — свяжемся быстрее в Telegram
              </DialogTitle>
              <DialogDescription>
                Привяжите Telegram — так менеджер сможет ответить в любое
                удобное время, а вы будете получать напоминания и материалы
                прямо в мессенджере. Это займёт 10 секунд.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <TelegramCompactCard />
              <Button
                onClick={handleFinishTelegram}
                variant="ghost"
                className="w-full"
              >
                {telegramStatus?.status === "active"
                  ? "Готово"
                  : "Пропустить — привяжу позже"}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Позже привязать Telegram можно в личном кабинете.
              </p>
            </div>
          </>
        )}


        {step === "success" && (
          <div className="py-6 text-center space-y-4">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
            <DialogTitle>Заявка отправлена</DialogTitle>
            <DialogDescription>
              {successMessage ||
                "Спасибо! Мы свяжемся с вами в ближайшее время."}
            </DialogDescription>
            {bankMessageHtml && (
              <div
                className="text-sm text-left text-foreground/90 bg-muted/40 rounded-md p-3 [&_a]:text-primary [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: bankMessageHtml }}
              />
            )}
            {bankLinkUrl && (
              <Button asChild className="w-full">
                <a href={bankLinkUrl} target="_blank" rel="noopener noreferrer">
                  {bankLinkLabel || "Перейти к оформлению в банк"}
                </a>
              </Button>
            )}
            <Button
              onClick={() => onOpenChange(false)}
              variant={bankLinkUrl ? "ghost" : "default"}
              className="w-full"
            >
              Закрыть
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
