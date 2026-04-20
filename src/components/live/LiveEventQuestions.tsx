import { useState, useEffect, forwardRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
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

interface Question {
  id: string;
  user_id: string;
  content: string;
  is_answered: boolean;
  created_at: string;
  author_display_name: string | null;
  author_role: string | null;
  profile?: { full_name: string | null; first_name: string | null; last_name: string | null } | null;
}

function resolveDisplayName(q: Question): string {
  if (q.author_display_name) return q.author_display_name;
  const p = q.profile;
  if (p?.full_name) return p.full_name;
  const parts = [p?.first_name, p?.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return "Пользователь";
}

function getInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "") || "?";
}

interface LiveEventQuestionsProps {
  liveEventId: string;
  presenterUserId?: string | null;
  onOpenProfile?: (userId: string) => void;
}

// forwardRef to satisfy Tabs/Radix ref forwarding (fixes console warning).
export const LiveEventQuestions = forwardRef<HTMLDivElement, LiveEventQuestionsProps>(
  function LiveEventQuestions({ liveEventId, presenterUserId, onOpenProfile }, ref) {
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
          .select("id, user_id, content, is_answered, created_at, author_display_name, author_role")
          .eq("live_event_id", liveEventId)
          .order("created_at", { ascending: true })
          .limit(200);
        if (error) throw error;

        const legacy = (data || []).filter(q => !q.author_display_name);
        let profiles: Record<string, { full_name: string | null; first_name: string | null; last_name: string | null }> = {};
        if (legacy.length > 0) {
          const userIds = [...new Set(legacy.map(q => q.user_id))];
          const { data: profileData } = await supabase
            .from("profiles")
            .select("user_id, full_name, first_name, last_name")
            .in("user_id", userIds);
          for (const p of profileData || []) {
            profiles[p.user_id] = { full_name: p.full_name, first_name: p.first_name, last_name: p.last_name };
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
        const { error } = await supabase.from("live_event_questions").insert({
          live_event_id: liveEventId,
          user_id: user!.id,
          content,
        } as any);
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
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !questions?.length ? (
            <p className="text-sm room-meta-text text-center py-4">Пока нет вопросов</p>
          ) : (
            questions.map((q) => {
              const displayName = resolveDisplayName(q);
              const initials = getInitials(displayName);
              const displayRole = resolveDisplayRole(q);
              const isOwn = user?.id === q.user_id;
              const highlight = resolveMessageHighlight({ isOwn, role: displayRole });
              return (
                <div key={q.id}>
                  <div className={`flex gap-2 group rounded-lg p-2 ${q.is_answered ? "opacity-70" : ""} ${highlight}`}>
                    <Avatar
                      className="h-7 w-7 shrink-0 cursor-pointer"
                      onClick={() => onOpenProfile?.(q.user_id)}
                    >
                      <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="text-xs font-medium room-message-text cursor-pointer hover:underline"
                          onClick={() => onOpenProfile?.(q.user_id)}
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
                    : "Задать вопрос ведущему..."
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
