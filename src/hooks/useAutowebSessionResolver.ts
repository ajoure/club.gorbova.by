/**
 * Sprint B: hook-обёртка над autoweb-resolve-sessions.
 *
 * Добавляет к ответу edge-функции viewer_timezone (детектится через Intl)
 * и держит refetch на 30s для scheduled (ближайшие слоты могут "уехать").
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AutowebMode = "one_time" | "scheduled" | "just_in_time" | "on_demand";

export interface AutowebScheduledSlot {
  session_id: string;
  starts_at: string;
  ends_at: string | null;
}

export interface AutowebJitOption {
  offset_minutes: number;
  starts_at: string;
}

export interface AutowebResolveResponse {
  status: "ok" | "not_found" | "unpublished" | "unsupported_event_type" | "error";
  mode?: AutowebMode;
  timezone?: string;
  one_time?: { starts_at: string };
  scheduled?: { upcoming: AutowebScheduledSlot[] };
  just_in_time?: { options: AutowebJitOption[]; show_countdown: boolean };
  on_demand?: { starts_at: string; min_delay_seconds: number };
}

function detectViewerTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useAutowebSessionResolver(opts: {
  liveEventId?: string;
  slug?: string;
  enabled?: boolean;
}) {
  const enabled = !!(opts.enabled !== false && (opts.liveEventId || opts.slug));

  const query = useQuery({
    queryKey: ["autoweb-resolve-sessions", opts.liveEventId, opts.slug],
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<AutowebResolveResponse & { viewer_timezone: string }> => {
      const params = new URLSearchParams();
      if (opts.liveEventId) params.set("live_event_id", opts.liveEventId);
      else if (opts.slug) params.set("slug", opts.slug);

      const { data, error } = await supabase.functions.invoke(
        `autoweb-resolve-sessions?${params.toString()}`,
        { method: "GET" },
      );
      if (error) throw error;
      const viewer_timezone = detectViewerTz();
      return { ...(data as AutowebResolveResponse), viewer_timezone };
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    viewerTimezone: query.data?.viewer_timezone ?? detectViewerTz(),
  };
}

/** Запрос на создание персональной сессии (JIT/on_demand). */
export async function createAutowebPersonalSession(args: {
  liveEventId: string;
  offsetMinutes?: number;
}): Promise<{ ok: boolean; sessionId?: string; reason?: string; dedup?: boolean }> {
  const { data, error } = await supabase.functions.invoke("autoweb-create-personal-session", {
    method: "POST",
    body: {
      live_event_id: args.liveEventId,
      offset_minutes: args.offsetMinutes,
    },
  });
  if (error) return { ok: false, reason: error.message };
  const payload = data as any;
  if (payload?.status !== "ok" || !payload?.session?.id) {
    return { ok: false, reason: payload?.message || payload?.status || "unknown_error" };
  }
  return { ok: true, sessionId: payload.session.id, dedup: !!payload.dedup };
}
