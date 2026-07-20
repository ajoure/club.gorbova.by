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

export function useRoomParticipants(
  eventId: string | null | undefined,
  enabled = true,
  autowebSessionId?: string | null,
) {
  const refetchInterval = useVisibilityPolling(20_000);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["room-participants", eventId, autowebSessionId ?? "legacy"],
    enabled: !!eventId && enabled,
    refetchInterval,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!eventId) return [] as RoomParticipant[];
      const { data, error } = autowebSessionId
        ? await supabase.rpc("get_autoweb_session_participants" as any, {
            _session_id: autowebSessionId,
          })
        : await supabase.rpc("get_room_participants" as any, {
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
    const uniq = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
    const table = autowebSessionId ? "live_event_session_progress" : "live_active_sessions";
    const filter = autowebSessionId
      ? `session_id=eq.${autowebSessionId}`
      : `live_event_id=eq.${eventId}`;
    const channel = supabase
      .channel(`room-participants:${eventId}:${autowebSessionId ?? "legacy"}:${uniq}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["room-participants", eventId, autowebSessionId ?? "legacy"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, enabled, autowebSessionId, queryClient]);

  return query;
}
