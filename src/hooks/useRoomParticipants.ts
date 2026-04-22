import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useVisibilityPolling } from "./useVisibilityPolling";

/**
 * Список участников комнаты.
 *
 * Источник: RPC get_room_participants(_event_id) — единственный privacy-aware путь.
 * Сервер сам решает, отдавать ли real_name_for_staff (только staff).
 *
 * Realtime: подписка на live_active_sessions (insert/update/delete) по live_event_id —
 * чтобы при join/leave список обновлялся без явного refetch.
 */
export type RoomParticipant = {
  user_id: string;
  display_name: string | null;
  nickname_color: string | null;
  show_avatar: boolean | null;
  avatar_url: string | null;
  real_name_for_staff: string | null;
  role_in_room: string | null;
  last_seen_at: string | null;
};

export function useRoomParticipants(eventId: string | null | undefined, enabled = true) {
  const refetchInterval = useVisibilityPolling(20_000);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["room-participants", eventId],
    enabled: !!eventId && enabled,
    refetchInterval,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!eventId) return [] as RoomParticipant[];
      const { data, error } = await supabase.rpc("get_room_participants" as any, {
        _event_id: eventId,
      });
      if (error) {
        console.error("[useRoomParticipants] error:", error);
        return [] as RoomParticipant[];
      }
      return ((data as any[]) || []) as RoomParticipant[];
    },
  });

  useEffect(() => {
    if (!eventId || !enabled) return;
    const channel = supabase
      .channel(`room-participants:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_active_sessions",
          filter: `live_event_id=eq.${eventId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["room-participants", eventId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, enabled, queryClient]);

  return query;
}
