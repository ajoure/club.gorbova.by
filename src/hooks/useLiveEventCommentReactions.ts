import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type LiveCommentReaction = {
  emoji: string;
  count: number;
  userReacted: boolean;
};

export type LiveCommentReactionsMap = Record<string, LiveCommentReaction[]>;

function buildReactionMap(
  rows: Array<{ comment_id: string; emoji: string; reaction_count: number; user_reacted: boolean }>,
): LiveCommentReactionsMap {
  const result: LiveCommentReactionsMap = {};
  for (const row of rows) {
    const reactions = result[row.comment_id] ?? (result[row.comment_id] = []);
    reactions.push({
      emoji: row.emoji,
      count: Number(row.reaction_count),
      userReacted: row.user_reacted,
    });
  }

  for (const reactions of Object.values(result)) {
    reactions.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
  }
  return result;
}

/** Reactions are queried only for currently writable room comments, never source history. */
export function useLiveEventCommentReactions(commentIds: string[]) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const viewerId = user?.id ?? null;
  const stableIds = useMemo(
    () => [...new Set(commentIds.filter(Boolean))].sort(),
    [commentIds],
  );
  const idsKey = stableIds.join(",");

  const query = useQuery({
    queryKey: ["live-event-comment-reactions", idsKey, viewerId],
    enabled: stableIds.length > 0 && !!viewerId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "live_event_comment_reaction_summary",
        { _comment_ids: stableIds },
      );
      if (error) throw error;
      return buildReactionMap((data as Array<{
        comment_id: string;
        emoji: string;
        reaction_count: number;
        user_reacted: boolean;
      }>) ?? []);
    },
  });

  useEffect(() => {
    if (!idsKey || !viewerId) return;
    const channel = supabase
      .channel(`live-comment-reactions:${viewerId}:${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_event_comment_reactions" },
        () => queryClient.invalidateQueries({ queryKey: ["live-event-comment-reactions"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [idsKey, viewerId, queryClient]);

  return query;
}

export function useToggleLiveEventCommentReaction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ commentId, emoji }: { commentId: string; emoji: string }) => {
      if (!user?.id) throw new Error("auth_required");
      const { data: existing, error: lookupError } = await supabase
        .from("live_event_comment_reactions" as any)
        .select("id")
        .eq("comment_id", commentId)
        .eq("user_id", user.id)
        .eq("emoji", emoji)
        .maybeSingle();
      if (lookupError) throw lookupError;

      if (existing?.id) {
        const { error } = await supabase
          .from("live_event_comment_reactions" as any)
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("live_event_comment_reactions" as any)
          .insert({ comment_id: commentId, user_id: user.id, emoji });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["live-event-comment-reactions"] }),
  });
}
