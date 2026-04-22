import { useState, useEffect, forwardRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Send, CheckCircle2, Lock } from "lucide-react";
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

interface Question {
  id: string;
  user_id: string;
  content: string;
  is_answered: boolean;
  created_at: string;
  author_display_name: string | null;
  author_role: string | null;
  author_avatar_url: string | null;
  // Legacy fallback: только avatar_url (snapshot — SoT для имени).
  profile?: { avatar_url: string | null } | null;
}

interface LiveEventQuestionsProps {
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

// forwardRef to satisfy Tabs/Radix ref forwarding (fixes console warning).
export const LiveEventQuestions = forwardRef<HTMLDivElement, LiveEventQuestionsProps>(
  function LiveEventQuestions({ liveEventId, presenterUserId, onOpenProfile, autowebSessionId, emojiNormalizationEnabled = true }, ref) {
    const { user, role } = useAuth();
    const queryClient = useQueryClient();
    const [newQuestion, setNewQuestion] = useState("");
    const isStaff = role === "admin" || role === "superadmin" || role === "employee";
    const [replyingTo, setReplyingTo] = useState<{ id: string; userId: string; name: string } | null>(null);

    const { data: questions, isLoading } = useQuery({
      queryKey: ["live-event-questions", liveEventId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("live_event_questions")
          .select("id, user_id, content, is_answered, created_at, author_display_name, author_role, author_avatar_url")
          .eq("live_event_id", liveEventId)
          .order("created_at", { ascending: true })
          .limit(200);
        if (error) throw error;

        // Legacy fallback: тянем ТОЛЬКО avatar_url. Имя — из snapshot.
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

    // Realtime
    useEffect(() => {
      const channel = supabase
        .channel(`live-questions-${liveEventId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "live_event_questions", filter: `live_event_id=eq.${liveEventId}` },
          () => queryClient.invalidateQueries({ queryKey: ["live-event-questions", liveEventId] })
        )
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }, [liveEventId, queryClient]);

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
        queryClient.invalidateQueries({ queryKey: ["live-event-questions", liveEventId] });
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
        const { error } = await supabase.from("live_event_questions").update({ is_answered } as any).eq("id", id);
        if (error) throw error;
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["live-event-questions", liveEventId] }),
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

    return (
      <div ref={ref} className="flex flex-col h-full min-h-0 room-panel">
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 p-3 overscroll-contain">
          {/* Анонимность вопросов: hint всегда сверху */}
          <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1.5 text-xs text-muted-foreground mb-2">
            <Lock className="h-3 w-3 shrink-0" />
            <span>Анонимные вопросы. Их видят модераторы и ведущий.</span>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !questions?.length ? (
            <p className="text-sm room-meta-text text-center py-4">Пока нет вопросов</p>
          ) : (
            questions.map((q) => {
              const displayName = resolveDisplayName(q);
              const avatarUrl = resolveAvatarUrl(q);
              const initials = getInitials(displayName);
              const displayRole = resolveDisplayRole(q);
              const isOwn = user?.id === q.user_id;
              const highlight = resolveMessageHighlight({ isOwn, role: displayRole });
              // SECURITY: onOpenProfile передаётся ТОЛЬКО при isStaff (см. LiveEvent.tsx).
              // Для non-staff handler === undefined → нет onClick/cursor-pointer/aria-роли.
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
                          onClick={canOpenProfile ? () => onOpenProfile!(q.user_id) : undefined}
                        >
                          {displayName}
                          {isOwn && <span className="ml-1 text-[10px] text-primary">(вы)</span>}
                        </span>
                        <LiveRoleBadge role={displayRole} />
                        <span className="text-[10px] room-meta-text">{format(new Date(q.created_at), "HH:mm", { locale: ru })}</span>
                        {q.is_answered && <CheckCircle2 className="h-3 w-3 text-primary inline" />}
                        <LiveInlineModeration
                          liveEventId={liveEventId}
                          messageId={q.id}
                          messageUserId={q.user_id}
                          messageTable="live_event_questions"
                          onReply={() => setReplyingTo({ id: q.id, userId: q.user_id, name: displayName })}
                          onOpenProfile={onOpenProfile}
                        />
                      </div>
                      <p className="text-sm room-message-text break-words whitespace-pre-wrap">{q.content}</p>
                      {/* Admin: toggle answered inline */}
                      {isStaff && (
                        <button
                          className="text-[10px] room-meta-text hover:text-primary mt-0.5"
                          onClick={() => toggleAnsweredMutation.mutate({ id: q.id, is_answered: !q.is_answered })}
                        >
                          {q.is_answered ? "Снять отметку" : "Отметить как отвечен"}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Threaded replies */}
                  <LiveEventRepliesList
                    liveEventId={liveEventId}
                    sourceQuestionId={q.id}
                  />
                  {/* Inline reply form */}
                  {replyingTo?.id === q.id && (
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
                </div>
              );
            })
          )}
        </div>

        {user && (
          <div className="border-t sticky bottom-0 z-10 room-panel-sticky">
            <LiveModerationBanner isMuted={isMuted} isRemoved={isRemoved} />
            <div
              className="flex gap-2 items-end p-3 room-panel-input"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
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
