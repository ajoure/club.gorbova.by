import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Send, ArrowDown, SmilePlus, Reply } from "lucide-react";
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
import { useStaffNameMap } from "@/hooks/useStaffNameMap";
import { useLiveEventCommentReactions, useToggleLiveEventCommentReaction } from "@/hooks/useLiveEventCommentReactions";
import { LiveEventCommentReactions } from "./LiveEventCommentReactions";
import { TELEGRAM_REACTION_EMOJIS } from "@/lib/telegramReactionEmojis";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Comment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  author_display_name: string | null;
  author_role: string | null;
  author_avatar_url: string | null;
  author_nickname_color: string | null;
  // Legacy fallback: только avatar_url используется (snapshot — SoT для имени).
  profile?: { avatar_url: string | null } | null;
}

interface LiveEventCommentsProps {
  liveEventId: string;
  presenterUserId?: string | null;
  onOpenProfile?: (userId: string) => void;
  /**
   * Sprint B: для autowebinar event_type обязателен session_id.
   * Если передан — записывается в metadata.session_id и клиент валидирует
   * наличие до submit. Для legacy live_stream/recorded_webinar — undefined.
   */
  autowebSessionId?: string | null;
  /** Sprint final: render-time emoji normalization toggle. */
  emojiNormalizationEnabled?: boolean;
  /**
   * Autoweb timed-replay: id исходного live_stream, чья историческая лента
   * проигрывается синхронно с видео. Если задан вместе с historySourceStartedAt —
   * компонент подтягивает комментарии этого события read-only и показывает
   * только те, чьё created_at−sourceStartedAt <= currentPlaybackSeconds.
   * Новые сообщения продолжают писаться под liveEventId (текущий автовеб).
   */
  historySourceEventId?: string;
  historySourceStartedAt?: string;
  /** Start of the current autoweb session; used for unified display_at order. */
  autowebSessionStartedAt?: string;
  currentPlaybackSeconds?: number;
  /** Для staff — визуально помечать источник (history/live) значком. */
  staffSourceIndicator?: boolean;
}

export function LiveEventComments({
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
}: LiveEventCommentsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; userId: string; name: string } | null>(null);
  const isStaffViewer = !!onOpenProfile;
  const staffNameMap = useStaffNameMap(liveEventId, isStaffViewer);
  const { data: liveReplies = [] } = useLiveEventReplies(liveEventId);

  // Live (текущий автовеб) — новые комментарии зрителей идут сюда.
  const { data: liveComments, isLoading } = useQuery({
    queryKey: ["live-event-comments", liveEventId, autowebSessionId ?? "legacy"],
    queryFn: async () => {
      let commentsQuery = supabase
        .from("live_event_comments")
        .select("id, user_id, content, created_at, author_display_name, author_role, author_avatar_url, author_nickname_color")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (autowebSessionId) {
        commentsQuery = commentsQuery.eq("metadata->>session_id", autowebSessionId);
      }
      const { data: rawDesc, error } = await commentsQuery;
      if (error) throw error;
      const data = (rawDesc || []).slice().reverse();

      const needsAvatarFallback = (data || []).filter(c => !c.author_avatar_url);
      let profiles: Record<string, { avatar_url: string | null }> = {};
      if (needsAvatarFallback.length > 0) {
        const userIds = [...new Set(needsAvatarFallback.map(c => c.user_id))];
        const { data: profileData } = await supabase
          .from("profiles")
          .select("user_id, avatar_url")
          .in("user_id", userIds);
        for (const p of profileData || []) {
          profiles[p.user_id] = { avatar_url: p.avatar_url };
        }
      }

      return (data || []).map(c => ({
        ...c,
        profile: profiles[c.user_id] || null,
      })) as Comment[];
    },
  });

  // Historical (исходный live_stream) — read-only, для timed-replay.
  const historyEnabled = !!historySourceEventId && !!historySourceStartedAt;
  const { data: historyComments } = useQuery({
    queryKey: ["live-event-comments-history", historySourceEventId, autowebSessionId ?? "none"],
    enabled: historyEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!autowebSessionId) return [] as Comment[];
      const { data, error } = await supabase.rpc("autoweb_history_comments_list", {
        _session_id: autowebSessionId,
        _source_event_id: historySourceEventId!,
      });
      if (error) throw error;

      const needsAvatarFallback = (data || []).filter(c => !c.author_avatar_url);
      let profiles: Record<string, { avatar_url: string | null }> = {};
      if (needsAvatarFallback.length > 0) {
        const userIds = [...new Set(needsAvatarFallback.map(c => c.user_id))];
        const { data: profileData } = await supabase
          .from("profiles")
          .select("user_id, avatar_url")
          .in("user_id", userIds);
        for (const p of profileData || []) {
          profiles[p.user_id] = { avatar_url: p.avatar_url };
        }
      }
      return (data || []).map(c => ({
        ...c,
        profile: profiles[c.user_id] || null,
      })) as Comment[];
    },
  });

  // Unified feed: timed-replay history + live, отсортированные по display_at.
  const sourceStartedMs = historyEnabled ? new Date(historySourceStartedAt!).getTime() : 0;
  const cutoffMs = historyEnabled
    ? sourceStartedMs + Math.max(0, currentPlaybackSeconds ?? 0) * 1000
    : 0;
  const comments = useMemo<Comment[]>(() => {
    if (!historyEnabled) return liveComments ?? [];
    const cut = cutoffMs;
    const historicalVisible = (historyComments ?? []).filter(
      (c) => new Date(c.created_at).getTime() <= cut,
    );
    const sessionStartedMs = autowebSessionStartedAt
      ? new Date(autowebSessionStartedAt).getTime()
      : sourceStartedMs;
    // `display_at` is session-relative for source history and real created_at
    // for new autoweb messages. Sorting only by the historical source clock
    // would incorrectly place a prior live stream before this new session.
    return [
      ...historicalVisible.map((comment) => ({
        comment,
        displayAt: sessionStartedMs + (new Date(comment.created_at).getTime() - sourceStartedMs),
      })),
      ...(liveComments ?? []).map((comment) => ({
        comment,
        displayAt: new Date(comment.created_at).getTime(),
      })),
    ]
      .sort((a, b) => a.displayAt - b.displayAt)
      .map(({ comment }) => comment);
  }, [historyEnabled, liveComments, historyComments, cutoffMs, autowebSessionStartedAt, sourceStartedMs]);
  const historicalCommentIds = useMemo(
    () => new Set((historyComments ?? []).map((comment) => comment.id)),
    [historyComments],
  );
  const commentTextById = useMemo(
    () => new Map(comments.map((comment) => [comment.id, comment.content])),
    [comments],
  );
  const commentReplies = useMemo(
    () => liveReplies.filter((reply) => !!reply.source_comment_id && commentTextById.has(reply.source_comment_id)),
    [liveReplies, commentTextById],
  );

  // Reactions are available only for the actual room messages. Source history
  // is deliberately read-only in an autowebinar and must never be mutated.
  const liveCommentIds = useMemo(
    () => (liveComments ?? []).map((comment) => comment.id),
    [liveComments],
  );
  const { data: commentReactions } = useLiveEventCommentReactions(liveCommentIds);
  const toggleCommentReaction = useToggleLiveEventCommentReaction();



  // Realtime subscription
  useEffect(() => {
    const uniq = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
    const channel = supabase
      .channel(`live-comments-${liveEventId}-${uniq}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_event_comments",
          filter: `live_event_id=eq.${liveEventId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["live-event-comments", liveEventId, autowebSessionId ?? "legacy"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [liveEventId, autowebSessionId, queryClient]);

  // M1.1: smart auto-scroll — only follow if user is already near bottom; otherwise show pill.
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

  // First load — jump to bottom; new messages — follow only if near bottom, else show pill.
  useEffect(() => {
    const count = (comments?.length ?? 0) + commentReplies.length;
    const prev = lastCountRef.current;
    if (count === 0) {
      lastCountRef.current = 0;
      return;
    }
    if (prev === 0) {
      // initial load
      requestAnimationFrame(() => scrollToBottom(false));
    } else if (count > prev) {
      if (wasNearBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom(true));
      } else {
        setHasNewBelow(true);
      }
    }
    lastCountRef.current = count;
  }, [comments, commentReplies.length, scrollToBottom]);

  const { isMuted, isRemoved } = useRoomModerationState(liveEventId, user?.id);
  const isBlocked = isMuted || isRemoved;

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      // Sprint B: если prop autowebSessionId передан (autowebinar room) — обязателен.
      // Server-side trigger продублирует проверку.
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
      const { error } = await supabase.from("live_event_comments").insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setNewComment("");
      queryClient.invalidateQueries({ queryKey: ["live-event-comments", liveEventId, autowebSessionId ?? "legacy"] });
    },
    onError: (err: any) => {
      // Server-side RLS will reject if user is muted/removed; surface a clear message.
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
      // Refresh state in case it changed in another tab.
      queryClient.invalidateQueries({
        queryKey: ["live-user-mod-state", liveEventId, user?.id],
      });
    },
  });

  const handleSend = () => {
    if (!newComment.trim() || !user) return;
    if (isBlocked) {
      toast.error(
        isRemoved
          ? "Вы удалены из комнаты модератором"
          : "Вы заглушены модератором",
      );
      return;
    }
    sendMutation.mutate(newComment.trim());
  };

  const handleEmojiInsert = (emoji: string) => {
    setNewComment((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${emoji}`);
  };

  const handleToggleCommentReaction = (commentId: string, emoji: string) => {
    if (!user) {
      toast.error("Войдите, чтобы реагировать");
      return;
    }
    if (isBlocked) {
      toast.error(isRemoved ? "Вы удалены из комнаты модератором" : "Вы заглушены модератором");
      return;
    }
    toggleCommentReaction.mutate(
      { commentId, emoji },
      { onError: () => toast.error("Не удалось изменить реакцию") },
    );
  };

  const resolveDisplayRole = (c: Comment): AuthorRole | string | null => {
    // Visual presenter label is derived from live_events.metadata.presenter_user_id.
    // Auth role is unaffected; this is UI-only.
    if (presenterUserId && c.user_id === presenterUserId) return "presenter";
    return c.author_role;
  };

  return (
    <div className="relative flex flex-col h-full min-h-0 room-panel">
      <div ref={scrollRef} data-room-messages-scroll className="room-messages-scroll flex-1 min-h-0 overflow-y-auto space-y-1 p-3 overscroll-contain">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !comments?.length ? (
          <p className="text-sm room-meta-text text-center py-4">Пока нет комментариев</p>
        ) : (
          comments.map((comment) => {
            const isHistorical = historicalCommentIds.has(comment.id);
            const display = resolveParticipantDisplay({
              user_id: comment.user_id,
              author_display_name: comment.author_display_name,
              author_avatar_url: comment.author_avatar_url,
              legacy_avatar_url: comment.profile?.avatar_url ?? null,
              viewerIsStaff: isStaffViewer,
              staff_real_name: isStaffViewer ? staffNameMap.get(comment.user_id) ?? null : null,
            });
            const displayName = display.displayName;
            const avatarUrl = display.avatarUrl;
            const initials = display.initials;
            const displayRole = resolveDisplayRole(comment);
            const isOwn = user?.id === comment.user_id;
            const highlight = resolveMessageHighlight({ isOwn, role: displayRole });
            // SECURITY: onOpenProfile передаётся ТОЛЬКО если isStaff===true (см. LiveEvent.tsx).
            // Для non-staff handler === undefined → нет onClick/cursor-pointer/aria-button.
            // Политика: mem://security/access-control/webinar-staff-action-guards.
            const canOpenProfile = !!onOpenProfile;
            return (
              <div key={comment.id} className="group">
                <div className={`flex gap-2 rounded-lg p-2 ${highlight}`}>
                  <Avatar
                    className={`h-7 w-7 shrink-0 ${canOpenProfile ? "cursor-pointer" : ""}`}
                    onClick={canOpenProfile ? () => onOpenProfile!(comment.user_id) : undefined}
                  >
                    {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
                    <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-xs font-medium room-message-text ${canOpenProfile ? "cursor-pointer hover:underline" : ""}`}
                        style={comment.author_nickname_color ? { color: comment.author_nickname_color } : undefined}
                        onClick={canOpenProfile ? () => onOpenProfile!(comment.user_id) : undefined}
                      >
                        {displayName}
                        {isOwn && <span className="ml-1 text-[10px] text-primary">(вы)</span>}
                      </span>
                      <LiveRoleBadge role={displayRole} />
                      {staffSourceIndicator && isHistorical && <Badge variant="outline" className="text-[9px] px-1 py-0">История</Badge>}
                      <span className="text-[10px] room-meta-text">{format(new Date(comment.created_at), "HH:mm", { locale: ru })}</span>
                      {!isHistorical && (
                        <button
                          type="button"
                          className="ml-auto inline-flex items-center gap-1 text-[10px] room-meta-text hover:text-primary"
                          onClick={() => {
                            if (isBlocked) {
                              toast.error(isRemoved ? "Вы удалены из комнаты модератором" : "Вы заглушены модератором");
                              return;
                            }
                            setReplyingTo({ id: comment.id, userId: comment.user_id, name: displayName });
                          }}
                          aria-label={`Ответить ${displayName}`}
                        >
                          <Reply className="h-3 w-3" />
                          Ответить
                        </button>
                      )}
                      {!isHistorical && <LiveInlineModeration
                          liveEventId={liveEventId}
                          messageId={comment.id}
                          messageUserId={comment.user_id}
                          messageTable="live_event_comments"
                          onOpenProfile={onOpenProfile}
                        />}
                    </div>
                    <p className="text-sm room-message-text break-words whitespace-pre-wrap">{normalizeEmoji(comment.content, emojiNormalizationEnabled)}</p>
                  </div>
                </div>
                {!isHistorical && (
                  <LiveEventCommentReactions
                    reactions={commentReactions?.[comment.id]}
                    disabled={toggleCommentReaction.isPending || isBlocked}
                    onToggle={(emoji) => handleToggleCommentReaction(comment.id, emoji)}
                  />
                )}
                {/* Inline reply form */}
                {!isHistorical && replyingTo?.id === comment.id && (
                  <div className="ml-6 mt-1">
                    <LiveEventReplyForm
                      liveEventId={liveEventId}
                      sourceCommentId={comment.id}
                      targetUserId={comment.user_id}
                      targetDisplayName={displayName}
                      onClose={() => setReplyingTo(null)}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
        <LiveEventReplyActivity replies={commentReplies} sourceTextById={commentTextById} />
      </div>

      {/* M1.1: «Новые сообщения» pill — only when user scrolled away from bottom and new arrived. */}
      {hasNewBelow && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--room-composer-h,64px)+12px)] lg:bottom-20 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs shadow-lg hover:opacity-90 transition-opacity"
          aria-label="Перейти к новым сообщениям"
        >
          <ArrowDown className="h-3 w-3" />
          Новые сообщения
        </button>
      )}

      {user && (
        <div className="room-composer border-t lg:sticky lg:bottom-0 z-10 room-panel-sticky">
          <LiveModerationBanner isMuted={isMuted} isRemoved={isRemoved} />
          {/* K1: убран дублирующий env(safe-area-inset-bottom) — safe-area уже учтён
              на внешнем .room-composer через bottom: max(safe-area, vv-offset). */}
          <div className="flex gap-2 items-end p-3 room-panel-input">
            <LiveAutoGrowTextarea
              value={newComment}
              onChange={setNewComment}
              onSubmit={handleSend}
              placeholder={
                isRemoved
                  ? "Вы удалены из комнаты"
                  : isMuted
                  ? "Вы заглушены модератором"
                  : "Написать комментарий..."
              }
              maxHeight={120}
              className="flex-1"
              disabled={isBlocked}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={isBlocked}
                  aria-label="Добавить эмодзи в комментарий"
                >
                  <SmilePlus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[320px] p-2" side="top" align="end">
                <div className="grid grid-cols-10 gap-1" aria-label="Выбор эмодзи">
                  {TELEGRAM_REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleEmojiInsert(emoji)}
                      className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors hover:bg-accent focus:bg-accent"
                      aria-label={`Добавить ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleSend}
              disabled={!newComment.trim() || sendMutation.isPending || isBlocked}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
