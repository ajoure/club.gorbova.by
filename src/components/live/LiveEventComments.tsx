import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, Send, Trash2, Reply } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { LiveRoleBadge, getMessageHighlightClass } from "./LiveRoleBadge";
import { LiveEventReplyForm, LiveEventRepliesList } from "./LiveEventReplies";

interface Comment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  author_display_name: string | null;
  author_role: string | null;
  profile?: { full_name: string | null; first_name: string | null; last_name: string | null } | null;
}

function resolveDisplayName(comment: Comment): string {
  if (comment.author_display_name) return comment.author_display_name;
  const p = comment.profile;
  if (p?.full_name) return p.full_name;
  const parts = [p?.first_name, p?.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return "Пользователь";
}

function getInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "") || "?";
}

export function LiveEventComments({ liveEventId }: { liveEventId: string }) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAdmin = role === "admin" || role === "superadmin";
  const isStaff = isAdmin || role === "employee";
  const [replyingTo, setReplyingTo] = useState<{ id: string; userId: string; name: string } | null>(null);

  const { data: comments, isLoading } = useQuery({
    queryKey: ["live-event-comments", liveEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_event_comments")
        .select("id, user_id, content, created_at, author_display_name, author_role")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;

      const legacyComments = (data || []).filter(c => !c.author_display_name);
      let profiles: Record<string, { full_name: string | null; first_name: string | null; last_name: string | null }> = {};
      if (legacyComments.length > 0) {
        const userIds = [...new Set(legacyComments.map(c => c.user_id))];
        const { data: profileData } = await supabase
          .from("profiles")
          .select("user_id, full_name, first_name, last_name")
          .in("user_id", userIds);
        for (const p of profileData || []) {
          profiles[p.user_id] = { full_name: p.full_name, first_name: p.first_name, last_name: p.last_name };
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

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-1 p-3">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !comments?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Пока нет комментариев</p>
        ) : (
          comments.map((comment) => {
            const displayName = resolveDisplayName(comment);
            const initials = getInitials(displayName);
            return (
              <div key={comment.id}>
                <div className={`flex gap-2 group rounded-lg p-2 ${getMessageHighlightClass(comment.author_role)}`}>
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium text-foreground">{displayName}</span>
                      <LiveRoleBadge role={comment.author_role} />
                      <span className="text-[10px] text-muted-foreground">{format(new Date(comment.created_at), "HH:mm", { locale: ru })}</span>
                      {isStaff && (
                        <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity ml-auto">
                          <button
                            onClick={() => setReplyingTo({ id: comment.id, userId: comment.user_id, name: displayName })}
                            title="Ответить"
                          >
                            <Reply className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                          </button>
                          {isAdmin && (
                            <button onClick={() => deleteMutation.mutate(comment.id)}>
                              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-foreground break-words">{comment.content}</p>
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
        <div className="flex gap-2 p-3 border-t bg-card sticky bottom-0 z-10" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
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
