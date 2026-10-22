import { toast } from "sonner";
import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type EmojiReaction = {
  emoji: string;
  count: number;
  userReacted: boolean;
};

export type MessageReactionsMap = Record<string, EmojiReaction[]>;

function buildReactionsMap(
  rows: Array<{ message_id: string; emoji: string; user_id: string }>,
  currentUserId?: string | null
): MessageReactionsMap {
  const result: MessageReactionsMap = {};
  for (const row of rows) {
    if (!result[row.message_id]) result[row.message_id] = [];
    const arr = result[row.message_id];

    const existing = arr.find((r) => r.emoji === row.emoji);
    if (existing) {
      existing.count += 1;
      if (currentUserId && row.user_id === currentUserId) existing.userReacted = true;
    } else {
      arr.push({
        emoji: row.emoji,
        count: 1,
        userReacted: currentUserId ? row.user_id === currentUserId : false,
      });
    }
  }
  return result;
}

export function useTelegramReactions(messageIds: string[], scopedPolling = false) {
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
    queryKey: ["telegram-reactions", stableIdsCsv, viewerId],
    queryFn: async () => {
      if (!stableIds.length) return {} as MessageReactionsMap;

      const { data, error } = await supabase
        .from("telegram_message_reactions")
        .select("message_id, emoji, user_id")
        .in("message_id", stableIds);

      if (error) throw error;
      return buildReactionsMap(data || [], user?.id);
    },
    enabled: stableIds.length > 0 && !!user?.id,
    refetchInterval: scopedPolling ? 15_000 : false,
  });

  useEffect(() => {
    if (!stableIdsCsv || scopedPolling) return;

    const channel = supabase
      .channel(`telegram-reactions-rt-${viewerId}-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telegram_message_reactions" },
        () => {
          const key = ["telegram-reactions", stableIdsCsv, viewerId];
          queryClient.invalidateQueries({ queryKey: ["telegram-reactions"] });
          queryClient.invalidateQueries({ queryKey: key, exact: true });
          queryClient.refetchQueries({ queryKey: key, exact: true, type: "active" });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "telegram_message_reactions" },
        () => {
          const key = ["telegram-reactions", stableIdsCsv, viewerId];
          queryClient.invalidateQueries({ queryKey: ["telegram-reactions"] });
          queryClient.invalidateQueries({ queryKey: key, exact: true });
          queryClient.refetchQueries({ queryKey: key, exact: true, type: "active" });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stableIdsCsv, viewerId, queryClient, scopedPolling]);

  return query;
}

export function useToggleTelegramReaction(supportBotId?: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      if (!user?.id) throw new Error("Not authenticated");

      const { data: existing, error: existingError } = await supabase
        .from("telegram_message_reactions")
        .select("id")
        .eq("message_id", messageId)
        .eq("user_id", user.id)
        .eq("emoji", emoji)
        .maybeSingle();

      if (existingError) throw existingError;

      const wasRemoved = !!existing?.id;

      if (supportBotId) {
        const { error } = await supabase.rpc("support_bot_set_reaction_v1" as any, {
          p_bot_id: supportBotId, p_message_id: messageId, p_emoji: emoji, p_present: !wasRemoved,
        } as any);
        if (error) throw error;
        return { messageId, emoji, wasRemoved };
      }

      if (existing?.id) {
        const { error } = await supabase
          .from("telegram_message_reactions")
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("telegram_message_reactions")
          .insert({
            message_id: messageId,
            user_id: user.id,
            emoji,
          });
        if (error) throw error;
      }

      return { messageId, emoji, wasRemoved };
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["telegram-reactions"] });

      if (supportBotId && result) {
        try {
          const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
            body: { action: "sync_telegram_reaction", support_bot_id: supportBotId,
              telegram_message_db_id: result.messageId, emoji: result.emoji, remove: result.wasRemoved },
          });
          if (error || !data?.ok) throw new Error(data?.reason || "delivery_unknown");
          toast.success("Реакция доставлена в Telegram");
        } catch {
          toast.error("Реакция сохранена, но доставка в Telegram не подтверждена. Не повторяйте её без проверки.");
        }
        return;
      }
      // Fire-and-forget: sync reaction to Telegram
      if (result) {
        supabase.functions.invoke("telegram-admin-chat", {
          body: {
            action: "sync_telegram_reaction",
            telegram_message_db_id: result.messageId,
            emoji: result.emoji,
            remove: result.wasRemoved,
          },
        }).catch(() => { /* fire-and-forget */ });
      }
    },
  });
}
