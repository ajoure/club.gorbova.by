import { useState, useEffect } from "react";
import { FileText, ExternalLink, Image as ImageIcon, Play, Mic, Download, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

interface InstagramMessageMediaProps {
  url: string;
  type?: string | null;
  className?: string;
  /** ID сообщения в БД — нужен для rehost callback'а на конкретную запись. */
  messageId?: string;
}

/**
 * Извлекает «человеческое» имя файла из URL.
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

const UNSTABLE_HOST_RE = /(lookaside\.fbsbx\.com|fbcdn\.net|cdninstagram\.com)/i;

/**
 * Lazy server-side rehost для нестабильных Instagram CDN URL.
 * Ставим в очередь только при реальной ошибке playback или для audio/video,
 * где browser обычно не открывает напрямую signed lookaside ссылки.
 */
async function rehostMedia(
  messageId: string | undefined,
  sourceUrl: string,
  mediaType: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("instagram-media-proxy", {
      body: { message_id: messageId, source_url: sourceUrl, media_type: mediaType },
    });
    if (error) return null;
    if (data?.ok && data?.stable_url && data.stable_url !== sourceUrl) {
      return data.stable_url as string;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Рендерит медиа-вложение Instagram/ManyChat в чат-пузыре.
 *
 * PATCH: Inbound media playback fix.
 *  - audio/video теперь ВСЕГДА проходит через rehost (lookaside lookup-only headers
 *    ломают <audio>/<video>) → inline player работает стабильно;
 *  - image: остаётся inline lightbox; на 404/CORS — пробуем rehost;
 *  - file: карточка с download.
 *  - fallback "Открыть" — только если inline-play реально невозможен.
 */
export function InstagramMessageMedia({
  url,
  type,
  className,
  messageId,
}: InstagramMessageMediaProps) {
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string>(url);
  const [rehosting, setRehosting] = useState(false);

  const t = (type || "").toLowerCase();
  const isImage = t === "image" || t.startsWith("image/");
  const isVideo = t === "video" || t.startsWith("video/");
  const isVoice = t === "voice" || t === "audio/voice";
  const isAudio = t === "audio" || isVoice || t.startsWith("audio/");
  const isUnstable = UNSTABLE_HOST_RE.test(url);

  // Eager rehost для audio/video с нестабильных CDN — иначе browser не сможет проиграть.
  useEffect(() => {
    setResolvedUrl(url);
    setImgError(false);
    setVideoError(false);
    setAudioError(false);
    if (isUnstable && (isAudio || isVideo)) {
      setRehosting(true);
      rehostMedia(messageId, url, isAudio ? "audio" : "video")
        .then((stable) => {
          if (stable) setResolvedUrl(stable);
        })
        .finally(() => setRehosting(false));
    }
  }, [url, isAudio, isVideo, isUnstable, messageId]);

  // Lazy rehost при ошибке image/video → пробуем заменить URL.
  const tryLazyRehost = async (kind: "image" | "video" | "audio") => {
    if (resolvedUrl !== url) return; // уже rehosted и снова сломалось — не зацикливаем
    setRehosting(true);
    const stable = await rehostMedia(messageId, url, kind);
    setRehosting(false);
    if (stable) {
      setResolvedUrl(stable);
      setImgError(false);
      setVideoError(false);
      setAudioError(false);
    }
  };

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
            src={resolvedUrl}
            alt="Вложение"
            loading="lazy"
            className="w-full max-h-64 object-cover group-hover:opacity-90 transition-opacity"
            onError={() => {
              if (resolvedUrl === url && isUnstable) {
                void tryLazyRehost("image");
              } else {
                setImgError(true);
              }
            }}
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
              href={resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-14 top-3 z-10 rounded-full bg-background/80 p-2 hover:bg-background transition-colors"
              aria-label="Открыть оригинал"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <img
              src={resolvedUrl}
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
    if (rehosting && resolvedUrl === url) {
      return (
        <div className={cn("flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs", className)}>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Готовим видео…</span>
        </div>
      );
    }
    return (
      <video
        controls
        preload="metadata"
        playsInline
        className={cn("rounded-lg max-h-64 max-w-[280px] border border-border/30 bg-black", className)}
        onError={() => {
          if (resolvedUrl === url && isUnstable) {
            void tryLazyRehost("video");
          } else {
            setVideoError(true);
          }
        }}
      >
        <source src={resolvedUrl} />
      </video>
    );
  }

  // ─── AUDIO / VOICE ──────────────────────────────────────────────
  if (isAudio && !audioError) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 max-w-[320px]",
          className,
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {rehosting && resolvedUrl === url ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-foreground/80 mb-1">
            {isVoice ? "Голосовое сообщение" : "Аудио"}
          </div>
          {rehosting && resolvedUrl === url ? (
            <div className="text-[11px] text-muted-foreground">Готовим аудио…</div>
          ) : (
            <audio
              controls
              preload="metadata"
              className="w-full h-8"
              onError={() => {
                if (resolvedUrl === url && isUnstable) {
                  void tryLazyRehost("audio");
                } else {
                  setAudioError(true);
                }
              }}
            >
              <source src={resolvedUrl} />
            </audio>
          )}
        </div>
      </div>
    );
  }

  // ─── FILE / UNKNOWN / FALLBACK ──────────────────────────────────
  // Сюда попадаем только если inline-play реально не удался.
  const Icon = isImage ? ImageIcon : isVideo ? Play : isAudio ? Mic : FileText;
  const fileName = deriveFileName(resolvedUrl, t);
  const playFailedHint = imgError || videoError || audioError;
  return (
    <a
      href={resolvedUrl}
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
      <div className="flex-1 min-w-0">
        <span className="block truncate font-medium">{fileName}</span>
        {playFailedHint && (
          <span className="block text-[10px] text-muted-foreground">
            Не удалось встроенно проиграть — открыть в новой вкладке
          </span>
        )}
      </div>
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

/**
 * Проверка: является ли строка media-URL.
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
