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
  const invoke = vi.fn().mockResolvedValue({ data: { results: { orders_reconciled: 1 } }, error: null });
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
  return { run, writes, invoke, item };
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

  it.each([
    [{ attempts: 5 }, "STALE_PROCESSING_MAX_ATTEMPTS"],
    [{ source: "file_import" }, "STALE_PROCESSING_EXCLUDED_IMPORT"],
    [{ last_error: "SOFT_CANCELLED: operator" }, "STALE_PROCESSING_CANCELLED"],
  ])("releases terminal stale rows without replay: %s", async (overrides, reason) => {
    const h = harness(overrides);
    const result = await (await h.run()).json();
    expect(result.stale_terminal).toBe(1);
    expect(h.invoke).not.toHaveBeenCalled();
    const updates = h.writes.filter(w => w.table === "payment_reconcile_queue");
    expect(updates).toHaveLength(1);
    expect(updates[0].values.status).toBe("error");
    expect(updates[0].values.last_error).toContain(reason);
    expect(updates[0].filters).toContainEqual(["eq", "updated_at", h.item.updated_at]);
  });

  it.each(["lose", "error"] as const)("never overwrites a %s CAS claim", async claim => {
    const h = harness({}, claim);
    await h.run();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.writes.filter(w => w.table === "payment_reconcile_queue")).toHaveLength(1);
  });

  it("skips even an exact-id request for a fresh worker claim", async () => {
    const h = harness({ updated_at: new Date().toISOString() });
    const result = await (await h.run({ queueItemId: h.item.id })).json();
    expect(result.claim_conflicts).toBe(1);
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.writes.filter(w => w.table === "payment_reconcile_queue")).toHaveLength(0);
  });

  it("recovers one stale claim and requires verified materialization", async () => {
    const h = harness();
    const result = await (await h.run()).json();
    expect(result.stale_recovered).toBe(1);
    expect(result.orders_created).toBe(1);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("bepaid-auto-process", {
      body: { queueItemId: h.item.id }, headers: { "x-internal-key": "cron-test" },
    });
    const updates = h.writes.filter(w => w.table === "payment_reconcile_queue");
    expect(updates[0].values.attempts).toBe(2);
    expect(updates[1].values).toMatchObject({ status: "completed", last_error: null, next_retry_at: null });
  });
});

describe("actual scheduled payments-reconcile handler with isolated database", () => {
  it("rejects unauthenticated execution", async () => {
    const h = harness({}, "win", "reconcile");
    expect((await h.run({}, false)).status).toBe(401);
    expect(h.writes).toEqual([]);
  });
  it.each(["lose", "error"] as const)("leaves another worker untouched on %s claim", async claim => {
    const h = harness({}, claim, "reconcile");
    expect((await h.run()).status).toBe(200);
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.writes.filter(w => w.table === "payment_reconcile_queue")).toHaveLength(1);
  });
  it("releases exhausted stale claims without payment/access side effects", async () => {
    const h = harness({ attempts: 5 }, "win", "reconcile");
    const result = await (await h.run()).json();
    expect(result.stale_terminal).toBe(1);
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.writes.filter(w => w.table === "payment_reconcile_queue")[0].values.status).toBe("error");
  });
  it("reclaims an interrupted row but does not invent a missing order", async () => {
    const h = harness({}, "win", "reconcile");
    const result = await (await h.run()).json();
    expect(result.stale_recovered).toBe(1);
    expect(result.queue_processed).toBe(0);
    expect(h.invoke).not.toHaveBeenCalled();
    const updates = h.writes.filter(w => w.table === "payment_reconcile_queue");
    expect(updates[0].filters).toContainEqual(["eq", "updated_at", h.item.updated_at]);
    expect(updates[1].values).toMatchObject({ status: "pending", last_error: "Could not match to order" });
  });
  it("leaves an explicit terminal error when the last attempt cannot match an order", async () => {
    const h = harness({ attempts: 4 }, "win", "reconcile");
    await h.run();
    const updates = h.writes.filter(w => w.table === "payment_reconcile_queue");
    expect(updates[1].values).toMatchObject({ status: "error", next_retry_at: null });
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
