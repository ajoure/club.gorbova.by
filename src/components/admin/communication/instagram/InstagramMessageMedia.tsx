import { useState } from "react";
import { FileText, ExternalLink, Image as ImageIcon, Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface InstagramMessageMediaProps {
  url: string;
  type?: string | null;
  className?: string;
}

/**
 * Рендерит медиа-вложение Instagram/ManyChat в чат-пузыре.
 * Поддерживает image / audio / voice / video / file / unknown (fallback карточкой).
 * URL никогда не показывается как сырой текст.
 */
export function InstagramMessageMedia({
  url,
  type,
  className,
}: InstagramMessageMediaProps) {
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const t = (type || "").toLowerCase();
  const isImage = t === "image" || t.startsWith("image/");
  const isVideo = t === "video" || t.startsWith("video/");
  const isAudio = t === "audio" || t === "voice" || t.startsWith("audio/");

  if (isImage && !imgError) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("block max-w-[260px] rounded-lg overflow-hidden border border-border/30", className)}
      >
        <img
          src={url}
          alt="Вложение"
          loading="lazy"
          className="w-full max-h-64 object-cover"
          onError={() => setImgError(true)}
        />
      </a>
    );
  }

  if (isVideo && !videoError) {
    return (
      <video
        controls
        preload="metadata"
        className={cn("rounded-lg max-h-64 max-w-[280px] border border-border/30", className)}
        onError={() => setVideoError(true)}
      >
        <source src={url} />
      </video>
    );
  }

  if (isAudio) {
    return (
      <audio
        controls
        preload="metadata"
        className={cn("max-w-[280px]", className)}
      >
        <source src={url} />
      </audio>
    );
  }

  // file / unknown — fallback карточка с кнопкой
  const Icon = isImage ? ImageIcon : isVideo ? Play : FileText;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs hover:bg-background/90 transition-colors max-w-[280px]",
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 min-w-0 truncate font-medium">Вложение</span>
      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
    </a>
  );
}

/**
 * Проверка: является ли строка media-URL (lookaside / fbcdn / расширения).
 * Для legacy-сообщений, где URL положили в message_text.
 */
const MEDIA_URL_RE = /^https?:\/\/(lookaside\.fbsbx\.com|scontent[\w.-]*\.fbcdn\.net|cdninstagram\.com)|^https?:\/\/\S+\.(jpe?g|png|gif|webp|mp4|mov|webm|mp3|m4a|ogg|wav|pdf|docx?|xlsx?|pptx?|zip)(?:[?#]|$)/i;

export function isMediaUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  return MEDIA_URL_RE.test(s.trim());
}

/**
 * Угадать тип media из URL (fallback render-layer для legacy записей).
 */
export function guessMediaTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|heic)(?:[?#]|$)/i.test(lower)) return "image";
  if (/\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(lower)) return "video";
  if (/\.(mp3|m4a|ogg|opus|wav|aac)(?:[?#]|$)/i.test(lower)) return "audio";
  if (/lookaside\.fbsbx\.com.*ig_messaging_cdn/i.test(url)) return "image";
  return "file";
}
