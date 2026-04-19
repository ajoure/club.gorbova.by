import { useState, useEffect, useRef } from "react";
import { FileText, ExternalLink, Image as ImageIcon, Play, Pause, Mic, Download, X, Loader2 } from "lucide-react";
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

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const UNSTABLE_HOST_RE = /(lookaside\.fbsbx\.com|fbcdn\.net|cdninstagram\.com)/i;

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

// ─── Custom compact AUDIO player (Instagram-like) ──────────────────────
function CompactAudio({ src, isVoice, onError }: { src: string; isVoice: boolean; onError: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => onError());
    }
  };

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    el.currentTime = Math.max(0, Math.min(duration, ratio * duration));
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-muted/60 px-2.5 py-1.5 min-w-[200px] max-w-[280px]">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={onError}
        className="hidden"
      />
      <button
        type="button"
        onClick={togglePlay}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        aria-label={playing ? "Пауза" : "Воспроизвести"}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div
          className="relative h-1 w-full cursor-pointer rounded-full bg-foreground/15 overflow-hidden"
          onClick={onSeek}
        >
          <div
            className="absolute left-0 top-0 h-full bg-primary rounded-full transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums leading-none">
          <span>{formatTime(currentTime)}</span>
          <span>{isVoice && !duration ? "voice" : formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Custom compact VIDEO shell (poster + play overlay until first play) ──
function CompactVideo({ src, onError, onAudioOnly }: { src: string; onError: () => void; onAudioOnly: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const handleStart = () => {
    setStarted(true);
    requestAnimationFrame(() => {
      videoRef.current?.play().catch(() => onError());
    });
  };

  return (
    <div className="relative inline-block max-w-[280px] rounded-2xl overflow-hidden bg-black/90">
      <video
        ref={videoRef}
        src={src}
        controls={started}
        preload="metadata"
        playsInline
        className="block max-h-72 max-w-full w-auto h-auto"
        onLoadedMetadata={(e) => {
          // mp4 audio-only (Instagram voice-notes часто .mp4) — переключаем на audio renderer
          if (e.currentTarget.videoWidth === 0 && e.currentTarget.videoHeight === 0) {
            onAudioOnly();
          }
        }}
        onError={onError}
      />
      {!started && (
        <button
          type="button"
          onClick={handleStart}
          className="absolute inset-0 flex items-center justify-center bg-black/10 hover:bg-black/20 transition-colors group"
          aria-label="Воспроизвести видео"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg group-hover:scale-105 transition-transform">
            <Play className="h-5 w-5 ml-0.5" fill="currentColor" />
          </span>
        </button>
      )}
    </div>
  );
}

export function InstagramMessageMedia({
  url,
  type,
  className,
  messageId,
}: InstagramMessageMediaProps) {
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [forceAudio, setForceAudio] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string>(url);
  const [rehosting, setRehosting] = useState(false);

  const lowerUrl = (url || "").toLowerCase();
  const urlSaysVideo = /\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(lowerUrl);
  const urlSaysAudio = /\.(mp3|m4a|ogg|opus|wav|aac)(?:[?#]|$)/i.test(lowerUrl);

  const rawT = (type || "").toLowerCase();
  const t = urlSaysVideo ? "video" : urlSaysAudio ? "audio" : rawT;

  const isImage = t === "image" || t.startsWith("image/");
  const isVideo = t === "video" || t.startsWith("video/");
  const isVoice = t === "voice" || t === "audio/voice";
  const isAudio = t === "audio" || isVoice || t.startsWith("audio/");
  const isUnstable = UNSTABLE_HOST_RE.test(url);

  useEffect(() => {
    setResolvedUrl(url);
    setImgError(false);
    setVideoError(false);
    setAudioError(false);
    setForceAudio(false);
    if (isUnstable && (isAudio || isVideo)) {
      setRehosting(true);
      rehostMedia(messageId, url, isAudio ? "audio" : "video")
        .then((stable) => {
          if (stable) setResolvedUrl(stable);
        })
        .finally(() => setRehosting(false));
    }
  }, [url, isAudio, isVideo, isUnstable, messageId]);

  const tryLazyRehost = async (kind: "image" | "video" | "audio") => {
    if (resolvedUrl !== url) return;
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
            "group block max-w-[260px] rounded-2xl overflow-hidden",
            className,
          )}
          aria-label="Открыть изображение"
        >
          <img
            src={resolvedUrl}
            alt="Вложение"
            loading="lazy"
            className="block w-auto h-auto max-w-full max-h-72 object-cover group-hover:opacity-95 transition-opacity"
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
  if (isVideo && !videoError && !forceAudio) {
    if (rehosting && resolvedUrl === url) {
      return (
        <div className={cn("inline-flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-xs", className)}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Готовим видео…</span>
        </div>
      );
    }
    return (
      <div className={className}>
        <CompactVideo
          src={resolvedUrl}
          onAudioOnly={() => setForceAudio(true)}
          onError={() => {
            if (resolvedUrl === url && isUnstable) {
              void tryLazyRehost("video");
            } else {
              setVideoError(true);
            }
          }}
        />
      </div>
    );
  }

  // ─── AUDIO / VOICE ──────────────────────────────────────────────
  if (isAudio && !audioError) {
    if (rehosting && resolvedUrl === url) {
      return (
        <div className={cn("inline-flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-xs", className)}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Готовим аудио…</span>
        </div>
      );
    }
    return (
      <div className={className}>
        <CompactAudio
          src={resolvedUrl}
          isVoice={isVoice}
          onError={() => {
            if (resolvedUrl === url && isUnstable) {
              void tryLazyRehost("audio");
            } else {
              setAudioError(true);
            }
          }}
        />
      </div>
    );
  }

  // ─── FILE / UNKNOWN / FALLBACK ──────────────────────────────────
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
        "inline-flex items-center gap-2.5 rounded-2xl bg-muted/60 px-3 py-2 text-xs hover:bg-muted/80 transition-colors max-w-[280px] group",
        className,
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground group-hover:text-primary transition-colors">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="block truncate font-medium text-foreground">{fileName}</span>
        <span className="block text-[10px] text-muted-foreground">
          {playFailedHint ? "Открыть в новой вкладке" : "Файл"}
        </span>
      </div>
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

const MEDIA_URL_RE = /^https?:\/\/(lookaside\.fbsbx\.com|scontent[\w.-]*\.fbcdn\.net|cdninstagram\.com)|^https?:\/\/\S+\.(jpe?g|png|gif|webp|mp4|mov|webm|mp3|m4a|ogg|wav|pdf|docx?|xlsx?|pptx?|zip)(?:[?#]|$)/i;

export function isMediaUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  return MEDIA_URL_RE.test(s.trim());
}

export function guessMediaTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|heic)(?:[?#]|$)/i.test(lower)) return "image";
  if (/\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(lower)) return "video";
  if (/\.(mp3|m4a|ogg|opus|wav|aac)(?:[?#]|$)/i.test(lower)) return "audio";
  if (/lookaside\.fbsbx\.com.*ig_messaging_cdn/i.test(url)) return "image";
  return "file";
}
