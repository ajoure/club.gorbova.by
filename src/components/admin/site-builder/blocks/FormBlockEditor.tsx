import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, AlertTriangle } from "lucide-react";

/**
 * FormBlockEditor — visual configuration only.
 * INVARIANT: Zero backend calls, zero table writes, zero events, zero cross-domain side effects.
 * Form submission is disabled in the renderer with placeholder text.
 */

interface FormBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function FormBlockEditor({ content, onChange }: FormBlockEditorProps) {
  const fields = (content.fields as Array<{ label: string; type: string; required: boolean }>) || [];

  const updateField = (index: number, patch: Record<string, unknown>) => {
    const updated = fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange({ ...content, fields: updated });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-2 bg-muted/50 rounded-lg text-xs text-muted-foreground">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Форма отображается как визуальный макет. Отправка данных будет подключена позже.</span>
      </div>

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
      <div>
        <Label className="text-xs">Сообщение-заглушка</Label>
        <Input value={(content.placeholderMessage as string) || "Форма будет подключена позже"} onChange={(e) => onChange({ ...content, placeholderMessage: e.target.value })} />
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
          <div className="flex items-center justify-between">
            <Label className="text-xs">Обязательное</Label>
            <Switch checked={field.required} onCheckedChange={(v) => updateField(i, { required: v })} />
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" className="w-full" onClick={() => onChange({ ...content, fields: [...fields, { label: "", type: "text", required: false }] })}>
        <Plus className="h-3 w-3 mr-1" /> Добавить поле
      </Button>
    </div>
  );
}
