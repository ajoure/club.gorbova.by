import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useVisibilityPolling } from "./useVisibilityPolling";

/**
 * Sprint 2 PATCH 2.6 + Sprint 3 PATCH 3.5: participant count v1.
 * Source: view live_event_active_participants_v
 * (live_active_sessions with expires_at > now() AND last_seen_at > now() - 2min).
 *
 * Uses useVisibilityPolling to pause when tab is hidden.
 * IMPORTANT: this does NOT pause heartbeat — only the read-only count polling.
 */
export function useActiveParticipants(eventId: string | null | undefined, enabled = true) {
  const refetchInterval = useVisibilityPolling(20_000);

  return useQuery({
    queryKey: ["live-active-participants", eventId],
    enabled: !!eventId && enabled,
    refetchInterval,
    refetchOnWindowFocus: false,
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
