import { Code, ShieldAlert } from "lucide-react";

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

interface EmbedSectionProps {
  content: Record<string, unknown>;
}

export function EmbedSection({ content }: EmbedSectionProps) {
  const url = (content.url as string) || "";
  const height = (content.height as number) || 400;

  if (!url) {
    return (
      <section className="py-6 px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-center h-48 bg-muted rounded-lg">
          <Code className="h-12 w-12 text-muted-foreground" />
        </div>
      </section>
    );
  }

  if (!isAllowedEmbedUrl(url)) {
    return (
      <section className="py-6 px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-2 p-6 bg-muted rounded-lg text-muted-foreground">
          <ShieldAlert className="h-5 w-5" />
          <span className="text-sm">Встраивание заблокировано: источник не в списке разрешённых</span>
        </div>
      </section>
    );
  }

  return (
    <section className="py-6 px-6">
      <div className="max-w-4xl mx-auto rounded-lg overflow-hidden border">
        <iframe
          src={url}
          className="w-full"
          style={{ height: `${height}px` }}
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
    </section>
  );
}
