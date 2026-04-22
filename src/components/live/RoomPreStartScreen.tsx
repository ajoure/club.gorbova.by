import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Volume2, VolumeX, Play, Pause, Image as ImageIcon } from "lucide-react";
import type { RoomPrestartSettings } from "@/lib/roomSettings";

/**
 * Pre-start screen — экран до старта эфира.
 * Privacy-нейтрален: не использует profiles/full_name. Только метаданные эфира.
 *
 * Audio policy:
 *  - <audio> создаётся muted=false по умолчанию НЕТ — старт только по user-click.
 *  - При unmount гарантированный cleanup: pause + src=''.
 */
export function RoomPreStartScreen({
  prestart,
  scheduledAt,
}: {
  prestart: RoomPrestartSettings;
  scheduledAt?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [musicState, setMusicState] = useState<"idle" | "playing" | "paused">("idle");
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Countdown tick
  useEffect(() => {
    if (!prestart.timer_enabled || !scheduledAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [prestart.timer_enabled, scheduledAt]);

  // Cleanup audio гарантированно — proof: pause + clear src
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) {
        try { a.pause(); } catch {}
        a.src = "";
        try { a.load(); } catch {}
      }
    };
  }, []);

  const handlePlayPause = async () => {
    const a = audioRef.current;
    if (!a || !prestart.music_url) return;
    if (musicState === "playing") {
      a.pause();
      setMusicState("paused");
      return;
    }
    try {
      await a.play();
      setMusicState("playing");
    } catch {
      // autoplay blocked — UI уже показывает кнопку, экран остаётся рабочим
      setMusicState("paused");
    }
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  };

  const remainingMs = scheduledAt ? Math.max(0, new Date(scheduledAt).getTime() - now) : 0;
  const remaining = formatRemaining(remainingMs);
  const showCountdown = prestart.timer_enabled && scheduledAt && remainingMs > 0;

  return (
    <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden">
      {/* Cover */}
      {prestart.cover_url ? (
        <img
          src={prestart.cover_url}
          alt={prestart.title || ""}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-muted" />
      )}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full text-white p-6 text-center gap-4">
        {prestart.title && (
          <h2 className="text-2xl md:text-4xl font-bold drop-shadow-lg">{prestart.title}</h2>
        )}
        {showCountdown && (
          <div className="text-3xl md:text-5xl font-mono font-bold tracking-wider tabular-nums drop-shadow-lg">
            {remaining}
          </div>
        )}
        {!showCountdown && scheduledAt && remainingMs <= 0 && (
          <div className="text-base md:text-lg opacity-80">Эфир скоро начнётся…</div>
        )}

        {prestart.music_url && (
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handlePlayPause}
              className="gap-1.5"
              aria-label={musicState === "playing" ? "Пауза" : "Включить музыку"}
            >
              {musicState === "playing" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {musicState === "playing" ? "Пауза" : "Включить музыку"}
            </Button>
            {musicState !== "idle" && (
              <Button size="icon" variant="secondary" onClick={handleToggleMute} aria-label={muted ? "Включить звук" : "Выключить звук"}>
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        )}

        {/* Hidden audio element. autoplay не используется — пользователь жмёт Play. */}
        {prestart.music_url && (
          <audio
            ref={audioRef}
            src={prestart.music_url}
            loop
            preload="none"
          />
        )}
      </div>

      {/* Gallery strip */}
      {prestart.gallery && prestart.gallery.length > 0 && (
        <div className="absolute bottom-2 left-2 right-2 flex gap-2 overflow-x-auto scrollbar-thin">
          {prestart.gallery.map((g, i) => (
            <Card key={i} className="shrink-0 overflow-hidden bg-background/90">
              <img src={g.url} alt={g.caption || ""} className="h-16 w-24 object-cover" />
              {g.caption && (
                <div className="text-[10px] px-1.5 py-0.5 truncate max-w-[6rem]">{g.caption}</div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* No-cover hint */}
      {!prestart.cover_url && !prestart.title && (
        <div className="absolute top-2 right-2 text-white/60 text-[10px] flex items-center gap-1">
          <ImageIcon className="h-3 w-3" /> pre-start
        </div>
      )}
    </div>
  );
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) {
    return `${days}д ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
function pad(n: number) { return n.toString().padStart(2, "0"); }
