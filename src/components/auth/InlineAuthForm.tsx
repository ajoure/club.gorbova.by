/**
 * InlineAuthForm — canonical inline auth UI used by every public/identity flow.
 *
 * Single source of truth for: email → login (+forgot) → signup → email_confirm.
 * Wrapped around `useInlineAuth` so behaviour stays in lockstep with PaymentDialog
 * and site-renderer FormSection (auth_mode).
 *
 * Anti-duplication contract (mem://ui/auth/inline-auth-form-standard):
 *   - Do NOT fork email/password/forgot logic anywhere else.
 *   - Callers control post-auth behaviour via onAuthenticated callback.
 *   - Caller is responsible for "next action" (e.g. trigger payment) after
 *     onAuthenticated fires — this component only handles identity.
 */
import { useState, useEffect, FormEvent } from "react";
import { useInlineAuth } from "@/hooks/useInlineAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, AlertCircle, CheckCircle2 } from "lucide-react";

export interface InlineAuthFormProps {
  /** Pre-fill email (e.g. from session); user may override. */
  initialEmail?: string;
  /** Called after a successful login/signup-with-session. */
  onAuthenticated: (email: string, userId?: string) => void | Promise<void>;
  /** Optional context label shown above the form. */
  contextNote?: string;
  /** Submit button label override on email step. Default: "Продолжить". */
  emailCtaLabel?: string;
  /** Submit button label override on login step. Default: "Войти". */
  loginCtaLabel?: string;
  /** Submit button label override on signup step. Default: "Зарегистрироваться". */
  signupCtaLabel?: string;
  /** Whether parent is processing something after onAuthenticated (e.g. payment). */
  externalLoading?: boolean;
}

export function InlineAuthForm({
  initialEmail = "",
  onAuthenticated,
  contextNote,
  emailCtaLabel = "Продолжить",
  loginCtaLabel = "Войти",
  signupCtaLabel = "Зарегистрироваться",
  externalLoading = false,
}: InlineAuthFormProps) {
  const auth = useInlineAuth();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  // Keep email in sync if parent provides it later (e.g. after session restored)
  useEffect(() => {
    if (initialEmail && !email) setEmail(initialEmail);
  }, [initialEmail, email]);

  const isBusy = auth.isLoading || externalLoading;

  const handleEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    await auth.checkEmail(email.trim());
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    const result = await auth.login(email, password);
    if (result) await onAuthenticated(email.trim().toLowerCase(), result.userId);
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    const result = await auth.signup(email, password, { firstName, lastName, phone });
    if (result && !result.needsConfirmation) {
      await onAuthenticated(email.trim().toLowerCase(), result.userId);
    }
  };

  const handleForgot = async () => {
    await auth.requestPasswordReset(email);
  };

  const useDifferentEmail = () => {
    auth.reset();
    setPassword("");
  };

  return (
    <div className="space-y-3">
      {contextNote && (
        <p className="text-sm text-muted-foreground">{contextNote}</p>
      )}

      {auth.error && (
        <div className="flex items-start gap-2 text-destructive text-sm p-3 rounded-md bg-destructive/10">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{auth.error}</span>
        </div>
      )}

      {auth.step === "email" && (
        <form onSubmit={handleEmail} method="post" action="#" className="space-y-3">
          <div>
            <Label htmlFor="iaf-email">Email</Label>
            <Input
              id="iaf-email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={isBusy}>
            {isBusy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Проверка…</>
            ) : (
              <><Mail className="mr-2 h-4 w-4" /> {emailCtaLabel}</>
            )}
          </Button>
        </form>
      )}

      {auth.step === "login" && (
        <form onSubmit={handleLogin} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Аккаунт <strong>{email}</strong> найден. Введите пароль, чтобы продолжить.
          </p>
          <div>
            <Label htmlFor="iaf-password">Пароль</Label>
            <Input
              id="iaf-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={isBusy}>
            {isBusy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Вход…</>
            ) : (
              loginCtaLabel
            )}
          </Button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={handleForgot}
              disabled={isBusy}
            >
              Забыли пароль?
            </button>
            <button
              type="button"
              className="text-muted-foreground underline"
              onClick={useDifferentEmail}
              disabled={isBusy}
            >
              Другой email
            </button>
          </div>
        </form>
      )}

      {auth.step === "signup" && (
        <form onSubmit={handleSignup} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Создайте аккаунт для <strong>{email}</strong>, чтобы продолжить.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="iaf-first">Имя</Label>
              <Input id="iaf-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="iaf-last">Фамилия</Label>
              <Input id="iaf-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="iaf-phone">Телефон</Label>
            <Input id="iaf-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="iaf-pw-new">Пароль</Label>
            <Input
              id="iaf-pw-new"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={isBusy}>
            {isBusy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Создание…</>
            ) : (
              signupCtaLabel
            )}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline w-full text-center"
            onClick={useDifferentEmail}
            disabled={isBusy}
          >
            Другой email
          </button>
        </form>
      )}

      {auth.step === "email_confirm" && (
        <div className="text-center text-sm text-muted-foreground p-4 rounded-md bg-muted/50 space-y-2">
          <Mail className="h-6 w-6 mx-auto text-primary" />
          <p>
            Подтвердите email по ссылке из письма, отправленного на <strong>{email}</strong>,
            затем вернитесь на эту страницу — она остаётся активной.
          </p>
        </div>
      )}

      {auth.step === "password_reset_sent" && (
        <div className="text-sm p-4 rounded-md bg-primary/5 border border-primary/20 space-y-3">
          <div className="flex items-start gap-2 text-primary">
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
            <p>
              Письмо для восстановления пароля отправлено на <strong>{email}</strong>.
              Перейдите по ссылке в письме, задайте новый пароль и вернитесь сюда.
            </p>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => auth.setStep("login")}
          >
            Вернуться ко входу
          </button>
        </div>
      )}
    </div>
  );
}
