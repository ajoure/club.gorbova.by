import { loadClientEvidence } from "../../supabase/functions/_shared/sales-runtime/client-evidence.ts";
const at = "2026-09-12T12:00:00Z";
function check(value: unknown, message = "assertion failed") {
  if (!value) throw Error(message);
}
function fixture(tables: Record<string, any[]> = {}, failTable = "") {
  const calls: any[] = [];
  const db: any = {
    from(table: string) {
      let filters: ((r: any) => boolean)[] = [],
        from = 0,
        to = 199,
        sort = "id";
      const call: any = { table, fields: "" };
      calls.push(call);
      const q: any = {
        select(fields: string) {
          call.fields = fields;
          return q;
        },
        or(s: string) {
          const clauses = s.split(",").map((x) => x.split(".eq."));
          filters.push((r) => clauses.some(([k, v]) => r[k] === v));
          return q;
        },
        eq(k: string, v: any) {
          filters.push((r) => r[k] === v);
          return q;
        },
        in(k: string, v: any[]) {
          filters.push((r) => v.includes(r[k]));
          return q;
        },
        lte(k: string, v: any) {
          filters.push((r) => r[k] <= v);
          return q;
        },
        order(k: string) {
          sort = k;
          return q;
        },
        range(a: number, b: number) {
          from = a;
          to = b;
          call.range = [a, b];
          return q;
        },
        then(resolve: any, reject: any) {
          const data = (tables[table] ?? []).filter((r) =>
            filters.every((f) => f(r))
          ).sort((a, b) => String(a[sort]).localeCompare(String(b[sort])))
            .slice(from, to + 1);
          return Promise.resolve({
            data,
            error: table === failTable ? { message: "synthetic_error" } : null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { db, calls };
}
const base = {
  created_at: "2026-01-01T00:00:00Z",
  user_id: "user",
  profile_id: "profile",
};
Deno.test("loader pages all canonical orders, retains free/failed states, and strips unrelated fields", async () => {
  const orders = Array.from(
    { length: 205 },
    (_, i) => ({
      ...base,
      id: "o" + String(i).padStart(3, "0"),
      product_id: "course",
      status: i === 0 ? "paid" : "failed",
      final_price: i === 0 ? 0 : 100,
      currency: "BYN",
      is_deleted: false,
    }),
  );
  const f = fixture({
    orders_v2: orders,
    products_v2: [{ id: "course", name: "ЦБ", created_at: base.created_at }],
    entitlement_sources: [{
      ...base,
      id: "bonus",
      product_id: "course",
      source_type: "bonus",
      status: "active",
      starts_at: base.created_at,
      secret: "must-not-escape",
    }],
  });
  const r = await loadClientEvidence(f.db, "user", "profile", "course", at, []);
  check(r.purchases.length === 205);
  check(r.purchases[0].classification === "zero_price_order");
  check(!r.current_course_paid && r.current_course_checkout_hold);
  check(r.purchase_history_complete === false);
  check(
    r.access[0].source_type === "bonus" && r.access[0].payment_proof === false,
  );
  check(!JSON.stringify(r).includes("must-not-escape"));
  check(f.calls.some((c) => c.table === "orders_v2" && c.range?.[0] === 200));
  check(
    f.calls.every((c) =>
      !c.fields.includes("session_key") &&
      !c.fields.includes("provider_response") &&
      !c.fields.includes("payment_token")
    ),
  );
});
Deno.test("linked payment without identity is bound by exact order FK; foreign identity stops context", async () => {
  const order = {
    ...base,
    id: "o",
    product_id: "course",
    status: "paid",
    final_price: 100,
    currency: "BYN",
    is_deleted: false,
  };
  const pm = {
    id: "p",
    created_at: base.created_at,
    order_id: "o",
    status: "succeeded",
    amount: 100,
    currency: "BYN",
  };
  const f = fixture({ orders_v2: [order,{...order,id:'old-deleted',profile_id:'foreign',is_deleted:true}], payments_v2: [pm,{...pm,id:'deleted-payment',profile_id:'foreign',is_deleted:true}] });
  check(
    (await loadClientEvidence(f.db, "user", "profile", "course", at, []))
      .current_course_paid,
  );
  const wrong = fixture({
    orders_v2: [order],
    payments_v2: [{ ...pm, profile_id: "foreign" }],
  });
  let stopped = false;
  try {
    await loadClientEvidence(wrong.db, "user", "profile", "course", at, []);
  } catch (e) {
    stopped = String(e).includes("identity_conflict");
  }
  check(stopped);
});
Deno.test("missing source query fails closed; a shared autoweb session is read only with own player record", async () => {
  const f = fixture({}, "entitlements");
  let stopped = false;
  try {
    await loadClientEvidence(f.db, "user", "profile", "course", at, []);
  } catch {
    stopped = true;
  }
  check(stopped);
  const data = {
    live_event_session_progress: [{
      id: "progress",
      created_at: base.created_at,
      viewer_user_id: "user",
      session_id: "session",
      max_watched_seconds: 3600,
    }],
    live_event_sessions: [{
      id: "session",
      created_at: base.created_at,
      viewer_user_id: null,
      live_event_id: "event",
    }],
    live_events: [{
      id: "event",
      created_at: base.created_at,
      title: "Webinar",
    }],
  };
  const r = await loadClientEvidence(
    fixture(data).db,
    "user",
    "profile",
    "course",
    at,
    [],
  );
  check(
    r.webinar_activity[0].player_evidence[0].furthest_position_seconds === 3600,
  );
  check(r.webinar_activity[0].completion_verified === false);
});
