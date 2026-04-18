import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextarea } from "@/components/ui/RichTextarea";

interface CtaBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function CtaBlockEditor({ content, onChange }: CtaBlockEditorProps) {
  const update = (key: string, value: string) => onChange({ ...content, [key]: value });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Заголовок</Label>
        <RichTextarea inline value={(content.title as string) || ""} onChange={(v) => update("title", v)} placeholder="Готовы начать?" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Подзаголовок</Label>
        <RichTextarea value={(content.subtitle as string) || ""} onChange={(v) => update("subtitle", v)} minHeight="60px" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Текст кнопки</Label>
          <RichTextarea inline value={(content.buttonText as string) || ""} onChange={(v) => update("buttonText", v)} placeholder="Начать" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ссылка</Label>
          <Input value={(content.buttonLink as string) || ""} onChange={(e) => update("buttonLink", e.target.value)} placeholder="/pricing" />
        </div>
      </div>
    </div>
  );
}
