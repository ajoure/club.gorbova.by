import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { checkFunctionAvailability, deferred, registryDigest, runAvailabilityBatch, summarizeAvailability,
  type RegistryEntry, type FunctionCheckResult } from "../../supabase/functions/system-health-full-check/availability";
import { availabilityView } from "@/lib/system-health/availability";
import { newestBusinessEvidence, retainMissingP0 } from "../../supabase/functions/system-health-full-check/critical-evidence";

const entry: RegistryEntry = { name: "send-email", tier: "P0", category: "browser",
  expected_status: [200, 204], timeout_ms: 100, auto_fix_policy: "none" };
const registry = Array.from({ length: 172 }, (_, n) => ({ ...entry, name: `fixture-${n}` }));
const success = (e: RegistryEntry): FunctionCheckResult => ({ ...deferred(e), status: "OK", exists: true,
  http_status: 200, checked_at: new Date().toISOString(), error: undefined });
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type,apikey,x-client-info" };
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

describe("bounded server-owned availability scan", () => {
  it("covers172 exactly once in9 independent invocations, never more than20 each", async () => {
    const seen: string[] = [];
    const probe = vi.fn(async (e: RegistryEntry) => { seen.push(e.name); return success(e); });
    let previous: Awaited<ReturnType<typeof runAvailabilityBatch>> | undefined;
    for (let batch = 0; batch < 9; batch++) {
      previous = await runAvailabilityBatch(registry, "https://fixture.test", previous, probe);
      expect(previous.scan.batch_checked).toBeLessThanOrEqual(20);
      expect(previous.scan.checked).toBe(Math.min(20 * (batch + 1), 172));
      expect(previous.scan.complete).toBe(batch === 8);
      expect(summarizeAvailability(previous.results).healthy).toBe(previous.scan.checked);
    }
    expect(seen.length).toBe(172); expect(new Set(seen).size).toBe(172);
  });
  it("stops launching work after a rate limit, preserving deferred UNKNOWN", async () => {
    const probe = vi.fn(async (e: RegistryEntry) => ({ ...deferred(e), status: "RATE_LIMITED" as const,
      checked_at: new Date().toISOString(), retry_after_ms: 56000 }));
    const scan = await runAvailabilityBatch(registry, "https://fixture.test", undefined, probe);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(scan.scan).toMatchObject({ complete: false, checked: 0, pending: 172, retry_after_ms: 56000 });
    expect(scan.results.filter(r => r.status === "UNKNOWN")).toHaveLength(168);
    expect(summarizeAvailability(scan.results)).toMatchObject({ deployed: 0, healthy: 0 });
    probe.mockClear();
    const cooling = await runAvailabilityBatch(registry, "https://fixture.test", scan, probe);
    expect(cooling.scan.batch_checked).toBe(0); expect(probe).not.toHaveBeenCalled();
  });
  it("rejects changed registry, expired scan and old release before any network access", async () => {
    const probe = vi.fn(async (e: RegistryEntry) => success(e));
    const initial = await runAvailabilityBatch(registry, "https://fixture.test", undefined, probe);
    probe.mockClear();
    await expect(runAvailabilityBatch([...registry, { ...entry, name: "new" }], "https://fixture.test", initial, probe)).rejects.toThrow();
    await expect(runAvailabilityBatch(registry, "https://fixture.test", { ...initial,
      scan: { ...initial.scan, started_at: "2020-01-01T00:00:00Z" } }, probe)).rejects.toThrow();
    await expect(runAvailabilityBatch(registry, "https://fixture.test", { ...initial,
      scan: { ...initial.scan, release: "old" } }, probe)).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
  });
  it("uses a stable registry fingerprint, including contract and timeout changes", async () => {
    expect(await registryDigest(registry)).toBe(await registryDigest([...registry].reverse()));
    expect(await registryDigest([{ ...entry, timeout_ms: 1000 }])).not.toBe(await registryDigest([entry]));
    expect(await registryDigest([{ ...entry, expected_status: [200] }])).not.toBe(await registryDigest([entry]));
  });
  it("concurrent scan chains never share mutable probe outcomes", async () => {
    const first = await runAvailabilityBatch(registry, "https://fixture.test", undefined, async e => success(e));
    const [a, b] = await Promise.all([1, 2].map(() => runAvailabilityBatch(registry, "https://fixture.test", first, async e => success(e))));
    expect(a.scan.checked).toBe(40); expect(b.scan.checked).toBe(40); expect(first.scan.checked).toBe(20);
    expect(first.results.filter(r => r.checked_at)).toHaveLength(20);
  });
});

describe("safe preflight semantics", () => {
  it("never invokes a registry entry without a versioned OPTIONS contract, even with forged registry flags", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const r = await checkFunctionAvailability({ ...entry, name: "test-payment-direct" }, "https://fixture.test", fetcher);
    expect(r).toMatchObject({ status: "UNKNOWN", exists: null, probe_skipped: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(summarizeAvailability([r])).toMatchObject({ healthy: 0, deployed: 0 });
  });
  it.each([200, 204])("uses only OPTIONS and the normal public origin (%s)", async status => {
    const fetcher = vi.fn<typeof fetch>(async (_url, _init) => new Response(null, { status, headers }));
    const r = await checkFunctionAvailability(entry, "https://fixture.test", fetcher);
    expect(r).toMatchObject({ status: "OK", exists: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "OPTIONS" });
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("body");
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
  });
  it("classifies Deno RateLimitError without exposing its trace identifier", async () => {
    const error = Object.assign(new Error("Rate limit exceeded for trace private-id"), { name: "RateLimitError", retryAfterMs: 56000 });
    const r = await checkFunctionAvailability(entry, "https://fixture.test", async () => { throw error; });
    expect(r).toMatchObject({ status: "RATE_LIMITED", exists: null, retry_after_ms: 56000 });
    expect(JSON.stringify(r)).not.toContain("private-id");
  });
  it("accepts standard204 preflight even when the legacy registry omitted204", async () => {
    const r = await checkFunctionAvailability({ ...entry, expected_status: [200, 400, 401, 403, 405] },
      "https://fixture.test", async () => new Response(null, { status: 204, headers }));
    expect(r.status).toBe("OK");
  });
  it("honors HTTP429, distinguishes gateway404, and never calls a business fallback", async () => {
    expect(await checkFunctionAvailability(entry, "https://fixture.test", async () => new Response(null, { status: 429, headers: { "Retry-After": "8" } })))
      .toMatchObject({ status: "RATE_LIMITED", exists: null, retry_after_ms: 8000 });
    expect(await checkFunctionAvailability(entry, "https://fixture.test", async () => new Response('{"code": "NOT_FOUND"}', { status: 404 })))
      .toMatchObject({ status: "NOT_DEPLOYED", exists: false });
    expect(await checkFunctionAvailability(entry, "https://fixture.test", async () => new Response("not a deployment assertion", { status: 404 })))
      .toMatchObject({ status: "ERROR" });
  });
  it("does not count HTTP500, missing CORS, timeout or network errors as healthy/deployed proof", async () => {
    const outputs = await Promise.all([
      checkFunctionAvailability(entry, "https://fixture.test", async () => new Response(null, { status: 500 })),
      checkFunctionAvailability(entry, "https://fixture.test", async () => new Response(null, { status: 200 })),
      checkFunctionAvailability(entry, "https://fixture.test", async () => { throw new DOMException("aborted", "AbortError"); }),
      checkFunctionAvailability(entry, "https://fixture.test", async () => { throw new Error("network and private URL"); }),
    ]);
    expect(outputs.map(r => r.status)).toEqual(["ERROR", "CORS_ERROR", "TIMEOUT", "UNKNOWN"]);
    expect(summarizeAvailability(outputs)).toMatchObject({ healthy: 0, deployed: 2 });
    expect(JSON.stringify(outputs)).not.toContain("private URL");
  });
  it("recomputes a truthful view for old saved reports with142 RateLimit errors", () => {
    const results = [...Array.from({ length: 29 }, () => ({ status: "OK" })), { status: "ERROR", error: "HTTP500" },
      ...Array.from({ length: 142 }, () => ({ status: "ERROR", error: "RateLimitError" }))];
    expect(availabilityView({ edge_functions: { healthy: 172, results } })).toMatchObject({ healthy: 29, complete: false,
      rateLimited: 142, errors: 1, total: 172 });
    expect(availabilityView({ edge_functions: { healthy: 172, results: [{ status: "ERROR" }] } })?.healthy).toBe(0);
  });
});

describe("critical evidence across independent chains", () => {
  it("uses the latest verified block, never a newer partial row with no business verification", () => {
    const older = { results: [{ passed: true, severity: "CRITICAL" }], checked_at: "2026-10-21T10:00:00Z" };
    const newer = { results: [{ passed: false, severity: "CRITICAL" }], checked_at: "2026-10-21T10:01:00Z" };
    expect(newestBusinessEvidence([older, newer, { results: [], checked_at: null }])).toBe(newer);
  });
  it("keeps a confirmed missing P0 when unprobed/UNKNOWN/TIMEOUT or older OK; only a newer OK can clear it", () => {
    const prior = [{ name: entry.name, checked_at: "2026-10-21T10:01:00Z" }];
    for (const status of ["UNKNOWN", "TIMEOUT", "RATE_LIMITED"] as const) {
      expect(retainMissingP0([{ ...deferred(entry), status, checked_at: "2026-10-21T10:02:00Z" }], prior)).toEqual(prior);
    }
    expect(retainMissingP0([{ ...success(entry), checked_at: "2026-10-21T10:00:00Z" }], prior)).toEqual(prior);
    expect(retainMissingP0([{ ...success(entry), checked_at: "2026-10-21T10:01:00Z" }], prior)).toEqual(prior);
    expect(retainMissingP0([{ ...success(entry), checked_at: "2026-10-21T10:02:00Z" }], prior)).toEqual([]);
    expect(retainMissingP0([deferred(entry)], prior, [{ ...success(entry), checked_at: "2026-10-21T10:02:00Z" }])).toEqual([]);
  });
});
