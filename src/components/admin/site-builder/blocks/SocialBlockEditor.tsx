import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/services/sitePages/types";

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  vk: "ВКонтакте",
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  x: "X (Twitter)",
};

interface SocialBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function SocialBlockEditor({ content, onChange }: SocialBlockEditorProps) {
  const items = (content.items as Array<{ platform: SocialPlatform; url: string; label: string }>) || [];

  const updateItem = (index: number, patch: Record<string, string>) => {
    const updated = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ ...content, items: updated });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Выравнивание</Label>
        <Select value={(content.alignment as string) || "center"} onValueChange={(v) => onChange({ ...content, alignment: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Лево</SelectItem>
            <SelectItem value="center">Центр</SelectItem>
            <SelectItem value="right">Право</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {items.map((item, i) => (
        <div key={i} className="border rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ссылка {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange({ ...content, items: items.filter((_, j) => j !== i) })}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Select value={item.platform} onValueChange={(v) => updateItem(i, { platform: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOCIAL_PLATFORMS.map((p) => (
                <SelectItem key={p} value={p}>{PLATFORM_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={item.url} onChange={(e) => updateItem(i, { url: e.target.value })} placeholder="https://..." />
          <Input value={item.label} onChange={(e) => updateItem(i, { label: e.target.value })} placeholder="Подпись (необязательно)" />
        </div>
      ))}

      <Button variant="outline" size="sm" className="w-full" onClick={() => onChange({ ...content, items: [...items, { platform: "telegram" as SocialPlatform, url: "", label: "" }] })}>
        <Plus className="h-3 w-3 mr-1" /> Добавить соцсеть
      </Button>
    </div>
  );
}
