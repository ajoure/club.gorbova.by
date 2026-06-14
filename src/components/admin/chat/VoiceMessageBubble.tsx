import { useEffect, useRef, useState } from "react";
import { Play, Pause, Mic, MoreHorizontal, X, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type VoiceDirection = "incoming" | "outgoing";

interface VoiceMessageBubbleProps {
  direction: VoiceDirection;
  src: string;
  durationHint?: number | null;
  fileSize?: number | null;
  fileName?: string | null;
  sentAt?: Date | null;
  status?: "sending" | "sent" | "delivered" | "failed" | null;
  onDownload?: () => void;
  onDelete?: () => void;
  onReply?: () => void;
  compact?: boolean;
}

const formatTime = (sec: number) => {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const formatSize = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

const formatStatus = (s?: VoiceMessageBubbleProps["status"]) => {
  switch (s) {
    case "sending": return "Отправляется…";
    case "sent": return "Отправлено";
    case "delivered": return "Доставлено";
    case "failed": return "Ошибка";
    default: return null;
  }
};

export function VoiceMessageBubble({
  direction,
  src,
  durationHint,
  fileSize,
  fileName,
  sentAt,
  status,
  onDownload,
  onDelete,
  onReply,
  compact = false,
}: VoiceMessageBubbleProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [metaDuration, setMetaDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Duration priority: durationHint > metaDuration (loadedmetadata) > "—"
  const safeHint = durationHint && durationHint > 0 ? durationHint : 0;
  const effectiveDuration = safeHint || (isFinite(metaDuration) && metaDuration > 0 ? metaDuration : 0);
  const durationLabel = effectiveDuration > 0 ? formatTime(effectiveDuration) : "—";

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => {
      const d = audio.duration;
      if (isFinite(d) && d > 0) setMetaDuration(d);
    };
    const onTime = () => { if (!isDragging) setCurrentTime(audio.currentTime); };
    const onEnd = () => { setPlaying(false); setCurrentTime(0); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [isDragging]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  const seekFromEvent = (clientX: number) => {
    const bar = progressRef.current;
    const audio = audioRef.current;
    if (!bar || !audio || !effectiveDuration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = ratio * effectiveDuration;
    audio.currentTime = t;
    setCurrentTime(t);
  };

  const sizeLabel = formatSize(fileSize);
  const statusLabel = formatStatus(status);
  const timeLabel = sentAt
    ? sentAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const progress = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0;
  const hasMenu = !compact && (onDownload || onReply);

  return (
    <div
      className={cn(
        "flex flex-col w-fit",
        "max-w-[calc(100vw-96px)] md:max-w-[380px]",
        direction === "outgoing" ? "items-end" : "items-start"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl px-2.5 py-1.5",
          "backdrop-blur-xl border shadow-sm overflow-hidden",
          direction === "outgoing"
            ? "bg-primary/10 border-primary/20"
            : "bg-card/40 dark:bg-card/20 border-border/40"
        )}
        style={{ minWidth: 220 }}
      >
        <audio ref={audioRef} src={src} preload="metadata" />

        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Пауза" : "Воспроизвести"}
          className={cn(
            "shrink-0 w-9 h-9 rounded-full flex items-center justify-center",
            "bg-foreground/10 hover:bg-foreground/15 text-foreground transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          )}
        >
          {playing ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <div
            ref={progressRef}
            className="relative h-1.5 rounded-full bg-foreground/15 cursor-pointer touch-none"
            onPointerDown={(e) => {
              setIsDragging(true);
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              seekFromEvent(e.clientX);
            }}
            onPointerMove={(e) => { if (isDragging) seekFromEvent(e.clientX); }}
            onPointerUp={(e) => {
              if (!isDragging) return;
              setIsDragging(false);
              try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
            }}
            onPointerCancel={() => setIsDragging(false)}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary shadow-sm"
              style={{ left: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
            <span className="flex items-center gap-1">
              <Mic className="w-3 h-3" />
              {formatTime(currentTime)} / {durationLabel}
            </span>
            {sizeLabel && <span className="opacity-70">{sizeLabel}</span>}
          </div>
        </div>

        {compact && onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onDelete}
            aria-label="Удалить запись"
            title="Удалить запись"
          >
            <X className="w-4 h-4" />
          </Button>
        )}

        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label="Действия"
                title={fileName || "Действия"}
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={direction === "outgoing" ? "end" : "start"}>
              {onDownload && (
                <DropdownMenuItem onClick={onDownload}>
                  <Download className="w-4 h-4 mr-2" />
                  Скачать
                </DropdownMenuItem>
              )}
              {onReply && (
                <DropdownMenuItem onClick={onReply}>
                  Ответить
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!compact && (timeLabel || statusLabel) && (
        <div className="mt-0.5 px-1 text-[10px] text-muted-foreground tabular-nums flex gap-2">
          {timeLabel && <span>{timeLabel}</span>}
          {statusLabel && <span className={cn(status === "failed" && "text-destructive")}>{statusLabel}</span>}
        </div>
      )}
    </div>
  );
}
