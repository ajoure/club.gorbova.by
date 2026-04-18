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
  numbered: "Номер шага",
};

interface FeatureItem {
  icon: string;
  title: string;
  description: string;
}

interface FeaturesBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function FeaturesBlockEditor({ content, onChange }: FeaturesBlockEditorProps) {
  const items = (content.items as FeatureItem[]) || [];
  const layout = (content.layout as string) || "grid";
  const iconMode = (content.iconMode as string) || "";
  const columns = (content.columns as number) || 3;

  const update = (patch: Record<string, unknown>) => onChange({ ...content, ...patch });

  const addItem = () => update({ items: [...items, { icon: "", title: "", description: "" }] });
  const updateItem = (idx: number, field: string, value: string) => {
    update({ items: items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)) });
  };
  const removeItem = (idx: number) => update({ items: items.filter((_, i) => i !== idx) });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Раскладка</Label>
          <Select value={layout} onValueChange={(v) => update({ layout: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="grid">Сетка (по умолчанию)</SelectItem>
              <SelectItem value="card-list">Список карточек</SelectItem>
              <SelectItem value="numbered-list">Нумерованные шаги</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Режим иконки</Label>
          <Select value={iconMode || "default"} onValueChange={(v) => update({ iconMode: v === "default" ? undefined : v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">По умолчанию (emoji)</SelectItem>
              {ICON_MODES.map((m) => (
                <SelectItem key={m} value={m}>{ICON_MODE_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {layout === "grid" && (
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
      )}

      <div className="space-y-2">
        <Label className="text-xs">Пункты</Label>
        {items.map((item, idx) => (
          <div key={idx} className="border rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Пункт {idx + 1}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(idx)}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
            {iconMode !== "numbered" && iconMode !== "none" && (
              <Input value={item.icon} onChange={(e) => updateItem(idx, "icon", e.target.value)} placeholder="Иконка (emoji)" className="text-sm" />
            )}
            <Input value={item.title} onChange={(e) => updateItem(idx, "title", e.target.value)} placeholder="Заголовок" className="text-sm" />
            <Textarea value={item.description} onChange={(e) => updateItem(idx, "description", e.target.value)} placeholder="Описание" rows={2} className="text-sm" />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Добавить пункт
        </Button>
      </div>
    </div>
  );
}
