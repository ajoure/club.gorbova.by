export type LivePageState = "loading" | "not_found" | "unpublished" | "access_denied" | "invite_required" | "source_unavailable" | "removed_from_room" | "scheduled" | "live" | "live_pending" | "ended_no_replay" | "session_revoked" | "session_expired" | "room_open_waiting" | "auth_required" | "error";

export interface LiveResolveStateInput {
  status: string;
  event_type?: string;
  room_phase?: string;
  platform_status?: string;
  event_status?: string;
  replay_enabled?: boolean;
  resolved_source?: { resolved_source_kind?: string };
}

/** Keep business rejections distinct from a failed page request. */
export function liveResolveState(result: LiveResolveStateInput): LivePageState {
  switch (result.status) {
    case "not_found": case "unpublished": case "access_denied":
    case "invite_required": case "source_unavailable": case "removed_from_room":
    case "auth_required": return result.status;
    case "session_missing": return "session_expired";
    case "replay_disabled": return "ended_no_replay";
    case "room_closed": return "scheduled";
    case "ok":
      if (result.event_type === "live_stream" && result.room_phase === "closed") return "scheduled";
      if (result.room_phase === "waiting") return "room_open_waiting";
      if (result.platform_status === "scheduled" || result.event_status === "scheduled") return "scheduled";
      if (result.resolved_source?.resolved_source_kind === "live_pending") return "live_pending";
      if (result.platform_status === "replay_available" || (result.event_status === "ended" && result.replay_enabled)) return "live";
      return result.event_status === "ended" && !result.replay_enabled ? "ended_no_replay" : "live";
    default: return "error";
  }
}

/** Only failed GET requests retry; business responses never use this loop. */
export function createLiveResolveRecovery(retry: () => void) {
  const delays = [1000, 3000, 8000];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let failed = false;
  let disposed = false;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  return {
    fail() {
      if (disposed) return;
      failed = true;
      if (timer !== undefined || attempts >= delays.length) return;
      timer = setTimeout(() => { timer = undefined; if (!disposed) retry(); }, delays[attempts++]);
    },
    reset() { clear(); attempts = 0; failed = false; },
    wake() {
      if (disposed || !failed) return;
      clear(); attempts = 0; failed = false; retry();
    },
    dispose() { disposed = true; failed = false; clear(); },
  };
}
