import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AutowebSessionSelector } from "@/components/live/AutowebSessionSelector";
import { AutowebRoomRuntime } from "@/components/live/AutowebRoomRuntime";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useKinescopePlayer } from "@/hooks/useKinescopePlayer";
import { Loader2, Lock, CalendarClock, AlertTriangle, Video, MonitorX, TimerOff, MessageCircle, HelpCircle, ShieldX, Users } from "lucide-react";
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
import { LiveBadge, type LiveBadgeMode } from "@/components/live/LiveBadge";
import { RoomParticipantsList } from "@/components/live/RoomParticipantsList";
import { LiveRoomReactionsBar } from "@/components/live/LiveRoomReactionsBar";
import { LiveRoomReactionsOverlay } from "@/components/live/LiveRoomReactionsOverlay";
import "@/components/live/liveRoomTheme.css";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { useLiveContactSheet } from "@/hooks/useLiveContactSheet";
import { RoomWaitingState } from "@/components/live/RoomWaitingState";
import { RoomLifecycleActions } from "@/components/live/RoomLifecycleActions";
import { parseRoomState, getRoomStateBadgeVM, type RoomState } from "@/lib/liveRoomLifecycle";
import { RoomEntryDialog } from "@/components/live/RoomEntryDialog";
import { RoomPreStartScreen } from "@/components/live/RoomPreStartScreen";
import { useRoomEntryPrefs } from "@/hooks/useRoomEntryPrefs";
import { readRoomSettings } from "@/lib/roomSettings";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import { useVisualViewportInset } from "@/hooks/useVisualViewportInset";
import { useUnansweredQuestionsCount } from "@/hooks/useUnansweredQuestionsCount";

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
  // Sprint 2 PATCH 2.5/2.6
  room_state?: RoomState;
  room_phase?: "closed" | "waiting" | "live" | "completed";
  active_participants?: number;
  // Запуск 2: room_settings (entry/prestart/participants/chat/reactions/sales) — pass-through из metadata.
  room_settings?: Record<string, any> | null;
}

type PageState = "loading" | "not_found" | "unpublished" | "access_denied" | "invite_required" | "source_unavailable" | "removed_from_room" | "scheduled" | "live" | "live_pending" | "ended_no_replay" | "session_revoked" | "session_expired" | "room_open_waiting" | "error";

const HEARTBEAT_INTERVAL_MS = 45_000;
const RESOLVE_POLL_INTERVAL_MS = 12_000;

/**
 * Sprint B: add-only autowebinar branch wrapper.
 * Lookup event_type by slug; if autowebinar — render selector/runtime.
 * Иначе — fallback в legacy LiveEventLegacy без изменений.
 */
export default function LiveEvent() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSessionId = searchParams.get("session");
  const { data: autowebMeta, isLoading: autowebMetaLoading } = useQuery({
    queryKey: ["autoweb-event-meta", slug],
    enabled: !!slug,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("live_events")
        .select("id, event_type, title, description")
        .eq("slug", slug!)
        .maybeSingle();
      return data ?? null;
    },
  });

  if (autowebMetaLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (autowebMeta?.event_type === "autowebinar") {
    if (urlSessionId) {
      return <AutowebRoomRuntime sessionId={urlSessionId} title={autowebMeta.title} description={autowebMeta.description} />;
    }
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <AutowebSessionSelector
            liveEventId={autowebMeta.id}
            onSessionChosen={(sid) => setSearchParams({ session: sid }, { replace: true })}
          />
        </div>
      </div>
    );
  }

  // Legacy flow (live_stream / recorded_webinar) — рендерится без изменений.
  return <LiveEventLegacy />;
}

function LiveEventLegacy() {
  const { slug } = useParams<{ slug: string }>();
  const { session, user, role } = useAuth();
  const [state, setState] = useState<PageState>("loading");
  const [data, setData] = useState<LiveResolveResult | null>(null);
  const { selectedContact, contactSheetOpen, setContactSheetOpen, openContactSheet } = useLiveContactSheet();
  const isStaff = role === "admin" || role === "superadmin" || role === "employee";
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMobile = useIsMobile();

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
  // Staff badge: счётчик неотвеченных вопросов для модераторов / ведущего.
  // Должен вызываться ДО early returns ниже (Rules of Hooks).
  // RLS на live_event_questions гарантирует, что non-staff увидят только свои → нет утечки.
  const presenterUserIdForBadge: string | null =
    ((data as any)?.presenter_user_id as string | null) || null;
  const isPresenterForBadge =
    !!user?.id && !!presenterUserIdForBadge && user.id === presenterUserIdForBadge;
  const unansweredCount = useUnansweredQuestionsCount(
    eventIdForCta || null,
    isStaff || isPresenterForBadge,
  );

  // Room settings + entry prefs (Запуск 2)
  // P1 ROOT CAUSE FIX: live-resolve отдаёт уже-распакованный room_settings
  // (см. supabase/functions/live-resolve/index.ts:335 — `room_settings: metadata.room_settings`).
  // readRoomSettings ожидает целиком metadata и сам ищет внутри `.room_settings`.
  // Из-за двойной распаковки stored всегда был {}, prestart.enabled=false по дефолту,
  // и обложка/таймер НИКОГДА не показывались. Оборачиваем обратно в { room_settings }.
  const roomSettings = useMemo(
    () => readRoomSettings({ room_settings: (data as any)?.room_settings }),
    [data]
  );
  const { prefs, isLoading: prefsLoading, profileAvatarUrl, profileFullName, upsertPrefs, syncSessionMirror } =
    useRoomEntryPrefs(data?.event_id);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [entrySatisfied, setEntrySatisfied] = useState(false);

  // Wake Lock: держим экран активным ТОЛЬКО в live / room_open_waiting.
  // Для всех остальных state (loading/ended/session_revoked/session_expired/
  // access_denied/room_closed/error/...) enabled=false → cleanup освобождает lock.
  // Хук размещён ДО early returns по Rules of Hooks (всегда вызывается).
  // Привязка только к state комнаты — никаких tabs/chat/reactions/composer.
  useScreenWakeLock(state === "live" || state === "room_open_waiting");

  // PATCH: iOS keyboard gap — привязка composer к Visual Viewport.
  // Хук безопасен на desktop (offset = 0). См. useVisualViewportInset.ts.
  useVisualViewportInset();

  // Reconnect contract: prefs already exist → silent mirror to session, skip dialog.
  useEffect(() => {
    if (!data?.event_id || prefsLoading) return;
    if (entrySatisfied) return;
    const nameRequired = roomSettings.entry.name_required;
    if (!nameRequired) {
      setEntrySatisfied(true);
      return;
    }
    if (prefs?.display_name) {
      // silent resync runtime mirror, then proceed
      void syncSessionMirror(prefs).finally(() => setEntrySatisfied(true));
    } else if (state === "live" || state === "room_open_waiting") {
      setEntryDialogOpen(true);
    }
  }, [data?.event_id, prefs, prefsLoading, roomSettings.entry.name_required, state, entrySatisfied, syncSessionMirror]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  /**
   * M2 unified entry tracking:
   * - если в sessionStorage уже лежит session_key (token-flow или прошлый soft-join) — обычный ping;
   * - если ключа нет, но передан liveEventId и mode ∈ {'live','room_open_waiting'} — soft-join:
   *   первый ping идёт с { live_event_id }, сервер делает access-check и UPSERT в live_active_sessions,
   *   возвращает выданный session_key, который мы сохраняем в sessionStorage и продолжаем heartbeat.
   * entry_path: token | direct | menu (наличие nav state hint) — для будущей аналитики (M3).
   */
  const startHeartbeat = useCallback((opts?: { liveEventId?: string }) => {
    if (!slug) return;
    stopHeartbeat();

    const liveEventId = opts?.liveEventId;
    let sessionKey = sessionStorage.getItem(`live_session_${slug}`);

    if (!sessionKey && !liveEventId) {
      // Нет ни ключа, ни eventId — нечего пинговать (классический cold-start без token-link).
      return;
    }

    // Определяем entry_path для soft-join: token уже даёт session_key, поэтому здесь только non-token.
    // Подсказку о входе из меню можно класть в sessionStorage[`live_entry_${slug}`] = 'menu'.
    const entryPathHint = sessionStorage.getItem(`live_entry_${slug}`) || "direct";

    const ping = async () => {
      try {
        const token = sessionRef.current?.access_token;
        if (!token) return;
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

        const body: Record<string, unknown> = {};
        if (sessionKey) body.session_key = sessionKey;
        if (!sessionKey && liveEventId) {
          body.live_event_id = liveEventId;
          body.entry_path = entryPathHint;
        }

        const response = await fetch(
          `${supabaseUrl}/functions/v1/live-session-heartbeat`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }
        );
        const json = await response.json();

        if (json.status === "ok" && json.session_key && !sessionKey) {
          // Soft-join успешен — сохраняем выданный ключ для следующих ping-ов.
          sessionKey = json.session_key as string;
          sessionStorage.setItem(`live_session_${slug}`, sessionKey);
          // M2: одноразовый hint о пути входа — удаляем после успешного использования,
          // чтобы повторное открытие из direct-URL не наследовало 'menu'.
          try { sessionStorage.removeItem(`live_entry_${slug}`); } catch {/* noop */}
        } else if (json.status === "session_revoked") {
          stopHeartbeat();
          setState("session_revoked");
        } else if (json.status === "session_expired") {
          stopHeartbeat();
          setState("session_expired");
        } else if (json.status === "access_denied") {
          // Soft-join отклонён сервером (нет доступа) — ничего не делаем, не флапаем UI.
          stopHeartbeat();
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
          room_theme: (json as any).room_theme,
          live_badge_mode: (json as any).live_badge_mode,
          presenter_user_id: (json as any).presenter_user_id,
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
            // Sprint 2 PATCH 2.5: room_phase из live-resolve — отдельный SoT для UI-веток.
            // Если комната открыта но эфир ещё не начат → waiting (вход разрешён, чат активен).
            const roomPhase = json.room_phase;

            if (roomPhase === "waiting") {
              nextState = "room_open_waiting";
              startHeartbeat({ liveEventId: json.event_id });
            } else if (ps === "scheduled" || es === "scheduled") {
              // Fallback: если комната ещё closed — старый scheduled-экран.
              nextState = "scheduled";
            } else if (sourceKind === "live_pending") {
              nextState = "live_pending";
            } else if (ps === "replay_available" || (es === "ended" && json.replay_enabled)) {
              nextState = "live";
            } else if (es === "ended" && !json.replay_enabled) {
              nextState = "ended_no_replay";
            } else {
              nextState = "live";
              startHeartbeat({ liveEventId: json.event_id });
            }
            break;
          }
          default:
            nextState = "error";
        }
        setState(nextState);

        const shouldPoll = nextState === "scheduled"
          || nextState === "live_pending"
          || nextState === "live"
          || nextState === "room_open_waiting";
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
        <h1 className="text-2xl md:text-3xl font-bold text-foreground text-center text-balance max-w-3xl mx-auto leading-tight px-4">{data?.title || "Эфир"}</h1>
        {data?.event_type && (
          <Badge variant="outline">{data.event_type === "live_stream" ? "Живой эфир" : "Видео"}</Badge>
        )}
        {data?.description && (
          <p className="text-muted-foreground text-center text-balance max-w-2xl mx-auto px-4">{data.description}</p>
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
        <h1 className="text-2xl md:text-3xl font-bold text-foreground text-center text-balance max-w-3xl mx-auto leading-tight px-4">{data?.title || "Эфир запускается"}</h1>
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
        <h1 className="text-2xl md:text-3xl font-bold text-foreground text-center text-balance max-w-3xl mx-auto leading-tight px-4">{data?.title || "Эфир завершён"}</h1>
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

  // state === "live" | "room_open_waiting" — shared room tree (PATCH 2.5).
  // In waiting mode the player is replaced by RoomWaitingState; chat/questions/CTA stay active.
  // PATCH 3.5 IMPORTANT: root `.live-room-themed` wrapper is shared — switching waiting→live
  // changes ONLY the player column. Chat/CTA/header are NOT remounted. Do NOT break this.
  const isWaiting = state === "room_open_waiting";
  const eventId = data?.event_id;

  const isReplay = !isWaiting && (data?.platform_status === "replay_available" ||
    (data?.event_status === "ended" && data?.replay_enabled));
  const resolvedSource = data?.resolved_source;
  const roomState = parseRoomState(data?.room_state);
  const roomBadgeVM = getRoomStateBadgeVM(roomState);
  const activeParticipants = data?.active_participants;

  // CTA bindings hooks moved to top of component (Rules of Hooks)

  // Room theme + UX metadata from live-resolve (passed through from live_events.metadata).
  // Strictly local to .live-room-themed scope — never leaks globally.
  const roomTheme: any = (data as any)?.room_theme || {};
  const presenterUserId: string | null = (data as any)?.presenter_user_id || null;
  const isPresenter = !!user?.id && !!presenterUserId && user.id === presenterUserId;
  const liveBadgeMode: LiveBadgeMode = ((data as any)?.live_badge_mode as LiveBadgeMode) || "auto";
  const themeStyle: React.CSSProperties = {
    ['--room-bg' as string]: roomTheme.background_color || undefined,
    ['--room-text' as string]: roomTheme.primary_text_color || undefined,
    ['--room-text-secondary' as string]: roomTheme.secondary_text_color || undefined,
    ['--room-panel' as string]: roomTheme.panel_color || undefined,
    ['--room-accent' as string]: roomTheme.accent_color || undefined,
    ['--room-tabs' as string]: roomTheme.tabs_color || undefined,
    ['--room-admin-badge' as string]: roomTheme.admin_badge_color || undefined,
    ['--room-employee-badge' as string]: roomTheme.employee_badge_color || undefined,
  };

  return (
    <div
      className="live-room-themed min-h-[100dvh] lg:min-h-screen lg:flex lg:flex-col"
      style={themeStyle}
    >
      {/* Header — compact. M1.2: на mobile уезжает вверх при body-scroll (НЕ sticky), на desktop — обычный flow.
          M1.4: уменьшены вертикальные отступы и размер заголовка на mobile, чтобы первый экран
          был плотнее и не было пустого «воздуха» сверху между header и video-shell. */}
      <div data-mobile-header className="max-w-[1600px] w-full mx-auto px-3 md:px-6 pt-1.5 md:pt-4 pb-1 md:pb-2 max-lg:flex-shrink-0">
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <h1
              tabIndex={0}
              className="room-title w-full text-base md:text-2xl lg:text-[28px] font-semibold tracking-tight leading-[1.2] text-balance line-clamp-1 md:line-clamp-2 mb-1 md:mb-1.5 cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm"
              title={data?.title}
            >
              {data?.title}
            </h1>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-[min(92vw,640px)] text-sm leading-snug whitespace-normal break-words">
            {data?.title}
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-1.5 md:gap-3 mb-0.5 md:mb-1 flex-wrap">
          {/* Sprint 2 PATCH 2.5/2.7: room state badge через единый VM, не локальное вычисление */}
          {isWaiting ? (
            <Badge variant={roomBadgeVM.variant}>{roomBadgeVM.shortLabel}</Badge>
          ) : (
            <LiveBadge platformStatus={data?.platform_status} mode={liveBadgeMode} />
          )}
          {data?.event_type && (
            <Badge variant="outline" className="text-xs shrink-0">
              {data.event_type === "live_stream" ? "Эфир" : "Видео"}
            </Badge>
          )}
          {/* Sprint 2 PATCH 2.6: participant count v1 (честный — активные за 2 мин) */}
          {typeof activeParticipants === "number" && (roomState === "opened" || roomState === "live") && (
            <Badge variant="outline" className="text-xs gap-1 shrink-0" title="Активные участники за последние 2 минуты">
              <Users className="h-3 w-3" /> {activeParticipants}
            </Badge>
          )}
          {/* Sprint 2 PATCH 2.4 + M1.5: «Завершить вебинар» внутри комнаты, только staff в state=live.
              Mobile (max-lg) — компактная icon-only кнопка с тем же confirm-диалогом.
              Desktop — прежняя текстовая кнопка. Гейтинг по правам не меняется. */}
          {isStaff && eventId && roomState === "live" && (
            <div className="ml-auto">
              <RoomLifecycleActions
                eventId={eventId}
                roomState={roomState}
                layout={isMobile ? "room-mobile" : "room"}
                invalidateKeys={[["admin-live-events"]]}
              />
            </div>
          )}
        </div>
        {data?.description && (
          <p className="room-subtitle text-sm line-clamp-1 mb-1 hidden md:block">{data.description}</p>
        )}
        {isReplay && (
          <div className="inline-flex items-center gap-2 bg-muted rounded-lg px-2.5 py-1 text-xs text-muted-foreground">
            <Video className="h-3.5 w-3.5" /> Запись эфира
          </div>
        )}
      </div>

      {/* Main content — fills remaining height. M1.2: на mobile sticky top-0 + h-100dvh + overflow-hidden,
          чтобы после ухода header дальнейший body-scroll прекращался, а скролл оставался только внутри messages.
          bg-background + z-[1] — чтобы header при уходе вверх не просвечивал и не накладывался по слоям. */}
      <div data-mobile-sticky-main className="max-w-[1600px] w-full mx-auto px-3 md:px-6 pb-0 md:pb-6 flex flex-col lg:flex-1 lg:flex-row lg:items-start gap-3 md:gap-4 min-h-0 max-lg:sticky max-lg:top-0 max-lg:h-[100dvh] max-lg:overflow-hidden max-lg:bg-background max-lg:z-[1]">
        {/* Player column — takes most width on desktop */}
        <div data-video-shell className="lg:flex-[3] flex flex-col gap-2 min-w-0 max-lg:shrink-0" style={{ pointerEvents: "auto", touchAction: "manipulation" }}>
          {/* K3: relative-обёртка для overlay реакций. pointer-events: auto явно
              задан выше, чтобы tap по Kinescope iframe (controls/fullscreen/quality)
              гарантированно проходил в Safari iOS и в PWA standalone. */}
          <div className="relative" style={{ pointerEvents: "auto" }}>
            {(() => {
              // P1 FIX (root cause): прежний guard
              //   prestart.enabled && scheduled_at>now() && (state==='room_open_waiting'||isWaiting)
              // отрезал pre-start, если: (1) дата старта в прошлом, а админ открыл комнату вручную;
              // (2) lifecycle ещё не успел перейти в 'room_open_waiting'. Из-за этого админ видел
              // обычный waiting-state вместо настроенной обложки/таймера.
              //
              // Новый контракт (двухрежимный):
              //  A) countdown mode  — enabled + scheduled_at > now → обложка + countdown;
              //  B) cover-only mode — enabled + есть cover/title/music + (room opened ИЛИ wait state) → обложка без countdown.
              // Если pre-start выкл/нет ассетов → старый RoomWaitingState.
              const ps = roomSettings.prestart;
              const prestartReady =
                ps.enabled && (ps.cover_url || (ps.title && ps.title.trim()) || ps.music_url);
              const futureStart =
                !!data?.scheduled_at && new Date(data.scheduled_at).getTime() > Date.now();
              const roomOpenedOrWaiting =
                state === "room_open_waiting" || isWaiting;
              const showPreStart =
                !isReplay && prestartReady && (futureStart || roomOpenedOrWaiting);

              if (showPreStart) {
                return (
                  <RoomPreStartScreen
                    prestart={ps}
                    scheduledAt={futureStart ? data?.scheduled_at : undefined}
                    eventTimezone={data?.event_timezone}
                  />
                );
              }
              if (isWaiting) {
                return <RoomWaitingState scheduledAt={data?.scheduled_at} eventTimezone={data?.event_timezone} compact={isMobile} />;
              }
              if (resolvedSource?.resolved_source_kind === 'kinescope_video' && resolvedSource.resolved_embed_url) {
                return <KinescopePlayerWrapper videoId={data?.kinescope_video_id!} />;
              }
              if (resolvedSource?.resolved_source_kind === 'kinescope_live_embed' && resolvedSource.resolved_embed_url) {
                return <LiveEmbedPlayer embedUrl={resolvedSource.resolved_embed_url} />;
              }
              return (
                <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                  <div className="text-center p-4">
                    <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Источник видео недоступен</p>
                  </div>
                </div>
              );
            })()}
            {/* Sprint final: Reactions overlay поверх видео — emoji-only, fade-out ~3s, realtime для всех. */}
            {eventId && roomSettings.reactions.enabled && !isReplay && (
              <LiveRoomReactionsOverlay liveEventId={eventId} enabled={roomSettings.reactions.enabled} />
            )}
          </div>
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
          {/* Sprint final: Live-room reactions bar (room-level emoji reactions). */}
          {eventId && roomSettings.reactions.enabled && !isReplay && (
            <LiveRoomReactionsBar liveEventId={eventId} enabled={roomSettings.reactions.enabled} />
          )}
        </div>

        {/* Chat / Questions sidebar — fixed width on desktop, stack on mobile.
            PATCH 1: Card-чат ВСЕГДА первый элемент DOM-сайдбара на desktop —
            гарантирует, что top чата === top видео. CTA/room blocks рендерятся
            ниже Card. На mobile порядок остаётся естественным (column stack). */}
        {eventId && (
          <div className="w-full lg:w-[360px] xl:w-[400px] lg:shrink-0 lg:self-start flex flex-col min-h-0 flex-1 lg:flex-none lg:h-[calc(100vh-140px)] gap-2 max-lg:overflow-hidden">
            <Card className="room-panel flex-1 flex flex-col overflow-hidden min-h-0 order-1">
              {(() => {
                const showParticipantsTab = isStaff || roomSettings.participants.visible_for_students;
                const tabsCols = showParticipantsTab ? "grid-cols-3" : "grid-cols-2";
                return (
                  <Tabs defaultValue="comments" className="flex flex-col h-full min-h-0">
                    <TabsList className={`room-tabs-list w-full grid ${tabsCols} rounded-none border-b shrink-0 sticky top-0 z-10 bg-card`}>
                      <TabsTrigger value="comments" className="room-tab-trigger gap-1.5 text-xs">
                        <MessageCircle className="h-3.5 w-3.5" />
                        Чат
                      </TabsTrigger>
                      <TabsTrigger value="questions" className="room-tab-trigger gap-1.5 text-xs">
                        <HelpCircle className="h-3.5 w-3.5" />
                        Вопросы
                        <Lock className="h-3 w-3 opacity-60" />
                        {(isStaff || isPresenter) && unansweredCount > 0 && (
                          <Badge
                            variant="destructive"
                            className="ml-0.5 h-4 min-w-4 px-1 text-[10px] leading-none rounded-full"
                          >
                            {unansweredCount > 99 ? "99+" : unansweredCount}
                          </Badge>
                        )}
                      </TabsTrigger>
                      {showParticipantsTab && (
                        <TabsTrigger value="participants" className="room-tab-trigger gap-1.5 text-xs">
                          <Users className="h-3.5 w-3.5" />
                          Участники
                        </TabsTrigger>
                      )}
                    </TabsList>
                    {/* PATCH 3.5: forceMount keeps both tabs in DOM — preserves scroll position and realtime subscriptions. */}
                    <TabsContent value="comments" className="flex-1 min-h-0 overflow-hidden m-0 data-[state=inactive]:hidden" forceMount>
                      <LiveEventComments
                        liveEventId={eventId}
                        presenterUserId={presenterUserId}
                        onOpenProfile={isStaff ? openContactSheet : undefined}
                        emojiNormalizationEnabled={roomSettings.chat.emoji_normalization_enabled}
                      />
                    </TabsContent>
                    <TabsContent value="questions" className="flex-1 min-h-0 overflow-hidden m-0 data-[state=inactive]:hidden" forceMount>
                      <LiveEventQuestions
                        liveEventId={eventId}
                        presenterUserId={presenterUserId}
                        onOpenProfile={isStaff ? openContactSheet : undefined}
                        emojiNormalizationEnabled={roomSettings.chat.emoji_normalization_enabled}
                      />
                    </TabsContent>
                    {showParticipantsTab && (
                      <TabsContent value="participants" className="flex-1 min-h-0 overflow-hidden m-0 data-[state=inactive]:hidden" forceMount>
                        <RoomParticipantsList
                          liveEventId={eventId}
                          isStaff={isStaff}
                          visibleForStudents={roomSettings.participants.visible_for_students}
                        />
                      </TabsContent>
                    )}
                  </Tabs>
                );
              })()}
            </Card>
            {/* Sidebar room blocks (legacy, only if no product CTA bindings) — ПОД чатом */}
            {!hasSidebarCta && (
              <div className="order-2 shrink-0">
                <LiveEventRoomBlocks
                  liveEventId={eventId}
                  displayContext={isReplay ? "replay" : "live"}
                  position="sidebar"
                />
              </div>
            )}
            {/* Product CTA — sidebar (ПОД чатом). Mobile: constrained height to not eat chat space */}
            <div className="order-3 lg:max-h-none max-h-[35vh] overflow-y-auto shrink-0">
              <LiveEventProductCta
                liveEventId={eventId}
                position="sidebar"
                displayContext={isReplay ? "replay" : "live"}
                eventStartedAt={data?.scheduled_at}
              />
            </div>
          </div>
        )}
      </div>

      {/* Contact Detail Sheet — reuse existing pattern */}
      <ContactDetailSheet
        contact={selectedContact}
        open={contactSheetOpen}
        onOpenChange={setContactSheetOpen}
      />

      {/* Room Entry Dialog — Запуск 2 PHASE 3 */}
      {data?.event_id && (
        <RoomEntryDialog
          open={entryDialogOpen}
          onOpenChange={setEntryDialogOpen}
          settings={roomSettings.entry}
          isStaff={isStaff}
          initialPrefs={prefs}
          profileAvatarUrl={profileAvatarUrl}
          profileFullName={profileFullName}
          onSubmit={async (next) => {
            const saved = await upsertPrefs(next);
            await syncSessionMirror(saved);
            setEntrySatisfied(true);
          }}
        />
      )}
    </div>
  );
}

/** Player for recorded/replay videos via Kinescope SDK — PATCH 3.5: memo by videoId */
const KinescopePlayerWrapper = React.memo(function KinescopePlayerWrapper({ videoId }: { videoId: string }) {
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
}, (prev, next) => prev.videoId === next.videoId);

/** Player for live stream embed via iframe — PATCH 3.5: memo by embedUrl */
const LiveEmbedPlayer = React.memo(function LiveEmbedPlayer({ embedUrl }: { embedUrl: string }) {
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
}, (prev, next) => prev.embedUrl === next.embedUrl);
