/**
 * Autoweb Room Runtime — самостоятельная комната автовебинара.
 *
 * Ключевые инварианты:
 *  - Плеер: seek/pause/скорость определяются ЕДИНЫМ SoT — autoweb_config.viewer_controls,
 *    приходящим через autoweb-room-state в state.viewer_controls. Никакой отдельной
 *    "крепости" сверху нет: если админ включил Пауза=true, пауза работает.
 *  - Бейдж: "В эфире" для live/replay (никакого "Запись"). "Завершён" только для ended.
 *  - Timed-replay: если у автовеба задан source_live_event_id, вкладки Чат/Вопросы
 *    подтягивают исторические сообщения ИСХОДНОГО эфира и проигрывают их по
 *    таймингу видео (t0 = source.live_started_at ?? room_opened_at ?? starts_at).
 *    Новые сообщения текущих зрителей пишутся под id автовеба и подмешиваются в
 *    единую ленту.
 *  - Участники: показываем ТОЛЬКО текущих в autoweb-session (никакого архива online).
 *  - Сценарий/Блоки: подтягиваются из source (это редакторский контент прошедшего эфира).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  AlertTriangle,
  CalendarClock,
  Video,
  MessageCircle,
  HelpCircle,
  Users,
  FileText,
} from "lucide-react";
import { useAutowebRoomState } from "@/hooks/useAutowebRoomState";
import { LiveEventComments } from "@/components/live/LiveEventComments";
import { LiveEventQuestions } from "@/components/live/LiveEventQuestions";
import { AutowebTimelineOverlay } from "@/components/live/AutowebTimelineOverlay";
import { RoomParticipantsList } from "@/components/live/RoomParticipantsList";
import { LiveEventScenario } from "@/components/live/LiveEventScenario";
import { LiveEventRoomBlocks } from "@/components/live/LiveEventRoomBlocks";
import { formatDualTz } from "@/lib/autowebTzLabel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import type { AutowebViewerControls } from "@/types/autoweb";
import "@/components/live/liveRoomTheme.css";

interface Props {
  sessionId: string;
  title?: string;
  description?: string | null;
}

/**
 * Kinescope iframe плеер. Разрешения/запреты берутся из viewerControls (единый SoT).
 *  - allow_seek=false        → hotkeys=false + overlay-guard на нижнюю панель (timeline)
 *  - allow_pause=false       → controls=false + overlay-guard на центр (клик = pause/play)
 *  - allow_speed_control=false → speed=false + settings=false
 * subtitles/captions выключены всегда — это отдельное продуктовое требование
 * "эффект live" для автовебинаров, не связанное с viewer_controls.
 */
function AutowebKinescopePlayer({
  videoId,
  startSeconds,
  onTimeUpdate,
  viewerControls,
}: {
  videoId: string;
  startSeconds: number;
  onTimeUpdate: (seconds: number) => void;
  viewerControls: AutowebViewerControls;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const allowSeek = !!viewerControls.allow_seek;
  const allowPause = viewerControls.allow_pause !== false;
  const allowSpeed = !!viewerControls.allow_speed_control;

  const src = useMemo(() => {
    const u = new URL(`https://kinescope.io/embed/${videoId}`);
    if (startSeconds > 0) u.searchParams.set("t", String(Math.floor(startSeconds)));
    u.searchParams.set("autoplay", "1");
    // Controls (панель плеера) скрываем целиком только если И пауза, И перемотка запрещены.
    // Если разрешено что-то одно — оставляем controls, а лишнее прячем overlay-guard'ом.
    if (!allowPause && !allowSeek) {
      u.searchParams.set("controls", "false");
    }
    // Hotkeys управляют клавиатурными Space/←/→. Разрешаем только если хотя бы одно из них
    // фактически доступно; иначе — глушим, чтобы клавиатура не обходила UI-запрет.
    u.searchParams.set("hotkeys", allowPause || allowSeek ? "true" : "false");
    // Скорость и настройки — отдельным флагом.
    if (!allowSpeed) {
      u.searchParams.set("speed", "false");
      u.searchParams.set("settings", "false");
    }
    // Всегда — никаких субтитров/PiP на автовебе.
    u.searchParams.set("subtitles", "false");
    u.searchParams.set("captions", "false");
    u.searchParams.set("pip", "false");
    u.searchParams.set("preload", "true");
    return u.toString();
  }, [videoId, startSeconds, allowPause, allowSeek, allowSpeed]);

  // Слушаем timeupdate/postMessage от Kinescope плеера.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
        const data: any = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (!data) return;
        const t: number | undefined =
          data?.data?.currentTime ??
          data?.currentTime ??
          data?.time ??
          undefined;
        if (typeof t === "number" && isFinite(t)) {
          onTimeUpdate(t);
        }
      } catch {
        // ignore malformed messages
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onTimeUpdate]);

  // Fallback: если Kinescope не шлёт postMessage — оцениваем время по монотонному счётчику,
  // сбрасываемому только при смене видео. Не абсолютно точно, но достаточно для timed-replay.
  useEffect(() => {
    let mounted = true;
    const startedAt = Date.now();
    const base = Math.max(0, Math.floor(startSeconds));
    const id = window.setInterval(() => {
      if (!mounted) return;
      onTimeUpdate(base + (Date.now() - startedAt) / 1000);
    }, 1000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, [videoId, startSeconds, onTimeUpdate]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      <iframe
        ref={iframeRef}
        src={src}
        title="Autoweb video"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full border-0"
      />
      {/* Overlay-guard: перехватывает клики по нижней панели (timeline).
          Ставим ТОЛЬКО если перемотка запрещена — иначе не мешаем зрителю. */}
      {!allowSeek && (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[72px] z-10"
          style={{ pointerEvents: "auto", background: "transparent" }}
          onClick={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          onDoubleClick={(e) => e.preventDefault()}
        />
      )}
      {/* Overlay-guard центра — блокирует клик по видео (pause/play toggle).
          Ставим ТОЛЬКО если пауза запрещена. */}
      {!allowPause && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-10"
          style={{
            pointerEvents: "auto",
            background: "transparent",
            bottom: !allowSeek ? 72 : 0,
          }}
          onClick={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          onDoubleClick={(e) => e.preventDefault()}
        />
      )}
    </div>
  );
}

function PreShowCountdown({
  startsAt,
  viewerTz,
  eventTz,
}: {
  startsAt: string;
  viewerTz: string;
  eventTz: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, new Date(startsAt).getTime() - now);
  const hh = Math.floor(diff / 3_600_000);
  const mm = Math.floor((diff % 3_600_000) / 60_000);
  const ss = Math.floor((diff % 60_000) / 1000);
  const label = formatDualTz({ iso: startsAt, viewerTz, eventTz });
  return (
    <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
      <div className="text-center px-6 py-8">
        <CalendarClock className="h-10 w-10 text-primary mx-auto mb-3" />
        <h3 className="text-lg font-semibold mb-2">Эфир скоро начнётся</h3>
        <div className="text-3xl font-mono tabular-nums mb-2">
          {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </div>
        <div className="text-sm text-muted-foreground">
          Старт: <strong>{label.primary}</strong>
        </div>
        {label.secondary && (
          <div className="text-xs text-muted-foreground mt-1">
            в TZ эфира: {label.secondary} ({eventTz})
          </div>
        )}
      </div>
    </div>
  );
}

export function AutowebRoomRuntime({ sessionId, title, description }: Props) {
  const { state, isLoading, error } = useAutowebRoomState(sessionId);
  const { role } = useAuth();
  const isStaff = role === "admin" || role === "superadmin" || role === "employee";

  // Playback time для timed-replay ленты. Обновляется постом от Kinescope-плеера
  // и/или fallback-интервалом (см. AutowebKinescopePlayer).
  const [playbackSeconds, setPlaybackSeconds] = useState<number>(0);
  const handleTimeUpdate = useCallback((seconds: number) => {
    setPlaybackSeconds((prev) => (Math.abs(prev - seconds) >= 0.5 ? seconds : prev));
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !state || state.status !== "ok") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-6 max-w-md flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
          <div>
            <div className="font-medium">Не удалось загрузить комнату</div>
            <div className="text-sm text-muted-foreground">
              {state?.status === "not_found" ? "Сессия не найдена" : "Попробуйте обновить страницу."}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const isPreShow = state.phase === "pre_show";
  const isLive = state.phase === "live";
  const isReplay = state.phase === "replay";
  const isEnded = state.phase === "ended";
  const isPlaying = isLive || isReplay;

  // Единый режим для чат/вопросов: если у автовеба привязан source_live_event_id
  // и известен его starts_at — включаем timed-replay слой исторической ленты.
  const historyEnabled = !!state.source_live_event_id && !!state.source_started_at;
  const historyEventId = historyEnabled ? state.source_live_event_id! : undefined;
  const historyStartedAt = historyEnabled ? state.source_started_at! : undefined;

  // Для Сценария/Блоков — читаем из source, если он задан; иначе из самого автовеба.
  const scenarioEventId = state.source_live_event_id ?? state.live_event_id;

  return (
    <div className="live-room-themed min-h-screen flex flex-col">
      {/* Header */}
      <div className="max-w-[1600px] w-full mx-auto px-3 md:px-6 pt-3 md:pt-4 pb-2">
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <h1
              tabIndex={0}
              className="room-title w-full text-base md:text-2xl lg:text-[28px] font-semibold tracking-tight leading-[1.2] text-balance line-clamp-1 md:line-clamp-2 mb-1 md:mb-1.5 cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm"
              title={title ?? "Автовебинар"}
            >
              {title ?? "Автовебинар"}
            </h1>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            className="max-w-[min(92vw,640px)] text-sm leading-snug whitespace-normal break-words"
          >
            {title ?? "Автовебинар"}
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2 md:gap-3 mb-1 flex-wrap">
          <Badge variant={isPlaying ? "default" : "outline"}>
            {isPreShow && "До эфира"}
            {isPlaying && "В эфире"}
            {isEnded && "Завершён"}
          </Badge>
        </div>
        {description && (
          <p className="room-subtitle text-sm line-clamp-1 mb-1">{description}</p>
        )}
        {state.viewer_timezone !== state.event_timezone && (
          <div className="text-xs text-muted-foreground">
            TZ зрителя: {state.viewer_timezone} · TZ эфира: {state.event_timezone}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 max-w-[1600px] w-full mx-auto px-3 md:px-6 pb-3 md:pb-6 flex flex-col lg:flex-row lg:items-start gap-3 md:gap-4 min-h-0">
        {/* Player column */}
        <div className="lg:flex-[3] flex flex-col gap-2 min-w-0">
          {isPreShow ? (
            <PreShowCountdown
              startsAt={state.starts_at}
              viewerTz={state.viewer_timezone}
              eventTz={state.event_timezone}
            />
          ) : isPlaying && state.kinescope_video_id ? (
            <AutowebKinescopePlayer
              videoId={state.kinescope_video_id}
              startSeconds={state.resume.enabled ? state.resume.last_video_position_seconds : 0}
              onTimeUpdate={handleTimeUpdate}
              viewerControls={state.viewer_controls}
            />
          ) : (
            <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
              <div className="text-center p-4">
                <Video className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {isEnded ? "Эфир завершён" : "Источник видео недоступен"}
                </p>
              </div>
            </div>
          )}

          {state.timeline_enabled && isPlaying && (
            <AutowebTimelineOverlay sessionId={state.session_id} enabled={true} />
          )}

          {/* Блоки редакторского контента прошедшего эфира (под видео). */}
          <LiveEventRoomBlocks
            liveEventId={scenarioEventId}
            displayContext={isReplay ? "replay" : "live"}
            position="under_video"
          />
        </div>


        {/* Sidebar: chat / questions / participants / scenario / (moderation-staff) */}
        <div className="lg:flex-[1] min-w-0 lg:min-w-[320px] flex flex-col">
          <Tabs defaultValue="chat" className="flex-1 flex flex-col">
            <TabsList className={`grid ${isStaff ? "grid-cols-5" : "grid-cols-4"} w-full`}>
              <TabsTrigger value="chat" disabled={!state.chat_enabled}>
                <MessageCircle className="h-4 w-4 mr-1" /> Чат
              </TabsTrigger>
              <TabsTrigger value="questions" disabled={!state.questions_enabled}>
                <HelpCircle className="h-4 w-4 mr-1" /> Вопросы
              </TabsTrigger>
              <TabsTrigger value="participants">
                <Users className="h-4 w-4 mr-1" /> Участники
              </TabsTrigger>
              <TabsTrigger value="scenario">
                <FileText className="h-4 w-4 mr-1" /> Сценарий
              </TabsTrigger>
              {isStaff && (
                <TabsTrigger value="moderation">Модер.</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="chat" className="flex-1 mt-2">
              {state.chat_enabled ? (
                <LiveEventComments
                  liveEventId={state.live_event_id}
                  autowebSessionId={state.session_id}
                  historySourceEventId={historyEventId}
                  historySourceStartedAt={historyStartedAt}
                  currentPlaybackSeconds={playbackSeconds}
                  staffSourceIndicator={isStaff}
                />
              ) : (
                <div className="text-sm text-muted-foreground p-3">Чат отключён.</div>
              )}
            </TabsContent>

            <TabsContent value="questions" className="flex-1 mt-2">
              {state.questions_enabled ? (
                <LiveEventQuestions
                  liveEventId={state.live_event_id}
                  autowebSessionId={state.session_id}
                  historySourceEventId={historyEventId}
                  historySourceStartedAt={historyStartedAt}
                  currentPlaybackSeconds={playbackSeconds}
                  staffSourceIndicator={isStaff}
                />
              ) : (
                <div className="text-sm text-muted-foreground p-3">Вопросы отключены.</div>
              )}
            </TabsContent>

            {/* Участники — ТОЛЬКО текущие в этой автосессии.
                Исторические слушатели не показываются как "сейчас онлайн". */}
            <TabsContent value="participants" className="flex-1 mt-2">
              <RoomParticipantsList
                liveEventId={state.live_event_id}
                isStaff={isStaff}
                visibleForStudents={true}
              />
            </TabsContent>


            <TabsContent value="scenario" className="flex-1 mt-2">
              <LiveEventScenario liveEventId={scenarioEventId} />
            </TabsContent>

            {isStaff && (
              <TabsContent value="moderation" className="flex-1 mt-2">
                <div className="text-xs text-muted-foreground p-3">
                  Модерация встроена в каждое сообщение (иконки при наведении).
                  Полная админ-модерация — в редакторе эфира.
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
