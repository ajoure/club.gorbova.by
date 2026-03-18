import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface HeroBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function HeroBlockEditor({ content, onChange }: HeroBlockEditorProps) {
  const update = (key: string, value: unknown) => onChange({ ...content, [key]: value });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Заголовок</Label>
        <Input value={(content.title as string) || ""} onChange={(e) => update("title", e.target.value)} placeholder="Главный заголовок" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Подзаголовок</Label>
        <Textarea value={(content.subtitle as string) || ""} onChange={(e) => update("subtitle", e.target.value)} rows={2} placeholder="Описание" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Текст кнопки</Label>
          <Input value={(content.buttonText as string) || ""} onChange={(e) => update("buttonText", e.target.value)} placeholder="Начать" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ссылка кнопки</Label>
          <Input value={(content.buttonLink as string) || ""} onChange={(e) => update("buttonLink", e.target.value)} placeholder="/pricing" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Фоновое изображение (URL)</Label>
        <Input value={(content.backgroundImage as string) || ""} onChange={(e) => update("backgroundImage", e.target.value)} placeholder="https://..." />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Выравнивание</Label>
        <Select value={(content.alignment as string) || "center"} onValueChange={(v) => update("alignment", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Слева</SelectItem>
            <SelectItem value="center">По центру</SelectItem>
            <SelectItem value="right">Справа</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
