/**
 * InlineAuthForm — canonical inline auth UI used by every public/identity flow.
 *
 * PATCH-INLINE-AUTH-PASSWORD-TABS (2026-07-24):
 *   Business rule (owner-approved) — a returning user logs in with
 *   email + password. A new user registers through a six-digit email OTP.
 *   The UI exposes two explicit tabs: «Войти» and «Зарегистрироваться».
 *     - Войти  → supabase.auth.signInWithPassword (no shouldCreateUser, no OTP).
 *     - Регистрация → InlineEmailOtpForm; no email-link redirect.
 *     - «Забыли пароль?» → auth-actions recovery email.
 *   Callers still own "is a session already active?" — if it is, the gate
 *   should be bypassed BEFORE rendering this component.
 *
 * The OTP-first flow is retained under VITE_INLINE_AUTH_MODE=otp as an
 * opt-in escape hatch; it is no longer the default.
 *
 * Anti-duplication contract (mem://ui/auth/inline-auth-form-standard):
 *   - Do NOT fork email/password/forgot logic anywhere else.
 *   - Callers control post-auth behaviour via onAuthenticated callback.
 */
import { useState, useEffect, FormEvent } from "react";
import { useInlineAuth } from "@/hooks/useInlineAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Mail, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { INLINE_AUTH_MODE } from "@/lib/inlineAuth/mode";
import { InlineEmailOtpForm } from "@/components/auth/InlineEmailOtpForm";
import { getUserPasswordRequirementText, USER_PASSWORD_MIN_LENGTH } from "@/lib/passwordPolicy";


export interface InlineAuthFormProps {
  /** Pre-fill email (e.g. from session); user may override. */
  initialEmail?: string;
  /** Called after a successful login/signup-with-session. */
  onAuthenticated: (email: string, userId?: string) => void | Promise<void>;
  /** Optional context label shown above the form. */
  contextNote?: string;
  /** Submit button label override on email step (OTP mode only). */
  emailCtaLabel?: string;
  /** Submit button label override on login tab. Default: "Войти". */
  loginCtaLabel?: string;
  /** Submit button label override on signup tab. Default: "Зарегистрироваться". */
  signupCtaLabel?: string;
  /** Whether parent is processing something after onAuthenticated (e.g. payment). */
  externalLoading?: boolean;
  /** Initial active tab. Default: "login". */
  defaultTab?: "login" | "signup";
}

export function InlineAuthForm({
  initialEmail = "",
  onAuthenticated,
  contextNote,
  emailCtaLabel = "Продолжить",
  loginCtaLabel = "Войти",
  signupCtaLabel = "Зарегистрироваться",
  externalLoading = false,
  defaultTab = "login",
}: InlineAuthFormProps) {
  const auth = useInlineAuth();

  const [tab, setTab] = useState<"login" | "signup">(defaultTab);
  const [loginEmail, setLoginEmail] = useState(initialEmail);
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Keep both email fields in sync if parent hydrates initialEmail later.
  useEffect(() => {
    if (!initialEmail) return;
    if (!loginEmail) setLoginEmail(initialEmail);
  }, [initialEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full OTP escape hatch. Keep it after all hooks so changing the build-time
  // flag can never alter hook order during preview/HMR.
  if (INLINE_AUTH_MODE === "otp") {
    return (
      <InlineEmailOtpForm
        initialEmail={initialEmail}
        onAuthenticated={onAuthenticated}
        contextNote={contextNote}
        emailCtaLabel={emailCtaLabel}
        externalLoading={externalLoading}
        collectSignupMeta
        requirePrivacyConsent
      />
    );
  }

  const isBusy = auth.isLoading || externalLoading;
  const isSuccessScreen =
    auth.step === "email_confirm" || auth.step === "password_reset_sent";

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = loginEmail.trim().toLowerCase();
    if (!trimmed || !loginPassword) return;
    const result = await auth.login(trimmed, loginPassword);
    if (result) await onAuthenticated(trimmed, result.userId);
  };

  const handleForgot = async () => {
    if (!loginEmail.trim()) {
      // useInlineAuth surfaces the "введите email" error itself.
    }
    await auth.requestPasswordReset(loginEmail);
  };

  const backToTabs = () => {
    auth.reset();
    auth.clearError();
  };

  if (isSuccessScreen) {
    return (
      <div className="space-y-3">
        {contextNote && (
          <p className="text-sm text-muted-foreground">{contextNote}</p>
        )}

        {auth.step === "email_confirm" && (
          <div className="text-center text-sm text-muted-foreground p-4 rounded-md bg-muted/50 space-y-2">
            <Mail className="h-6 w-6 mx-auto text-primary" />
            <p>
              Подтвердите email по ссылке из письма, отправленного на{" "}
              <strong>указанный адрес</strong>, затем вернитесь на эту страницу —
              она остаётся активной.
            </p>
          </div>
        )}

        {auth.step === "password_reset_sent" && (
          <div className="text-sm p-4 rounded-md bg-primary/5 border border-primary/20 space-y-3">
            <div className="flex items-start gap-2 text-primary">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
              <p>
                Письмо для восстановления пароля отправлено на{" "}
                <strong>{loginEmail}</strong>. Перейдите по ссылке в письме,
                задайте новый пароль и вернитесь сюда.
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={backToTabs}
            >
              Вернуться ко входу
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {contextNote && (
        <p className="text-sm text-muted-foreground">{contextNote}</p>
      )}

      {auth.error && (
        <div
          role="alert"
          className="flex items-start gap-2 text-destructive text-sm p-3 rounded-md bg-destructive/10"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{auth.error}</span>
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as "login" | "signup");
          auth.clearError();
        }}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="login">Войти</TabsTrigger>
          <TabsTrigger value="signup">Зарегистрироваться</TabsTrigger>
        </TabsList>

        <TabsContent value="login" className="mt-3">
          <form onSubmit={handleLogin} method="post" action="#" className="space-y-3">
            <div>
              <Label htmlFor="iaf-login-email">Email</Label>
              <Input
                id="iaf-login-email"
                name="email"
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div>
              <Label htmlFor="iaf-login-password">Пароль</Label>
              <div className="relative">
                <Input
                  id="iaf-login-password"
                  name="password"
                  type={showLoginPw ? "text" : "password"}
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showLoginPw ? "Скрыть пароль" : "Показать пароль"}
                  aria-pressed={showLoginPw}
                >
                  {showLoginPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={isBusy}>
              {isBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Вход…
                </>
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
                onClick={() => {
                  setTab("signup");
                  auth.clearError();
                }}
                disabled={isBusy}
              >
                Нет аккаунта? Зарегистрироваться
              </button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="signup" className="mt-3">
          <InlineEmailOtpForm
            initialEmail={initialEmail}
            onAuthenticated={onAuthenticated}
            contextNote="Подтвердите реальный email шестизначным кодом. Ссылку открывать не нужно."
            emailCtaLabel={signupCtaLabel}
            externalLoading={externalLoading}
            requirePrivacyConsent
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
