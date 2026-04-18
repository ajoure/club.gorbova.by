import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

interface TestimonialsBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function TestimonialsBlockEditor({ content, onChange }: TestimonialsBlockEditorProps) {
  const items = (content.items as Array<{ name: string; text: string; avatar: string; role: string }>) || [];

  const updateItem = (index: number, patch: Record<string, string>) => {
    const updated = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ ...content, items: updated });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Колонок</Label>
        <Select value={String((content.columns as number) || 2)} onValueChange={(v) => onChange({ ...content, columns: Number(v) })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {items.map((item, i) => (
        <div key={i} className="border rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Отзыв {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange({ ...content, items: items.filter((_, j) => j !== i) })}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <RichTextarea inline value={item.name} onChange={(v) => updateItem(i, { name: v })} placeholder="Имя" />
          <RichTextarea inline value={item.role} onChange={(v) => updateItem(i, { role: v })} placeholder="Должность / роль" />
          <RichTextarea value={item.text} onChange={(v) => updateItem(i, { text: v })} placeholder="Текст отзыва" minHeight="80px" />
          <Input value={item.avatar} onChange={(e) => updateItem(i, { avatar: e.target.value })} placeholder="URL аватара" />
        </div>
      ))}

      <Button variant="outline" size="sm" className="w-full" onClick={() => onChange({ ...content, items: [...items, { name: "", text: "", avatar: "", role: "" }] })}>
        <Plus className="h-3 w-3 mr-1" /> Добавить отзыв
      </Button>
    </div>
  );
}
