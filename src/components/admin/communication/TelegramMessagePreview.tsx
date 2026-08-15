import { useMemo } from "react";
import { SafeHtml } from "@/components/ui/SafeHtml";

interface TelegramMessagePreviewProps {
  text: string;
  mediaType?: "photo" | "animation" | "video" | "audio" | "video_note" | "document" | null;
  mediaUrl?: string;
  fileName?: string;
  buttonText?: string;
  showButton?: boolean;
  deliveryHint?: string;
  willSplit?: boolean;
}

export function TelegramMessagePreview({
  text,
  mediaType,
  mediaUrl,
  fileName,
  buttonText,
  showButton,
  deliveryHint,
  willSplit,
}: TelegramMessagePreviewProps) {
  const formattedHtml = useMemo(() => {
    if (!text) return "";
    
    // Process lines individually to handle [[align:...]] prefixes
    const lines = text.split("\n");
    const processedLines = lines.map((line) => {
      const alignMatch = line.match(/^\[\[align:(left|center|right)\]\]/);
      const align = alignMatch ? alignMatch[1] : null;
      const cleanLine = alignMatch ? line.slice(alignMatch[0].length) : line;
      
      const html = cleanLine
        // Escape HTML
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // Bold: *text*
        .replace(/\*([^*]+)\*/g, "<strong>$1</strong>")
        // Italic: _text_
        .replace(/_([^_]+)_/g, "<em>$1</em>")
        // Code: `text`
        .replace(/`([^`]+)`/g, "<code class='bg-muted px-1 rounded text-sm font-mono'>$1</code>")
        // Links: [text](url)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href='$2' class='text-primary underline' target='_blank' rel='noopener'>$1</a>");
      
      const style = align ? ` style="text-align:${align};"` : "";
      return `<div${style}>${html || "&nbsp;"}</div>`;
    });
    
    return processedLines.join("");
  }, [text]);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl rounded-bl-md bg-[#e7f2ff] dark:bg-[#183654] p-3 shadow-sm max-w-md">
        {mediaType === "photo" && mediaUrl && (
          <img src={mediaUrl} alt="Фото в рассылке" className="w-full max-h-64 object-cover rounded-xl mb-2" />
        )}
        {mediaType === "animation" && mediaUrl && (
          fileName?.toLowerCase().endsWith(".mp4") ? (
            <video src={mediaUrl} autoPlay loop muted playsInline className="w-full max-h-64 rounded-xl mb-2" />
          ) : (
            <img src={mediaUrl} alt="GIF в рассылке" className="w-full max-h-64 object-cover rounded-xl mb-2" />
          )
        )}
        {mediaType === "video" && mediaUrl && (
          <video src={mediaUrl} controls className="w-full max-h-64 rounded-xl mb-2" />
        )}
        {mediaType && !["photo", "animation", "video"].includes(mediaType) && (
          <div className="rounded-lg border bg-background/60 px-3 py-4 mb-2 text-sm">
            {mediaType === "audio" ? "🎵 Аудио" : mediaType === "video_note" ? "⭕ Видеокружок" : "📎 Файл"}
            {fileName ? ` · ${fileName}` : ""}
          </div>
        )}
        {text ? (
          <SafeHtml html={formattedHtml} as="div" className="prose prose-sm dark:prose-invert max-w-none" />
        ) : !mediaType ? (
          <div className="text-muted-foreground text-sm italic">Введите текст сообщения...</div>
        ) : null}
        {showButton && (
          <div className="mt-3 rounded-lg bg-white/80 dark:bg-black/20 text-center px-3 py-2 text-sm font-medium text-primary">
            {buttonText || "Открыть"}
          </div>
        )}
      </div>
      {deliveryHint && (
        <p className={willSplit ? "text-xs text-destructive" : "text-xs text-emerald-700 dark:text-emerald-400"}>
          {willSplit ? "Будет разделено: " : "Будет отправлено вместе: "}{deliveryHint}
        </p>
      )}
    </div>
  );
}
