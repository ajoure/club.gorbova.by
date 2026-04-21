/**
 * Sprint B: hook-обёртка над autoweb-room-state (pure resolver, ZERO writes).
 *
 * Polling: каждые 10s. Полностью read-only — никакой UPDATE статусов в БД.
 * Возвращает полный контракт AutowebRoomStateResponse (см. src/types/autoweb.ts).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AutowebRoomStateResponse } from "@/types/autoweb";

const POLL_INTERVAL_MS = 10_000;

function detectViewerTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useAutowebRoomState(sessionId: string | null | undefined) {
  const enabled = !!sessionId;

  const query = useQuery<AutowebRoomStateResponse>({
    queryKey: ["autoweb-room-state", sessionId],
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    queryFn: async () => {
      const params = new URLSearchParams({
        session_id: sessionId!,
        viewer_timezone: detectViewerTz(),
      });
      const { data, error } = await supabase.functions.invoke(
        `autoweb-room-state?${params.toString()}`,
        { method: "GET" },
      );
      if (error) throw error;
      return data as AutowebRoomStateResponse;
    },
  });

  return {
    state: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
