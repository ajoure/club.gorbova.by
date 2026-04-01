import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";

interface FormBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

const MAPPING_OPTIONS = [
  { value: "none", label: "Без привязки" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Телефон" },
  { value: "full_name", label: "ФИО" },
  { value: "first_name", label: "Имя" },
  { value: "last_name", label: "Фамилия" },
  { value: "telegram_username", label: "Telegram" },
];

export function FormBlockEditor({ content, onChange }: FormBlockEditorProps) {
  const fields = (content.fields as Array<{ label: string; type: string; required: boolean; mapping?: string }>) || [];

  const updateField = (index: number, patch: Record<string, unknown>) => {
    const updated = fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange({ ...content, fields: updated });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Заголовок</Label>
        <Input value={(content.title as string) || ""} onChange={(e) => onChange({ ...content, title: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Подзаголовок</Label>
        <Input value={(content.subtitle as string) || ""} onChange={(e) => onChange({ ...content, subtitle: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Текст кнопки</Label>
        <Input value={(content.buttonText as string) || "Отправить"} onChange={(e) => onChange({ ...content, buttonText: e.target.value })} />
      </div>

      {fields.map((field, i) => (
        <div key={i} className="border rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Поле {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange({ ...content, fields: fields.filter((_, j) => j !== i) })}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Input value={field.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="Название поля" />
          <Select value={field.type} onValueChange={(v) => updateField(i, { type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Текст</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="phone">Телефон</SelectItem>
              <SelectItem value="textarea">Многострочный</SelectItem>
            </SelectContent>
          </Select>
          <div>
            <Label className="text-xs">Привязка к карточке</Label>
            <Select value={field.mapping || "none"} onValueChange={(v) => updateField(i, { mapping: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MAPPING_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Обязательное</Label>
            <Switch checked={field.required} onCheckedChange={(v) => updateField(i, { required: v })} />
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" className="w-full" onClick={() => onChange({ ...content, fields: [...fields, { label: "", type: "text", required: false, mapping: "none" }] })}>
        <Plus className="h-3 w-3 mr-1" /> Добавить поле
      </Button>
    </div>
  );
}
