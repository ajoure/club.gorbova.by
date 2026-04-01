import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { AlertTriangle } from "lucide-react";

const EMBED_WHITELIST = [
  "youtube.com", "youtu.be", "vimeo.com",
  "docs.google.com", "drive.google.com",
  "figma.com", "canva.com", "miro.com",
  "loom.com", "calendly.com", "typeform.com",
  "airtable.com", "notion.so",
];

function isAllowedEmbedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname;
    return EMBED_WHITELIST.some(d => hostname === d || hostname.endsWith("." + d));
  } catch {
    return false;
  }
}

interface SiteEmbedBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function SiteEmbedBlockEditor({ content, onChange }: SiteEmbedBlockEditorProps) {
  const url = (content.url as string) || "";
  const height = (content.height as number) || 400;
  const urlValid = !url || isAllowedEmbedUrl(url);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">URL для встраивания</Label>
        <Input
          value={url}
          onChange={(e) => onChange({ ...content, url: e.target.value })}
          placeholder="https://youtube.com/embed/..."
        />
        {url && !urlValid && (
          <div className="flex items-start gap-1.5 mt-1.5 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Домен не в списке разрешённых. Допустимы: {EMBED_WHITELIST.join(", ")}. Embed не будет отображён на сайте.</span>
          </div>
        )}
      </div>
      <div>
        <Label className="text-xs">Высота: {height}px</Label>
        <Slider
          value={[height]}
          onValueChange={([v]) => onChange({ ...content, height: v })}
          min={200}
          max={800}
          step={50}
        />
      </div>
    </div>
  );
}
