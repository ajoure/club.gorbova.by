import { PREFLIGHT_FUNCTIONS, PREFLIGHT_SOURCE_DIGEST } from "./preflight-manifest.generated.ts";

// Each invocation has its own bounded work budget. Never alter trace headers or
// retry inside the request: hosted function-to-function chains have a hard cap.
export const PROBE_BUDGET = 20;
export const PROBE_CONCURRENCY = 4;
export const SCAN_TTL_MS = 15 * 60_000;
export const AVAILABILITY_RELEASE = "health-bounded-preflight-2026-10-21-v2";

export interface RegistryEntry {
  name: string;
  tier: string;
  category: string;
  expected_status: number[];
  timeout_ms: number;
  auto_fix_policy: string;
}
export interface FunctionCheckResult {
  name: string;
  exists: boolean | null;
  http_status: number | null;
  status: "OK" | "NOT_DEPLOYED" | "ERROR" | "TIMEOUT" | "CORS_ERROR" | "RATE_LIMITED" | "UNKNOWN";
  tier: string;
  category: string;
  auto_fix_policy: string;
  cors_ok?: boolean;
  error?: string;
  checked_at?: string;
  retry_after_ms?: number;
  probe_skipped?: boolean;
}
export interface AvailabilityScan {
  release: string;
  id: string;
  registry_digest: string;
  started_at: string;
  complete: boolean;
  checked: number;
  total: number;
  pending: number;
  batch_checked: number;
  retry_after_ms: number;
  resume_after: string | null;
}
export const deferred = (e: RegistryEntry): FunctionCheckResult => ({
  name: e.name, tier: e.tier, category: e.category, auto_fix_policy: e.auto_fix_policy,
  exists: null, http_status: null, status: "UNKNOWN", error: "Deferred: bounded probe budget",
});

export async function registryDigest(entries: RegistryEntry[]): Promise<string> {
  const canonical = [...entries].sort((a, b) => a.name.localeCompare(b.name)).map(e =>
    [e.name, e.tier, e.category, [...e.expected_status].sort((a, b) => a - b), e.timeout_ms, e.auto_fix_policy]);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([PREFLIGHT_SOURCE_DIGEST, canonical]))))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

function rateLimitDelay(error: unknown): number | null {
  const details = error && typeof error === "object" ? error as { name?: string; message?: string; retryAfterMs?: number } : null;
  if (details && (details.name === "RateLimitError" || /rate limit exceeded for trace/i.test(details.message || ""))) {
    const delay = Number(details.retryAfterMs);
    return Number.isFinite(delay) && delay > 0 ? Math.ceil(delay) : 60_000;
  }
  return null;
}

export async function checkFunctionAvailability(
  entry: RegistryEntry, baseUrl: string, fetcher: typeof fetch = fetch,
): Promise<FunctionCheckResult> {
  if (!PREFLIGHT_FUNCTIONS.has(entry.name)) return { ...deferred(entry), checked_at: new Date().toISOString(),
    probe_skipped: true, error: "No versioned OPTIONS contract; no request sent" };
  const timeout = Math.max(100, Math.min(entry.timeout_ms || 8000, 8000));
  const base = deferred(entry);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(`${baseUrl}/functions/v1/${encodeURIComponent(entry.name)}`, {
      method: "OPTIONS", signal: controller.signal,
      headers: { Origin: "https://gorbova.by", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,apikey,x-client-info" },
    });
    const result = { ...base, checked_at: new Date().toISOString(), http_status: response.status, error: undefined };
    if (response.status === 429) {
      const header = response.headers.get("Retry-After") || "";
      const retry = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
      return { ...result, status: "RATE_LIMITED", retry_after_ms: Number.isFinite(retry) && retry > 0 ? retry : 60_000,
        error: "Preflight rate limited; no retry in this invocation" };
    }
    if (response.status === 404) {
      const text = await response.text();
      if (/"code"\s*:\s*"NOT_FOUND"|Function not found/i.test(text)) {
        return { ...result, exists: false, status: "NOT_DEPLOYED" };
      }
    }
    //204 is a valid empty OPTIONS response (telegram-mass-broadcast uses it).
    // The legacy registry lists business statuses and omitted that preflight.
    if (response.status !== 204 && !entry.expected_status.includes(response.status)) {
      return { ...result, exists: true, status: "ERROR", error: `Unexpected preflight status ${response.status}` };
    }
    if (entry.category === "browser") {
      const allowed = (response.headers.get("Access-Control-Allow-Headers") || "").toLowerCase().split(",").map(s => s.trim());
      const origin = response.headers.get("Access-Control-Allow-Origin");
      const corsOk = response.ok && ["authorization", "content-type", "apikey", "x-client-info"].every(h => allowed.includes(h))
        && (origin === "*" || origin === "https://gorbova.by");
      if (!corsOk) return { ...result, exists: true, status: "CORS_ERROR", cors_ok: false,
        error: "Missing browser invocation origin or headers in CORS allowlist" };
    }
    return { ...result, exists: true, status: "OK", cors_ok: true };
  } catch (error) {
    const retry = rateLimitDelay(error);
    if (retry !== null) return { ...base, status: "RATE_LIMITED", checked_at: new Date().toISOString(), retry_after_ms: retry,
      error: "Nested preflight rate limited; no retry in this invocation" };
    const aborted = controller.signal.aborted || (error !== null && typeof error === "object" && "name" in error && error.name === "AbortError");
    return { ...base, checked_at: new Date().toISOString(),
      status: aborted ? "TIMEOUT" : "UNKNOWN",
      error: aborted ? `Preflight timeout (${timeout}ms)` : "Preflight transport failed" };
  } finally { clearTimeout(timeoutId); }
}

export async function runAvailabilityBatch(
  registry: RegistryEntry[], baseUrl: string,
  previous?: { scan: AvailabilityScan; results: FunctionCheckResult[] },
  probe: typeof checkFunctionAvailability = checkFunctionAvailability,
) {
  const digest = await registryDigest(registry);
  if (previous && (previous.scan.release !== AVAILABILITY_RELEASE || previous.scan.registry_digest !== digest
    || !Number.isFinite(Date.parse(previous.scan.started_at))
    || Date.now() - Date.parse(previous.scan.started_at) > SCAN_TTL_MS)) throw new Error("availability_scan_expired_or_registry_changed");
  const waitMs = Date.parse(previous?.scan.resume_after || "") - Date.now();
  if (previous && waitMs > 0) return { results: previous.results,
    scan: { ...previous.scan, retry_after_ms: waitMs, batch_checked: 0 } };
  // Only the immutable, server-persisted predecessor is accepted, never results
  // from a browser request. Concurrent scan chains do not overwrite each other.
  const cache = new Map(previous?.results.map(r => [r.name, r]) || []);
  const results = registry.map(e => cache.get(e.name) || deferred(e));
  const pending = results.map((r, i) => !r.checked_at || r.status === "RATE_LIMITED" ? i : -1).filter(i => i >= 0);
  let attempted = 0;
  let retryAfter = 0;
  for (let offset = 0; offset < Math.min(pending.length, PROBE_BUDGET); offset += PROBE_CONCURRENCY) {
    const indexes = pending.slice(offset, Math.min(offset + PROBE_CONCURRENCY, PROBE_BUDGET));
    const batch = await Promise.all(indexes.map(i => probe(registry[i], baseUrl)));
    batch.forEach((r, n) => { results[indexes[n]] = r; });
    attempted += batch.length;
    retryAfter = Math.max(0, ...batch.map(r => r.retry_after_ms || 0));
    if (retryAfter > 0) break;
  }
  const checked = results.filter(r => r.checked_at && r.status !== "RATE_LIMITED").length;
  const scan: AvailabilityScan = { release: AVAILABILITY_RELEASE, id: previous?.scan.id || crypto.randomUUID(),
    registry_digest: digest, started_at: previous?.scan.started_at || new Date().toISOString(),
    complete: checked === registry.length, checked, total: registry.length, pending: registry.length - checked,
    batch_checked: attempted, retry_after_ms: retryAfter,
    resume_after: retryAfter > 0 ? new Date(Date.now() + retryAfter).toISOString() : null };
  return { scan, results };
}

export function summarizeAvailability(results: FunctionCheckResult[]) {
  return { deployed: results.filter(r => r.exists === true).length,
    healthy: results.filter(r => r.status === "OK").length,
    missing: results.filter(r => r.status === "NOT_DEPLOYED").map(r => r.name),
    timeout: results.filter(r => r.status === "TIMEOUT").map(r => r.name),
    errors: results.filter(r => ["ERROR", "CORS_ERROR", "UNKNOWN", "RATE_LIMITED", "TIMEOUT"].includes(r.status)).map(r => r.name) };
}
