/**
 * Sprint B: AutowebRoomRuntime — самостоятельная комната автовебинара.
 *
 * Add-only: не трогает существующий live/recorded flow в LiveEvent.tsx.
 * Включается через одну early-return ветку, когда:
 *   event_type === 'autowebinar' && URL содержит ?session=<uuid>.
 *
 * Внутри:
 *   - polling autoweb-room-state (pure resolver, ZERO writes)
 *   - phase: pre_show / live / replay / ended → разные UI
 *   - Kinescope-плеер с currentTime = resume.last_video_position_seconds
 *   - LiveEventComments / LiveEventQuestions с autowebSessionId (обязателен)
 *   - AutowebTimelineOverlay (scripted layer, изолирован)
 *   - TZ labels viewer + event (если отличаются)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertTriangle, CalendarClock, Video, MessageCircle, HelpCircle } from "lucide-react";
import { useAutowebRoomState } from "@/hooks/useAutowebRoomState";
import { LiveEventComments } from "@/components/live/LiveEventComments";
import { LiveEventQuestions } from "@/components/live/LiveEventQuestions";
import { AutowebTimelineOverlay } from "@/components/live/AutowebTimelineOverlay";
import { formatDualTz } from "@/lib/autowebTzLabel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import "@/components/live/liveRoomTheme.css";

interface Props {
  sessionId: string;
  /** Нужен только для UI заголовка комнаты — берётся из live-resolve. */
  title?: string;
  description?: string | null;
}

/**
 * Компактный Kinescope iframe-плеер с поддержкой стартовой позиции (resume).
 * Использует параметр t= в URL — это самый предсказуемый способ
 * без зависимости от состояния плеер-объекта между навигациями.
 */
function AutowebKinescopePlayer({
  videoId,
  startSeconds,
}: {
  videoId: string;
  startSeconds: number;
}) {
  const src = useMemo(() => {
    const u = new URL(`https://kinescope.io/embed/${videoId}`);
    if (startSeconds > 0) u.searchParams.set("t", String(Math.floor(startSeconds)));
    u.searchParams.set("autoplay", "1");
    return u.toString();
  }, [videoId, startSeconds]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      <iframe
        src={src}
        title="Autoweb video"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full border-0"
      />
    </div>
  );
}

function PreShowCountdown({ startsAt, viewerTz, eventTz }: { startsAt: string; viewerTz: string; eventTz: string }) {
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
          <TooltipContent side="bottom" align="start" className="max-w-[min(92vw,640px)] text-sm leading-snug whitespace-normal break-words">
            {title ?? "Автовебинар"}
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2 md:gap-3 mb-1 flex-wrap">
          <Badge variant={isLive ? "default" : "outline"}>
            {isPreShow && "До эфира"}
            {isLive && "В эфире"}
            {isReplay && "Запись"}
            {isEnded && "Завершён"}
          </Badge>
          <Badge variant="outline" className="text-xs">Видео</Badge>
        </div>
        {description && <p className="room-subtitle text-sm line-clamp-1 mb-1">{description}</p>}
        {/* TZ-лейбл (если viewer_tz != event_tz) */}
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
          ) : (isLive || isReplay) && state.kinescope_video_id ? (
            <AutowebKinescopePlayer
              videoId={state.kinescope_video_id}
              startSeconds={state.resume.enabled ? state.resume.last_video_position_seconds : 0}
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

          {/* Scripted timeline overlay — отдельный визуальный слой, изолирован от SoT */}
          {state.timeline_enabled && (isLive || isReplay) && (
            <AutowebTimelineOverlay sessionId={state.session_id} enabled={true} />
          )}
        </div>

        {/* Sidebar: chat + questions */}
        <div className="lg:flex-[1] min-w-0 lg:min-w-[320px] flex flex-col">
          <Tabs defaultValue="chat" className="flex-1 flex flex-col">
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="chat" disabled={!state.chat_enabled}>
                <MessageCircle className="h-4 w-4 mr-1" /> Чат
              </TabsTrigger>
              <TabsTrigger value="questions" disabled={!state.questions_enabled}>
                <HelpCircle className="h-4 w-4 mr-1" /> Вопросы
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chat" className="flex-1 mt-2">
              {state.chat_enabled ? (
                <LiveEventComments
                  liveEventId={state.live_event_id}
                  autowebSessionId={state.session_id}
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
                />
              ) : (
                <div className="text-sm text-muted-foreground p-3">Вопросы отключены.</div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
