import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { ICON_MODES, type IconMode } from "@/services/sitePages/types";

const ICON_MODE_LABELS: Record<IconMode, string> = {
  none: "Без иконки",
  circle: "Круглая",
  square: "Квадратная",
  numbered: "Номер",
};

interface StatsItem {
  number?: string;
  suffix?: string;
  label?: string;
  description?: string;
  icon?: string;
}

interface StatsBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function StatsBlockEditor({ content, onChange }: StatsBlockEditorProps) {
  const items = (content.items as StatsItem[]) || [];
  const columns = (content.columns as number) || 4;
  const iconMode = (content.iconMode as string) || "none";

  const update = (patch: Record<string, unknown>) => onChange({ ...content, ...patch });

  const addItem = () => {
    update({ items: [...items, { number: "", suffix: "", label: "", description: "", icon: "" }] });
  };
  const updateItem = (idx: number, field: string, value: string) => {
    update({ items: items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)) });
  };
  const removeItem = (idx: number) => {
    update({ items: items.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Заголовок секции (опционально)</Label>
        <Input
          value={(content.title as string) || ""}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Например: Достижения"
        />
      </div>
      <div>
        <Label className="text-xs">Подзаголовок (опционально)</Label>
        <Input
          value={(content.subtitle as string) || ""}
          onChange={(e) => update({ subtitle: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Колонок (desktop)</Label>
          <Select value={String(columns)} onValueChange={(v) => update({ columns: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Режим иконки</Label>
          <Select value={iconMode} onValueChange={(v) => update({ iconMode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ICON_MODES.map((m) => (
                <SelectItem key={m} value={m}>{ICON_MODE_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Показатели</Label>
        {items.map((item, idx) => (
          <div key={idx} className="border rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Показатель {idx + 1}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(idx)}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={item.number || ""}
                onChange={(e) => updateItem(idx, "number", e.target.value)}
                placeholder="Число (500)"
                className="text-sm"
              />
              <Input
                value={item.suffix || ""}
                onChange={(e) => updateItem(idx, "suffix", e.target.value)}
                placeholder="Суффикс (+, %, k)"
                className="text-sm"
              />
            </div>
            <Input
              value={item.label || ""}
              onChange={(e) => updateItem(idx, "label", e.target.value)}
              placeholder="Подпись (клиентов)"
              className="text-sm"
            />
            <Textarea
              value={item.description || ""}
              onChange={(e) => updateItem(idx, "description", e.target.value)}
              placeholder="Описание (опционально)"
              rows={2}
              className="text-sm"
            />
            {iconMode !== "none" && iconMode !== "numbered" && (
              <Input
                value={item.icon || ""}
                onChange={(e) => updateItem(idx, "icon", e.target.value)}
                placeholder="Иконка (эмодзи)"
                className="text-sm"
              />
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Добавить показатель
        </Button>
      </div>
    </div>
  );
}
