import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useInlineAuth } from "@/hooks/useInlineAuth";
import { useStartTelegramLink, useTelegramLinkStatus } from "@/hooks/useTelegramLink";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeInstagram } from "@/lib/normalizeInstagram";
import { z } from "zod";
import { PhoneInput, isValidPhoneNumber } from "@/components/ui/phone-input";

interface FormField {
  label: string;
  type: string;
  required: boolean;
  mapping?: string;
}

interface FormSectionProps {
  content: Record<string, unknown>;
  pageId?: string;
}

function isSafeRedirectUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeRedirect(url: string) {
  if (url.startsWith('/')) {
    window.location.href = url;
  } else {
    window.open(url, '_self', 'noopener,noreferrer');
  }
}

// ─── Auth mode state machine ───
type AuthFormStep =
  | "check_session"
  | "email_check"
  | "login"
  | "signup"
  | "email_confirm_wait"
  | "telegram_prompt"
  | "extra_fields"
  | "submit"
  | "success";

const emailSchema = z.string().email("Введите корректный email");
const passwordSchema = z.string().min(6, "Пароль должен быть не менее 6 символов");

export function FormSection({ content, pageId }: FormSectionProps) {
  const title = (content.title as string) || "";
  const subtitle = (content.subtitle as string) || "";
  const buttonText = (content.buttonText as string) || "Отправить";
  const redirectUrl = (content.redirectUrl as string) || "";
  const fields = (content.fields as FormField[]) || [];
  const authMode = (content.auth_mode as boolean) || false;
  const telegramLinkEnabled = (content.telegram_link as boolean) || false;

  // If auth_mode is false, render the legacy form
  if (!authMode) {
    return <LegacyFormSection content={content} pageId={pageId} />;
  }

  return (
    <AuthFormSection
      title={title}
      subtitle={subtitle}
      buttonText={buttonText}
      redirectUrl={redirectUrl}
      fields={fields}
      telegramLinkEnabled={telegramLinkEnabled}
      pageId={pageId}
      content={content}
    />
  );
}

// ─── Legacy form (auth_mode=false) — unchanged behavior ───
function LegacyFormSection({ content, pageId }: FormSectionProps) {
  const title = (content.title as string) || "";
  const subtitle = (content.subtitle as string) || "";
  const buttonText = (content.buttonText as string) || "Отправить";
  const redirectUrl = (content.redirectUrl as string) || "";
  const fields = (content.fields as FormField[]) || [];

  const [values, setValues] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const setValue = (index: number, value: string) => {
    setValues((prev) => ({ ...prev, [index]: value }));
  };

  const validateEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const val = (values[i] || "").trim();
      if (field.required && !val) {
        setError(`Поле «${field.label || `Поле ${i + 1}`}» обязательно`);
        return;
      }
      if (field.type === "email" && val && !validateEmail(val)) {
        setError("Введите корректный email");
        return;
      }
    }

    if (!pageId) {
      setError("Ошибка конфигурации формы");
      return;
    }

    setLoading(true);
    try {
      const productId = content.product_id as string | undefined;
      const tariffId = content.tariff_id as string | undefined;

      const payload: Record<string, unknown> = {
        page_id: pageId,
        redirect_url: redirectUrl || undefined,
        fields: fields.map((field, i) => ({
          label: field.label,
          type: field.type,
          value: (values[i] || "").trim(),
          mapping: field.mapping || "none",
        })),
      };

      if (productId) payload.product_id = productId;
      if (tariffId) payload.tariff_id = tariffId;

      const { error: fnError } = await supabase.functions.invoke(
        "site-form-submit",
        { body: payload }
      );

      if (fnError) {
        console.error("Form submit error:", fnError);
        setError("Не удалось отправить форму. Попробуйте позже.");
      } else {
        if (redirectUrl && isSafeRedirectUrl(redirectUrl)) {
          safeRedirect(redirectUrl);
        } else {
          setSubmitted(true);
        }
      }
    } catch (err) {
      console.error("Form submit exception:", err);
      setError("Произошла ошибка. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <section className="py-12 px-6">
        <div className="max-w-xl mx-auto text-center space-y-4">
          <div className="text-4xl">✓</div>
          <h3 className="text-2xl font-bold text-foreground">Спасибо!</h3>
          <p className="text-muted-foreground">Ваша заявка отправлена. Мы свяжемся с вами в ближайшее время.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 px-6">
      <div className="max-w-xl mx-auto space-y-6">
        {title && <h3 className="text-2xl font-bold text-foreground text-center">{title}</h3>}
        {subtitle && <p className="text-muted-foreground text-center">{subtitle}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map((field, i) => (
            <div key={i}>
              <label className="block text-sm font-medium text-foreground mb-1">
                {field.label || `Поле ${i + 1}`}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={field.label}
                  value={values[i] || ""}
                  onChange={(e) => setValue(i, e.target.value)}
                />
              ) : (
                <input
                  type={field.type === "phone" ? "tel" : field.type || "text"}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={field.label}
                  value={values[i] || ""}
                  onChange={(e) => setValue(i, e.target.value)}
                />
              )}
            </div>
          ))}

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Отправка..." : buttonText}
          </button>
        </form>
      </div>
    </section>
  );
}

// ─── Auth mode form ───
interface AuthFormSectionProps {
  title: string;
  subtitle: string;
  buttonText: string;
  redirectUrl: string;
  fields: FormField[];
  telegramLinkEnabled: boolean;
  pageId?: string;
  content: Record<string, unknown>;
}

function AuthFormSection({
  title,
  subtitle,
  buttonText,
  redirectUrl,
  fields,
  telegramLinkEnabled,
  pageId,
  content,
}: AuthFormSectionProps) {
  const { user, session } = useAuth();
  const inlineAuth = useInlineAuth();
  const startTelegramLink = useStartTelegramLink();
  const { data: telegramStatus } = useTelegramLinkStatus();

  // State machine
  const [formStep, setFormStep] = useState<AuthFormStep>("check_session");

  // System auth fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  // Extra custom fields (non-system)
  const [extraValues, setExtraValues] = useState<Record<number, string>>({});

  // UI state
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [telegramDeepLink, setTelegramDeepLink] = useState<string | null>(null);

  // Determine extra fields (non-system custom fields added by admin)
  const customFields = fields;

  // ─── Session check on mount ───
  useEffect(() => {
    if (formStep !== "check_session") return;

    if (session && user) {
      // Already authenticated — determine next step
      if (telegramLinkEnabled && telegramStatus?.status !== "active") {
        setFormStep("telegram_prompt");
      } else if (customFields.length > 0) {
        setFormStep("extra_fields");
      } else {
        // No extra fields, auto-submit
        setFormStep("submit");
      }
    } else {
      setFormStep("email_check");
    }
  }, [formStep, session, user, telegramLinkEnabled, telegramStatus?.status, customFields.length]);

  // ─── Listen for session changes (email confirmation resume) ───
  useEffect(() => {
    if (formStep !== "email_confirm_wait") return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "SIGNED_IN" && newSession) {
        // User confirmed email and is now logged in
        if (telegramLinkEnabled && telegramStatus?.status !== "active") {
          setFormStep("telegram_prompt");
        } else if (customFields.length > 0) {
          setFormStep("extra_fields");
        } else {
          setFormStep("submit");
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [formStep, telegramLinkEnabled, telegramStatus?.status, customFields.length]);

  // ─── Handlers ───

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const validation = emailSchema.safeParse(email);
    if (!validation.success) {
      setError(validation.error.errors[0].message);
      return;
    }

    const result = await inlineAuth.checkEmail(email);
    if (result) {
      if (result.exists) {
        setFormStep("login");
      } else {
        setFormStep("signup");
      }
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const passValidation = passwordSchema.safeParse(password);
    if (!passValidation.success) {
      setError(passValidation.error.errors[0].message);
      return;
    }

    const result = await inlineAuth.login(email, password);
    if (result) {
      // Fetch profile data to pre-fill
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone, first_name, last_name")
        .eq("user_id", result.userId)
        .maybeSingle();

      if (profile) {
        setFirstName(profile.first_name || "");
        setLastName(profile.last_name || "");
        setPhone(profile.phone || "");
      }

      // Advance to next step
      if (telegramLinkEnabled && telegramStatus?.status !== "active") {
        setFormStep("telegram_prompt");
      } else if (customFields.length > 0) {
        setFormStep("extra_fields");
      } else {
        setFormStep("submit");
      }
    } else if (inlineAuth.error) {
      setError(inlineAuth.error);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!firstName.trim() || firstName.trim().length < 2) {
      setError("Имя должно содержать минимум 2 символа");
      return;
    }
    if (!lastName.trim() || lastName.trim().length < 2) {
      setError("Фамилия должна содержать минимум 2 символа");
      return;
    }
    if (phone && !isValidPhoneNumber(phone)) {
      setError("Введите корректный номер телефона");
      return;
    }
    const passValidation = passwordSchema.safeParse(password);
    if (!passValidation.success) {
      setError(passValidation.error.errors[0].message);
      return;
    }

    const result = await inlineAuth.signup(email, password, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone || undefined,
    });

    if (result) {
      if (result.needsConfirmation) {
        setFormStep("email_confirm_wait");
      } else {
        if (telegramLinkEnabled && telegramStatus?.status !== "active") {
          setFormStep("telegram_prompt");
        } else if (customFields.length > 0) {
          setFormStep("extra_fields");
        } else {
          setFormStep("submit");
        }
      }
    } else if (inlineAuth.error) {
      setError(inlineAuth.error);
    }
  };

  const handleStartTelegram = async () => {
    try {
      const result = await startTelegramLink.mutateAsync();
      if (result.deep_link) {
        setTelegramDeepLink(result.deep_link);
        window.open(result.deep_link, "_blank");
      }
    } catch (err) {
      console.error("Failed to start Telegram link:", err);
    }
  };

  const handleSkipTelegram = () => {
    if (customFields.length > 0) {
      setFormStep("extra_fields");
    } else {
      setFormStep("submit");
    }
  };

  const handleTelegramDone = () => {
    if (customFields.length > 0) {
      setFormStep("extra_fields");
    } else {
      setFormStep("submit");
    }
  };

  const handleExtraFieldsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validate required custom fields
    for (let i = 0; i < customFields.length; i++) {
      const field = customFields[i];
      const val = (extraValues[i] || "").trim();
      if (field.required && !val) {
        setError(`Поле «${field.label || `Поле ${i + 1}`}» обязательно`);
        return;
      }
      if (field.type === "email" && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        setError("Введите корректный email");
        return;
      }
    }

    setFormStep("submit");
  };

  // ─── Auto-submit when reaching "submit" step ───
  useEffect(() => {
    if (formStep !== "submit") return;
    doSubmit();
  }, [formStep]);

  const doSubmit = async () => {
    if (!pageId) {
      setError("Ошибка конфигурации формы");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const productId = content.product_id as string | undefined;
      const tariffId = content.tariff_id as string | undefined;

      // Build fields array for submission
      const submissionFields = customFields.map((field, i) => ({
        label: field.label,
        type: field.type,
        value: (extraValues[i] || "").trim(),
        mapping: field.mapping || "none",
      }));

      // Normalize instagram if mapped
      for (const f of submissionFields) {
        if (f.mapping === "instagram_url" && f.value) {
          f.value = normalizeInstagram(f.value) || f.value;
        }
      }

      const payload: Record<string, unknown> = {
        page_id: pageId,
        auth_mode: true,
        redirect_url: redirectUrl || undefined,
        fields: submissionFields,
      };

      if (productId) payload.product_id = productId;
      if (tariffId) payload.tariff_id = tariffId;

      // JWT is sent automatically by supabase client
      const { error: fnError } = await supabase.functions.invoke(
        "site-form-submit",
        { body: payload }
      );

      if (fnError) {
        console.error("Form submit error:", fnError);
        setError("Не удалось отправить форму. Попробуйте позже.");
        return;
      }

      if (redirectUrl && isSafeRedirectUrl(redirectUrl)) {
        safeRedirect(redirectUrl);
      } else {
        setFormStep("success");
      }
    } catch (err) {
      console.error("Form submit exception:", err);
      setError("Произошла ошибка. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───

  const wrapSection = (children: React.ReactNode) => (
    <section className="py-12 px-6">
      <div className="max-w-xl mx-auto space-y-6">
        {title && <h3 className="text-2xl font-bold text-foreground text-center">{title}</h3>}
        {subtitle && <p className="text-muted-foreground text-center">{subtitle}</p>}
        {children}
      </div>
    </section>
  );

  if (formStep === "success") {
    return (
      <section className="py-12 px-6">
        <div className="max-w-xl mx-auto text-center space-y-4">
          <div className="text-4xl">✓</div>
          <h3 className="text-2xl font-bold text-foreground">Спасибо!</h3>
          <p className="text-muted-foreground">Ваша заявка отправлена. Мы свяжемся с вами в ближайшее время.</p>
        </div>
      </section>
    );
  }

  if (formStep === "check_session") {
    return wrapSection(
      <div className="text-center text-muted-foreground">Загрузка...</div>
    );
  }

  if (formStep === "submit") {
    return wrapSection(
      <div className="text-center space-y-2">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
        <p className="text-muted-foreground">Отправка...</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (formStep === "email_check") {
    return wrapSection(
      <form onSubmit={handleEmailSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Email <span className="text-destructive">*</span>
          </label>
          <input
            type="email"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <button
          type="submit"
          disabled={inlineAuth.isLoading}
          className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {inlineAuth.isLoading ? "Проверка..." : "Продолжить"}
        </button>
      </form>
    );
  }

  if (formStep === "login") {
    return wrapSection(
      <form onSubmit={handleLoginSubmit} className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Аккаунт найден. Введите пароль для входа.
        </p>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Email</label>
          <input
            type="email"
            className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm"
            value={email}
            disabled
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Пароль <span className="text-destructive">*</span>
          </label>
          <input
            type="password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Ваш пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <button
          type="submit"
          disabled={inlineAuth.isLoading}
          className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {inlineAuth.isLoading ? "Вход..." : "Войти"}
        </button>
        <button
          type="button"
          onClick={() => { setFormStep("email_check"); setError(""); }}
          className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Использовать другой email
        </button>
      </form>
    );
  }

  if (formStep === "signup") {
    return wrapSection(
      <form onSubmit={handleSignupSubmit} className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Создание аккаунта
        </p>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Email</label>
          <input
            type="email"
            className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm"
            value={email}
            disabled
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Имя <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Имя"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Фамилия <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Фамилия"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Телефон
          </label>
          <PhoneInput
            value={phone}
            onChange={(val) => setPhone(val || "")}
            defaultCountry="BY"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Пароль <span className="text-destructive">*</span>
          </label>
          <input
            type="password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Минимум 6 символов"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <button
          type="submit"
          disabled={inlineAuth.isLoading}
          className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {inlineAuth.isLoading ? "Регистрация..." : "Зарегистрироваться"}
        </button>
        <button
          type="button"
          onClick={() => { setFormStep("email_check"); setError(""); }}
          className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Использовать другой email
        </button>
      </form>
    );
  }

  if (formStep === "email_confirm_wait") {
    return wrapSection(
      <div className="text-center space-y-4">
        <div className="text-4xl">✉️</div>
        <h4 className="text-lg font-semibold text-foreground">Подтвердите email</h4>
        <p className="text-sm text-muted-foreground">
          Мы отправили письмо на <strong>{email}</strong>. Перейдите по ссылке в письме для подтверждения.
        </p>
        <p className="text-xs text-muted-foreground">
          После подтверждения эта страница обновится автоматически.
        </p>
        <button
          type="button"
          onClick={() => {
            // Manual recheck
            supabase.auth.getSession().then(({ data: { session: s } }) => {
              if (s) {
                if (telegramLinkEnabled && telegramStatus?.status !== "active") {
                  setFormStep("telegram_prompt");
                } else if (customFields.length > 0) {
                  setFormStep("extra_fields");
                } else {
                  setFormStep("submit");
                }
              }
            });
          }}
          className="text-sm text-primary hover:underline"
        >
          Я подтвердил email
        </button>
      </div>
    );
  }

  if (formStep === "telegram_prompt") {
    return wrapSection(
      <div className="space-y-4 text-center">
        <div className="text-4xl">🤖</div>
        <h4 className="text-lg font-semibold text-foreground">Привязка Telegram</h4>
        <p className="text-sm text-muted-foreground">
          Привяжите Telegram для получения доступов и уведомлений. Это позволит нам добавить вас в закрытую группу.
        </p>
        {telegramDeepLink ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Бот открыт в новом окне. Нажмите «Start» в Telegram, затем вернитесь сюда.
            </p>
            <button
              type="button"
              onClick={handleTelegramDone}
              className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Я привязал Telegram — продолжить
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleStartTelegram}
            disabled={startTelegramLink.isPending}
            className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {startTelegramLink.isPending ? "Загрузка..." : "Привязать Telegram"}
          </button>
        )}
        <button
          type="button"
          onClick={handleSkipTelegram}
          className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Пропустить
        </button>
      </div>
    );
  }

  if (formStep === "extra_fields") {
    return wrapSection(
      <form onSubmit={handleExtraFieldsSubmit} className="space-y-4">
        {customFields.map((field, i) => (
          <div key={i}>
            <label className="block text-sm font-medium text-foreground mb-1">
              {field.label || `Поле ${i + 1}`}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </label>
            {field.type === "textarea" ? (
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={field.label}
                value={extraValues[i] || ""}
                onChange={(e) => setExtraValues((prev) => ({ ...prev, [i]: e.target.value }))}
              />
            ) : (
              <input
                type={field.type === "phone" ? "tel" : field.type || "text"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={field.label}
                value={extraValues[i] || ""}
                onChange={(e) => setExtraValues((prev) => ({ ...prev, [i]: e.target.value }))}
              />
            )}
          </div>
        ))}

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Отправка..." : buttonText}
        </button>
      </form>
    );
  }

  return null;
}
