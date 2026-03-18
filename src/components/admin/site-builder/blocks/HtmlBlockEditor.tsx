import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface HtmlBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function HtmlBlockEditor({ content, onChange }: HtmlBlockEditorProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">HTML-код (скрипты и iframe будут удалены при рендере)</Label>
      <Textarea
        value={(content.code as string) || ""}
        onChange={(e) => onChange({ ...content, code: e.target.value })}
        placeholder="<div>...</div>"
        className="font-mono text-xs"
        rows={8}
      />
    </div>
  );
}
