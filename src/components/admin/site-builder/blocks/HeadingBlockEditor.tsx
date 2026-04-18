import { Label } from "@/components/ui/label";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface HeadingBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function HeadingBlockEditor({ content, onChange }: HeadingBlockEditorProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Текст заголовка</Label>
        <RichTextarea
          inline
          value={(content.text as string) || ""}
          onChange={(v) => onChange({ ...content, text: v })}
          placeholder="Заголовок секции"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Уровень</Label>
        <Select
          value={String((content.level as number) || 2)}
          onValueChange={(v) => onChange({ ...content, level: parseInt(v) })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">H1</SelectItem>
            <SelectItem value="2">H2</SelectItem>
            <SelectItem value="3">H3</SelectItem>
            <SelectItem value="4">H4</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
