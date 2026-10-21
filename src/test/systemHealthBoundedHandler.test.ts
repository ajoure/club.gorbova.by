import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import * as availability from "../../supabase/functions/system-health-full-check/availability";
import { PREFLIGHT_FUNCTIONS } from "../../supabase/functions/system-health-full-check/preflight-manifest.generated";
import * as evidence from "../../supabase/functions/system-health-full-check/critical-evidence";
import * as renewals from "../../supabase/functions/system-health-full-check/renewal-check";
import * as paymentPolicy from "../../supabase/functions/_shared/payment-health-policy";
import { authorizeSystemHealth } from "../../supabase/functions/system-health-full-check/authorization";

const source = ts.transpileModule(readFileSync("supabase/functions/system-health-full-check/index.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const safeNames = [...PREFLIGHT_FUNCTIONS].slice(0, 172);
function fixture(options: { savedCritical?: boolean; fetchError?: boolean } = {}) {
  vi.stubGlobal("crypto", webcrypto);
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(init?.method).toBe("OPTIONS");
    if (options.fetchError) throw Object.assign(new Error("fixture rate limit"), { name: "RateLimitError", retryAfterMs: 60000 });
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization,content-type,apikey,x-client-info" } });
  });
  vi.stubGlobal("fetch", fetcher);
  const registry = safeNames.map((name, n) => ({ name, tier: n < 12 ? "P0" : "P1",
    category: "browser", expected_status: [200], timeout_ms: 100, auto_fix_policy: "none" }));
  const reports: any[] = options.savedCritical ? [{ id: uuid(999), source: "manual", status: "CRITICAL",
    created_at: new Date().toISOString(), report_json: { invariants: { results: [
      { code: "INV-P0-1", severity: "CRITICAL", passed: false, count: 1, name: "fixture existing problem" },
    ] } } }] : [];
  const reads: string[] = [];
  const audits: any[] = [];
  const rpc = vi.fn(async () => ({ data: 100, error: null }));
  const db = { rpc, from(table: string) {
    reads.push(table); let inserted: any = null; let limit = 1; const filters: Record<string, any> = {};
    const value = () => {
      if (table === "edge_functions_registry") return { data: registry, error: null };
      if (table === "system_health_reports") {
        const matches = reports.filter(r => Object.entries(filters).every(([k, v]) => r[k] === v));
        return { data: limit > 1 ? matches.slice(-limit).reverse() : matches.at(-1) || null, error: null };
      }
      return { data: [], count: 0, error: null };
    };
    const q: any = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(value()).then(resolve) };
    for (const key of ["select", "order", "like", "gte", "or", "range", "in"]) q[key] = () => q;
    q.limit = (n: number) => { limit = n; return q; };
    q.eq = (key: string, v: unknown) => { filters[key] = v; return q; };
    q.maybeSingle = async () => value();
    q.single = async () => {
      if (table !== "system_health_reports" || !inserted) throw new Error("Unexpected single/write");
      const id = uuid(reports.length + 1); reports.push({ ...inserted, id, created_at: new Date().toISOString() });
      return { data: { id }, error: null };
    };
    q.insert = (row: any) => { if (table === "audit_logs") audits.push(row);
      else if (table === "system_health_reports") inserted = structuredClone(row);
      else throw new Error(`Unexpected business write: ${table}`); return q; };
    q.update = q.delete = q.upsert = () => { throw new Error(`Unexpected mutation: ${table}`); };
    return q;
  } };
  let handler!: (request: Request) => Promise<Response>;
  runInNewContext(source, { exports: {}, Request, Response, Date, console: { log() {}, error() {}, warn() {} },
    Deno: { env: { get: (k: string) => ({ SUPABASE_URL: "https://fixture.test", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" })[k] },
      serve: (fn: typeof handler) => { handler = fn; } }, require(path: string) {
      if (path.includes("supabase-js")) return { createClient: () => db };
      if (path.endsWith("/cors.ts")) return { corsHeaders: {} };
      if (path.endsWith("/caller-user.ts")) return { getCallerUserId: async () => null };
      if (path.endsWith("/bepaid-credentials.ts")) return { getBepaidCredsStrict: () => { throw new Error("No candidates: credentials must not load"); }, isBepaidCredsError: () => false };
      if (path.endsWith("/payment-health-policy.ts")) return paymentPolicy;
      if (path === "./authorization.ts") return { authorizeSystemHealth };
      if (path === "./availability.ts") return availability;
      if (path === "./critical-evidence.ts") return evidence;
      if (path === "./renewal-check.ts") return renewals;
      throw new Error(`Unknown import ${path}`);
    } });
  const call = async (body: unknown, auth = true) => {
    const response = await handler(new Request("https://fixture.test", { method: "POST", headers: auth ? { apikey: "fixture-service" } : {}, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  return { call, reports, fetcher, reads, audits };
}
afterEach(() => vi.unstubAllGlobals());

describe("actual full-check handler", () => {
  it("completes a172-function scan via9 server-owned predecessors, business invariants once and zero sends", async () => {
    const h = fixture(); let predecessor: string | undefined;
    for (let page = 0; page < 9; page++) {
      const before = h.fetcher.mock.calls.length;
      const response = await h.call({ source: "manual", notify: false, ...(predecessor ? { continue_from: predecessor } : {}),
        results: [{ status: "OK", name: "forged-browser-result" }] });
      expect(response.status).toBe(200);
      expect(response.body.availability_scan.checked).toBe(Math.min(172, 20 * (page + 1)));
      expect(h.fetcher.mock.calls.length - before).toBeLessThanOrEqual(20);
      expect(h.reads.filter(r => r === "provider_subscriptions")).toHaveLength(page === 8 ? 1 : 0);
      expect(JSON.stringify(response.body)).not.toContain("forged-browser-result");
      predecessor = response.body.report_id;
    }
    expect(h.fetcher).toHaveBeenCalledTimes(172); expect(h.reports).toHaveLength(9); expect(h.audits).toHaveLength(9);
    expect(h.reports.at(-1).report_json.edge_functions.healthy).toBe(172);
    const replay = await h.call({ source: "manual", notify: false, continue_from: predecessor });
    expect(replay.body).toMatchObject({ replayed: true, sent: false });
    expect(h.fetcher).toHaveBeenCalledTimes(172); expect(h.reports).toHaveLength(9);
  });
  it("retains an existing critical business finding while coverage is incomplete", async () => {
    const h = fixture({ savedCritical: true }); const response = await h.call({ source: "manual", notify: false });
    expect(response.body).toMatchObject({ status: "CRITICAL", invariants: { failed: 1 }, availability_scan: { complete: false } });
    expect(h.reads).not.toContain("provider_subscriptions");
  });
  it("a pinned older predecessor cannot erase a critical finding from another completed chain, even behind a newer partial row", async () => {
    const h = fixture(); const first = await h.call({ source: "manual", notify: false });
    const verifiedAt = new Date().toISOString();
    h.reports.push({ id: uuid(900), source: "cron", created_at: verifiedAt,
      report_json: { availability_scan: { complete: true }, invariants_checked_at: verifiedAt,
        invariants: { results: [{ code: "INV-P0-1", severity: "CRITICAL", passed: false, count: 2 }] } } });
    h.reports.push({ id: uuid(901), source: "manual", created_at: new Date().toISOString(),
      report_json: { availability_scan: { complete: false }, invariants_checked_at: null, invariants: { results: [] } } });
    const next = await h.call({ source: "manual", notify: false, continue_from: first.body.report_id });
    expect(next.body).toMatchObject({ status: "CRITICAL", invariants_checked_at: verifiedAt,
      invariants: { results: [expect.objectContaining({ code: "INV-P0-1", count: 2, passed: false })] } });
  });
  it("keeps a newer known P0 missing through a continuation and clears it only after a newer successful probe", async () => {
    const h = fixture(); const first = await h.call({ source: "manual", notify: false });
    const firstRow = h.reports.at(-1);
    const old = new Date(Date.now() - 2000).toISOString();
    firstRow.report_json.edge_functions.results[0].checked_at = old;
    const verifiedAt = new Date(Date.now() - 1000).toISOString();
    h.reports.push({ id: uuid(900), source: "cron", created_at: verifiedAt, report_json: {
      availability_scan: { complete: false }, invariants_checked_at: null, invariants: { results: [] },
      known_p0_missing: [{ name: safeNames[0], checked_at: verifiedAt }], edge_functions: { results: [] } } });
    const next = await h.call({ source: "manual", notify: false, continue_from: first.body.report_id });
    expect(next.body).toMatchObject({ status: "CRITICAL", known_p0_missing: [{ name: safeNames[0] }],
      invariants: { results: [expect.objectContaining({ code: "INV-EDGE-P0-MISSING", count: 1 })] } });
    const fresh = await h.call({ source: "manual", notify: false });
    expect(fresh.body.known_p0_missing).toEqual([]);
    expect(fresh.body.invariants.results.some((r: any) => r.code === "INV-EDGE-P0-MISSING")).toBe(false);
  });
  it("stops on actual RateLimit, keeps results UNKNOWN and never sends alerts for partial scans", async () => {
    const h = fixture({ fetchError: true }); const response = await h.call({ source: "manual", notify: false });
    expect(response.body).toMatchObject({ status: "DEGRADED", edge_functions: { healthy: 0, deployed: 0 }, availability_scan: { checked: 0, complete: false } });
    expect(h.fetcher).toHaveBeenCalledTimes(4); expect(h.reads).not.toContain("profiles");
  });
  it("rejects unauthorized and invalid predecessor requests before any probes; idle cron makes no reports or writes", async () => {
    const h = fixture();
    expect((await h.call({}, false)).status).toBe(401);
    expect((await h.call({ source: "manual", notify: false, continue_from: "invalid" })).status).toBe(400);
    expect((await h.call({ source: "manual", notify: false, continue_from: uuid(500) })).status).toBe(409);
    expect((await h.call({ source: "cron", mode: "continue" })).body).toMatchObject({ skipped: true, sent: false });
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.reports).toHaveLength(0); expect(h.audits).toHaveLength(0);
  });
});
