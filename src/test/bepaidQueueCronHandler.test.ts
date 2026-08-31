import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { authorizeQueueCronRequest } from "../../supabase/functions/bepaid-queue-cron/auth";
import * as policy from "../../supabase/functions/_shared/bepaid-queue-policy";
import { authorizePaymentsReconcile } from "../../supabase/functions/_shared/payments-reconcile-auth";

const compiled = ts.transpileModule(
  readFileSync("supabase/functions/bepaid-queue-cron/index.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const reconcileCompiled = ts.transpileModule(
  readFileSync("supabase/functions/payments-reconcile/index.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function harness(overrides: Record<string, unknown> = {}, claim: "win" | "lose" | "error" = "win", processor = "queue") {
  const item = {
    id: "test-queue-id", status: "processing", attempts: 1, source: "webhook",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", last_error: null,
    ...overrides,
  };
  const writes: Array<{ table: string; values: Record<string, unknown>; filters: unknown[] }> = [];
  const response = claim === "lose" ? { success: true, claim_conflicts: 1 } :
    { success: true, stale_recovered: 1, results: { orders_reconciled: 1 } };
  const invoke = claim === "error" ? vi.fn().mockResolvedValue({ data: null, error: { message: "worker failed" } }) :
    vi.fn().mockResolvedValue({ data: response, error: null });
  const recover = vi.fn(async () => {
    if (claim === "error") throw new Error("recovery_test_failure");
    return response;
  });
  let queueReads = 0;
  const client = {
    functions: { invoke },
    from(table: string) {
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
  const run = (body: Record<string, unknown> = {}, authorized = true) => handler(new Request("https://example.test", {
    method: "POST", headers: authorized ? { apikey: "service-test" } : {}, body: JSON.stringify(body),
  }));
  return { run, writes, invoke, item, recover };
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
      body: { queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at },
    });
    expect(h.writes.filter(w => w.table === "payment_reconcile_queue")).toEqual([]);
    if (state === "win") expect(result.stale_recovered).toBe(1);
    if (state === "lose") expect(result.claim_conflicts).toBe(1);
    if (state === "error") expect(result.failed).toBe(1);
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
      queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at, providerAuth: "Basic test",
    });
    expect(h.writes.filter(w => w.table === "payment_reconcile_queue")).toEqual([]);
  });
  it("exact dry-run bypasses levels 1/2, audit and notifications", async () => {
    const h = harness({}, "win", "reconcile");
    await h.run({ queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at, dry_run: true });
    expect(h.recover).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      queueItemId: h.item.id, expectedUpdatedAt: h.item.updated_at, dryRun: true, providerAuth: "Basic test",
    });
    expect(h.writes).toEqual([]); expect(h.invoke).not.toHaveBeenCalled();
  });
  it("rejects unscoped dry-run rather than accidentally executing a full sweep", async () => {
    const h = harness({}, "win", "reconcile");
    expect((await h.run({ dryRun: true })).status).toBe(400);
    expect(h.writes).toEqual([]); expect(h.recover).not.toHaveBeenCalled();
  });
});
