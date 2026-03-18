import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ButtonBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function ButtonBlockEditor({ content, onChange }: ButtonBlockEditorProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Текст кнопки</Label>
        <Input value={(content.text as string) || ""} onChange={(e) => onChange({ ...content, text: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Ссылка</Label>
        <Input value={(content.link as string) || ""} onChange={(e) => onChange({ ...content, link: e.target.value })} placeholder="https://..." />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">Вариант</Label>
          <Select value={(content.variant as string) || "primary"} onValueChange={(v) => onChange({ ...content, variant: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="primary">Primary</SelectItem>
              <SelectItem value="secondary">Secondary</SelectItem>
              <SelectItem value="outline">Outline</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Размер</Label>
          <Select value={(content.size as string) || "md"} onValueChange={(v) => onChange({ ...content, size: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">Маленький</SelectItem>
              <SelectItem value="md">Средний</SelectItem>
              <SelectItem value="lg">Большой</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Выравнивание</Label>
          <Select value={(content.alignment as string) || "center"} onValueChange={(v) => onChange({ ...content, alignment: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Лево</SelectItem>
              <SelectItem value="center">Центр</SelectItem>
              <SelectItem value="right">Право</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
