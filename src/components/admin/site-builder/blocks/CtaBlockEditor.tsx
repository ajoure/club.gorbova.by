import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
        <Input value={(content.title as string) || ""} onChange={(e) => update("title", e.target.value)} placeholder="Готовы начать?" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Подзаголовок</Label>
        <Textarea value={(content.subtitle as string) || ""} onChange={(e) => update("subtitle", e.target.value)} rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Текст кнопки</Label>
          <Input value={(content.buttonText as string) || ""} onChange={(e) => update("buttonText", e.target.value)} placeholder="Начать" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ссылка</Label>
          <Input value={(content.buttonLink as string) || ""} onChange={(e) => update("buttonLink", e.target.value)} placeholder="/pricing" />
        </div>
      </div>
    </div>
  );
}
