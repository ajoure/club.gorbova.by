import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useKinescopePlayer } from "@/hooks/useKinescopePlayer";
import { Loader2, Lock, CalendarClock, AlertTriangle, Video, MonitorX, TimerOff, MessageCircle, HelpCircle, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { LiveEventComments } from "@/components/live/LiveEventComments";
import { LiveEventQuestions } from "@/components/live/LiveEventQuestions";
import { LiveEventRoomBlocks } from "@/components/live/LiveEventRoomBlocks";
import { LiveEventProductCta, useHasActiveCtaBindings } from "@/components/live/LiveEventProductCta";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { useLiveContactSheet } from "@/hooks/useLiveContactSheet";

interface ResolvedSource {
  resolved_source_kind: 'kinescope_video' | 'kinescope_live_embed' | 'live_pending' | 'none';
  resolved_embed_url: string | null;
  resolved_play_url: string | null;
  provider_source_status: string | null;
  source_reason: string | null;
  last_synced_at: string | null;
}

interface LiveResolveResult {
  status: "ok" | "not_found" | "unpublished" | "auth_required" | "access_denied" | "invite_required" | "session_missing" | "source_unavailable" | "removed_from_room" | "error";
  title?: string;
  description?: string;
  kinescope_video_id?: string;
  event_status?: string;
  scheduled_at?: string;
  replay_enabled?: boolean;
  message?: string;
  event_type?: string;
  source_kind?: string;
  event_timezone?: string;
  platform_status?: string;
  kinescope_live_event_id?: string;
  event_id?: string;
  resolved_source?: ResolvedSource;
}

type PageState = "loading" | "not_found" | "unpublished" | "access_denied" | "invite_required" | "source_unavailable" | "removed_from_room" | "scheduled" | "live" | "live_pending" | "ended_no_replay" | "session_revoked" | "session_expired" | "error";

const HEARTBEAT_INTERVAL_MS = 45_000;
const RESOLVE_POLL_INTERVAL_MS = 12_000;

export default function LiveEvent() {
  const { slug } = useParams<{ slug: string }>();
  const { session, role } = useAuth();
  const [state, setState] = useState<PageState>("loading");
  const [data, setData] = useState<LiveResolveResult | null>(null);
  const { selectedContact, contactSheetOpen, setContactSheetOpen, openContactSheet } = useLiveContactSheet();
  const isStaff = role === "admin" || role === "superadmin" || role === "employee";
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs to read latest session/data without triggering effect restarts on TOKEN_REFRESHED.
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const dataRef = useRef<LiveResolveResult | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  // accessToken as primitive — only used for cold-start gate, not as effect-restart trigger.
  const hasAccessToken = !!session?.access_token;

  // Hooks must be called unconditionally — keep before any early returns
  const eventIdForCta = data?.event_id || "";
  const hasUnderVideoCta = useHasActiveCtaBindings(eventIdForCta, "under_video");
  const hasSidebarCta = useHasActiveCtaBindings(eventIdForCta, "sidebar");

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    if (!slug) return;
    stopHeartbeat();

    const sessionKey = sessionStorage.getItem(`live_session_${slug}`);
    if (!sessionKey) return;

    const ping = async () => {
      try {
        const token = sessionRef.current?.access_token;
        if (!token) return;
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/live-session-heartbeat`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ session_key: sessionKey }),
          }
        );
        const json = await response.json();

        if (json.status === "session_revoked") {
          stopHeartbeat();
          setState("session_revoked");
        } else if (json.status === "session_expired") {
          stopHeartbeat();
          setState("session_expired");
        }
      } catch (err) {
        console.error("[LiveEvent] heartbeat error:", err);
      }
    };

    ping();
    heartbeatRef.current = setInterval(ping, HEARTBEAT_INTERVAL_MS);
  }, [slug, stopHeartbeat]);

  useEffect(() => {
    return () => stopHeartbeat();
  }, [stopHeartbeat]);

  useEffect(() => {
    if (!slug || !hasAccessToken) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const abortController = new AbortController();

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const resolve = async (isPoll = false) => {
      // Silent refresh guard: never flip back to "loading" if we already have valid data.
      // Only the very first cold-start (no data yet) shows the Loader.
      const hasValidData = !!dataRef.current;
      if (!isPoll && !hasValidData) {
        setState("loading");
      }
      try {
        const token = sessionRef.current?.access_token;
        if (!token) return;
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/live-resolve?slug=${encodeURIComponent(slug)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            signal: abortController.signal,
          }
        );

        if (cancelled) return;
        const json: LiveResolveResult = await response.json();
        if (cancelled) return;
        setData(json);

        // PROOF DEBUG — runtime branch trace
        console.debug('[live-resolve]', {
          status: json.status,
          platform_status: json.platform_status,
          event_status: json.event_status,
          has_live_id: !!json.kinescope_live_event_id,
          has_video_id: !!json.kinescope_video_id,
          source_kind: json.resolved_source?.resolved_source_kind,
          source_reason: json.resolved_source?.source_reason,
          source_url: json.resolved_source?.resolved_embed_url,
          is_poll: isPoll,
        });

        let nextState: PageState = "error";
        switch (json.status) {
          case "not_found":
            nextState = "not_found"; break;
          case "unpublished":
            nextState = "unpublished"; break;
          case "access_denied":
            nextState = "access_denied"; break;
          case "invite_required":
            nextState = "invite_required"; break;
          case "session_missing":
            nextState = "session_expired"; break;
          case "source_unavailable":
            nextState = "source_unavailable"; break;
          case "removed_from_room":
            nextState = "removed_from_room"; break;
          case "ok": {
            const ps = json.platform_status;
            const es = json.event_status;
            const sourceKind = json.resolved_source?.resolved_source_kind;

            if (ps === "scheduled" || es === "scheduled") {
              nextState = "scheduled";
            } else if (sourceKind === "live_pending") {
              nextState = "live_pending";
            } else if (ps === "replay_available" || (es === "ended" && json.replay_enabled)) {
              nextState = "live";
            } else if (es === "ended" && !json.replay_enabled) {
              nextState = "ended_no_replay";
            } else {
              nextState = "live";
              startHeartbeat();
            }
            break;
          }
          default:
            nextState = "error";
        }
        setState(nextState);

        const shouldPoll = nextState === "scheduled"
          || nextState === "live_pending"
          || nextState === "live";
        if (shouldPoll && !pollTimer) {
          pollTimer = setInterval(() => resolve(true), RESOLVE_POLL_INTERVAL_MS);
        } else if (!shouldPoll) {
          stopPolling();
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || cancelled) return;
        console.error("[LiveEvent] resolve error:", err);
        // Don't downgrade state to "error" if we already have valid data — keep room mounted.
        if (!dataRef.current) setState("error");
        stopPolling();
      }
    };

    resolve(false);

    return () => {
      cancelled = true;
      stopPolling();
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, hasAccessToken]);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (state === "session_revoked") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <MonitorX className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold text-foreground">Сессия завершена</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Просмотр продолжен с другого устройства. Одновременный просмотр невозможен.
        </p>
        <Button onClick={() => window.location.reload()}>Обновить</Button>
      </div>
    );
  }

  if (state === "session_expired") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <TimerOff className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Сессия просмотра истекла</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Сессия просмотра истекла. Обновите страницу для продолжения.
        </p>
        <Button onClick={() => window.location.reload()}>Обновить</Button>
      </div>
    );
  }

  if (state === "not_found") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <AlertTriangle className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Страница не найдена</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Эфир по этому адресу не найден. Проверьте ссылку или обратитесь в поддержку.
        </p>
      </div>
    );
  }

  if (state === "unpublished") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <AlertTriangle className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Эфир недоступен</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Этот эфир ещё не опубликован. Пожалуйста, дождитесь анонса.
        </p>
      </div>
    );
  }

  if (state === "source_unavailable") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <AlertTriangle className="h-16 w-16 text-amber-500" />
        <h1 className="text-2xl font-bold text-foreground">Источник трансляции временно недоступен</h1>
        {data?.title && (
          <h2 className="text-lg text-muted-foreground">{data.title}</h2>
        )}
        <p className="text-muted-foreground text-center max-w-md">
          Трансляция временно недоступна по техническим причинам. Пожалуйста, попробуйте позже.
        </p>
        <Button onClick={() => window.location.reload()}>Обновить</Button>
      </div>
    );
  }

  if (state === "removed_from_room") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <ShieldX className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold text-foreground">Доступ к комнате закрыт</h1>
        {data?.title && (
          <h2 className="text-lg text-muted-foreground">{data.title}</h2>
        )}
        <p className="text-muted-foreground text-center max-w-md">
          Вы были удалены из комнаты этого эфира модератором. Если вы считаете это ошибкой, обратитесь в поддержку.
        </p>
      </div>
    );
  }

  if (state === "access_denied") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <Lock className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Доступ ограничен</h1>
        {data?.title && (
          <h2 className="text-lg text-muted-foreground">{data.title}</h2>
        )}
        <p className="text-muted-foreground text-center max-w-md">
          У вас нет доступа к этому эфиру. Убедитесь, что у вас есть активная подписка на соответствующий продукт.
        </p>
        <Button variant="outline" onClick={() => window.location.href = "/products"}>
          Перейти к продуктам
        </Button>
      </div>
    );
  }

  if (state === "invite_required") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <Lock className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Требуется приглашение</h1>
        {data?.title && (
          <h2 className="text-lg text-muted-foreground">{data.title}</h2>
        )}
        <p className="text-muted-foreground text-center max-w-md">
          Доступ к этому эфиру возможен только по персональной пригласительной ссылке. Проверьте сообщения в Telegram или электронной почте.
        </p>
      </div>
    );
  }

  if (state === "scheduled") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <CalendarClock className="h-16 w-16 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">{data?.title || "Эфир"}</h1>
        {data?.event_type && (
          <Badge variant="outline">{data.event_type === "live_stream" ? "Живой эфир" : "Видео"}</Badge>
        )}
        {data?.description && (
          <p className="text-muted-foreground text-center max-w-md">{data.description}</p>
        )}
        {data?.scheduled_at && (
          <div className="bg-primary/10 rounded-lg px-6 py-3 text-primary font-medium">
            Начало: {format(new Date(data.scheduled_at), "dd MMMM yyyy, HH:mm", { locale: ru })}
            {data.event_timezone && (
              <span className="text-xs ml-2 opacity-70">({data.event_timezone})</span>
            )}
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Эфир ещё не начался. Возвращайтесь в назначенное время.
        </p>
      </div>
    );
  }

  if (state === "live_pending") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <h1 className="text-2xl font-bold text-foreground">{data?.title || "Эфир запускается"}</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Эфир уже начался, подключаемся к источнику видео. Это может занять несколько секунд.
        </p>
        <p className="text-xs text-muted-foreground/70">Страница обновится автоматически.</p>
      </div>
    );
  }

  if (state === "ended_no_replay") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <Video className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">{data?.title || "Эфир завершён"}</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Эфир завершён. Запись пока недоступна.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <AlertTriangle className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold text-foreground">Ошибка</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Произошла ошибка при загрузке страницы. Попробуйте обновить страницу.
        </p>
        <Button onClick={() => window.location.reload()}>Обновить</Button>
      </div>
    );
  }

  // state === "live" — show player + comments/questions
  const eventId = data?.event_id;
  const isReplay = data?.platform_status === "replay_available" || 
    (data?.event_status === "ended" && data?.replay_enabled);
  const resolvedSource = data?.resolved_source;

  // CTA bindings hooks moved to top of component (Rules of Hooks)

  // Room theme from metadata
  const roomTheme = (data as any)?.room_theme || (data as any)?.metadata?.room_theme;
  const themeStyle: React.CSSProperties = roomTheme ? {
    ['--room-bg' as string]: roomTheme.background_color || undefined,
    ['--room-text' as string]: roomTheme.primary_text_color || undefined,
    ['--room-text-secondary' as string]: roomTheme.secondary_text_color || undefined,
    ['--room-panel' as string]: roomTheme.panel_color || undefined,
    ['--room-accent' as string]: roomTheme.accent_color || undefined,
    ['--room-tabs' as string]: roomTheme.tabs_color || undefined,
    ['--room-admin-badge' as string]: roomTheme.admin_badge_color || undefined,
    ['--room-employee-badge' as string]: roomTheme.employee_badge_color || undefined,
    backgroundColor: roomTheme.background_color || undefined,
    color: roomTheme.primary_text_color || undefined,
  } : {};

  return (
    <div className="min-h-screen bg-background flex flex-col" style={themeStyle}>
      {/* Header — compact */}
      <div className="max-w-[1400px] w-full mx-auto px-3 md:px-6 pt-3 md:pt-4 pb-2">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-lg md:text-2xl font-bold text-foreground truncate">{data?.title}</h1>
          {data?.event_type && (
            <Badge variant="outline" className="text-xs shrink-0">
              {data.event_type === "live_stream" ? "Живой эфир" : "Видео"}
            </Badge>
          )}
        </div>
        {data?.description && (
          <p className="text-sm text-muted-foreground line-clamp-1 mb-1">{data.description}</p>
        )}
        {isReplay && (
          <div className="inline-flex items-center gap-2 bg-muted rounded-lg px-2.5 py-1 text-xs text-muted-foreground">
            <Video className="h-3.5 w-3.5" /> Запись эфира
          </div>
        )}
      </div>

      {/* Main content — fills remaining height */}
      <div className="flex-1 max-w-[1400px] w-full mx-auto px-3 md:px-6 pb-3 md:pb-6 flex flex-col lg:flex-row gap-3 md:gap-4 min-h-0">
        {/* Player column — takes most width on desktop */}
        <div className="lg:flex-[2.5] flex flex-col gap-2 min-w-0">
          {resolvedSource?.resolved_source_kind === 'kinescope_video' && resolvedSource.resolved_embed_url ? (
            <KinescopePlayerWrapper videoId={data?.kinescope_video_id!} />
          ) : resolvedSource?.resolved_source_kind === 'kinescope_live_embed' && resolvedSource.resolved_embed_url ? (
            <LiveEmbedPlayer embedUrl={resolvedSource.resolved_embed_url} />
          ) : (
            <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
              <div className="text-center p-4">
                <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Источник видео недоступен</p>
              </div>
            </div>
          )}
          {/* Room blocks — under_video (legacy, only if no product CTA bindings) */}
          {eventId && !hasUnderVideoCta && (
            <LiveEventRoomBlocks
              liveEventId={eventId}
              displayContext={isReplay ? "replay" : "live"}
              position="under_video"
            />
          )}
          {/* Product CTA — under_video */}
          {eventId && (
            <LiveEventProductCta
              liveEventId={eventId}
              position="under_video"
              displayContext={isReplay ? "replay" : "live"}
              eventStartedAt={data?.scheduled_at}
            />
          )}
        </div>

        {/* Chat / Questions sidebar — full height on desktop, sensible on mobile */}
        {eventId && (
          <div className="lg:flex-1 flex flex-col min-h-0 lg:min-h-0" style={{ maxHeight: 'calc(100vh - 120px)' }}>
            {/* Sidebar room blocks (legacy, only if no product CTA bindings) */}
            {!hasSidebarCta && (
              <LiveEventRoomBlocks
                liveEventId={eventId}
                displayContext={isReplay ? "replay" : "live"}
                position="sidebar"
              />
            )}
            {/* Product CTA — sidebar */}
            <LiveEventProductCta
              liveEventId={eventId}
              position="sidebar"
              displayContext={isReplay ? "replay" : "live"}
              eventStartedAt={data?.scheduled_at}
            />
            <Card className="flex-1 flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
              <Tabs defaultValue="comments" className="flex flex-col h-full">
                <TabsList className="w-full grid grid-cols-2 rounded-none border-b shrink-0 sticky top-0 z-10 bg-card">
                  <TabsTrigger value="comments" className="gap-1.5 text-xs">
                    <MessageCircle className="h-3.5 w-3.5" />
                    Чат
                  </TabsTrigger>
                  <TabsTrigger value="questions" className="gap-1.5 text-xs">
                    <HelpCircle className="h-3.5 w-3.5" />
                    Вопросы
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="comments" className="flex-1 overflow-hidden m-0">
                  <LiveEventComments liveEventId={eventId} onOpenProfile={isStaff ? openContactSheet : undefined} />
                </TabsContent>
                <TabsContent value="questions" className="flex-1 overflow-hidden m-0">
                  <LiveEventQuestions liveEventId={eventId} onOpenProfile={isStaff ? openContactSheet : undefined} />
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        )}
      </div>

      {/* Contact Detail Sheet — reuse existing pattern */}
      <ContactDetailSheet
        contact={selectedContact}
        open={contactSheetOpen}
        onOpenChange={setContactSheetOpen}
      />
    </div>
  );
}

/** Player for recorded/replay videos via Kinescope SDK */
function KinescopePlayerWrapper({ videoId }: { videoId: string }) {
  const containerId = "live-player-container";

  useKinescopePlayer({
    videoId,
    containerId,
  });

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      <div id={containerId} className="w-full h-full" />
    </div>
  );
}

/** Player for live stream embed via iframe */
function LiveEmbedPlayer({ embedUrl }: { embedUrl: string }) {
  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      <iframe
        src={embedUrl}
        className="w-full h-full border-0"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
      />
    </div>
  );
}
