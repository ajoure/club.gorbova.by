import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Live-room reactions runtime.
 *
 * Источник: таблица live_event_reactions (id, live_event_id, user_id, emoji, created_at).
 * Контракт реакций — на уровень комнаты (live_event_id), не на каждое сообщение.
 * RLS уже накладывает: rate_limit, mute/remove guards, has_access — серверные guards.
 *
 * Realtime: подписка на INSERT/DELETE по live_event_id, инвалидация кеша.
 */

export type ReactionAggregate = {
  emoji: string;
  count: number;
  userReacted: boolean;
};

function aggregate(
  rows: Array<{ emoji: string; user_id: string }>,
  viewerId: string | null,
): ReactionAggregate[] {
  const map = new Map<string, ReactionAggregate>();
  for (const r of rows) {
    const cur = map.get(r.emoji) || { emoji: r.emoji, count: 0, userReacted: false };
    cur.count += 1;
    if (viewerId && r.user_id === viewerId) cur.userReacted = true;
    map.set(r.emoji, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function useLiveEventReactions(eventId: string | null | undefined, enabled = true) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const viewerId = user?.id ?? null;

  const query = useQuery({
    queryKey: ["live-event-reactions", eventId, viewerId],
    enabled: !!eventId && enabled,
    queryFn: async () => {
      if (!eventId) return [] as ReactionAggregate[];
      const { data, error } = await supabase
        .from("live_event_reactions" as any)
        .select("emoji, user_id")
        .eq("live_event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) {
        console.error("[useLiveEventReactions] error:", error);
        return [] as ReactionAggregate[];
      }
      return aggregate((data as any[]) || [], viewerId);
    },
  });

  useEffect(() => {
    if (!eventId || !enabled) return;
    const channel = supabase
      .channel(`live-event-reactions:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_event_reactions",
          filter: `live_event_id=eq.${eventId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["live-event-reactions", eventId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, enabled, queryClient]);

  return query;
}

export function useSendLiveReaction(eventId: string | null | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (emoji: string) => {
      if (!user?.id) throw new Error("auth_required");
      if (!eventId) throw new Error("event_required");
      const { error } = await supabase
        .from("live_event_reactions" as any)
        .insert({ live_event_id: eventId, user_id: user.id, emoji });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live-event-reactions", eventId] });
    },
  });
}
