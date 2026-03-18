import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";

interface LogosBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function LogosBlockEditor({ content, onChange }: LogosBlockEditorProps) {
  const items = (content.items as Array<{ url: string; alt: string; linkUrl: string }>) || [];

  const updateItem = (index: number, patch: Record<string, string>) => {
    const updated = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ ...content, items: updated });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Высота лого (px)</Label>
          <Input
            type="number"
            min={16}
            value={(content.logoHeight as number) || 48}
            onChange={(e) => onChange({ ...content, logoHeight: Number(e.target.value) || 48 })}
          />
        </div>
        <div className="flex items-center justify-between pt-5">
          <Label className="text-xs">Ч/Б</Label>
          <Switch
            checked={(content.grayscale as boolean) || false}
            onCheckedChange={(v) => onChange({ ...content, grayscale: v })}
          />
        </div>
      </div>

      {items.map((item, i) => (
        <div key={i} className="border rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Лого {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange({ ...content, items: items.filter((_, j) => j !== i) })}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Input value={item.url} onChange={(e) => updateItem(i, { url: e.target.value })} placeholder="URL изображения" />
          <Input value={item.alt} onChange={(e) => updateItem(i, { alt: e.target.value })} placeholder="Alt текст" />
          <Input value={item.linkUrl} onChange={(e) => updateItem(i, { linkUrl: e.target.value })} placeholder="Ссылка (необязательно)" />
        </div>
      ))}

      <Button variant="outline" size="sm" className="w-full" onClick={() => onChange({ ...content, items: [...items, { url: "", alt: "", linkUrl: "" }] })}>
        <Plus className="h-3 w-3 mr-1" /> Добавить лого
      </Button>
    </div>
  );
}
