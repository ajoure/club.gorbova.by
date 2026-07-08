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
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2, Send, MessageCircle, Mail } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { InlineAuthForm } from "@/components/auth/InlineAuthForm";
import { TelegramCompactCard } from "@/components/telegram/TelegramCompactCard";
import {
  useTelegramLinkStatus,
} from "@/hooks/useTelegramLink";

interface LeadRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
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
  offerLabel,
  productName,
  tariffName,
  priceLabel,
  commentPlaceholder,
  successMessage,
}: LeadRequestDialogProps) {
  const { user, session } = useAuth();
  const { data: telegramStatus, refetch: refetchTelegram } = useTelegramLinkStatus();

  const contextSubtitle = [productName, tariffName].filter(Boolean).join(" · ");
  const headerSubtitle = contextSubtitle && (offerLabel || priceLabel)
    ? `${contextSubtitle} — ${offerLabel || priceLabel}`
    : contextSubtitle || null;

  const [step, setStep] = useState<Step>(user ? "details" : "auth");
  const [details, setDetails] = useState<DetailsForm>(emptyDetails);
  const [submitting, setSubmitting] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
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
              <div className="space-y-2">
                <Label htmlFor="lead-name">Имя *</Label>
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
                <Label htmlFor="lead-phone">Телефон *</Label>
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
              <p className="text-xs text-muted-foreground">
                Email <strong>{session?.user?.email}</strong> уже привязан к
                вашему аккаунту и будет использован для связи.
              </p>
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
            <Button onClick={() => onOpenChange(false)} className="w-full">
              Закрыть
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
