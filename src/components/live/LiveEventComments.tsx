import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, Send, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface Comment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profile?: { first_name: string | null; last_name: string | null } | null;
}

export function LiveEventComments({ liveEventId }: { liveEventId: string }) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAdmin = role === "admin" || role === "superadmin";

  const { data: comments, isLoading } = useQuery({
    queryKey: ["live-event-comments", liveEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_event_comments")
        .select("id, user_id, content, created_at")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;

      // Fetch profiles for comments
      const userIds = [...new Set((data || []).map(c => c.user_id))];
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

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase.from("live_event_comments").insert({
        live_event_id: liveEventId,
        user_id: user!.id,
        content,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setNewComment("");
      queryClient.invalidateQueries({ queryKey: ["live-event-comments", liveEventId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase.from("live_event_comments").delete().eq("id", commentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live-event-comments", liveEventId] });
    },
  });

  const handleSend = () => {
    if (!newComment.trim() || !user) return;
    sendMutation.mutate(newComment.trim());
  };

  const getInitials = (comment: Comment) => {
    const fn = comment.profile?.first_name || "";
    const ln = comment.profile?.last_name || "";
    return (fn[0] || "") + (ln[0] || "") || "?";
  };

  const getName = (comment: Comment) => {
    const parts = [comment.profile?.first_name, comment.profile?.last_name].filter(Boolean);
    return parts.join(" ") || "Пользователь";
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 p-3 max-h-[400px]">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !comments?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Пока нет комментариев</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="flex gap-2 group">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="text-[10px]">{getInitials(comment)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-foreground">{getName(comment)}</span>
                  <span className="text-[10px] text-muted-foreground">{format(new Date(comment.created_at), "HH:mm", { locale: ru })}</span>
                  {isAdmin && (
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => deleteMutation.mutate(comment.id)}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  )}
                </div>
                <p className="text-sm text-foreground break-words">{comment.content}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {user && (
        <div className="flex gap-2 p-3 border-t">
          <Input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Написать комментарий..."
            className="text-sm"
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          />
          <Button size="icon" variant="ghost" onClick={handleSend} disabled={!newComment.trim() || sendMutation.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
