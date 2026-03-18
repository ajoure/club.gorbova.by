import type { SocialPlatform } from "@/services/sitePages/types";

interface SocialSectionProps {
  content: Record<string, unknown>;
}

const PLATFORM_ICONS: Record<SocialPlatform, string> = {
  telegram: "✈️",
  instagram: "📸",
  vk: "🔵",
  youtube: "▶️",
  tiktok: "🎵",
  facebook: "📘",
  whatsapp: "💬",
  x: "𝕏",
};

export function SocialSection({ content }: SocialSectionProps) {
  const items = (content.items as Array<{ platform: SocialPlatform; url: string; label: string }>) || [];
  if (!items.length) return null;

  const alignment = (content.alignment as string) || "center";
  const alignClass = alignment === "left" ? "justify-start" : alignment === "right" ? "justify-end" : "justify-center";

  return (
    <section className="py-8 px-6">
      <div className={`max-w-4xl mx-auto flex flex-wrap gap-4 ${alignClass}`}>
        {items.map((item, i) => (
          <a
            key={i}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border hover:bg-muted transition-colors text-sm text-foreground"
          >
            <span>{PLATFORM_ICONS[item.platform] || "🔗"}</span>
            <span>{item.label || item.platform}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
