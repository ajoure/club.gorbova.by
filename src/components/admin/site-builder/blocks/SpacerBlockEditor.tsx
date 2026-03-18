import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SpacerBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function SpacerBlockEditor({ content, onChange }: SpacerBlockEditorProps) {
  return (
    <div>
      <Label className="text-xs">Высота (px)</Label>
      <Input
        type="number"
        min={0}
        value={(content.height as number) || 40}
        onChange={(e) => onChange({ ...content, height: Number(e.target.value) || 0 })}
      />
    </div>
  );
}
