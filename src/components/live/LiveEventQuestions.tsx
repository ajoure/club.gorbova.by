import { useState, useEffect, useRef, useCallback, useMemo, forwardRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Send, CheckCircle2, Lock, ArrowDown, Reply } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  LiveRoleBadge,
  resolveMessageHighlight,
  type AuthorRole,
} from "./LiveRoleBadge";
import { LiveEventReplyActivity, LiveEventReplyForm, useLiveEventReplies } from "./LiveEventReplies";
import { LiveInlineModeration } from "./LiveInlineModeration";
import { LiveAutoGrowTextarea } from "./LiveAutoGrowTextarea";
import { LiveModerationBanner } from "./LiveModerationBanner";
import { useRoomModerationState } from "@/hooks/useRoomModerationState";
import { toast } from "sonner";
import { resolveParticipantDisplay } from "@/lib/participantDisplay";
import { normalizeEmoji } from "@/lib/normalizeEmoji";
import { groupLiveEventRepliesBySource } from "@/lib/groupLiveEventRepliesBySource";
import { useStaffNameMap } from "@/hooks/useStaffNameMap";

interface Question {
  id: string;
  user_id: string;
  content: string;
  is_answered: boolean;
  answered_at: string | null;
  answered_by: string | null;
  created_at: string;
  author_display_name: string | null;
  author_role: string | null;
  author_avatar_url: string | null;
  author_nickname_color: string | null;
  // Legacy fallback: только avatar_url (snapshot — SoT для имени).
  profile?: { avatar_url: string | null } | null;
}

interface LiveEventQuestionsProps {
  liveEventId: string;
  presenterUserId?: string | null;
  onOpenProfile?: (userId: string) => void;
  /**
   * Sprint B: для autowebinar event_type обязателен session_id.
   */
  autowebSessionId?: string | null;
  /** Sprint final: render-time emoji normalization toggle. */
  emojiNormalizationEnabled?: boolean;
  /** Autoweb timed-replay history layer. */
  historySourceEventId?: string;
  historySourceStartedAt?: string;
  /** Start of the current autoweb session; used for unified display_at order. */
  autowebSessionStartedAt?: string;
  currentPlaybackSeconds?: number;
  /** Для staff — визуально помечать источник (history/live). */
  staffSourceIndicator?: boolean;
}

// forwardRef to satisfy Tabs/Radix ref forwarding (fixes console warning).
export const LiveEventQuestions = forwardRef<HTMLDivElement, LiveEventQuestionsProps>(
  function LiveEventQuestions(
    {
      liveEventId,
      presenterUserId,
      onOpenProfile,
      autowebSessionId,
      emojiNormalizationEnabled = true,
      historySourceEventId,
      historySourceStartedAt,
      autowebSessionStartedAt,
      currentPlaybackSeconds,
      staffSourceIndicator = false,
    },
    ref,
  ) {
    const { user, role } = useAuth();
    const queryClient = useQueryClient();
    const [newQuestion, setNewQuestion] = useState("");
    const isStaff = role === "admin" || role === "superadmin" || role === "employee";
    const [replyingTo, setReplyingTo] = useState<{ id: string; userId: string; name: string } | null>(null);
    const staffNameMap = useStaffNameMap(liveEventId, isStaff);
    const { data: liveReplies = [] } = useLiveEventReplies(liveEventId);

    // Live (текущий автовеб).
    const { data: liveQuestions, isLoading } = useQuery({
      queryKey: ["live-event-questions", liveEventId, autowebSessionId ?? "legacy"],
      queryFn: async () => {
        let questionsQuery = supabase
          .from("live_event_questions")
          .select("id, user_id, content, is_answered, answered_at, answered_by, created_at, author_display_name, author_role, author_avatar_url, author_nickname_color")
          .eq("live_event_id", liveEventId)
          .order("created_at", { ascending: true })
          .limit(200);
        if (autowebSessionId) {
          questionsQuery = questionsQuery.eq("metadata->>session_id", autowebSessionId);
        }
        const { data, error } = await questionsQuery;
        if (error) throw error;

        const needsAvatarFallback = (data || []).filter(q => !q.author_avatar_url);
        let profiles: Record<string, { avatar_url: string | null }> = {};
        if (needsAvatarFallback.length > 0) {
          const userIds = [...new Set(needsAvatarFallback.map(q => q.user_id))];
          const { data: profileData } = await supabase
            .from("profiles")
            .select("user_id, avatar_url")
            .in("user_id", userIds);
          for (const p of profileData || []) {
            profiles[p.user_id] = { avatar_url: p.avatar_url };
          }
        }

        return (data || []).map(q => ({
          ...q,
          profile: profiles[q.user_id] || null,
        })) as Question[];
      },
    });

    // Historical (исходный live_stream) — read-only, timed-replay.
    const historyEnabled = !!historySourceEventId && !!historySourceStartedAt;
    const { data: historyQuestions } = useQuery({
      queryKey: ["live-event-questions-history", historySourceEventId, autowebSessionId ?? "none"],
      enabled: historyEnabled,
      staleTime: 5 * 60_000,
      queryFn: async () => {
        if (!autowebSessionId) return [] as Question[];
        const { data, error } = await supabase.rpc("autoweb_history_questions_list", {
          _session_id: autowebSessionId,
          _source_event_id: historySourceEventId!,
        });
        if (error) throw error;
        const needsAvatarFallback = (data || []).filter(q => !q.author_avatar_url);
        let profiles: Record<string, { avatar_url: string | null }> = {};
        if (needsAvatarFallback.length > 0) {
          const userIds = [...new Set(needsAvatarFallback.map(q => q.user_id))];
          const { data: profileData } = await supabase
            .from("profiles")
            .select("user_id, avatar_url")
            .in("user_id", userIds);
          for (const p of profileData || []) {
            profiles[p.user_id] = { avatar_url: p.avatar_url };
          }
        }
        return (data || []).map(q => ({
          ...q,
          profile: profiles[q.user_id] || null,
        })) as Question[];
      },
    });

    const sourceStartedMs = historyEnabled ? new Date(historySourceStartedAt!).getTime() : 0;
    const cutoffMs = historyEnabled
      ? sourceStartedMs + Math.max(0, currentPlaybackSeconds ?? 0) * 1000
      : 0;
    const questions = useMemo<Question[]>(() => {
      if (!historyEnabled) return liveQuestions ?? [];
      const visible = (historyQuestions ?? []).filter(
        (q) => new Date(q.created_at).getTime() <= cutoffMs,
      );
      const sessionStartedMs = autowebSessionStartedAt
        ? new Date(autowebSessionStartedAt).getTime()
        : sourceStartedMs;
      return [
        ...visible.map((question) => ({
          question,
          displayAt: sessionStartedMs + (new Date(question.created_at).getTime() - sourceStartedMs),
        })),
        ...(liveQuestions ?? []).map((question) => ({
          question,
          displayAt: new Date(question.created_at).getTime(),
        })),
      ]
        .sort((a, b) => a.displayAt - b.displayAt)
        .map(({ question }) => question);
    }, [historyEnabled, liveQuestions, historyQuestions, cutoffMs, autowebSessionStartedAt, sourceStartedMs]);
    const historicalQuestionIds = useMemo(
      () => new Set((historyQuestions ?? []).map((question) => question.id)),
      [historyQuestions],
    );
    const questionTextById = useMemo(
      () => new Map(questions.map((question) => [question.id, question.content])),
      [questions],
    );
    const questionReplies = useMemo(
      () => liveReplies.filter((reply) => !!reply.source_question_id && questionTextById.has(reply.source_question_id)),
      [liveReplies, questionTextById],
    );
    const questionRepliesBySource = useMemo(
      () => groupLiveEventRepliesBySource(questionReplies, "question"),
      [questionReplies],
    );


    // Realtime
    useEffect(() => {
      const uniq = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
      const channel = supabase
        .channel(`live-questions-${liveEventId}-${uniq}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "live_event_questions", filter: `live_event_id=eq.${liveEventId}` },
          () => queryClient.invalidateQueries({ queryKey: ["live-event-questions", liveEventId, autowebSessionId ?? "legacy"] })
        )
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }, [liveEventId, autowebSessionId, queryClient]);

    // M1.1: smart auto-scroll for questions list (same pattern as comments).
    const scrollRef = useRef<HTMLDivElement>(null);
    const [hasNewBelow, setHasNewBelow] = useState(false);
    const wasNearBottomRef = useRef(true);
    const lastCountRef = useRef(0);

    const isNearBottom = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return true;
      return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }, []);

    const scrollToBottom = useCallback((smooth = true) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
      setHasNewBelow(false);
    }, []);

    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const onScroll = () => {
        wasNearBottomRef.current = isNearBottom();
        if (wasNearBottomRef.current) setHasNewBelow(false);
      };
      el.addEventListener("scroll", onScroll, { passive: true });
      return () => el.removeEventListener("scroll", onScroll);
    }, [isNearBottom]);

    useEffect(() => {
      const count = (questions?.length ?? 0) + questionReplies.length;
      const prev = lastCountRef.current;
      if (count === 0) {
        lastCountRef.current = 0;
        return;
      }
      if (prev === 0) {
        requestAnimationFrame(() => scrollToBottom(false));
      } else if (count > prev) {
        if (wasNearBottomRef.current) {
          requestAnimationFrame(() => scrollToBottom(true));
        } else {
          setHasNewBelow(true);
        }
      }
      lastCountRef.current = count;
    }, [questions, questionReplies.length, scrollToBottom]);

    const { isMuted, isRemoved } = useRoomModerationState(liveEventId, user?.id);
    const isBlocked = isMuted || isRemoved;

    const sendMutation = useMutation({
      mutationFn: async (content: string) => {
        // Sprint B: для autowebinar обязателен session_id.
        if (autowebSessionId === null) {
          throw new Error("Сессия не выбрана — обновите страницу и выберите сессию заново.");
        }
        const payload: Record<string, unknown> = {
          live_event_id: liveEventId,
          user_id: user!.id,
          content,
        };
        if (autowebSessionId) {
          payload.metadata = { session_id: autowebSessionId };
        }
        const { error } = await supabase.from("live_event_questions").insert(payload as any);
        if (error) throw error;
      },
      onSuccess: () => {
        setNewQuestion("");
        queryClient.invalidateQueries({ queryKey: ["live-event-questions", liveEventId, autowebSessionId ?? "legacy"] });
      },
      onError: (err: any) => {
        const msg = String(err?.message || "");
        if (msg.includes("row-level security") || msg.includes("violates")) {
          toast.error(
            isRemoved
              ? "Вы удалены из комнаты — отправка недоступна"
              : "Вы заглушены — отправка временно недоступна",
          );
        } else {
          toast.error(`Ошибка отправки: ${err.message}`);
        }
        queryClient.invalidateQueries({
          queryKey: ["live-user-mod-state", liveEventId, user?.id],
        });
      },
    });

    const toggleAnsweredMutation = useMutation({
      mutationFn: async ({ id, is_answered }: { id: string; is_answered: boolean }) => {
        const patch: Record<string, unknown> = { is_answered };
        if (is_answered) {
          patch.answered_at = new Date().toISOString();
          patch.answered_by = user?.id ?? null;
        } else {
          patch.answered_at = null;
          patch.answered_by = null;
        }
        const { error } = await supabase.from("live_event_questions").update(patch as any).eq("id", id);
        if (error) throw error;
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["live-event-questions", liveEventId, autowebSessionId ?? "legacy"] }),
    });

    const handleSend = () => {
      if (!newQuestion.trim() || !user) return;
      if (isBlocked) {
        toast.error(
          isRemoved
            ? "Вы удалены из комнаты модератором"
            : "Вы заглушены модератором",
        );
        return;
      }
      sendMutation.mutate(newQuestion.trim());
    };

    const resolveDisplayRole = (q: Question): AuthorRole | string | null => {
      if (presenterUserId && q.user_id === presenterUserId) return "presenter";
      return q.author_role;
    };

    const renderQuestion = (q: Question) => {
      const isHistorical = historicalQuestionIds.has(q.id);
      const display = resolveParticipantDisplay({
        user_id: q.user_id,
        author_display_name: q.author_display_name,
        author_avatar_url: q.author_avatar_url,
        legacy_avatar_url: q.profile?.avatar_url ?? null,
        viewerIsStaff: isStaff,
        staff_real_name: isStaff ? staffNameMap.get(q.user_id) ?? null : null,
      });
      const displayName = display.displayName;
      const avatarUrl = display.avatarUrl;
      const initials = display.initials;
      const displayRole = resolveDisplayRole(q);
      const isOwn = user?.id === q.user_id;
      const highlight = resolveMessageHighlight({ isOwn, role: displayRole });
      // SECURITY: onOpenProfile передаётся ТОЛЬКО при isStaff (см. LiveEvent.tsx).
      // Политика: mem://security/access-control/webinar-staff-action-guards.
      const canOpenProfile = !!onOpenProfile;
      return (
        <div key={q.id}>
          <div className={`flex gap-2 group rounded-lg p-2 ${q.is_answered ? "opacity-70" : ""} ${highlight}`}>
            <Avatar
              className={`h-7 w-7 shrink-0 ${canOpenProfile ? "cursor-pointer" : ""}`}
              onClick={canOpenProfile ? () => onOpenProfile!(q.user_id) : undefined}
            >
              {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
              <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`text-xs font-medium room-message-text ${canOpenProfile ? "cursor-pointer hover:underline" : ""}`}
                  style={q.author_nickname_color ? { color: q.author_nickname_color } : undefined}
                  onClick={canOpenProfile ? () => onOpenProfile!(q.user_id) : undefined}
                >
                  {displayName}
                  {isOwn && <span className="ml-1 text-[10px] text-primary">(вы)</span>}
                </span>
                <LiveRoleBadge role={displayRole} />
                {staffSourceIndicator && isHistorical && <Badge variant="outline" className="text-[9px] px-1 py-0">История</Badge>}
                <span className="text-[10px] room-meta-text">{format(new Date(q.created_at), "HH:mm", { locale: ru })}</span>
                {q.is_answered && <CheckCircle2 className="h-3 w-3 text-primary inline" />}
                {!isHistorical && (
                  <button
                    type="button"
                    className="ml-auto inline-flex items-center gap-1 text-[10px] room-meta-text hover:text-primary"
                    onClick={() => {
                      if (isBlocked) {
                        toast.error(isRemoved ? "Вы удалены из комнаты модератором" : "Вы заглушены модератором");
                        return;
                      }
                      setReplyingTo({ id: q.id, userId: q.user_id, name: displayName });
                    }}
                    aria-label={`Ответить ${displayName}`}
                  >
                    <Reply className="h-3 w-3" />
                    Ответить
                  </button>
                )}
                {!isHistorical && <LiveInlineModeration
                    liveEventId={liveEventId}
                    messageId={q.id}
                    messageUserId={q.user_id}
                    messageTable="live_event_questions"
                    onOpenProfile={onOpenProfile}
                  />}
              </div>
              <p className="text-sm room-message-text break-words whitespace-pre-wrap">{normalizeEmoji(q.content, emojiNormalizationEnabled)}</p>
              {isStaff && !isHistorical && (
                <button
                  className="text-[10px] room-meta-text hover:text-primary mt-0.5"
                  onClick={() => toggleAnsweredMutation.mutate({ id: q.id, is_answered: !q.is_answered })}
                >
                  {q.is_answered ? "Снять отметку" : "Отметить как отвечен"}
                </button>
              )}
            </div>
          </div>
          {!isHistorical && replyingTo?.id === q.id && (
            <div className="ml-6 mt-1">
              <LiveEventReplyForm
                liveEventId={liveEventId}
                sourceQuestionId={q.id}
                targetUserId={q.user_id}
                targetDisplayName={displayName}
                onClose={() => setReplyingTo(null)}
              />
            </div>
          )}
          <LiveEventReplyActivity
            replies={questionRepliesBySource.get(q.id) ?? []}
            sourceTextById={questionTextById}
          />
        </div>
      );
    };

    // Sectioning (только для staff, который видит много чужих вопросов).
    // Обычный участник видит максимум свои — секции бессмысленны.
    const unanswered = (questions ?? []).filter((q) => !q.is_answered);
    const answered = (questions ?? []).filter((q) => q.is_answered);

    return (
      <div ref={ref} className="relative flex flex-col h-full min-h-0 room-panel">
        <div ref={scrollRef} data-room-messages-scroll className="room-messages-scroll flex-1 min-h-0 overflow-y-auto space-y-1 p-3 overscroll-contain">
          {/* Privacy hint: точная формулировка контракта (RLS-backed). */}
          <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1.5 text-xs text-muted-foreground mb-2">
            <Lock className="h-3 w-3 shrink-0" />
            <span>
              {isStaff
                ? "Вопросы видны только вам и другим модераторам / ведущему."
                : "Ваш вопрос увидят только модераторы и ведущий. Чужие вопросы вам не видны."}
            </span>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !questions?.length ? (
            <p className="text-sm room-meta-text text-center py-4">Пока нет вопросов</p>
          ) : isStaff ? (
            <>
              {unanswered.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wide room-meta-text mt-1 mb-1">
                    Неотвеченные ({unanswered.length})
                  </div>
                  {unanswered.map(renderQuestion)}
                </>
              )}
              {answered.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wide room-meta-text mt-3 mb-1">
                    Отвеченные ({answered.length})
                  </div>
                  {answered.map(renderQuestion)}
                </>
              )}
            </>
          ) : (
            questions.map(renderQuestion)
          )}
        </div>

        {/* M1.1: «Новые вопросы» pill — only when user scrolled away from bottom and new arrived. */}
        {hasNewBelow && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--room-composer-h,64px)+12px)] lg:bottom-20 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs shadow-lg hover:opacity-90 transition-opacity"
            aria-label="Перейти к новым вопросам"
          >
            <ArrowDown className="h-3 w-3" />
            Новые вопросы
          </button>
        )}

        {user && (
          <div className="room-composer border-t lg:sticky lg:bottom-0 z-10 room-panel-sticky">
            <LiveModerationBanner isMuted={isMuted} isRemoved={isRemoved} />
            {/* K1: убран дублирующий env(safe-area-inset-bottom) — safe-area уже учтён
                на внешнем .room-composer через bottom: max(safe-area, vv-offset). */}
            <div className="flex gap-2 items-end p-3 room-panel-input">
              <LiveAutoGrowTextarea
                value={newQuestion}
                onChange={setNewQuestion}
                onSubmit={handleSend}
                placeholder={
                  isRemoved
                    ? "Вы удалены из комнаты"
                    : isMuted
                    ? "Вы заглушены модератором"
                    : "Задать анонимный вопрос..."
                }
                maxHeight={160}
                className="flex-1"
                disabled={isBlocked}
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={handleSend}
                disabled={!newQuestion.trim() || sendMutation.isPending || isBlocked}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
