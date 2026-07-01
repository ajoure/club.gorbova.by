// ============================================================================
// CallRecordingPlayer
// ----------------------------------------------------------------------------
// Кастомный аудиоплеер для записей звонков VOCHI.
// - Кликабельный seek-bar
// - Duration из <audio metadata> с fallback на duration_seconds
// - Кастомный dropdown скорости (glassmorphism)
// - Кнопка скачивания вместо «открыть в новом окне»
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Download, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface Props {
  src: string;
  /** Fallback длительность в секундах (например из VOCHI API). */
  fallbackDurationSec?: number | null;
  className?: string;
  fileName?: string;
}

export function CallRecordingPlayer({ src, fallbackDurationSec, className, fileName }: Props) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState<number>(
    fallbackDurationSec && fallbackDurationSec > 0 ? fallbackDurationSec : 0,
  );
  const [rate, setRate] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMeta = () => {
      if (isFinite(el.duration) && el.duration > 0) setDur(el.duration);
    };
    const onTime = () => setCur(el.currentTime);
    const onEnd = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWait = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWait);
    el.addEventListener("canplay", onCanPlay);
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWait);
      el.removeEventListener("canplay", onCanPlay);
    };
  }, [src]);

  const toggle = async () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
      } catch {
        /* autoplay блокировки — просто игнор */
      }
    } else {
      el.pause();
    }
  };

  const seekTo = (clientX: number) => {
    const el = ref.current;
    const bar = barRef.current;
    if (!el || !bar || !dur) return;
    const r = bar.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    el.currentTime = pct * dur;
    setCur(el.currentTime);
  };

  const changeSpeed = (v: number) => {
    setRate(v);
    if (ref.current) ref.current.playbackRate = v;
  };

  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border/60",
        "bg-background/60 backdrop-blur px-2 py-1 shadow-sm",
        className,
      )}
    >
      <audio ref={ref} src={src} preload="metadata" />

      <button
        type="button"
        onClick={toggle}
        className={cn(
          "h-7 w-7 rounded-full grid place-items-center shrink-0",
          "bg-primary text-primary-foreground hover:opacity-90 transition",
        )}
        title={playing ? "Пауза" : "Воспроизвести"}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-[1px]" />}
      </button>

      <div className="flex items-center gap-2 min-w-[180px]">
        <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">
          {fmt(cur)}
        </span>
        <div
          ref={barRef}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={dur || 0}
          aria-valuenow={cur}
          onClick={(e) => seekTo(e.clientX)}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            seekTo(e.clientX);
            const move = (ev: PointerEvent) => seekTo(ev.clientX);
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          className="relative h-1.5 flex-1 rounded-full bg-muted cursor-pointer group"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary shadow ring-2 ring-background opacity-0 group-hover:opacity-100 transition"
            style={{ left: `calc(${pct}% - 6px)` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground w-8">{fmt(dur)}</span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "h-6 px-2 rounded-full text-[11px] font-medium tabular-nums",
              "border border-border/60 bg-background/70 hover:bg-accent transition",
              "inline-flex items-center gap-1",
            )}
            title="Скорость воспроизведения"
          >
            <Gauge className="h-3 w-3 opacity-70" />
            {rate}×
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[110px] bg-background/80 backdrop-blur-xl border-border/60"
        >
          {SPEEDS.map((s) => (
            <DropdownMenuItem
              key={s}
              onSelect={() => changeSpeed(s)}
              className={cn(
                "text-xs justify-between",
                s === rate && "font-semibold text-primary",
              )}
            >
              {s}×{s === rate && <span aria-hidden>✓</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            const resp = await fetch(src);
            if (!resp.ok) throw new Error(`http_${resp.status}`);
            const blob = await resp.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = typeof fileName === "string" && fileName ? fileName : "recording";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
          } catch (err) {
            // Fallback: открыть в новой вкладке, если fetch заблокирован
            window.open(src, "_blank", "noopener,noreferrer");
          }
        }}
        className="h-6 w-6 grid place-items-center rounded-full border border-border/60 bg-background/70 hover:bg-accent transition"
        title="Скачать запись"
      >
        <Download className="h-3 w-3" />
      </button>

      {loading && <span className="sr-only">loading…</span>}
    </div>
  );
}

export default CallRecordingPlayer;
