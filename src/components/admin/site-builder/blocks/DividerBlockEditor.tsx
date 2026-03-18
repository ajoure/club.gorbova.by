import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DividerBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function DividerBlockEditor({ content, onChange }: DividerBlockEditorProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Стиль</Label>
        <Select value={(content.style as string) || "line"} onValueChange={(v) => onChange({ ...content, style: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="line">Линия</SelectItem>
            <SelectItem value="spacer">Отступ</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Высота (px)</Label>
        <Input
          type="number"
          min={1}
          max={200}
          value={(content.height as number) || 1}
          onChange={(e) => onChange({ ...content, height: parseInt(e.target.value) || 1 })}
        />
      </div>
    </div>
  );
}
