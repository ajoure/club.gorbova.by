import { assert, assertEquals } from "jsr:@std/assert";
import { classifyProviderRenewal, loadRenewalCandidates, probeProviderRenewal, verifyRenewalCandidates } from "./renewal-check.ts";
import { authorizeSystemHealth } from "./authorization.ts";

const NOW = Date.parse("2026-10-20T17:00:00Z");
const ID = "sbs_fixture_1";
const past = "2026-10-03T10:00:00Z";
const future = "2026-11-03T10:00:00Z";
const candidate = { provider_subscription_id: ID, state: "active", next_charge_at: past, last_charge_at: null,
  local_status: "active", local_auto_renew: true };
const payload = (state = "active", renew_at: unknown = future) => ({ id: ID, state, renew_at });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

Deno.test("fresh terminal provider state clears a stale active mirror, without local-state guesses", () => {
  for (const state of ["canceled", "cancelled", "terminated", "expired", "completed"]) {
    assertEquals(classifyProviderRenewal(ID, payload(state, null), NOW).classification, "healthy");
  }
  assertEquals(classifyProviderRenewal(ID, payload("active", past), NOW).classification, "overdue");
});
Deno.test("provider future date and payment covering the due date are distinct healthy evidence", () => {
  assertEquals(classifyProviderRenewal(ID, { subscription: payload() }, NOW).classification, "healthy");
  assertEquals(classifyProviderRenewal(ID, { ...payload("active", past), last_transaction: {
    status: "successful", type: "payment", amount: 1000, paid_at: "2026-10-03T10:01:00Z",
  } }, NOW).classification, "healthy");
});
Deno.test("24h grace is unchanged; an older schedule is still actionable", () => {
  assertEquals(classifyProviderRenewal(ID, payload("active", "2026-10-20T05:00:00Z"), NOW).classification, "healthy");
  assertEquals(classifyProviderRenewal(ID, payload("active", "2026-10-19T17:00:00Z"), NOW).classification, "overdue");
});
Deno.test("failed provider payments and unknown states do not turn green", () => {
  for (const state of ["failed", "error"]) assertEquals(classifyProviderRenewal(ID, payload(state), NOW).classification, "declined");
  for (const state of ["", "pending", "redirecting", "unknown"]) assertEquals(classifyProviderRenewal(ID, payload(state), NOW).classification, "unknown");
});
Deno.test("missing/invalid schedules or wrong provider identity stay unknown", () => {
  for (const renew_at of [null, "", "1", "bad date", 12345]) {
    assertEquals(classifyProviderRenewal(ID, payload("active", renew_at), NOW).classification, "unknown");
  }
  assertEquals(classifyProviderRenewal(ID, { ...payload("canceled"), id: "sbs_other" }, NOW).classification, "unknown");
  assertEquals(classifyProviderRenewal(ID, null, NOW).classification, "unknown");
});
Deno.test("refunds, failed or unproven transactions cannot cover a missed renewal", () => {
  for (const tx of [
    { type: "refund", status: "successful", amount: 1000, paid_at: future },
    { type: "payment", status: "failed", amount: 1000, paid_at: past },
    { type: "payment", status: "successful", amount: 0, paid_at: past },
    { type: "payment", status: "successful", amount: 1000, paid_at: future },
    { type: "payment", status: "successful", amount: 1000, paid_at: "2026-09-03T10:00:00Z" },
    { status: "successful", paid_at: past },
  ]) assertEquals(classifyProviderRenewal(ID, { ...payload("active", past), last_transaction: tx }, NOW).classification, "overdue");
});
Deno.test("probe is fixed-origin GET only and does not echo arbitrary provider data", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const request = init as { method?: string; redirect?: string; body?: unknown } | undefined;
    calls++;
    assertEquals(url, `https://api.bepaid.by/subscriptions/${ID}`);
    assertEquals(request?.method, "GET");
    assertEquals(request?.redirect, "error");
    assertEquals(request?.body, undefined);
    return respond({ ...payload(), customer: { private: "must_not_escape" }, credit_card: { private: "must_not_escape" } });
  };
  const result = await probeProviderRenewal(ID, "Basic fixture", NOW, fetcher);
  assertEquals(result.classification, "healthy");
  assertEquals(calls, 1);
  assert(!JSON.stringify(result).includes("must_not_escape"));
});
Deno.test("upstream failures, malformed and oversized responses fail closed without echo", async () => {
  for (const fetcher of [
    async () => respond({ secret: "must_not_escape" }, 429),
    async () => new Response("<private error>", { status: 500 }),
    async () => new Response("not JSON"),
    async () => new Response("x".repeat(131073)),
    async () => { throw new Error("must_not_escape"); },
  ]) {
    const result = await probeProviderRenewal(ID, "Basic fixture", NOW, fetcher as typeof fetch);
    assertEquals(result.classification, "unknown");
    assert(!JSON.stringify(result).includes("must_not_escape"));
  }
});
Deno.test("invalid provider identifiers never issue a request", async () => {
  let calls = 0;
  const result = await probeProviderRenewal("../../private", "fixture", NOW, (async () => { calls++; return respond({}); }) as typeof fetch);
  assertEquals(calls, 0);
  assertEquals(result.classification, "unknown");
});
Deno.test("only overdue mirrors trigger GET; real overdue and unknown remain counted", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return respond(payload("active", past)); }) as typeof fetch;
  const r = await verifyRenewalCandidates([candidate, { ...candidate, last_charge_at: past }, { ...candidate, next_charge_at: future }], "fixture", NOW, fetcher);
  assertEquals(calls, 1);
  assertEquals(r.passed, false);
  assertEquals(r.verification, { candidates: 1, healthy: 0, overdue: 1, declined: 0, unknown: 0, source: "provider_get", release: "bepaid-renewal-health-2026-10-20-v2" });
  const unavailable = await verifyRenewalCandidates([candidate], null, NOW, fetcher);
  assertEquals(unavailable.passed, false);
  assertEquals(unavailable.count, 1);
  assertEquals(calls, 1);
});
Deno.test("terminal provider proof is repeatable without mutating the mirror", async () => {
  const rows = [structuredClone(candidate)];
  const before = JSON.stringify(rows);
  const fetcher = (async () => respond(payload("canceled", null))) as typeof fetch;
  assertEquals((await verifyRenewalCandidates(rows, "fixture", NOW, fetcher)).count, 0);
  assertEquals((await verifyRenewalCandidates(rows, "fixture", NOW, fetcher)).count, 0);
  assertEquals(JSON.stringify(rows), before);
});
Deno.test("declines remain visible as review, and active provider/local stop is never silently cleared", async () => {
  const declined = await verifyRenewalCandidates([candidate], "fixture", NOW, (async () => respond(payload("failed", past))) as typeof fetch);
  assertEquals(declined.count, 0);
  assertEquals(declined.verification.declined, 1);
  assertEquals(declined.review.passed, false);
  assertEquals(declined.review.count, 1);
  assertEquals(declined.review.samples[0].reason, "provider_payment_failed");
  const mismatch = await verifyRenewalCandidates([{ ...candidate, local_status: "superseded", local_auto_renew: false }], "fixture", NOW, (async () => respond(payload())) as typeof fetch);
  assertEquals(mismatch.passed, true);
  assertEquals(mismatch.review.passed, false);
  assertEquals(mismatch.review.samples[0].reason, "provider_active_local_not_renewing");
});
Deno.test("probe budget overflow is visible rather than silently truncating the invariant", async () => {
  let calls = 0;
  const rows = Array.from({ length: 22 }, () => ({ ...candidate }));
  const r = await verifyRenewalCandidates(rows, "fixture", NOW, (async () => { calls++; return respond(payload("canceled")); }) as typeof fetch);
  assertEquals(calls, 20);
  assertEquals(r.count, 2);
  assertEquals(r.verification.unknown, 2);
  assertEquals(r.passed, false);
});
Deno.test("snapshot enumeration is paginated, deterministic and bePaid-only", async () => {
  const methods: unknown[][] = [];
  let pages = 0;
  const db = { from(table: string) {
    assertEquals(table, "provider_subscriptions");
    const q: any = {};
    for (const method of ["select", "eq", "or", "order"]) q[method] = (...args: unknown[]) => { methods.push([method, ...args]); return q; };
    q.range = async (from: number, to: number) => {
      pages++;
      assertEquals([from, to], pages === 1 ? [0, 999] : [1000, 1999]);
      return { data: Array.from({ length: pages === 1 ? 1000 : 1 }, () => candidate), error: null };
    };
    return q;
  } };
  assertEquals((await loadRenewalCandidates(db, NOW)).length, 1001);
  assert(methods.some(m => JSON.stringify(m) === '["eq","provider","bepaid"]'));
  assert(methods.some(m => m[0] === 'or' && String(m[1]).includes('billing_review_required.eq.true')));
  assertEquals(pages, 2);
});
Deno.test('recorded billing review remains visible after the provider snapshot date becomes future', async () => {
  for (const flag of [true, 'true']) {
    const row = { ...candidate, next_charge_at: future, billing_review_required: flag, local_auto_renew: false };
    const before = structuredClone(row);
    const r = await verifyRenewalCandidates([row], 'fixture', NOW, (async () => respond(payload())) as typeof fetch);
    assertEquals(r.count, 0); assertEquals(r.verification.candidates, 1); assertEquals(r.review.count, 1);
    assertEquals(r.review.samples[0].reason, 'provider_active_local_not_renewing'); assertEquals(row, before);
  }
});
Deno.test('a recorded review is resolved only by fresh provider/local evidence, never its flag alone', async () => {
  const row = { ...candidate, next_charge_at: future, billing_review_required: 'true' };
  const aligned = await verifyRenewalCandidates([row], 'fixture', NOW, (async () => respond(payload())) as typeof fetch);
  assertEquals(aligned.review.count, 0);
  const terminal = await verifyRenewalCandidates([{ ...row, local_auto_renew: false }], 'fixture', NOW, (async () => respond(payload('canceled'))) as typeof fetch);
  assertEquals(terminal.review.count, 0);
  const failedProbe = await verifyRenewalCandidates([row], 'fixture', NOW, (async () => respond({}, 500)) as typeof fetch);
  assertEquals(failedProbe.count, 1); assertEquals(failedProbe.verification.unknown, 1);
});
Deno.test("authorization rejects unverified headers, missing secrets and nonstaff", async () => {
  const request = (headers: Record<string, string> = {}) => new Request("https://fixture.local", { headers });
  for (const req of [request(), request({ Authorization: "anything" }), request({ Authorization: "Bearer forged-role-admin" }), request({ apikey: "public-fixture" }), request({ "x-cron-secret": "undefined" })]) {
    assertEquals(await authorizeSystemHealth(req, "service-fixture", undefined, async () => false), false);
  }
  assertEquals(await authorizeSystemHealth(request({ Authorization: "Bearer nonstaff" }), "service-fixture", "cron-fixture", async () => false), false);
});
Deno.test("authorization preserves exact service and cron, and verified staff", async () => {
  const headersList: Record<string, string>[] = [{ apikey: "service-fixture" }, { Authorization: "Bearer service-fixture" }, { "x-cron-secret": "cron-fixture" }];
  for (const headers of headersList) {
    assertEquals(await authorizeSystemHealth(new Request("https://fixture.local", { headers }), "service-fixture", "cron-fixture", async () => { throw new Error("not needed"); }), true);
  }
  assertEquals(await authorizeSystemHealth(new Request("https://fixture.local", { headers: { Authorization: "Bearer verified-staff" } }), "service-fixture", "cron-fixture", async () => true), true);
});
