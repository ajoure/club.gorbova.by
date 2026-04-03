import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, Send, CheckCircle2, Circle, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface Question {
  id: string;
  user_id: string;
  content: string;
  is_answered: boolean;
  created_at: string;
  profile?: { first_name: string | null; last_name: string | null } | null;
}

export function LiveEventQuestions({ liveEventId }: { liveEventId: string }) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [newQuestion, setNewQuestion] = useState("");
  const isAdmin = role === "admin" || role === "superadmin";

  const { data: questions, isLoading } = useQuery({
    queryKey: ["live-event-questions", liveEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_event_questions")
        .select("id, user_id, content, is_answered, created_at")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;

      const userIds = [...new Set((data || []).map(q => q.user_id))];
      let profiles: Record<string, { first_name: string | null; last_name: string | null }> = {};
      if (userIds.length > 0) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", userIds);
        for (const p of profileData || []) {
          profiles[p.id] = { first_name: p.first_name, last_name: p.last_name };
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("live_event_questions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["live-event-questions", liveEventId] }),
  });

  const handleSend = () => {
    if (!newQuestion.trim() || !user) return;
    sendMutation.mutate(newQuestion.trim());
  };

  const getName = (q: Question) => {
    const parts = [q.profile?.first_name, q.profile?.last_name].filter(Boolean);
    return parts.join(" ") || "Пользователь";
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 p-3 max-h-[400px]">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !questions?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Пока нет вопросов</p>
        ) : (
          questions.map((q) => (
            <div key={q.id} className={`flex gap-2 group rounded-lg p-2 ${q.is_answered ? "bg-muted/30" : ""}`}>
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="text-[10px]">
                  {(q.profile?.first_name?.[0] || "") + (q.profile?.last_name?.[0] || "") || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">{getName(q)}</span>
                  <span className="text-[10px] text-muted-foreground">{format(new Date(q.created_at), "HH:mm", { locale: ru })}</span>
                  {q.is_answered && <CheckCircle2 className="h-3 w-3 text-primary inline" />}
                  {isAdmin && (
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                      <button onClick={() => toggleAnsweredMutation.mutate({ id: q.id, is_answered: !q.is_answered })} title={q.is_answered ? "Снять отметку" : "Отметить как отвечен"}>
                        {q.is_answered ? <Circle className="h-3 w-3 text-muted-foreground" /> : <CheckCircle2 className="h-3 w-3 text-primary" />}
                      </button>
                      <button onClick={() => deleteMutation.mutate(q.id)}>
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-sm break-words">{q.content}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {user && (
        <div className="flex gap-2 p-3 border-t">
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
