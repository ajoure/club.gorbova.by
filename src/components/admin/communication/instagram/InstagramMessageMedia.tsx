import { useState } from "react";
import { FileText, ExternalLink, Image as ImageIcon, Play, Mic, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface InstagramMessageMediaProps {
  url: string;
  type?: string | null;
  className?: string;
}

/**
 * Извлекает «человеческое» имя файла из URL.
 * Для CDN без расширения — fallback по типу.
 */
function deriveFileName(url: string, type: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "";
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
  } catch {
    /* noop */
  }
  if (type === "image") return "Изображение";
  if (type === "video") return "Видео";
  if (type === "audio" || type === "voice") return "Голосовое сообщение";
  return "Вложение";
}

/**
 * Рендерит медиа-вложение Instagram/ManyChat в чат-пузыре.
 * Поддерживает image / audio / voice / video / file / unknown (fallback карточкой).
 * URL никогда не показывается как сырой текст.
 *
 * Inbound media UX:
 *  - image: клик → lightbox dialog (не новая вкладка)
 *  - audio/voice: native <audio controls> + подпись "Голосовое сообщение"
 *  - video: native <video controls> + fallback карточка
 *  - file: карточка с именем файла + кнопка "Скачать"
 */
export function InstagramMessageMedia({
  url,
  type,
  className,
}: InstagramMessageMediaProps) {
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const t = (type || "").toLowerCase();
  const isImage = t === "image" || t.startsWith("image/");
  const isVideo = t === "video" || t.startsWith("video/");
  const isVoice = t === "voice" || t === "audio/voice";
  const isAudio = t === "audio" || isVoice || t.startsWith("audio/");

  // ─── IMAGE → lightbox ───────────────────────────────────────────
  if (isImage && !imgError) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className={cn(
            "group block max-w-[260px] rounded-lg overflow-hidden border border-border/30 hover:border-border/60 transition-colors",
            className,
          )}
          aria-label="Открыть изображение"
        >
          <img
            src={url}
            alt="Вложение"
            loading="lazy"
            className="w-full max-h-64 object-cover group-hover:opacity-90 transition-opacity"
            onError={() => setImgError(true)}
          />
        </button>
        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-background/95 backdrop-blur border-0">
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="absolute right-3 top-3 z-10 rounded-full bg-background/80 p-2 hover:bg-background transition-colors"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-14 top-3 z-10 rounded-full bg-background/80 p-2 hover:bg-background transition-colors"
              aria-label="Открыть оригинал"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <img
              src={url}
              alt="Вложение"
              className="w-full h-full object-contain max-h-[90vh]"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ─── VIDEO ──────────────────────────────────────────────────────
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

  // ─── AUDIO / VOICE ──────────────────────────────────────────────
  if (isAudio) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 max-w-[300px]",
          className,
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Mic className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-foreground/80 mb-1">
            {isVoice ? "Голосовое сообщение" : "Аудио"}
          </div>
          <audio controls preload="metadata" className="w-full h-8">
            <source src={url} />
          </audio>
        </div>
      </div>
    );
  }

  // ─── FILE / UNKNOWN ─────────────────────────────────────────────
  const Icon = isImage ? ImageIcon : isVideo ? Play : FileText;
  const fileName = deriveFileName(url, t);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs hover:bg-background/90 transition-colors max-w-[280px] group",
        className,
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
        <Icon className="h-4 w-4" />
      </div>
      <span className="flex-1 min-w-0 truncate font-medium">{fileName}</span>
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
