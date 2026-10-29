import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_CONTACT_URL_BUTTONS,
  validateContactUrlButtons,
  type TelegramUrlButton,
} from "../../../../supabase/functions/telegram-admin-chat/messageFormat";

export function TelegramUrlButtonEditor({ value, onChange, disabled = false }: {
  value: TelegramUrlButton[];
  onChange: (buttons: TelegramUrlButton[]) => void;
  disabled?: boolean;
}) {
  let error = "";
  let preview: TelegramUrlButton[] = [];
  try { preview = validateContactUrlButtons(value); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Проверьте кнопки"; }
  const update = (index: number, field: keyof TelegramUrlButton, text: string) => {
    onChange(value.map((button, i) => i === index ? { ...button, [field]: text } : button));
  };
  return <div className="mt-2 max-h-[35dvh] space-y-2 overflow-y-auto overscroll-contain" data-testid="telegram-url-button-editor">
    <Button type="button" variant="ghost" size="sm" className="h-8 text-xs"
      disabled={disabled || value.length >= MAX_CONTACT_URL_BUTTONS}
      onClick={() => onChange([...value, { text: "", url: "" }])}>
      <Plus className="h-3.5 w-3.5 mr-1" />Кнопка со ссылкой
    </Button>
    {value.map((button, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border p-2">
      <div className="min-w-0 space-y-2">
        <Input aria-label={`Название кнопки ${index + 1}`} placeholder="Например: Открыть урок"
          value={button.text} disabled={disabled} onChange={(event) => update(index, "text", event.target.value)} />
        <Input aria-label={`Ссылка кнопки ${index + 1}`} placeholder="https://…" inputMode="url"
          value={button.url} disabled={disabled} onChange={(event) => update(index, "url", event.target.value)} />
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label={`Удалить кнопку ${index + 1}`}
        disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>)}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {preview.length > 0 && <div aria-label="Кнопки под сообщением" className="space-y-1 rounded-md bg-muted/40 p-2">
      <p className="text-xs text-muted-foreground">Под сообщением</p>
      {preview.map((button, index) => <a key={index} href={button.url} target="_blank" rel="noopener noreferrer"
        className="block break-words rounded border px-3 py-2 text-center text-sm text-primary">{button.text}</a>)}
    </div>}
  </div>;
}
