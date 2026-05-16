// PATCH H3.x-a — tests for classifySameProductState (B-2 root-fix helper).
//
// Verifies decision contract:
//   extend_same_tariff  — same user+product+tariff active+provider-managed sub;
//   replace_other_tariff — same product, другой tariff_id (или null);
//   no_existing         — нет provider-managed sub (zombie без provider linkage игнорируется);
//   error               — fail-closed на ошибке запроса.
//
// Anti-regression (требование #9 утверждённого плана):
//   active subscription same user/product/tariff/provider →
//     decision='extend_same_tariff' → writer вернёт already_has_active_subscription
//     → НЕ создаст новой subscriptions_v2 и НЕ дёрнет bePaid /subscriptions.

import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { classifySameProductState } from "./subscription-conflict.ts";

const USER = "00000000-0000-0000-0000-00000000a001";
const PRODUCT = "00000000-0000-0000-0000-0000000000b1";
const TARIFF_A = "00000000-0000-0000-0000-0000000000c1";
const TARIFF_B = "00000000-0000-0000-0000-0000000000c2";

interface Row {
  id: string;
  status: string;
  tariff_id: string | null;
  access_end_at?: string | null;
  next_charge_at?: string | null;
  created_at?: string;
}

function makeMock(opts: {
  subs?: Row[];
  providerSubByV2: Record<string, { provider_subscription_id: string; state: string } | null>;
  subsError?: boolean;
  providerError?: boolean;
}) {
  return {
    from(table: string) {
      if (table === "subscriptions_v2") {
        return {
          select(_cols: string) {
            const filters: { col: string; val: any; op: string }[] = [];
            const chain: any = {
              eq(col: string, val: any) { filters.push({ col, val, op: "eq" }); return chain; },
              in(col: string, vals: any[]) { filters.push({ col, val: vals, op: "in" }); return chain; },
              order(_c: string, _o: any) { return chain; },
              then(resolve: any) {
                if (opts.subsError) return resolve({ data: null, error: { message: "boom" } });
                const all = (opts.subs ?? []).map((r) => ({ ...r, user_id: USER, product_id: PRODUCT }));
                const filtered = all.filter((r) =>
                  filters.every((f) => {
                    if (f.op === "in") return (f.val as any[]).includes((r as any)[f.col]);
                    return (r as any)[f.col] === f.val;
                  })
                );
                return resolve({ data: filtered, error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === "provider_subscriptions") {
        return {
          select(_cols: string) {
            let subId: string | null = null;
            const chain: any = {
              eq(col: string, val: any) { if (col === "subscription_v2_id") subId = val; return chain; },
              in(_c: string, _v: any[]) { return chain; },
              limit(_n: number) { return chain; },
              async maybeSingle() {
                if (opts.providerError) return { data: null, error: { message: "boom" } };
                const v = subId ? opts.providerSubByV2[subId] ?? null : null;
                return { data: v ? { ...v, provider: "bepaid" } : null, error: null };
              },
            };
            return chain;
          },
        };
      }
      throw new Error("unexpected table: " + table);
    },
  } as any;
}

Deno.test("classifySameProductState — no_existing when no candidates", async () => {
  const supabase = makeMock({ subs: [], providerSubByV2: {} });
  const r = await classifySameProductState(supabase, { user_id: USER, product_id: PRODUCT, tariff_id: TARIFF_A });
  assertEquals(r.status, "ok");
  if (r.status === "ok") assertEquals(r.decision, "no_existing");
});

Deno.test("classifySameProductState — no_existing when only zombie (no provider linkage)", async () => {
  const supabase = makeMock({
    subs: [{ id: "v2-zombie", status: "active", tariff_id: TARIFF_A }],
    providerSubByV2: { "v2-zombie": null },
  });
  const r = await classifySameProductState(supabase, { user_id: USER, product_id: PRODUCT, tariff_id: TARIFF_A });
  assertEquals(r.status, "ok");
  if (r.status === "ok") assertEquals(r.decision, "no_existing");
});

Deno.test("classifySameProductState — extend_same_tariff when active+provider sub matches tariff", async () => {
  const supabase = makeMock({
    subs: [{ id: "v2-active", status: "active", tariff_id: TARIFF_A }],
    providerSubByV2: { "v2-active": { provider_subscription_id: "sbs_111", state: "active" } },
  });
  const r = await classifySameProductState(supabase, { user_id: USER, product_id: PRODUCT, tariff_id: TARIFF_A });
  assertEquals(r.status, "ok");
  if (r.status === "ok") {
    assertEquals(r.decision, "extend_same_tariff");
    assertEquals(r.existing?.subscription_v2_id, "v2-active");
    assertEquals(r.existing?.provider_subscription_id, "sbs_111");
  }
});

Deno.test("classifySameProductState — replace_other_tariff when active+provider sub on different tariff", async () => {
  const supabase = makeMock({
    subs: [{ id: "v2-other", status: "active", tariff_id: TARIFF_B }],
    providerSubByV2: { "v2-other": { provider_subscription_id: "sbs_222", state: "pending" } },
  });
  const r = await classifySameProductState(supabase, { user_id: USER, product_id: PRODUCT, tariff_id: TARIFF_A });
  assertEquals(r.status, "ok");
  if (r.status === "ok") {
    assertEquals(r.decision, "replace_other_tariff");
    assertEquals(r.existing?.tariff_id, TARIFF_B);
  }
});

Deno.test("classifySameProductState — fail-closed on subs query error", async () => {
  const supabase = makeMock({ subs: [], providerSubByV2: {}, subsError: true });
  const r = await classifySameProductState(supabase, { user_id: USER, product_id: PRODUCT, tariff_id: TARIFF_A });
  assertEquals(r.status, "error");
});

Deno.test("classifySameProductState — fail-closed on provider query error", async () => {
  const supabase = makeMock({
    subs: [{ id: "v2-x", status: "active", tariff_id: TARIFF_A }],
    providerSubByV2: {},
    providerError: true,
  });
  const r = await classifySameProductState(supabase, { user_id: USER, product_id: PRODUCT, tariff_id: TARIFF_A });
  assertEquals(r.status, "error");
});

Deno.test("classifySameProductState — anti-regression: same-tariff active sub blocks new write-path (H3.x-a #9)", async () => {
  // Same user/product/tariff + provider-managed active sub → extend_same_tariff,
  // writer ОБЯЗАН не создавать new subscriptions_v2 и не вызывать bePaid /subscriptions.
  const supabase = makeMock({
    subs: [
      { id: "v2-active", status: "active", tariff_id: TARIFF_A },
      { id: "v2-zombie", status: "active", tariff_id: TARIFF_A },
    ],
    providerSubByV2: {
      "v2-active": { provider_subscription_id: "sbs_anti_regression", state: "active" },
      "v2-zombie": null,
    },
  });
  const r = await classifySameProductState(supabase, { user_id: USER, product_id: PRODUCT, tariff_id: TARIFF_A });
  assertEquals(r.status, "ok");
  if (r.status === "ok") {
    assertEquals(r.decision, "extend_same_tariff");
    assertEquals(r.existing?.provider_subscription_id, "sbs_anti_regression");
  }
});

Deno.test("classifySameProductState — missing tariff_id with provider sub → replace_other_tariff", async () => {
  // Если caller вызвал без tariff_id (legacy/edge), но active provider sub есть —
  // классифицируем как replace_other_tariff (writer вернёт conflict без replacement_id).
  const supabase = makeMock({
    subs: [{ id: "v2-active", status: "active", tariff_id: TARIFF_A }],
    providerSubByV2: { "v2-active": { provider_subscription_id: "sbs_x", state: "active" } },
  });
  const r = await classifySameProductState(supabase, { user_id: USER, product_id: PRODUCT, tariff_id: null });
  assertEquals(r.status, "ok");
  if (r.status === "ok") assertEquals(r.decision, "replace_other_tariff");
});
