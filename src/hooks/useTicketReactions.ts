import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ReactionGroup {
  emoji: string;
  count: number;
  userReacted: boolean;
}

export interface MessageReactions {
  [messageId: string]: ReactionGroup[];
}

export function useTicketReactions(messageIds: string[]) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["ticket-reactions", messageIds],
    queryFn: async () => {
      if (!messageIds.length) return {} as MessageReactions;

      const { data, error } = await supabase
        .from("ticket_message_reactions")
        .select("message_id, emoji, user_id")
        .in("message_id", messageIds);

      if (error) throw error;

      const result: MessageReactions = {};
      for (const row of data || []) {
        if (!result[row.message_id]) result[row.message_id] = [];

        const existing = result[row.message_id].find((r) => r.emoji === row.emoji);
        if (existing) {
          existing.count++;
          if (row.user_id === user?.id) existing.userReacted = true;
        } else {
          result[row.message_id].push({
            emoji: row.emoji,
            count: 1,
            userReacted: row.user_id === user?.id,
          });
        }
      }
      return result;
    },
    enabled: messageIds.length > 0,
  });

  // Realtime subscription
  useEffect(() => {
    if (!messageIds.length) return;

    const channel = supabase
      .channel("ticket-reactions-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ticket_message_reactions" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["ticket-reactions"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [messageIds.length, queryClient]);

  return query;
}

export function useToggleReaction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      if (!user?.id) throw new Error("Not authenticated");

      // Check if reaction already exists
      const { data: existing } = await supabase
        .from("ticket_message_reactions")
        .select("id")
        .eq("message_id", messageId)
        .eq("user_id", user.id)
        .eq("emoji", emoji)
        .maybeSingle();

      if (existing) {
        // Remove
        const { error } = await supabase
          .from("ticket_message_reactions")
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        // Add
        const { error } = await supabase
          .from("ticket_message_reactions")
          .insert({ message_id: messageId, user_id: user.id, emoji });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticket-reactions"] });
    },
  });
}
