import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isValidVideoUrl } from "@/services/sitePages/adapters/VideoEmbedAdapter";

interface VideoBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function VideoBlockEditor({ content, onChange }: VideoBlockEditorProps) {
  const url = (content.url as string) || "";
  const valid = url ? isValidVideoUrl(url) : true;

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">URL видео (YouTube, Vimeo, RuTube)</Label>
        <Input
          value={url}
          onChange={(e) => onChange({ ...content, url: e.target.value })}
          placeholder="https://www.youtube.com/watch?v=..."
        />
        {url && !valid && (
          <p className="text-xs text-destructive mt-1">Неподдерживаемый формат URL</p>
        )}
      </div>
      <div>
        <Label className="text-xs">Пропорции</Label>
        <Select
          value={(content.aspectRatio as string) || "16:9"}
          onValueChange={(v) => onChange({ ...content, aspectRatio: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="16:9">16:9</SelectItem>
            <SelectItem value="4:3">4:3</SelectItem>
            <SelectItem value="1:1">1:1</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-xs">Автовоспроизведение</Label>
        <Switch
          checked={(content.autoplay as boolean) || false}
          onCheckedChange={(v) => onChange({ ...content, autoplay: v })}
        />
      </div>
    </div>
  );
}
