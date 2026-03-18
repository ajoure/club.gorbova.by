import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { Plus, Trash2 } from "lucide-react";

interface ColumnsBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function ColumnsBlockEditor({ content, onChange }: ColumnsBlockEditorProps) {
  const items = (content.items as Array<{ html: string }>) || [{ html: "" }, { html: "" }];
  const columns = (content.columns as number) || 2;

  const updateItem = (index: number, html: string) => {
    const updated = items.map((item, i) => (i === index ? { ...item, html } : item));
    onChange({ ...content, items: updated });
  };

  const addItem = () => {
    onChange({ ...content, items: [...items, { html: "" }] });
  };

  const removeItem = (index: number) => {
    if (items.length <= columns) return;
    onChange({ ...content, items: items.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Колонок</Label>
          <Select value={String(columns)} onValueChange={(v) => onChange({ ...content, columns: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Отступ (px)</Label>
          <Input
            type="number"
            min={0}
            value={(content.gap as number) || 24}
            onChange={(e) => onChange({ ...content, gap: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      {items.map((item, i) => (
        <div key={i} className="relative border rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Колонка {i + 1}</span>
            {items.length > columns && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(i)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
          <RichTextarea
            value={item.html}
            onChange={(html) => updateItem(i, html)}
            placeholder="Содержимое колонки..."
            minHeight="60px"
          />
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={addItem} className="w-full">
        <Plus className="h-3 w-3 mr-1" /> Добавить колонку
      </Button>
    </div>
  );
}
