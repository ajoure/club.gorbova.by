import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SiteAudioBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function SiteAudioBlockEditor({ content, onChange }: SiteAudioBlockEditorProps) {
  const url = (content.url as string) || "";
  const title = (content.title as string) || "";

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">URL аудио</Label>
        <Input
          value={url}
          onChange={(e) => onChange({ ...content, url: e.target.value })}
          placeholder="https://example.com/audio.mp3"
        />
      </div>
      <div>
        <Label className="text-xs">Название (опционально)</Label>
        <Input
          value={title}
          onChange={(e) => onChange({ ...content, title: e.target.value })}
          placeholder="Название аудио"
        />
      </div>
      {url && (
        <div>
          <Label className="text-xs text-muted-foreground">Предпросмотр</Label>
          <audio controls className="w-full mt-1">
            <source src={url} />
          </audio>
        </div>
      )}
    </div>
  );
}
