import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
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

export function useTicketReactions(ticketId: string, messageIds: string[], scopedPolling = false) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const viewerId = user?.id ?? "anon";

  // Stable key: deduplicate, sort, join as CSV string
  const stableIdsCsv = useMemo(() => {
    const unique = [...new Set(messageIds.filter(Boolean))].sort();
    return unique.join(",");
  }, [messageIds]);

  const stableIds = useMemo(() => (stableIdsCsv ? stableIdsCsv.split(",") : []), [stableIdsCsv]);

  const query = useQuery({
    queryKey: ["ticket-reactions", stableIdsCsv, viewerId],
    queryFn: async () => {
      if (!stableIds.length) return {} as MessageReactions;

      const { data, error } = await supabase
        .from("ticket_message_reactions")
        .select("message_id, emoji, user_id")
        .in("message_id", stableIds);

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
    enabled: stableIds.length > 0 && !!user?.id,
    refetchInterval: scopedPolling ? 15_000 : false,
  });

  // Realtime subscription scoped to ticketId
  useEffect(() => {
    if (!ticketId || scopedPolling) return;

    const channel = supabase
      .channel(`ticket-reactions-rt-${ticketId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ticket_message_reactions" },
        () => {
          const key = ["ticket-reactions", stableIdsCsv, viewerId];
          queryClient.invalidateQueries({ queryKey: ["ticket-reactions"] });
          queryClient.invalidateQueries({ queryKey: key, exact: true });
          queryClient.refetchQueries({ queryKey: key, exact: true, type: "active" });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "ticket_message_reactions" },
        () => {
          const key = ["ticket-reactions", stableIdsCsv, viewerId];
          queryClient.invalidateQueries({ queryKey: ["ticket-reactions"] });
          queryClient.invalidateQueries({ queryKey: key, exact: true });
          queryClient.refetchQueries({ queryKey: key, exact: true, type: "active" });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId, stableIdsCsv, viewerId, queryClient, scopedPolling]);

  return query;
}

export function useToggleReaction(ticketId: string) {
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

      const wasRemoved = !!existing;

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

      return { messageId, emoji, wasRemoved };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["ticket-reactions"] });

      // Fire-and-forget: sync reaction to Telegram if mapping exists
      if (result) {
        supabase
          .from("ticket_telegram_sync")
          .select("telegram_message_id")
          .eq("ticket_message_id", result.messageId)
          .in("direction", ["to_telegram", "from_telegram"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data: syncRecord }) => {
            if (syncRecord) {
              supabase.functions.invoke("telegram-admin-chat", {
                body: {
                  action: "sync_reaction",
                  ticket_message_id: result.messageId,
                  emoji: result.emoji,
                  remove: result.wasRemoved,
                },
              }).catch(() => { /* fire-and-forget */ });
            }
          });
      }
    },
  });
}
