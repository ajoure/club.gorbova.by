import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useInlineAuth } from "@/hooks/useInlineAuth";
import { useStartTelegramLink, useTelegramLinkStatus } from "@/hooks/useTelegramLink";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeInstagram } from "@/lib/normalizeInstagram";
import { z } from "zod";
import { PhoneInput, isValidPhoneNumber } from "@/components/ui/phone-input";
import { Loader2, Upload, X, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { getFieldDisplayLabel } from "@/lib/formFieldLabel";

interface FormField {
  label: string;
  type: string;
  required: boolean;
  mapping?: string;
  options?: string[];
  allowedGroups?: string[];
  maxSizeMB?: number;
  maxFiles?: number;
  min?: number;
  max?: number;
  step?: number;
}

interface FormSectionProps {
  content: Record<string, unknown>;
  pageId?: string;
  /** True when rendered inside admin editor preview — disables real submit */
  isPreview?: boolean;
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
  | "ready"       // awaits explicit user click
  | "submitting"  // network request in flight
  | "success";

type TelegramUiStatus = "idle" | "starting" | "pending" | "linked" | "failed" | "skipped";

const emailSchema = z.string().email("Введите корректный email");
const passwordSchema = z.string().min(6, "Пароль должен быть не менее 6 символов");

export function FormSection({ content, pageId, isPreview }: FormSectionProps) {
  const title = (content.title as string) || "";
  const subtitle = (content.subtitle as string) || "";
  const buttonText = (content.buttonText as string) || "Отправить";
  const redirectUrl = (content.redirectUrl as string) || "";
  const fields = (content.fields as FormField[]) || [];
  const authMode = (content.auth_mode as boolean) ?? false;
  const telegramLinkEnabled = (content.telegram_link as boolean) ?? false;

  if (!authMode) {
    return <LegacyFormSection content={content} pageId={pageId} isPreview={isPreview} />;
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
      isPreview={isPreview}
    />
  );
}

// ─── Legacy form (auth_mode=false) — расширенный набор типов полей ───
function LegacyFormSection({ content, pageId, isPreview }: FormSectionProps) {
  const title = (content.title as string) || "";
  const subtitle = (content.subtitle as string) || "";
  const buttonText = (content.buttonText as string) || "Отправить";
  const redirectUrl = (content.redirectUrl as string) || "";
  const fields = (content.fields as FormField[]) || [];
  const productBindingEnabled = (content.product_binding_enabled as boolean) ?? false;

  // submission_token — один на одну открытую форму. Используется для группировки файлов
  // одной отправки внутри form-uploads/{token}/. Сохраняется в metadata.
  const submissionTokenRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  // values: тип значения зависит от типа поля
  // string | string[] | number | boolean | FileObj | FileObj[] | null
  const [values, setValues] = useState<Record<number, unknown>>({});
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const setValue = (index: number, value: unknown) => {
    setValues((prev) => ({ ...prev, [index]: value }));
  };

  const validateEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const isEmpty = (v: unknown): boolean => {
    if (v === null || v === undefined) return true;
    if (typeof v === "string") return v.trim().length === 0;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return Object.keys(v as object).length === 0;
    return false;
  };

  const handleFileUpload = async (index: number, fileList: FileList | null, field: FormField) => {
    if (!fileList || fileList.length === 0) return;
    if (isPreview) {
      setError("В предпросмотре загрузка файлов недоступна");
      return;
    }
    setError("");
    setUploading((p) => ({ ...p, [index]: true }));
    try {
      const maxFiles = field.maxFiles ?? 1;
      const filesArr = Array.from(fileList).slice(0, maxFiles);
      const uploaded: unknown[] = [];

      for (const f of filesArr) {
        // Клиентский pre-check (UX): размер. Сервер всё равно проверит.
        const maxSize = (field.maxSizeMB ?? 10) * 1024 * 1024;
        if (f.size > maxSize) {
          setError(`Файл «${f.name}» больше ${field.maxSizeMB ?? 10} МБ`);
          continue;
        }
        const fd = new FormData();
        fd.append("submission_token", submissionTokenRef.current);
        fd.append("field_id", `${index}-${field.label || "field"}`);
        fd.append("file", f);

        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const url = `https://${projectId}.supabase.co/functions/v1/site-form-upload`;
        const res = await fetch(url, { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.file) {
          setError(data?.error || "Не удалось загрузить файл");
          break;
        }
        uploaded.push(data.file);
      }

      if (uploaded.length > 0) {
        // Контракт: maxFiles=1 → один объект; maxFiles>1 → массив
        const next = (field.maxFiles ?? 1) > 1 ? uploaded : uploaded[0];
        setValue(index, next);
      }
    } finally {
      setUploading((p) => ({ ...p, [index]: false }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreview) { setSubmitted(true); return; }
    setError("");

    // Validation
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const v = values[i];
      if (field.required && isEmpty(v)) {
        setError(`Поле «${field.label || `Поле ${i + 1}`}» обязательно`);
        return;
      }
      if (field.type === "email" && typeof v === "string" && v && !validateEmail(v)) {
        setError("Введите корректный email");
        return;
      }
      if (field.type === "number" && v !== undefined && v !== null && v !== "") {
        const n = Number(v);
        if (Number.isNaN(n)) {
          setError(`Поле «${field.label}» должно быть числом`);
          return;
        }
        if (typeof field.min === "number" && n < field.min) {
          setError(`Поле «${field.label}» должно быть ≥ ${field.min}`);
          return;
        }
        if (typeof field.max === "number" && n > field.max) {
          setError(`Поле «${field.label}» должно быть ≤ ${field.max}`);
          return;
        }
      }
    }

    if (!pageId) {
      setError("Ошибка конфигурации формы");
      return;
    }

    setLoading(true);
    try {
      const productId = productBindingEnabled ? (content.product_id as string) || undefined : undefined;
      const tariffId = productBindingEnabled ? (content.tariff_id as string) || undefined : undefined;

      // Нормализация значений по типам — БЕЗ stringify массивов/объектов
      const submissionFields = fields.map((field, i) => {
        const raw = values[i];
        let value: unknown = raw;
        if (field.type === "number") {
          value = raw === undefined || raw === null || raw === "" ? null : Number(raw);
        } else if (field.type === "boolean") {
          value = raw === true || raw === "true";
        } else if (field.type === "date") {
          value = typeof raw === "string" && raw ? raw : null; // ISO YYYY-MM-DD
        } else if (field.type === "multiselect") {
          value = Array.isArray(raw) ? raw : [];
        } else if (field.type === "file") {
          value = raw ?? null;
        } else if (typeof raw === "string") {
          value = raw.trim();
        }
        return {
          label: field.label,
          type: field.type,
          value,
          mapping: field.mapping || "none",
        };
      });

      const payload: Record<string, unknown> = {
        page_id: pageId,
        redirect_url: redirectUrl || undefined,
        fields: submissionFields,
        submission_token: submissionTokenRef.current,
      };

      if (productId) payload.product_id = productId;
      if (tariffId) payload.tariff_id = tariffId;
      payload.product_binding_enabled = !!productBindingEnabled;

      const dealEnabled = (content.deal_creation_enabled as boolean) ?? false;
      if (dealEnabled) {
        payload.deal_creation_enabled = true;
        const pipelineId = (content.pipeline_id as string) || "";
        const stageId = (content.pipeline_stage_id as string) || "";
        if (pipelineId) payload.pipeline_id = pipelineId;
        if (stageId) payload.pipeline_stage_id = stageId;
      }

      const embedOrigin = (content.__embed_origin as string) || "";
      const embedBlockId = (content.__embed_block_id as string) || "";
      if (embedOrigin) payload.embed_origin = embedOrigin;
      if (embedBlockId) {
        payload.embed_block_id = embedBlockId;
        payload.embed_mode = "iframe";
      }

      const { error: fnError } = await supabase.functions.invoke("site-form-submit", { body: payload });

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
            <FieldRenderer
              key={i}
              field={field}
              index={i}
              value={values[i]}
              uploading={!!uploading[i]}
              onChange={(v) => setValue(i, v)}
              onFiles={(fl) => handleFileUpload(i, fl, field)}
            />
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
      </div>
    </section>
  );
}

// ─── Универсальный рендерер поля ───
function FieldRenderer({
  field,
  index,
  value,
  uploading,
  onChange,
  onFiles,
}: {
  field: FormField;
  index: number;
  value: unknown;
  uploading: boolean;
  onChange: (v: unknown) => void;
  onFiles: (files: FileList | null) => void;
}) {
  const baseInputClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  const label = (
    <label className="block text-sm font-medium text-foreground mb-1">
      {field.label || `Поле ${index + 1}`}
      {field.required && <span className="text-destructive ml-1">*</span>}
    </label>
  );

  // textarea
  if (field.type === "textarea") {
    return (
      <div>
        {label}
        <textarea
          className={`${baseInputClass} min-h-[80px]`}
          placeholder={field.label}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  // boolean → Yes/No radio
  if (field.type === "boolean") {
    const v = value === true || value === "true";
    return (
      <div>
        {label}
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name={`bool-${index}`} checked={v === true} onChange={() => onChange(true)} />
            Да
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name={`bool-${index}`} checked={value === false} onChange={() => onChange(false)} />
            Нет
          </label>
        </div>
      </div>
    );
  }

  // select
  if (field.type === "select") {
    const opts = field.options || [];
    return (
      <div>
        {label}
        <select
          className={baseInputClass}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— выберите —</option>
          {opts.map((o, oi) => (
            <option key={oi} value={o}>{o}</option>
          ))}
        </select>
      </div>
    );
  }

  // multiselect → checkboxes
  if (field.type === "multiselect") {
    const opts = field.options || [];
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        {label}
        <div className="space-y-1.5">
          {opts.map((o, oi) => {
            const checked = arr.includes(o);
            return (
              <label key={oi} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked ? [...arr, o] : arr.filter((x) => x !== o);
                    onChange(next);
                  }}
                />
                {o}
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  // date
  if (field.type === "date") {
    return (
      <div>
        {label}
        <input
          type="date"
          className={baseInputClass}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  // number
  if (field.type === "number") {
    return (
      <div>
        {label}
        <input
          type="number"
          className={baseInputClass}
          placeholder={field.label}
          min={field.min}
          max={field.max}
          step={field.step}
          value={(value as number | string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      </div>
    );
  }

  // file
  if (field.type === "file") {
    const maxFiles = field.maxFiles ?? 1;
    const isMulti = maxFiles > 1;
    const files = isMulti
      ? (Array.isArray(value) ? (value as Array<{ filename: string; size: number }>) : [])
      : (value && typeof value === "object" ? [value as { filename: string; size: number }] : []);
    return (
      <div>
        {label}
        <div className="space-y-2">
          <label className="flex items-center justify-center gap-2 border border-dashed border-input rounded-md px-3 py-4 text-sm cursor-pointer hover:bg-muted/40 transition-colors">
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Загрузка...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> Выбрать {isMulti ? "файлы" : "файл"}
              </>
            )}
            <input
              type="file"
              className="hidden"
              multiple={isMulti}
              disabled={uploading}
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
          {files.length > 0 && (
            <ul className="space-y-1 text-xs">
              {files.map((f, fi) => (
                <li key={fi} className="flex items-center justify-between gap-2 bg-muted/40 rounded px-2 py-1">
                  <span className="truncate">{f.filename}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onChange(isMulti ? files.filter((_, idx) => idx !== fi) : null)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // text / email / phone (default)
  return (
    <div>
      {label}
      <input
        type={field.type === "phone" ? "tel" : field.type || "text"}
        className={baseInputClass}
        placeholder={field.label}
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
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
  isPreview?: boolean;
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
  isPreview,
}: AuthFormSectionProps) {
  const { user, session } = useAuth();
  const inlineAuth = useInlineAuth();
  const startTelegramLink = useStartTelegramLink();
  const { data: telegramStatus, refetch: refetchTelegramStatus } = useTelegramLinkStatus();

  // State machine — in preview, always start at email_check to show the real form UX
  const [formStep, setFormStep] = useState<AuthFormStep>(isPreview ? "email_check" : "check_session");

  // System auth fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  // Extra custom fields
  const [extraValues, setExtraValues] = useState<Record<number, string>>({});

  // UI state
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [telegramDeepLink, setTelegramDeepLink] = useState<string | null>(null);
  const [telegramUiStatus, setTelegramUiStatus] = useState<TelegramUiStatus>("idle");

  const customFields = fields;
  const productBindingEnabled = (content.product_binding_enabled as boolean) ?? false;
  const dealCreationEnabled = (content.deal_creation_enabled as boolean) ?? false;

  // ─── Determine next step after auth ───
  const getNextStepAfterAuth = useCallback((): AuthFormStep => {
    // In preview, always show telegram step if enabled (regardless of actual status)
    if (telegramLinkEnabled && (isPreview || telegramStatus?.status !== "active")) {
      return "telegram_prompt";
    }
    if (customFields.length > 0) {
      return "extra_fields";
    }
    // No extra fields → show ready button (never auto-submit)
    return "ready";
  }, [telegramLinkEnabled, telegramStatus?.status, customFields.length, isPreview]);

  // ─── Session check on mount — HARD RULE: never auto-submit, only UI branching ───
  // In preview mode, skip session check entirely — always show email_check step
  useEffect(() => {
    if (isPreview) return; // preview always stays at email_check initially
    if (formStep !== "check_session") return;

    if (session && user) {
      setFormStep(getNextStepAfterAuth());
    } else {
      setFormStep("email_check");
    }
  }, [isPreview, formStep, session, user, getNextStepAfterAuth]);

  // ─── Listen for session changes (email confirmation resume) ───
  useEffect(() => {
    if (formStep !== "email_confirm_wait") return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "SIGNED_IN" && newSession) {
        setFormStep(getNextStepAfterAuth());
      }
    });

    return () => subscription.unsubscribe();
  }, [formStep, getNextStepAfterAuth]);

  // ─── Telegram recheck on visibility change (add-only enhancement) ───
  useEffect(() => {
    if (formStep !== "telegram_prompt") return;

    const handler = () => {
      if (!document.hidden) {
        refetchTelegramStatus();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [formStep, refetchTelegramStatus]);

  // ─── Auto-advance from telegram_prompt when linked/active ───
  // Preview: advance when telegramUiStatus === "linked" (simulated)
  // Live: advance only when real telegramStatus?.status === "active" (server-confirmed)
  useEffect(() => {
    if (formStep !== "telegram_prompt") return;

    const shouldAdvance = isPreview
      ? telegramUiStatus === "linked"
      : telegramStatus?.status === "active";

    if (!shouldAdvance) return;

    if (!isPreview) setTelegramUiStatus("linked");

    const t = setTimeout(() => {
      if (customFields.length > 0) {
        setFormStep("extra_fields");
      } else {
        setFormStep("ready");
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [isPreview, formStep, telegramUiStatus, telegramStatus?.status, customFields.length]);

  // ─── Handlers ───

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const validation = emailSchema.safeParse(email);
    if (!validation.success) {
      setError(validation.error.errors[0].message);
      return;
    }

    // In preview mode, simulate step transition without real API calls
    if (isPreview) {
      setFormStep("signup");
      return;
    }

    const result = await inlineAuth.checkEmail(email);
    if (result) {
      setFormStep(result.exists ? "login" : "signup");
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

    // In preview mode, simulate the flow
    if (isPreview) {
      setFormStep(getNextStepAfterAuth());
      return;
    }

    const result = await inlineAuth.login(email, password);
    if (result) {
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

      setFormStep(getNextStepAfterAuth());
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

    // In preview mode, simulate the flow
    if (isPreview) {
      setFormStep(getNextStepAfterAuth());
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
        setFormStep(getNextStepAfterAuth());
      }
    } else if (inlineAuth.error) {
      setError(inlineAuth.error);
    }
  };

  const handleStartTelegram = async () => {
    // In preview, simulate full flow: pending → linked after 1s (UI-only, no real API calls)
    if (isPreview) {
      setTelegramUiStatus("pending");
      setTelegramDeepLink("https://t.me/preview_bot?start=demo");
      setTimeout(() => setTelegramUiStatus("linked"), 1000);
      return;
    }
    setTelegramUiStatus("starting");
    try {
      const result = await startTelegramLink.mutateAsync();
      if (result.deep_link) {
        setTelegramDeepLink(result.deep_link);
        setTelegramUiStatus("pending");
        window.open(result.deep_link, "_blank");
      }
    } catch (err) {
      console.error("Failed to start Telegram link:", err);
      setTelegramUiStatus("failed");
    }
  };

  const handleTelegramRecheck = async () => {
    const { data } = await refetchTelegramStatus();
    if (data?.status === "active") {
      setTelegramUiStatus("linked");
    }
  };

  // handleSkipTelegram removed — Telegram linking is mandatory when telegram_link=true

  const handleExtraFieldsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

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

    setFormStep("ready");
  };

  // ─── Submit — only by explicit click from "ready" step ───
  const doSubmit = async () => {
    // HARD RULE: preview never creates real submissions
    if (isPreview) {
      setFormStep("success");
      return;
    }

    if (!pageId) {
      setError("Ошибка конфигурации формы");
      return;
    }

    setFormStep("submitting");
    setLoading(true);
    setError("");

    try {
      // Only include product if product_binding_enabled
      const productId = productBindingEnabled ? (content.product_id as string) || undefined : undefined;
      const tariffId = productBindingEnabled ? (content.tariff_id as string) || undefined : undefined;

      const submissionFields = customFields.map((field, i) => ({
        label: field.label,
        type: field.type,
        value: (extraValues[i] || "").trim(),
        mapping: field.mapping || "none",
      }));

      // Client-side instagram normalization (server re-normalizes as source of truth)
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

      // Deal creation settings — only if toggle enabled
      if (dealCreationEnabled) {
        payload.deal_creation_enabled = true;
        const pipelineId = (content.pipeline_id as string) || "";
        const stageId = (content.pipeline_stage_id as string) || "";
        if (pipelineId) payload.pipeline_id = pipelineId;
        if (stageId) payload.pipeline_stage_id = stageId;
      }

      // product_binding_enabled flag for backend to guard
      payload.product_binding_enabled = !!productBindingEnabled;

      const { error: fnError } = await supabase.functions.invoke(
        "site-form-submit",
        { body: payload }
      );

      if (fnError) {
        console.error("Form submit error:", fnError);
        setError("Не удалось отправить форму. Попробуйте позже.");
        setFormStep("ready");
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
      setFormStep("ready");
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───

  const wrapSection = (stepLabel: string | null, children: React.ReactNode) => (
    <section className="py-12 px-6">
      <div className="max-w-xl mx-auto space-y-6">
        {isPreview && (
          <div className="text-xs text-center text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
            Предпросмотр формы — действия не выполняются
          </div>
        )}
        {title && <h3 className="text-2xl font-bold text-foreground text-center">{title}</h3>}
        {subtitle && <p className="text-muted-foreground text-center">{subtitle}</p>}
        {stepLabel && (
          <p className="text-xs text-muted-foreground text-center uppercase tracking-wide">{stepLabel}</p>
        )}
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
    return wrapSection(null,
      <div className="text-center text-muted-foreground">Загрузка...</div>
    );
  }

  if (formStep === "submitting") {
    return wrapSection(null,
      <div className="text-center space-y-2">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
        <p className="text-muted-foreground">Отправка...</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (formStep === "email_check") {
    return wrapSection("Шаг 1 — Вход",
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
    return wrapSection("Вход в аккаунт",
      <form onSubmit={handleLoginSubmit} className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Аккаунт найден. Введите пароль для входа.
        </p>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Email</label>
          <input type="email" className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm" value={email} disabled />
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
        {inlineAuth.step === "password_reset_sent" && (
          <p className="text-sm text-primary text-center">
            Письмо для восстановления пароля отправлено на {email}. Перейдите по ссылке, задайте новый пароль и вернитесь сюда.
          </p>
        )}
        <button
          type="submit"
          disabled={inlineAuth.isLoading}
          className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {inlineAuth.isLoading ? "Вход..." : "Войти"}
        </button>
        <button
          type="button"
          onClick={async () => {
            if (isPreview) return;
            await inlineAuth.requestPasswordReset(email);
          }}
          className="w-full text-sm text-primary hover:underline"
        >
          Забыли пароль?
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
    return wrapSection("Регистрация",
      <form onSubmit={handleSignupSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Email</label>
          <input type="email" className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm" value={email} disabled />
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
          <label className="block text-sm font-medium text-foreground mb-1">Телефон</label>
          <PhoneInput value={phone} onChange={(val) => setPhone(val || "")} />
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
    return wrapSection("Подтверждение email",
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
            supabase.auth.getSession().then(({ data: { session: s } }) => {
              if (s) {
                setFormStep(getNextStepAfterAuth());
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
    return wrapSection("Привязка Telegram",
      <div className="space-y-5 text-center">
        {/* Friendly bot illustration — inline SVG, no external assets */}
        <div className="flex justify-center">
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-sm">
            {/* Antenna */}
            <line x1="40" y1="8" x2="40" y2="18" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="40" cy="6" r="3.5" fill="hsl(var(--primary))" opacity="0.8" />
            {/* Head */}
            <rect x="14" y="18" width="52" height="40" rx="14" fill="hsl(var(--primary))" opacity="0.12" stroke="hsl(var(--primary))" strokeWidth="2" />
            {/* Eyes */}
            <circle cx="30" cy="36" r="5" fill="hsl(var(--primary))" opacity="0.7" />
            <circle cx="50" cy="36" r="5" fill="hsl(var(--primary))" opacity="0.7" />
            <circle cx="31.5" cy="34.5" r="1.8" fill="white" />
            <circle cx="51.5" cy="34.5" r="1.8" fill="white" />
            {/* Smile */}
            <path d="M30 46 Q40 54 50 46" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.6" />
            {/* Ears */}
            <rect x="6" y="28" width="6" height="16" rx="3" fill="hsl(var(--primary))" opacity="0.25" />
            <rect x="68" y="28" width="6" height="16" rx="3" fill="hsl(var(--primary))" opacity="0.25" />
            {/* Body hint */}
            <rect x="26" y="60" width="28" height="12" rx="6" fill="hsl(var(--primary))" opacity="0.08" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          </svg>
        </div>

        <h4 className="text-lg font-semibold text-foreground">Привяжите Telegram-бота</h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Все доступы к продуктам и материалам выдаются только через Telegram.<br />
          Чтобы получить доступ, обязательно привяжите нашего бота.
        </p>

        {telegramUiStatus === "linked" && (
          <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
            ✓ Telegram успешно привязан! Переходим дальше…
          </div>
        )}

        {telegramUiStatus === "failed" && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            Не удалось начать привязку. Попробуйте ещё раз.
          </div>
        )}

        {(telegramUiStatus === "idle" || telegramUiStatus === "failed") && (
          <button
            type="button"
            onClick={handleStartTelegram}
            className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            Привязать Telegram-бота
          </button>
        )}

        {telegramUiStatus === "starting" && (
          <div className="text-sm text-muted-foreground">Загрузка...</div>
        )}

        {telegramUiStatus === "pending" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Бот открыт в новом окне. Нажмите «Start» в Telegram, затем вернитесь сюда.
            </p>
            <button
              type="button"
              onClick={handleTelegramRecheck}
              className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Проверить статус
            </button>
            {telegramDeepLink && (
              <a
                href={telegramDeepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-primary hover:underline"
              >
                Открыть бота повторно
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  if (formStep === "extra_fields") {
    return wrapSection(customFields.length > 0 ? "Дополнительные вопросы" : null,
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
          className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Продолжить
        </button>
      </form>
    );
  }

  if (formStep === "ready") {
    return wrapSection(null,
      <div className="space-y-4">
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <button
          type="button"
          onClick={doSubmit}
          disabled={loading}
          className="w-full rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Отправка..." : buttonText}
        </button>
      </div>
    );
  }

  return null;
}
