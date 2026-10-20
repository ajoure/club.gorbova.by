import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { authorizeQueueCronRequest } from "../../supabase/functions/bepaid-queue-cron/auth";
import * as policy from "../../supabase/functions/_shared/bepaid-queue-policy";
import { authorizePaymentsReconcile } from "../../supabase/functions/_shared/payments-reconcile-auth";
import { requireExactGrantCapability } from "../../supabase/functions/payments-reconcile/grant-capability";
import { authorizeManualContinuation } from "../../supabase/functions/payments-reconcile/manual-continuation";
import { resolveGrantAccessCaller } from "../../supabase/functions/_shared/verified-financial-caller";

const compiled = ts.transpileModule(
  readFileSync("supabase/functions/bepaid-queue-cron/index.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const reconcileCompiled = ts.transpileModule(
  readFileSync("supabase/functions/payments-reconcile/index.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function harness(overrides: Record<string, unknown> = {}, claim: "win" | "lose" | "error" = "win", processor = "queue", operator = 'admin') {
  const item = {
    id: "test-queue-id", status: "processing", attempts: 1, source: "webhook",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", last_error: null,
    ...overrides,
  };
  const writes: Array<{ table: string; values: Record<string, unknown>; filters: unknown[] }> = [];
  const tableReads: string[] = [];
  const response = claim === "lose" ? { success: true, claim_conflicts: 1 } :
    { success: true, stale_recovered: 1, results: { orders_reconciled: 1 } };
  const invoke = claim === "error" ? vi.fn().mockResolvedValue({ data: null, error: { message: "worker failed" } }) :
    vi.fn().mockResolvedValue({ data: response, error: null });
  const recover = vi.fn(async (_db: unknown, _options: Record<string, unknown>) => {
    if (claim === "error") throw new Error("recovery_test_failure");
    return response;
  });
  let queueReads = 0;
  const client = {
    functions: { invoke },
    auth: { getUser: vi.fn(async () => operator === 'invalid'
      ? { data: { user: null }, error: {} }
      : { data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null }) },
    rpc: vi.fn(async (_name: string, args: any) => ({ data: operator === args?._role_code, error: null })),
    from(table: string) {
      tableReads.push(table);
      let values: Record<string, unknown> | undefined;
      const filters: unknown[] = [];
      const complete = () => {
        if (values) {
          writes.push({ table, values, filters });
          if (table === "payment_reconcile_queue" && values.status === "processing") {
            if (claim === "error") return { data: null, error: { message: "claim failed" } };
            if (claim === "lose") return { data: null, error: null };
          }
          return { data: { id: item.id }, error: null };
        }
        if (table === "payment_reconcile_queue") return { data: queueReads++ === 0 ? [item] : [], error: null };
        return { data: [], error: null };
      };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "limit", "or", "order", "eq", "neq", "gte", "in", "not", "lt", "is"]) {
        builder[method] = (...args: unknown[]) => { filters.push([method, ...args]); return builder; };
      }
      builder.update = builder.insert = (input: Record<string, unknown>) => { values = input; return builder; };
      builder.maybeSingle = () => Promise.resolve(complete());
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(complete()).then(resolve);
      return builder;
    },
  };
  let handler!: (request: Request) => Promise<Response>;
  runInNewContext(processor === "reconcile" ? reconcileCompiled : compiled, {
    exports: {}, Request, Response, Date,
    console: { log() {}, error() {}, info() {}, warn() {} },
    Deno: { env: { get: (key: string) => ({ SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "service-test", CRON_SECRET: "cron-test" })[key] } },
    require(path: string) {
      if (path.includes("/http/server.ts")) return { serve: (callback: typeof handler) => { handler = callback; } };
      if (path.includes("@supabase/supabase-js")) return { createClient: () => client };
      if (path === "./auth.ts") return { authorizeQueueCronRequest };
      if (path.endsWith("/payments-reconcile-auth.ts")) return { authorizePaymentsReconcile };
      if (path === "./grant-capability.ts") return { requireExactGrantCapability };
      if (path === "./manual-continuation.ts") return { authorizeManualContinuation };
      if (path.endsWith('/_shared/verified-financial-caller.ts')) return { resolveGrantAccessCaller };
      if (path.endsWith("/bepaid-canonical-recovery.ts")) return { reconcileExactQueuePayment: recover };
      if (path.endsWith("/bepaid-queue-policy.ts")) return policy;
      if (path.includes("bepaid-credentials")) return {
        getBepaidCredsStrict: async () => ({ shop_id: "test-shop", secret_key: "test-key" }),
        isBepaidCredsError: () => false, createBepaidAuthHeader: () => "Basic test",
      };
      if (/bepaid-tracking-id|admin-notify-message|admin-profile-name/.test(path)) return {};
      throw new Error(`Unexpected dependency ${path}`);
    },
  });
  const run = (body: Record<string, unknown> = {}, authorized: boolean | 'staff' = true) => handler(new Request("https://example.test", {
    method: "POST", headers: authorized === 'staff' ? { Authorization: 'Bearer verified-staff' } : authorized ? { apikey: "service-test" } : {}, body: JSON.stringify(body),
  }));
  return { run, writes, invoke, item, recover, tableReads };
}

function manualBody() {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return { manualPaidContinuation: true, queueItemId: id(2), expectedUpdatedAt: '2026-01-01T00:00:00Z',
    providerSubscriptionId: 'sbs_test', recordPreflightFailure: false,
    paidContinuation: { sourceSubscriptionId: id(3), targetSubscriptionId: id(4), previousPaymentUid: 'test_uid',
      expectedProviderUpdatedAt: '2026-01-01T00:00:00Z' } };
}

describe("actual bePaid queue cron handler with isolated database", () => {
  it("rejects anonymous callers before all database and worker effects", async () => {
    const h = harness();
    expect((await h.run({}, false)).status).toBe(401);
    expect(h.writes).toEqual([]);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("dry-run reports stale recovery but never writes, invokes or alerts", async () => {
    const h = harness();
    const result = await (await h.run({ dry_run: true, queueItemId: h.item.id })).json();
    expect(result.dry_run).toBe(true);
    expect(result.candidates).toEqual([{ id: h.item.id, status: "processing", attempts: 1, action: "recover_stale" }]);
    expect(h.writes).toEqual([]);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it.each(["win", "lose", "error"] as const)("delegates without queue writes, including downstream %s", async state => {
    const h = harness({}, state);
    const result = await (await h.run()).json();
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("payments-reconcile", {
      body: { queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at, recordPreflightFailure: true },
    });
    expect(h.writes.filter(w => w.table === "payment_reconcile_queue")).toEqual([]);
    if (state === "win") expect(result.stale_recovered).toBe(1);
    if (state === "lose") expect(result.claim_conflicts).toBe(1);
    if (state === "error") expect(result.failed).toBe(1);
  });

  it('keeps a manual exact queue execution out of automatic failure accounting', async () => {
    const h = harness();
    await h.run({ queueItemId: h.item.id });
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith('payments-reconcile', {
      body: { queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at, recordPreflightFailure: false },
    });
  });
});

describe("actual scheduled payments-reconcile handler with isolated database", () => {
  it("rejects unauthenticated execution before provider recovery", async () => {
    const h = harness({}, "win", "reconcile");
    expect((await h.run({}, false)).status).toBe(401);
    expect(h.writes).toEqual([]); expect(h.recover).not.toHaveBeenCalled();
  });
  it.each(["win", "lose", "error"] as const)("default run delegates queue ownership (%s)", async state => {
    const h = harness({}, state, "reconcile");
    expect((await h.run()).status).toBe(200);
    expect(h.recover).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at, providerAuth: "Basic test", recordPreflightFailure: true,
    });
    expect(h.writes.filter(w => w.table === "payment_reconcile_queue")).toEqual([]);
  });
  it("exact dry-run bypasses levels 1/2, audit and notifications", async () => {
    const h = harness({}, "win", "reconcile");
    await h.run({ queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at, dry_run: true });
    expect(h.recover).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at, dryRun: true, providerAuth: "Basic test", providerSubscriptionId: undefined, recordPreflightFailure: false,
    });
    expect(h.writes).toEqual([]); expect(h.invoke).not.toHaveBeenCalled();
  });
  it.each([true, false, 'true', 1])('accepts only the explicit boolean opt-in (%s)', async flag => {
    const h = harness({}, 'win', 'reconcile');
    await h.run({ queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at, dryRun: true, recordPreflightFailure: flag });
    expect(h.recover.mock.calls[0][1]).toMatchObject({ dryRun: true, recordPreflightFailure: flag === true });
    expect(h.writes).toEqual([]); expect(h.invoke).not.toHaveBeenCalled();
  });
  it("rejects unscoped dry-run rather than accidentally executing a full sweep", async () => {
    const h = harness({}, "win", "reconcile");
    expect((await h.run({ dryRun: true })).status).toBe(400);
    expect(h.writes).toEqual([]); expect(h.recover).not.toHaveBeenCalled();
  });
  it('proves deployed grant capability before planning an explicit continuation', async () => {
    const h = harness({}, 'win', 'reconcile');
    h.invoke.mockResolvedValueOnce({ data: { capabilities: { exact_existing_access_v1: true } }, error: null } as any);
    expect((await h.run({ queueItemId: h.item.id, paidContinuation: { sourceSubscriptionId: 'test-source' } })).status).toBe(200);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith('grant-access-for-order', { method: 'GET' });
    expect(h.invoke.mock.invocationCallOrder[0]).toBeLessThan(h.recover.mock.invocationCallOrder[0]);
    expect(h.recover.mock.calls[0][1]).toMatchObject({ dryRun: true });
    expect(h.writes).toEqual([]);
  });
  it('does not plan or write a continuation when the deployed capability is absent', async () => {
    const h = harness({}, 'win', 'reconcile');
    expect((await h.run({ queueItemId: h.item.id, paidContinuation: {} })).status).toBe(500);
    expect(h.recover).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith('grant-access-for-order', { method: 'GET' });
  });
  it.each(['admin', 'super_admin'])('uses verified %s identity for an exact manual dry-run, never body identity', async role => {
    const h = harness({}, 'win', 'reconcile', role);
    h.invoke.mockResolvedValueOnce({ data: { capabilities: { exact_existing_access_v1: true } }, error: null } as any);
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const response = await h.run({ manualPaidContinuation: true, queueItemId: id(2), expectedUpdatedAt: '2026-01-01T00:00:00Z',
      providerSubscriptionId: 'sbs_test', recordPreflightFailure: false,
      paidContinuation: { sourceSubscriptionId: id(3), targetSubscriptionId: id(4), previousPaymentUid: 'test_uid',
        expectedProviderUpdatedAt: '2026-01-01T00:00:00Z' } }, 'staff');
    expect(response.status).toBe(200);
    expect(h.recover.mock.calls[0][1]).toMatchObject({ dryRun: true, operatorUserId: id(1), recordPreflightFailure: false });
    expect(h.writes).toEqual([]);
  });
  it.each(['admin', 'ordinary_user', 'invalid'])('keeps generic reconciliation service-only for %s', async role => {
    const h = harness({}, 'win', 'reconcile', role);
    expect((await h.run({}, 'staff')).status).toBe(role === 'invalid' ? 401 : 403);
    expect(h.recover).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it.each(['ordinary_user', 'invalid'])('rejects a well-formed manual request from %s before any financial read', async role => {
    const h = harness({}, 'win', 'reconcile', role);
    expect((await h.run(manualBody(), 'staff')).status).toBe(role === 'invalid' ? 401 : 403);
    expect(h.tableReads).toEqual([]); expect(h.writes).toEqual([]);
    expect(h.recover).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled();
  });
  it('rejects an admin body claiming an operator before any financial read or sweep', async () => {
    const h = harness({}, 'win', 'reconcile', 'admin');
    expect((await h.run({ ...manualBody(), operatorUserId: 'spoofed' }, 'staff')).status).toBe(400);
    expect(h.tableReads).toEqual([]); expect(h.writes).toEqual([]);
    expect(h.recover).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled();
  });
  it('returns a snapshot conflict as 409 rather than a retryable server failure', async () => {
    const h = harness({}, 'win', 'reconcile'); h.recover.mockRejectedValueOnce(new Error('recovery_queue_snapshot_changed'));
    expect((await h.run({ queueItemId: h.item.id, dryRun: true })).status).toBe(409);
    expect(h.writes).toEqual([]);
  });
});
