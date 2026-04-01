import { Music } from "lucide-react";

interface AudioSectionProps {
  content: Record<string, unknown>;
}

export function AudioSection({ content }: AudioSectionProps) {
  const url = (content.url as string) || "";
  const title = (content.title as string) || "";

  if (!url) {
    return (
      <section className="py-6 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-center h-20 bg-muted rounded-lg">
          <Music className="h-8 w-8 text-muted-foreground" />
        </div>
      </section>
    );
  }

  return (
    <section className="py-6 px-6">
      <div className="max-w-3xl mx-auto space-y-2">
        {title && <p className="text-sm font-medium text-muted-foreground">{title}</p>}
        <audio controls className="w-full">
          <source src={url} />
        </audio>
      </div>
    </section>
  );
}
