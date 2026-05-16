// Tests for PATCH H2.1b-i — 3DS writer extension (stabilized for H2.1b-ii outcome union).
// Pure-helper tests + handler tests with in-memory supabase mock.
// H2.1b-ii additions in mock: `.in()` filter, profiles/products_v2/entitlements tables,
// injected invokeTelegramGrant.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyProration,
  bootstrapTrial,
  classifyCandidates,
  computeNextChargeAt,
  handleThreeDsFinalize,
  resolveExtendFromDate,
  SubShape,
  TariffShape,
} from "./three_ds_writer.ts";

const NOW = new Date("2026-05-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

// ---------------- pure helpers ----------------

Deno.test("resolveExtendFromDate: new sub + non-trial → now/new_from_now", () => {
  const r = resolveExtendFromDate(null, { id: "o", user_id: "u", product_id: "p", tariff_id: "t1" }, NOW);
  assertEquals(r.reason, "new_from_now");
});

Deno.test("resolveExtendFromDate: trial → trial_end_at", () => {
  const trialEnd = new Date(NOW.getTime() + 7 * DAY).toISOString();
  const r = resolveExtendFromDate(null, {
    id: "o", user_id: "u", product_id: "p", tariff_id: "t1",
    is_trial: true, trial_end_at: trialEnd,
  }, NOW);
  assertEquals(r.reason, "trial_from_trial_end");
  assertEquals(r.extendFromDate.toISOString(), trialEnd);
});

Deno.test("resolveExtendFromDate: active same tariff → from access_end_at", () => {
  const end = new Date(NOW.getTime() + 10 * DAY).toISOString();
  const sub: SubShape = { id: "s", status: "active", tariff_id: "t1", access_end_at: end };
  const r = resolveExtendFromDate(sub, { id: "o", user_id: "u", product_id: "p", tariff_id: "t1" }, NOW);
  assertEquals(r.reason, "same_tariff_from_end");
  assertEquals(r.extendFromDate.toISOString(), end);
});

Deno.test("resolveExtendFromDate: tariff change → now", () => {
  const end = new Date(NOW.getTime() + 10 * DAY).toISOString();
  const sub: SubShape = { id: "s", status: "active", tariff_id: "t1", access_end_at: end };
  const r = resolveExtendFromDate(sub, { id: "o", user_id: "u", product_id: "p", tariff_id: "t2" }, NOW);
  assertEquals(r.reason, "tariff_change_from_now");
});

Deno.test("resolveExtendFromDate: past_due → max(now, end)", () => {
  const end = new Date(NOW.getTime() - 5 * DAY).toISOString();
  const sub: SubShape = { id: "s", status: "past_due", tariff_id: "t1", access_end_at: end };
  const r = resolveExtendFromDate(sub, { id: "o", user_id: "u", product_id: "p", tariff_id: "t1" }, NOW);
  assertEquals(r.reason, "past_due_reattach_from_max");
  assertEquals(r.extendFromDate.getTime(), NOW.getTime());
});

Deno.test("applyProration: bonus days proportional to amount ratio", () => {
  const sub: SubShape = {
    id: "s", status: "active", tariff_id: "t1",
    access_end_at: new Date(NOW.getTime() + 10 * DAY).toISOString(),
  };
  const oldT: TariffShape = { id: "t1", access_days: 30, amount: 100 };
  const newT: TariffShape = { id: "t2", access_days: 30, amount: 200 };
  const r = applyProration(sub, oldT, newT, NOW);
  assertEquals(r.remaining_days, 10);
  assertEquals(r.bonus_days, 5); // 10 * (100/200)
});

Deno.test("applyProration: zero amount → no bonus", () => {
  const sub: SubShape = {
    id: "s", status: "active", tariff_id: "t1",
    access_end_at: new Date(NOW.getTime() + 10 * DAY).toISOString(),
  };
  const r = applyProration(sub, { id: "t1", access_days: 30, amount: 0 }, { id: "t2", access_days: 30, amount: 100 }, NOW);
  assertEquals(r.bonus_days, 0);
});

Deno.test("bootstrapTrial: returns trial_end_at + trialing", () => {
  const end = new Date(NOW.getTime() + 7 * DAY).toISOString();
  const r = bootstrapTrial({ id: "o", user_id: "u", product_id: "p", tariff_id: "t", is_trial: true, trial_end_at: end });
  assertEquals(r?.access_end_at, end);
  assertEquals(r?.status, "trialing");
});

Deno.test("bootstrapTrial: not a trial → null", () => {
  const r = bootstrapTrial({ id: "o", user_id: "u", product_id: "p", tariff_id: "t" });
  assertEquals(r, null);
});

Deno.test("computeNextChargeAt: trial → -1d, recurring → -3d", () => {
  const end = new Date(NOW.getTime() + 30 * DAY);
  const tr = computeNextChargeAt(end, true);
  const rc = computeNextChargeAt(end, false);
  assertEquals(tr.offset_days, 1);
  assertEquals(rc.offset_days, 3);
  assertEquals(new Date(tr.next_charge_at).getTime(), end.getTime() - DAY);
  assertEquals(new Date(rc.next_charge_at).getTime(), end.getTime() - 3 * DAY);
});

Deno.test("classifyCandidates: 0 → create_new, 1 → single, 2 → multi_review", () => {
  assertEquals(classifyCandidates([]).decision, "create_new");
  assertEquals(
    classifyCandidates([{ id: "a", status: "active", tariff_id: "t", access_end_at: null }]).decision,
    "single",
  );
  assertEquals(
    classifyCandidates([
      { id: "a", status: "active", tariff_id: "t", access_end_at: null },
      { id: "b", status: "past_due", tariff_id: "t", access_end_at: null },
    ]).decision,
    "multi_review",
  );
});

Deno.test("classifyCandidates: canceled subs ignored", () => {
  const r = classifyCandidates([
    { id: "a", status: "canceled", tariff_id: "t", access_end_at: null },
    { id: "b", status: "active", tariff_id: "t", access_end_at: null },
  ]);
  assertEquals(r.decision, "single");
  assertEquals(r.candidates.length, 1);
});

// ---------------- handler with mock supabase ----------------

type Row = Record<string, any>;

interface MockState {
  orders?: Row[];
  subscriptions?: Row[];
  tariffs?: Row[];
  profiles?: Row[];
  products_v2?: Row[];
  entitlements?: Row[];
}

function makeMockSb(state: MockState) {
  const tables: Record<string, Row[]> = {
    orders_v2: state.orders ?? [],
    subscriptions_v2: state.subscriptions ?? [],
    tariffs: state.tariffs ?? [],
    profiles: state.profiles ?? [],
    products_v2: state.products_v2 ?? [],
    entitlements: state.entitlements ?? [],
  };
  const inserts: { table: string; payload: Row }[] = [];
  const updates: { table: string; id: string; payload: Row }[] = [];

  function table(name: string) {
    const rows: Row[] = tables[name] ?? [];
    const filters: Array<(r: Row) => boolean> = [];

    const builder: any = {
      select: (_cols: string) => builder,
      eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return builder; },
      in: (k: string, vs: any[]) => { filters.push((r) => vs.includes(r[k])); return builder; },
      order: (_k: string, _opts?: any) => builder,
      maybeSingle: async () => {
        const f = rows.filter((r) => filters.every((fn) => fn(r)));
        return { data: f[0] ?? null, error: null };
      },
      single: async () => {
        const f = rows.filter((r) => filters.every((fn) => fn(r)));
        return { data: f[0] ?? null, error: null };
      },
      then: (resolve: any) => {
        const f = rows.filter((r) => filters.every((fn) => fn(r)));
        resolve({ data: f, error: null });
      },
    };

    const insertBuilder = (payload: Row) => {
      const row = { id: `${name}-${rows.length + 1}`, ...payload };
      rows.push(row);
      inserts.push({ table: name, payload });
      return {
        select: (_c: string) => ({
          single: async () => ({ data: { id: row.id }, error: null }),
        }),
      };
    };

    const updateBuilder = (payload: Row) => {
      const f: Array<(r: Row) => boolean> = [];
      const ub: any = {
        eq: (k: string, v: any) => { f.push((r) => r[k] === v); return ub; },
        then: (resolve: any) => {
          for (const r of rows) {
            if (f.every((fn) => fn(r))) {
              Object.assign(r, payload);
              updates.push({ table: name, id: r.id, payload });
            }
          }
          resolve({ data: null, error: null });
        },
      };
      return ub;
    };

    return Object.assign(builder, {
      insert: insertBuilder,
      update: updateBuilder,
    });
  }

  return {
    sb: { from: table } as any,
    inserts,
    updates,
    tables,
  };
}

function makeAudit() {
  const events: { action: string; meta: Record<string, unknown> }[] = [];
  return {
    audit: async (action: string, meta: Record<string, unknown>) => {
      events.push({ action, meta });
    },
    events,
  };
}

// Standard seeds reused across handler tests: profile + product so that
// ensurePrimaryEntitlement & invokeTelegram have valid lookups.
function baseSeeds(): Pick<MockState, "profiles" | "products_v2"> {
  return {
    profiles: [{ id: "prof-1", user_id: "u" }],
    products_v2: [{ id: "p", code: "test_code", name: "Test", telegram_club_id: null }],
  };
}

// telegram dep: always skipped (no club) — but we still inject to avoid network.
const tgSkip = async () => ({ status: "skipped" as const, reason: "test" });

Deno.test("handler: create_new_subscription → bootstrap_created, 1 insert", async () => {
  const { sb, inserts } = makeMockSb({
    ...baseSeeds(),
    orders: [{ id: "o1", user_id: "u", product_id: "p", tariff_id: "t1", status: "paid" }],
    subscriptions: [],
    tariffs: [{ id: "t1", access_days: 30, amount: 100 }],
  });
  const { audit } = makeAudit();
  const r = await handleThreeDsFinalize("o1", { supabase: sb, now: NOW, audit, invokeTelegramGrant: tgSkip });
  assertEquals(r.kind, "bootstrap_created");
  if (r.kind === "bootstrap_created") {
    assertEquals(r.bootstrap, "recurring");
    assert(r.next_charge_at_suggested);
  }
  assertEquals(inserts.filter((i) => i.table === "subscriptions_v2").length, 1);
});

Deno.test("handler: extend_same_tariff → extended, end + 30d", async () => {
  const oldEnd = new Date(NOW.getTime() + 5 * DAY).toISOString();
  const { sb } = makeMockSb({
    ...baseSeeds(),
    orders: [{ id: "o1", user_id: "u", product_id: "p", tariff_id: "t1", status: "paid" }],
    subscriptions: [{ id: "s1", user_id: "u", product_id: "p", tariff_id: "t1", status: "active", access_end_at: oldEnd, meta: {} }],
    tariffs: [{ id: "t1", access_days: 30, amount: 100 }],
  });
  const { audit } = makeAudit();
  const r = await handleThreeDsFinalize("o1", { supabase: sb, now: NOW, audit, invokeTelegramGrant: tgSkip });
  assertEquals(r.kind, "extended");
  if (r.kind === "extended") {
    assertEquals(r.extend_from_reason, "same_tariff_from_end");
    const expected = new Date(new Date(oldEnd).getTime() + 30 * DAY).toISOString();
    assertEquals(r.access_end_at, expected);
  }
});

Deno.test("handler: tariff_change_with_proration → bonus_days > 0", async () => {
  const oldEnd = new Date(NOW.getTime() + 10 * DAY).toISOString();
  const { sb } = makeMockSb({
    ...baseSeeds(),
    orders: [{ id: "o1", user_id: "u", product_id: "p", tariff_id: "t2", status: "paid" }],
    subscriptions: [{ id: "s1", user_id: "u", product_id: "p", tariff_id: "t1", status: "active", access_end_at: oldEnd, meta: {} }],
    tariffs: [
      { id: "t1", access_days: 30, amount: 100 },
      { id: "t2", access_days: 30, amount: 200 },
    ],
  });
  const { audit, events } = makeAudit();
  const r = await handleThreeDsFinalize("o1", { supabase: sb, now: NOW, audit, invokeTelegramGrant: tgSkip });
  assertEquals(r.kind, "extended");
  if (r.kind === "extended") {
    assertEquals(r.extend_from_reason, "tariff_change_from_now");
    // 30 base + 5 bonus = 35 days from now
    const expected = new Date(NOW.getTime() + 35 * DAY).toISOString();
    assertEquals(r.access_end_at, expected);
  }
  assert(events.some((e) => e.action === "grant.proration_applied"));
});

Deno.test("handler: trial_bootstrap → status trialing, end = trial_end_at", async () => {
  const trialEnd = new Date(NOW.getTime() + 7 * DAY).toISOString();
  const { sb, inserts } = makeMockSb({
    ...baseSeeds(),
    orders: [{ id: "o1", user_id: "u", product_id: "p", tariff_id: "t1", status: "paid", is_trial: true, trial_end_at: trialEnd }],
    subscriptions: [],
    tariffs: [{ id: "t1", access_days: 30, amount: 100 }],
  });
  const { audit, events } = makeAudit();
  const r = await handleThreeDsFinalize("o1", { supabase: sb, now: NOW, audit, invokeTelegramGrant: tgSkip });
  assertEquals(r.kind, "bootstrap_created");
  if (r.kind === "bootstrap_created") {
    assertEquals(r.bootstrap, "trial");
    assertEquals(r.access_end_at, trialEnd);
    assert(r.next_charge_at_suggested);
  }
  const sub = inserts.find((i) => i.table === "subscriptions_v2");
  assertEquals(sub?.payload.status, "trialing");
  assert(events.some((e) => e.action === "grant.trial_bootstrap"));
});

Deno.test("handler: past_due_reattach → status=active, reattach meta set", async () => {
  const oldEnd = new Date(NOW.getTime() - 2 * DAY).toISOString();
  const { sb, updates } = makeMockSb({
    ...baseSeeds(),
    orders: [{ id: "o1", user_id: "u", product_id: "p", tariff_id: "t1", status: "paid" }],
    subscriptions: [{ id: "s1", user_id: "u", product_id: "p", tariff_id: "t1", status: "past_due", access_end_at: oldEnd, meta: {} }],
    tariffs: [{ id: "t1", access_days: 30, amount: 100 }],
  });
  const { audit, events } = makeAudit();
  const r = await handleThreeDsFinalize("o1", { supabase: sb, now: NOW, audit, invokeTelegramGrant: tgSkip });
  assertEquals(r.kind, "extended");
  if (r.kind === "extended") {
    assertEquals(r.extend_from_reason, "past_due_reattach_from_max");
  }
  const upd = updates.find((u) => u.id === "s1");
  assertEquals(upd?.payload.status, "active");
  const meta = upd?.payload.meta as any;
  assertEquals(meta.reattached_from_order_id, "o1");
  assert(events.some((e) => e.action === "grant.subscription_order_attached"));
});

Deno.test("handler: multi_candidate → manual_review, 0 writes", async () => {
  const { sb, inserts, updates } = makeMockSb({
    ...baseSeeds(),
    orders: [{ id: "o1", user_id: "u", product_id: "p", tariff_id: "t1", status: "paid" }],
    subscriptions: [
      { id: "s1", user_id: "u", product_id: "p", tariff_id: "t1", status: "active", access_end_at: NOW.toISOString(), meta: {} },
      { id: "s2", user_id: "u", product_id: "p", tariff_id: "t2", status: "past_due", access_end_at: NOW.toISOString(), meta: {} },
    ],
    tariffs: [{ id: "t1", access_days: 30 }, { id: "t2", access_days: 30 }],
  });
  const { audit, events } = makeAudit();
  const r = await handleThreeDsFinalize("o1", { supabase: sb, now: NOW, audit, invokeTelegramGrant: tgSkip });
  assertEquals(r.kind, "manual_review_multi_candidate");
  if (r.kind === "manual_review_multi_candidate") {
    assertEquals(r.candidate_ids.sort(), ["s1", "s2"]);
  }
  assertEquals(inserts.length, 0);
  assertEquals(updates.length, 0);
  assert(events.some((e) => e.action === "grant.multi_candidate_review"));
});

Deno.test("handler: skip_already_processed when order already attached AND entitlement valid", async () => {
  const validEnd = new Date(NOW.getTime() + 10 * DAY).toISOString();
  const { sb, inserts, updates } = makeMockSb({
    ...baseSeeds(),
    orders: [{ id: "o1", user_id: "u", product_id: "p", tariff_id: "t1", status: "paid" }],
    subscriptions: [{ id: "s1", user_id: "u", product_id: "p", tariff_id: "t1", status: "active", order_id: "o1", access_end_at: validEnd, meta: {} }],
    tariffs: [{ id: "t1", access_days: 30 }],
    entitlements: [{ id: "e1", user_id: "u", product_id: "p", status: "active", expires_at: validEnd, meta: {} }],
  });
  const { audit } = makeAudit();
  const r = await handleThreeDsFinalize("o1", { supabase: sb, now: NOW, audit, invokeTelegramGrant: tgSkip });
  assertEquals(r.kind, "skip_already_processed");
  assertEquals(inserts.length, 0);
  assertEquals(updates.length, 0);
});

Deno.test("handler: response always contains next_charge_at_suggested for ok/extended/bootstrap", async () => {
  const { sb } = makeMockSb({
    ...baseSeeds(),
    orders: [{ id: "o1", user_id: "u", product_id: "p", tariff_id: "t1", status: "paid" }],
    subscriptions: [],
    tariffs: [{ id: "t1", access_days: 30, amount: 100 }],
  });
  const { audit } = makeAudit();
  const r = await handleThreeDsFinalize("o1", { supabase: sb, now: NOW, audit, invokeTelegramGrant: tgSkip });
  if (r.kind === "bootstrap_created" || r.kind === "ok" || r.kind === "extended") {
    assert(r.next_charge_at_suggested);
  } else {
    throw new Error(`Unexpected kind ${r.kind}`);
  }
});
