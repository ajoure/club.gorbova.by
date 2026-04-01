import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

export function FormSection({ content, pageId }: FormSectionProps) {
  const title = (content.title as string) || "";
  const subtitle = (content.subtitle as string) || "";
  const buttonText = (content.buttonText as string) || "Отправить";
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

    // Client-side validation
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
      const payload = {
        page_id: pageId,
        fields: fields.map((field, i) => ({
          label: field.label,
          type: field.type,
          value: (values[i] || "").trim(),
          mapping: field.mapping || "none",
        })),
      };

      const { error: fnError } = await supabase.functions.invoke(
        "site-form-submit",
        { body: payload }
      );

      if (fnError) {
        console.error("Form submit error:", fnError);
        setError("Не удалось отправить форму. Попробуйте позже.");
      } else {
        setSubmitted(true);
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
