import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useKinescopePlayer } from "@/hooks/useKinescopePlayer";
import { Loader2, Lock, CalendarClock, AlertTriangle, Video, MonitorX, TimerOff, MessageCircle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { LiveEventComments } from "@/components/live/LiveEventComments";
import { LiveEventQuestions } from "@/components/live/LiveEventQuestions";

interface LiveResolveResult {
  status: "ok" | "not_found" | "unpublished" | "auth_required" | "access_denied" | "invite_required" | "session_missing" | "source_unavailable" | "error";
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
}

type PageState = "loading" | "not_found" | "unpublished" | "access_denied" | "invite_required" | "source_unavailable" | "scheduled" | "live" | "ended_no_replay" | "session_revoked" | "session_expired" | "error";

const HEARTBEAT_INTERVAL_MS = 45_000;

export default function LiveEvent() {
  const { slug } = useParams<{ slug: string }>();
  const { session } = useAuth();
  const [state, setState] = useState<PageState>("loading");
  const [data, setData] = useState<LiveResolveResult | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    if (!slug || !session) return;
    stopHeartbeat();

    const sessionKey = sessionStorage.getItem(`live_session_${slug}`);
    if (!sessionKey) return;

    const ping = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/live-session-heartbeat`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
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
  }, [slug, session, stopHeartbeat]);

  useEffect(() => {
    return () => stopHeartbeat();
  }, [stopHeartbeat]);

  useEffect(() => {
    if (!slug || !session) return;

    const resolve = async () => {
      setState("loading");
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/live-resolve?slug=${encodeURIComponent(slug)}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );

        const json: LiveResolveResult = await response.json();
        setData(json);

        switch (json.status) {
          case "not_found":
            setState("not_found");
            break;
          case "unpublished":
            setState("unpublished");
            break;
          case "access_denied":
            setState("access_denied");
            break;
          case "invite_required":
            setState("invite_required");
            break;
          case "session_missing":
            setState("session_expired");
            break;
          case "source_unavailable":
            setState("source_unavailable");
            break;
          case "ok":
            if (json.event_status === "scheduled") {
              setState("scheduled");
            } else if (json.event_status === "ended" && !json.replay_enabled) {
              setState("ended_no_replay");
            } else {
              setState("live");
              startHeartbeat();
            }
            break;
          default:
            setState("error");
        }
      } catch (err) {
        console.error("[LiveEvent] resolve error:", err);
        setState("error");
      }
    };

    resolve();
  }, [slug, session, startHeartbeat]);

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
  const isReplay = data?.event_status === "ended" && data?.replay_enabled;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">{data?.title}</h1>
          {data?.event_type && (
            <Badge variant="outline" className="text-xs shrink-0">
              {data.event_type === "live_stream" ? "Живой эфир" : "Видео"}
            </Badge>
          )}
        </div>
        {data?.description && (
          <p className="text-muted-foreground mb-6">{data.description}</p>
        )}
        {isReplay && (
          <div className="mb-4 inline-flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 text-sm text-muted-foreground">
            <Video className="h-4 w-4" /> Запись эфира
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Player */}
          <div className="lg:col-span-2">
            {data?.kinescope_video_id && (
              <KinescopePlayerWrapper videoId={data.kinescope_video_id} />
            )}
          </div>

          {/* Comments / Questions sidebar */}
          {eventId && (
            <div className="lg:col-span-1">
              <Card className="h-[500px] flex flex-col overflow-hidden">
                <Tabs defaultValue="comments" className="flex flex-col h-full">
                  <TabsList className="w-full grid grid-cols-2 rounded-none border-b">
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
                    <LiveEventComments liveEventId={eventId} />
                  </TabsContent>
                  <TabsContent value="questions" className="flex-1 overflow-hidden m-0">
                    <LiveEventQuestions liveEventId={eventId} />
                  </TabsContent>
                </Tabs>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
