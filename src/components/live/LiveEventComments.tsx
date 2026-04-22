import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Send } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  LiveRoleBadge,
  resolveMessageHighlight,
  type AuthorRole,
} from "./LiveRoleBadge";
import { LiveEventReplyForm, LiveEventRepliesList } from "./LiveEventReplies";
import { LiveInlineModeration } from "./LiveInlineModeration";
import { LiveAutoGrowTextarea } from "./LiveAutoGrowTextarea";
import { LiveModerationBanner } from "./LiveModerationBanner";
import { useRoomModerationState } from "@/hooks/useRoomModerationState";
import { toast } from "sonner";
import { resolveParticipantDisplay } from "@/lib/participantDisplay";
import { normalizeEmoji } from "@/lib/normalizeEmoji";
import { useStaffNameMap } from "@/hooks/useStaffNameMap";

interface Comment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  author_display_name: string | null;
  author_role: string | null;
  author_avatar_url: string | null;
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
}

export function LiveEventComments({ liveEventId, presenterUserId, onOpenProfile, autowebSessionId, emojiNormalizationEnabled = true }: LiveEventCommentsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; userId: string; name: string } | null>(null);
  // Staff display rule: ФИО приходит ТОЛЬКО из RPC get_room_participants.
  // onOpenProfile передаётся ТОЛЬКО при isStaff (см. LiveEvent.tsx) — используем как маркер.
  const isStaffViewer = !!onOpenProfile;
  const staffNameMap = useStaffNameMap(liveEventId, isStaffViewer);

  const { data: comments, isLoading } = useQuery({
    queryKey: ["live-event-comments", liveEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_event_comments")
        .select("id, user_id, content, created_at, author_display_name, author_role, author_avatar_url")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;

      // Legacy fallback: тянем ТОЛЬКО avatar_url, имя берётся из snapshot (см. resolveDisplayName).
      // Минимизация данных: никаких email/phone/admin-данных в participant-facing UI.
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

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`live-comments-${liveEventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_event_comments",
          filter: `live_event_id=eq.${liveEventId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["live-event-comments", liveEventId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [liveEventId, queryClient]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments]);

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
      queryClient.invalidateQueries({ queryKey: ["live-event-comments", liveEventId] });
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

  const resolveDisplayRole = (c: Comment): AuthorRole | string | null => {
    // Visual presenter label is derived from live_events.metadata.presenter_user_id.
    // Auth role is unaffected; this is UI-only.
    if (presenterUserId && c.user_id === presenterUserId) return "presenter";
    return c.author_role;
  };

  return (
    <div className="flex flex-col h-full min-h-0 room-panel">
      <div ref={scrollRef} className="room-messages-scroll flex-1 min-h-0 overflow-y-auto space-y-1 p-3 overscroll-contain">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !comments?.length ? (
          <p className="text-sm room-meta-text text-center py-4">Пока нет комментариев</p>
        ) : (
          comments.map((comment) => {
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
              <div key={comment.id}>
                <div className={`flex gap-2 group rounded-lg p-2 ${highlight}`}>
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
                        onClick={canOpenProfile ? () => onOpenProfile!(comment.user_id) : undefined}
                      >
                        {displayName}
                        {isOwn && <span className="ml-1 text-[10px] text-primary">(вы)</span>}
                      </span>
                      <LiveRoleBadge role={displayRole} />
                      <span className="text-[10px] room-meta-text">{format(new Date(comment.created_at), "HH:mm", { locale: ru })}</span>
                      <LiveInlineModeration
                        liveEventId={liveEventId}
                        messageId={comment.id}
                        messageUserId={comment.user_id}
                        messageTable="live_event_comments"
                        onReply={() => setReplyingTo({ id: comment.id, userId: comment.user_id, name: displayName })}
                        onOpenProfile={onOpenProfile}
                      />
                    </div>
                    <p className="text-sm room-message-text break-words whitespace-pre-wrap">{normalizeEmoji(comment.content, emojiNormalizationEnabled)}</p>
                  </div>
                </div>
                {/* Threaded replies */}
                <LiveEventRepliesList
                  liveEventId={liveEventId}
                  sourceCommentId={comment.id}
                />
                {/* Inline reply form */}
                {replyingTo?.id === comment.id && (
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
      </div>

      {user && (
        <div className="room-composer border-t lg:sticky lg:bottom-0 z-10 room-panel-sticky">
          <LiveModerationBanner isMuted={isMuted} isRemoved={isRemoved} />
          <div
            className="flex gap-2 items-end p-3 room-panel-input"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
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
