import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ImageBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function ImageBlockEditor({ content, onChange }: ImageBlockEditorProps) {
  const update = (key: string, value: string) => onChange({ ...content, [key]: value });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">URL изображения</Label>
        <Input value={(content.url as string) || ""} onChange={(e) => update("url", e.target.value)} placeholder="https://..." />
      </div>
      {content.url && (
        <div className="border rounded p-2">
          <img src={content.url as string} alt={(content.alt as string) || ""} className="max-h-40 mx-auto object-contain" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Alt текст</Label>
          <Input value={(content.alt as string) || ""} onChange={(e) => update("alt", e.target.value)} placeholder="Описание" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ширина</Label>
          <Input value={(content.width as string) || "100%"} onChange={(e) => update("width", e.target.value)} placeholder="100%" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Ссылка при клике</Label>
        <Input value={(content.linkUrl as string) || ""} onChange={(e) => update("linkUrl", e.target.value)} placeholder="https://..." />
      </div>
    </div>
  );
}
