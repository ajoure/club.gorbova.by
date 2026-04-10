import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { LiveRoleBadge, getMessageHighlightClass } from "./LiveRoleBadge";
import { LiveEventReplyForm, LiveEventRepliesList } from "./LiveEventReplies";
import { LiveInlineModeration } from "./LiveInlineModeration";

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
  onOpenProfile?: (userId: string) => void;
}

export function LiveEventQuestions({ liveEventId, onOpenProfile }: LiveEventQuestionsProps) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [newQuestion, setNewQuestion] = useState("");
  const isAdmin = role === "admin" || role === "superadmin";
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
    sendMutation.mutate(newQuestion.trim());
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-1 p-3">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !questions?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Пока нет вопросов</p>
        ) : (
          questions.map((q) => {
            const displayName = resolveDisplayName(q);
            const initials = getInitials(displayName);
            return (
              <div key={q.id}>
                <div className={`flex gap-2 group rounded-lg p-2 ${q.is_answered ? "bg-muted/30" : ""} ${getMessageHighlightClass(q.author_role)}`}>
                  <Avatar
                    className="h-7 w-7 shrink-0 cursor-pointer"
                    onClick={() => onOpenProfile?.(q.user_id)}
                  >
                    <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="text-xs font-medium cursor-pointer hover:underline"
                        onClick={() => onOpenProfile?.(q.user_id)}
                      >
                        {displayName}
                      </span>
                      <LiveRoleBadge role={q.author_role} />
                      <span className="text-[10px] text-muted-foreground">{format(new Date(q.created_at), "HH:mm", { locale: ru })}</span>
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
                    <p className="text-sm break-words">{q.content}</p>
                    {/* Admin: toggle answered inline */}
                    {isAdmin && (
                      <button
                        className="text-[10px] text-muted-foreground hover:text-primary mt-0.5"
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
        <div className="flex gap-2 p-3 border-t bg-card sticky bottom-0 z-10" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <Input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Задать вопрос ведущему..."
            className="text-sm"
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          />
          <Button size="icon" variant="ghost" onClick={handleSend} disabled={!newQuestion.trim() || sendMutation.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
