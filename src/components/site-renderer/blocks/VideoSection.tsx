import { parseVideoUrl } from "@/services/sitePages/adapters/VideoEmbedAdapter";

interface VideoSectionProps {
  content: Record<string, unknown>;
}

const ASPECT_RATIOS: Record<string, string> = {
  "16:9": "56.25%",
  "4:3": "75%",
  "1:1": "100%",
};

export function VideoSection({ content }: VideoSectionProps) {
  const result = parseVideoUrl((content.url as string) || "");
  if (!result) return null;

  const ratio = ASPECT_RATIOS[(content.aspectRatio as string) || "16:9"] || "56.25%";
  const autoplay = (content.autoplay as boolean) ? "?autoplay=1&mute=1" : "";

  return (
    <section className="py-6 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="relative w-full" style={{ paddingBottom: ratio }}>
          <iframe
            src={`${result.embedUrl}${autoplay}`}
            className="absolute inset-0 w-full h-full rounded-lg"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}
