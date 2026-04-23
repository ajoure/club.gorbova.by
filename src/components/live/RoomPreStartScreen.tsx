import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Play, Pause } from "lucide-react";
import type { RoomPrestartSettings } from "@/lib/roomSettings";

/**
 * Pre-start screen — экран до старта эфира.
 * Privacy-нейтрален: не использует profiles/full_name. Только метаданные эфира.
 *
 * Fallback-контракт:
 *  - нет cover  -> брендовый градиент;
 *  - нет title  -> «Скоро начало»;
 *  - нет scheduled_at -> countdown скрыт;
 *  - нет music  -> music pill скрыт.
 *
 * Audio policy (browser autoplay):
 *  - Не пытаемся autoplay: старт только по user-click.
 *  - Если play() отклонён браузером — остаёмся в paused, кнопка остаётся доступной.
 *  - На unmount гарантированный cleanup: pause + clear src.
 */
export function RoomPreStartScreen({
  prestart,
  scheduledAt,
  eventTimezone,
}: {
  prestart: RoomPrestartSettings;
  scheduledAt?: string;
  eventTimezone?: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [musicState, setMusicState] = useState<"idle" | "playing" | "paused">("idle");
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const title = prestart.title?.trim() || "Скоро начало";
  const hasCountdown = Boolean(prestart.timer_enabled && scheduledAt);
  const remainingMs = scheduledAt ? Math.max(0, new Date(scheduledAt).getTime() - now) : 0;

  // Countdown tick
  useEffect(() => {
    if (!hasCountdown) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasCountdown]);

  // Cleanup audio
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
      // autoplay blocked / browser policy — кнопка остаётся, ошибки в UI нет
      setMusicState("paused");
    }
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  };

  const startLine = useMemo(() => {
    if (!scheduledAt) return null;
    try {
      const d = new Date(scheduledAt);
      const tz = eventTimezone || undefined;
      const datePart = d.toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: tz,
      });
      return tz ? `Старт: ${datePart} (${tz})` : `Старт: ${datePart}`;
    } catch {
      return null;
    }
  }, [scheduledAt, eventTimezone]);

  const cd = splitRemaining(remainingMs);
  const showLiveSoon = hasCountdown && remainingMs <= 0;

  return (
    <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
      {/* Cover: показываем картинку ЦЕЛИКОМ (object-contain), а пустые поля
          по бокам/сверху-снизу заполняем размытым дублем той же картинки —
          без обрезки контента и без серых полос. */}
      {prestart.cover_url ? (
        <>
          <img
            src={prestart.cover_url}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70"
          />
          <img
            src={prestart.cover_url}
            alt={title}
            className="absolute inset-0 w-full h-full object-contain"
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-background to-primary/10" />
      )}

      {/* Двойная вуаль для читаемости текста */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-black/70" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full p-4 md:p-8 text-center gap-4 md:gap-6 text-white">
        <h2
          className="text-2xl md:text-5xl font-semibold tracking-tight max-w-3xl [text-shadow:_0_2px_24px_rgba(0,0,0,0.5)]"
        >
          {title}
        </h2>

        {startLine && (
          <p className="text-xs md:text-sm uppercase tracking-[0.2em] text-white/80 [text-shadow:_0_1px_8px_rgba(0,0,0,0.6)]">
            {startLine}
          </p>
        )}

        {hasCountdown && remainingMs > 0 && (
          <div className="flex gap-1.5 md:gap-3 mt-1">
            <CountdownCapsule value={cd.days} label="дн" />
            <CountdownCapsule value={cd.hours} label="ч" />
            <CountdownCapsule value={cd.minutes} label="мин" />
            <CountdownCapsule value={cd.seconds} label="сек" />
          </div>
        )}

        {showLiveSoon && (
          <div className="text-base md:text-lg text-white/85 mt-1">Эфир скоро начнётся…</div>
        )}
      </div>

      {/* Music pill */}
      {prestart.music_url && (
        <div className="absolute bottom-3 md:bottom-5 left-1/2 -translate-x-1/2 z-20">
          <div className="flex items-center gap-1 backdrop-blur-md bg-white/10 border border-white/15 rounded-full px-1.5 py-1 shadow-lg">
            <Button
              size="sm"
              variant="ghost"
              onClick={handlePlayPause}
              className="h-8 rounded-full px-3 text-white hover:bg-white/15 hover:text-white gap-1.5"
              aria-label={musicState === "playing" ? "Пауза" : "Включить музыку"}
            >
              {musicState === "playing" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span className="text-xs">{musicState === "playing" ? "Пауза" : "Музыка"}</span>
            </Button>
            {musicState === "playing" && (
              <Button
                size="icon"
                variant="ghost"
                onClick={handleToggleMute}
                className="h-8 w-8 rounded-full text-white hover:bg-white/15 hover:text-white"
                aria-label={muted ? "Включить звук" : "Выключить звук"}
              >
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
          <audio ref={audioRef} src={prestart.music_url} loop preload="none" />
        </div>
      )}

      {/* Gallery carousel — fade edges */}
      {prestart.gallery && prestart.gallery.length > 0 && (
        <div className="absolute top-2 left-2 right-2 z-10 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-thin pb-1">
            {prestart.gallery.map((g, i) => (
              <div key={i} className="shrink-0 snap-start rounded-md overflow-hidden border border-white/15 backdrop-blur-sm bg-black/20">
                <img src={g.url} alt={g.caption || ""} className="h-12 md:h-16 w-20 md:w-24 object-cover" />
                {g.caption && (
                  <div className="text-[10px] px-1.5 py-0.5 text-white/90 truncate max-w-[6rem]">{g.caption}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CountdownCapsule({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-w-[64px] md:min-w-[96px] px-2 md:px-4 py-2 md:py-3 rounded-2xl backdrop-blur-md bg-white/10 border border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
      <span className="text-3xl md:text-5xl font-semibold tabular-nums leading-none">
        {pad(value)}
      </span>
      <span className="mt-1 text-[9px] md:text-[10px] uppercase tracking-[0.18em] text-white/75">
        {label}
      </span>
    </div>
  );
}

function splitRemaining(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
  };
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
