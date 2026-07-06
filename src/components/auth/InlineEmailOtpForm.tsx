/**
 * InlineEmailOtpForm — OTP-first inline auth UI.
 *
 * PATCH-INLINE-AUTH-EMAIL-OTP-FLOW Phase 2.
 *
 * Contract:
 *   - Same public shape as InlineAuthForm (initialEmail, onAuthenticated,
 *     contextNote, externalLoading) so callers can swap by feature flag.
 *   - Two visible steps: email → sent (6-digit OTP).
 *   - Real <input> underneath input-otp exposes autocomplete="one-time-code",
 *     inputmode="numeric", maxlength="6" — required for iOS/macOS AutoFill.
 *   - Never opens a new tab; verification finishes in the current window.
 *
 * Optional signup metadata (firstName/lastName/phone) is captured on the email
 * step and passed to signInWithOtp so it lands in user_metadata.
 */
import { FormEvent, useEffect, useState } from "react";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, Mail } from "lucide-react";
import { useInlineEmailOtp } from "@/hooks/useInlineEmailOtp";

export interface InlineEmailOtpFormProps {
  initialEmail?: string;
  onAuthenticated: (email: string, userId?: string) => void | Promise<void>;
  contextNote?: string;
  emailCtaLabel?: string;
  /** Whether parent is processing something after onAuthenticated (payment/submit). */
  externalLoading?: boolean;
  /** Collect name/phone on the email step (leads/signup). */
  collectSignupMeta?: boolean;
}

export function InlineEmailOtpForm({
  initialEmail = "",
  onAuthenticated,
  contextNote,
  emailCtaLabel = "Получить код",
  externalLoading = false,
  collectSignupMeta = false,
}: InlineEmailOtpFormProps) {
  const auth = useInlineEmailOtp();
  const [email, setEmail] = useState(initialEmail);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    if (initialEmail && !email) setEmail(initialEmail);
  }, [initialEmail, email]);

  const isBusy = auth.isSending || auth.isVerifying || externalLoading;

  const handleSendEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    await auth.sendCode(
      email,
      collectSignupMeta ? { firstName, lastName, phone } : undefined,
    );
  };

  const handleVerify = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const result = await auth.verifyCode(code);
    if (result) {
      await onAuthenticated(auth.email, result.userId);
    } else {
      setCode("");
    }
  };

  // Auto-submit once all 6 digits are entered (paste + fill).
  useEffect(() => {
    if (auth.step === "sent" && code.length === 6 && !auth.isVerifying && !externalLoading) {
      handleVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, auth.step]);

  const handleChangeEmail = () => {
    auth.changeEmail();
    setCode("");
  };

  return (
    <div className="space-y-3">
      {contextNote && <p className="text-sm text-muted-foreground">{contextNote}</p>}

      {auth.error && (
        <div className="flex items-start gap-2 text-destructive text-sm p-3 rounded-md bg-destructive/10">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{auth.error}</span>
        </div>
      )}

      {auth.step === "email" && (
        <form onSubmit={handleSendEmail} method="post" action="#" className="space-y-3">
          <div>
            <Label htmlFor="iaf-otp-email">Email</Label>
            <Input
              id="iaf-otp-email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          {collectSignupMeta && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="iaf-otp-first">Имя</Label>
                  <Input
                    id="iaf-otp-first"
                    name="given-name"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="iaf-otp-last">Фамилия</Label>
                  <Input
                    id="iaf-otp-last"
                    name="family-name"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="iaf-otp-phone">Телефон</Label>
                <Input
                  id="iaf-otp-phone"
                  name="tel"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={isBusy}>
            {isBusy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Отправка…</>
            ) : (
              <><Mail className="mr-2 h-4 w-4" /> {emailCtaLabel}</>
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Мы пришлём 6-значный код на email — введите его здесь, ничего открывать не нужно.
          </p>
        </form>
      )}

      {auth.step === "sent" && (
        <form onSubmit={handleVerify} method="post" action="#" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Код отправлен на <strong>{auth.email}</strong>. Введите 6 цифр из письма.
          </p>

          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              autoFocus
              disabled={isBusy}
              // These props flow to the underlying real <input> (input-otp lib):
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              name="one-time-code"
              id="one-time-code"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={isBusy || code.length !== 6}>
            {auth.isVerifying || externalLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Проверка…</>
            ) : (
              "Подтвердить"
            )}
          </Button>

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              onClick={auth.resend}
              disabled={auth.resendIn > 0 || isBusy}
            >
              {auth.resendIn > 0 ? `Отправить снова через ${auth.resendIn}с` : "Отправить код ещё раз"}
            </button>
            <button
              type="button"
              className="text-muted-foreground underline"
              onClick={handleChangeEmail}
              disabled={isBusy}
            >
              Другой email
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
