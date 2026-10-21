import { AVAILABILITY_RELEASE, SCAN_TTL_MS, type AvailabilityScan } from "./availability.ts";

export interface CronReport { id: string; created_at: string; report_json?: { availability_scan?: AvailabilityScan } }
export type CronTick = { kind: "start" } | { kind: "resume"; report_id: string } | { kind: "idle"; reason: string };

// Existing authenticated request becomes a cheap minute tick. One logical
// daily scan starts after the original05:00UTC boundary. A stale same-day
// attempt stays visibly incomplete: manual retry or the next UTC day, never
// an endless automatic restart loop.
export function cronTick(now: Date, latest: CronReport | null, continuationOnly = false): CronTick {
  const current = now.getTime();
  const scan = latest?.report_json?.availability_scan;
  const started = Date.parse(scan?.started_at || "");
  const created = Date.parse(latest?.created_at || "");
  if (latest && !Number.isFinite(created)) return { kind: "idle", reason: "invalid_cron_state" };
  if (scan?.release === AVAILABILITY_RELEASE && scan.complete === false
    && Number.isFinite(started) && current >= started && current - started <= SCAN_TTL_MS) {
    const resume = scan.resume_after ? Date.parse(scan.resume_after) : null;
    if (resume !== null && (!Number.isFinite(resume) || resume > current)) return { kind: "idle", reason: "retry_after" };
    if (Math.floor(created / 60_000) >= Math.floor(current / 60_000)) return { kind: "idle", reason: "tick_already_processed" };
    return { kind: "resume", report_id: latest!.id };
  }
  if (continuationOnly) return { kind: "idle", reason: "no_pending_availability_scan" };
  // Scan start day remains authoritative when a late scan crosses midnight.
  const anchor = Number.isFinite(started) ? started : created;
  if (Number.isFinite(anchor) && new Date(anchor).toISOString().slice(0, 10) >= now.toISOString().slice(0, 10))
    return { kind: "idle", reason: "daily_attempt_already_recorded" };
  return now.getUTCHours() < 5 ? { kind: "idle", reason: "before_daily_window" } : { kind: "start" };
}

// Existing report PK is the atomic boundary: racing copies may do harmless
// duplicate probes, but only one report/audit/final notification may commit.
export async function cronReportId(now: Date, predecessor?: string): Promise<string> {
  const seed = `system-health-cron:v2:${predecessor || now.toISOString().slice(0, 10)}`;
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x80; bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
