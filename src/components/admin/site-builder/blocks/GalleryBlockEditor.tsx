import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

interface GalleryBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function GalleryBlockEditor({ content, onChange }: GalleryBlockEditorProps) {
  const items = (content.items as Array<{ url: string; alt: string; caption: string }>) || [];

  const updateItem = (index: number, patch: Record<string, string>) => {
    const updated = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ ...content, items: updated });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Колонок</Label>
          <Select value={String((content.columns as number) || 3)} onValueChange={(v) => onChange({ ...content, columns: Number(v) })}>
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
          <Input type="number" min={0} value={(content.gap as number) || 16} onChange={(e) => onChange({ ...content, gap: Number(e.target.value) || 0 })} />
        </div>
      </div>

      {items.map((item, i) => (
        <div key={i} className="border rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Изображение {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange({ ...content, items: items.filter((_, j) => j !== i) })}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Input value={item.url} onChange={(e) => updateItem(i, { url: e.target.value })} placeholder="URL изображения" />
          <Input value={item.alt} onChange={(e) => updateItem(i, { alt: e.target.value })} placeholder="Alt текст" />
          <Input value={item.caption} onChange={(e) => updateItem(i, { caption: e.target.value })} placeholder="Подпись" />
        </div>
      ))}

      <Button variant="outline" size="sm" className="w-full" onClick={() => onChange({ ...content, items: [...items, { url: "", alt: "", caption: "" }] })}>
        <Plus className="h-3 w-3 mr-1" /> Добавить изображение
      </Button>
    </div>
  );
}
