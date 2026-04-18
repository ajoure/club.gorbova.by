import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextarea } from "@/components/ui/RichTextarea";
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
  const grid = (content.grid as Record<string, unknown>) || {};

  const update = (patch: Record<string, unknown>) => onChange({ ...content, ...patch });
  const updateGrid = (patch: Record<string, unknown>) => {
    const next = { ...grid, ...patch };
    Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
    update({ grid: Object.keys(next).length === 0 ? undefined : next });
  };

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
        <RichTextarea
          inline
          value={(content.title as string) || ""}
          onChange={(v) => update({ title: v })}
          placeholder="Например: Достижения"
        />
      </div>
      <div>
        <Label className="text-xs">Подзаголовок (опционально)</Label>
        <RichTextarea
          inline
          value={(content.subtitle as string) || ""}
          onChange={(v) => update({ subtitle: v })}
        />
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

      <div className="space-y-2 border rounded p-3 bg-muted/30">
        <Label className="text-xs font-medium">Сетка (responsive)</Label>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-[11px] text-muted-foreground">Десктоп</Label>
            <Select
              value={String((grid.columnsDesktop as number) ?? columns)}
              onValueChange={(v) => updateGrid({ columnsDesktop: Number(v) })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Планшет</Label>
            <Select
              value={grid.columnsTablet ? String(grid.columnsTablet) : "auto"}
              onValueChange={(v) => updateGrid({ columnsTablet: v === "auto" ? undefined : Number(v) })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto</SelectItem>
                {[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Моб.</Label>
            <Select
              value={String((grid.columnsMobile as number) ?? 2)}
              onValueChange={(v) => updateGrid({ columnsMobile: Number(v) })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Расстояние между карточками</Label>
          <Select
            value={(grid.gap as string) ?? "lg"}
            onValueChange={(v) => updateGrid({ gap: v })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">Маленькое</SelectItem>
              <SelectItem value="md">Среднее</SelectItem>
              <SelectItem value="lg">Большое</SelectItem>
              <SelectItem value="xl">Очень большое</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Если «Десктоп» не задан — используется legacy значение «{columns}».
        </p>
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
            <RichTextarea
              inline
              value={item.label || ""}
              onChange={(v) => updateItem(idx, "label", v)}
              placeholder="Подпись (клиентов)"
            />
            <RichTextarea
              value={item.description || ""}
              onChange={(v) => updateItem(idx, "description", v)}
              placeholder="Описание (опционально)"
              minHeight="60px"
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
