type Row = Record<string, any>;
const assert = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};

async function runAudit(rows: Row[], race?: (rows: Row[]) => void) {
  const audits: Row[] = [];
  const tickets: Row[] = [];
  let raced = false;
  class Query {
    filters: ((r: Row) => boolean)[] = [];
    patch: Row | null = null;
    constructor(readonly table: string) {}
    select(_fields: string) {
      return this;
    }
    in(k: string, vs: any[]) {
      this.filters.push((r) => vs.includes(r[k]));
      return this;
    }
    eq(k: string, v: any) {
      this.filters.push((r) => r[k] === v);
      return this;
    }
    is(k: string, v: any) {
      this.filters.push((r) => v === null ? r[k] == null : r[k] === v);
      return this;
    }
    not(k: string, _op: string, v: any) {
      this.filters.push((r) => v === null ? r[k] != null : r[k] !== v);
      return this;
    }
    or(expression: string) {
      const clauses = expression.split(",").map((x) => x.split("."));
      this.filters.push((r) =>
        clauses.some(([k, op, ...rest]) => {
          const v = rest.join(".");
          return op === "is" && v === "null"
            ? r[k] == null
            : op === "neq" && r[k] != null && r[k] !== v;
        })
      );
      return this;
    }
    update(patch: Row) {
      this.patch = patch;
      return this;
    }
    async insert(row: Row) {
      (this.table === "audit_logs" ? audits : tickets).push(row);
      return { error: null };
    }
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => {
        if (this.patch && !raced) {
          raced = true;
          race?.(rows);
        }
        const matches = rows.filter((r) => this.filters.every((f) => f(r)));
        if (this.patch) {
          for (const row of matches) Object.assign(row, this.patch);
        }
        return { data: matches.map((r) => ({ ...r })), error: null };
      }).then(resolve, reject);
    }
  }
  const db = {
    from: (table: string) => new Query(table),
    functions: {
      invoke: async (_name: string, options: any) => {
        assert(
          options.body.action === "report",
          "Test must never invoke cancellation",
        );
        return { data: null, error: null };
      },
    },
  };
  let handler: ((r: Request) => Promise<Response>) | undefined;
  const testGlobal = globalThis as any;
  testGlobal.__auditTestServe = (h: typeof handler) => {
    handler = h;
  };
  testGlobal.__auditTestCreateClient = () => db;
  const path = new URL("./index.ts", import.meta.url);
  let source = await Deno.readTextFile(path);
  source = source.replace(
    /^import \{ serve \}[^\n]+$/m,
    "const serve = (globalThis as any).__auditTestServe;",
  )
    .replace(
      /^import \{ createClient \}[^\n]+$/m,
      "const createClient = (globalThis as any).__auditTestCreateClient;",
    )
    .replaceAll('Deno.env.get("SUPABASE_URL")!', '"https://test.invalid"')
    .replaceAll('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!', '"test-only"')
    .replaceAll(
      '"./risk-policy.ts"',
      JSON.stringify(new URL("./risk-policy.ts", import.meta.url).href),
    );
  await import(
    "data:application/typescript;base64," +
      btoa(String.fromCharCode(...new TextEncoder().encode(source))) +
      "#case=" + crypto.randomUUID()
  );
  assert(handler, "Runtime handler must be registered");
  try {
    const response = await handler!(
      new Request("https://test.invalid", { method: "POST" }),
    );
    return { response, body: await response.json(), rows, audits, tickets };
  } finally {
    delete testGlobal.__auditTestServe;
    delete testGlobal.__auditTestCreateClient;
  }
}
const row = (id: string, changes: Row = {}): Row => ({
  id,
  user_id: "synthetic",
  status: "active",
  auto_renew: true,
  billing_type: "mit",
  payment_method_id: null,
  payment_token: null,
  ...changes,
});

Deno.test("daily audit preserves provider mandate without local card, disables only eligible internal renewal", async () => {
  const r = await runAudit([
    row("provider", { billing_type: "provider_managed" }),
    row("internal"),
    row("legacy", { billing_type: null }),
    row("has-card", { payment_method_id: "card" }),
    row("expired", { status: "expired" }),
    row("opt-out", { auto_renew: false }),
  ]);
  assert(r.response.status === 200, "Audit should succeed");
  assert(
    r.rows[0].auto_renew,
    "Provider-managed mandate must never be disabled because local card is absent",
  );
  assert(
    !r.rows[1].auto_renew && !r.rows[2].auto_renew,
    "Eligible internal/legacy cardless renewals must be disabled",
  );
  assert(
    r.rows[3].auto_renew && r.rows[4].auto_renew,
    "Card-backed and expired records must be preserved",
  );
  assert(
    r.body.report.internal_audit.auto_renew_disabled === 2,
    "Count must reflect actual changed rows",
  );
  assert(
    r.audits[0].meta.fixed_count === 2,
    "Audit must count actual mutations",
  );
  assert(
    !r.audits[0].meta.subscription_ids.includes("provider"),
    "Provider must never appear in mutation audit",
  );
});

Deno.test("atomic guards preserve new card, provider migration, user opt-out and status changes after selection", async () => {
  const r = await runAudit([
    row("card-race"),
    row("provider-race"),
    row("opt-out-race"),
    row("ended-race"),
  ], (rows) => {
    rows[0].payment_method_id = "new-card";
    rows[1].billing_type = "provider_managed";
    rows[2].auto_renew = false;
    rows[3].status = "expired";
  });
  assert(
    r.rows[0].auto_renew && r.rows[1].auto_renew && r.rows[3].auto_renew,
    "Concurrent protected changes must survive",
  );
  assert(!r.rows[2].auto_renew, "Explicit opt-out must remain disabled");
  assert(
    r.body.report.internal_audit.auto_renew_disabled === 0,
    "No stale candidate may be counted as changed",
  );
  assert(
    r.audits.length === 0 && r.tickets.length === 0,
    "No mutation audit or repair ticket for zero changes",
  );
});

Deno.test("provider-only cohort produces no mutation audit or repair ticket", async () => {
  const r = await runAudit([
    row("provider", { billing_type: "provider_managed" }),
  ]);
  assert(r.rows[0].auto_renew, "Provider mandate must remain active");
  assert(
    r.body.report.internal_audit.at_risk_found === 0,
    "Provider is not local cardless risk",
  );
  assert(
    r.audits.length === 0 && r.tickets.length === 0,
    "Nothing to mutate or report as repaired",
  );
});
