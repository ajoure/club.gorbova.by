import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sprint 2 PATCH 2.6: participant count v1.
 * Источник — view live_event_active_participants_v
 * (live_active_sessions с expires_at > now() AND last_seen_at > now() - 2min).
 *
 * Это «активные участники за последние 2 минуты», НЕ realtime presence.
 */
export function useActiveParticipants(eventId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["live-active-participants", eventId],
    enabled: !!eventId && enabled,
    refetchInterval: 20_000,
    queryFn: async () => {
      if (!eventId) return 0;
      const { data, error } = await supabase
        .from("live_event_active_participants_v" as any)
        .select("active_count")
        .eq("live_event_id", eventId)
        .maybeSingle();
      if (error) {
        console.error("[useActiveParticipants] error:", error);
        return 0;
      }
      return ((data as any)?.active_count as number) ?? 0;
    },
  });
}
