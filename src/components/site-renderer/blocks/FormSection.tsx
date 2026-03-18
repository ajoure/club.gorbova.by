/**
 * FormSection — visual placeholder only.
 * INVARIANT: Zero backend calls, zero table writes, zero events,
 * zero cross-domain side effects, disabled submit.
 */

interface FormSectionProps {
  content: Record<string, unknown>;
}

export function FormSection({ content }: FormSectionProps) {
  const title = (content.title as string) || "";
  const subtitle = (content.subtitle as string) || "";
  const buttonText = (content.buttonText as string) || "Отправить";
  const placeholderMessage = (content.placeholderMessage as string) || "Форма будет подключена позже";
  const fields = (content.fields as Array<{ label: string; type: string; required: boolean }>) || [];

  return (
    <section className="py-12 px-6">
      <div className="max-w-xl mx-auto space-y-6">
        {title && <h3 className="text-2xl font-bold text-foreground text-center">{title}</h3>}
        {subtitle && <p className="text-muted-foreground text-center">{subtitle}</p>}

        <div className="space-y-4">
          {fields.map((field, i) => (
            <div key={i}>
              <label className="block text-sm font-medium text-foreground mb-1">
                {field.label || `Поле ${i + 1}`}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  disabled
                  className="w-full rounded-md border border-input bg-muted/30 px-3 py-2 text-sm min-h-[80px]"
                  placeholder={field.label}
                />
              ) : (
                <input
                  disabled
                  type={field.type || "text"}
                  className="w-full rounded-md border border-input bg-muted/30 px-3 py-2 text-sm"
                  placeholder={field.label}
                />
              )}
            </div>
          ))}
        </div>

        <button
          disabled
          className="w-full rounded-md bg-primary/50 px-8 py-3 text-sm font-medium text-primary-foreground cursor-not-allowed"
        >
          {buttonText}
        </button>

        <p className="text-xs text-muted-foreground text-center">{placeholderMessage}</p>
      </div>
    </section>
  );
}
