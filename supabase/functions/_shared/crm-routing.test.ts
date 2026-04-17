/**
 * Deno-tests для _shared/crm-routing.ts
 *
 * Покрывают чистую логику резолва и применения terminal-стадии
 * с моками Supabase-клиента (без сети). Live proof собирается
 * отдельно через SQL-пакет (см. crm-routing.proof.sql).
 *
 * Запуск:
 *   supabase test_edge_functions с functions=["_shared"] или pattern="crm-routing"
 *   либо локально: deno test supabase/functions/_shared/crm-routing.test.ts --allow-env
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveOfferRouting, applyCrmStageOnTerminal, resolveOfferRoutingWithFallback, buildNegativeSnapshot } from "./crm-routing.ts";

// ---------- Helpers: мок Supabase-клиента ----------

const PIPELINE_ID = "11111111-1111-1111-1111-111111111111";
const STAGE_PENDING = "22222222-2222-2222-2222-222222222222";
const STAGE_SUCCESS = "33333333-3333-3333-3333-333333333333";
const STAGE_FAILED = "44444444-4444-4444-4444-444444444444";
const STAGE_OTHER_OPEN = "55555555-5555-5555-5555-555555555555";
const OFFER_ID = "66666666-6666-6666-6666-666666666666";
const ORDER_ID = "77777777-7777-7777-7777-777777777777";

interface MockState {
  offer?: any;
  /** Per-id offer lookup, used by fallback after candidate selection. */
  offersById?: Record<string, any>;
  pipeline?: any;
  stages?: any[];
  order?: any;
  /** Candidate offers returned by tariff_offers list-query in fallback resolver. */
  tariffOfferCandidates?: any[];
  updates: Array<{ table: string; values: any; eqs: Array<[string, any]> }>;
  audits: Array<{ action: string; meta: any }>;
}

function makeSupabase(state: MockState): any {
  const builder = (table: string) => {
    let _select = "*";
    const _eqs: Array<[string, any]> = [];
    const _ins: Array<[string, any[]]> = [];
    const api: any = {
      select(sel: string) { _select = sel; return api; },
      eq(col: string, val: any) { _eqs.push([col, val]); return api; },
      in(col: string, vals: any[]) { _ins.push([col, vals]); return api; },
      maybeSingle: async () => {
        if (table === "tariff_offers") {
          // Lookup by id (used inside resolveOfferRouting after fallback picks one)
          const idEq = _eqs.find(([c]) => c === "id");
          if (idEq && state.offersById && state.offersById[idEq[1]]) {
            return { data: state.offersById[idEq[1]], error: null };
          }
          return { data: state.offer ?? null, error: null };
        }
        if (table === "crm_pipelines") return { data: state.pipeline ?? null, error: null };
        if (table === "orders_v2") return { data: state.order ?? null, error: null };
        return { data: null, error: null };
      },
      then: undefined as any,
      async [Symbol.asyncIterator]() {},
      update(values: any) {
        const upd = { table, values, eqs: [] as Array<[string, any]> };
        const u: any = {
          eq(col: string, val: any) { upd.eqs.push([col, val]); return u; },
          then(resolve: any) {
            state.updates.push(upd);
            resolve({ error: null });
          },
        };
        return u;
      },
      insert(values: any) {
        if (table === "audit_logs") {
          state.audits.push({ action: values.action, meta: values.meta });
        }
        return Promise.resolve({ error: null });
      },
    };
    // Awaitable list-query support (no maybeSingle):
    //  - crm_pipeline_stages with .in('id', [...])
    //  - tariff_offers with .eq('tariff_id',...).eq('is_active',true).eq('offer_type','pay_now')
    (api as any).then = (resolve: any) => {
      if (table === "crm_pipeline_stages" && _ins.length > 0) {
        const ids = _ins[0][1];
        const filtered = (state.stages ?? []).filter((s) => ids.includes(s.id));
        resolve({ data: filtered, error: null });
      } else if (table === "tariff_offers") {
        resolve({ data: state.tariffOfferCandidates ?? [], error: null });
      } else {
        resolve({ data: null, error: null });
      }
    };
    return api;
  };
  return { from: builder };
}

function defaultStages() {
  return [
    { id: STAGE_PENDING, name: "В работе", stage_type: "open", pipeline_id: PIPELINE_ID },
    { id: STAGE_SUCCESS, name: "Оплачено", stage_type: "closed_won", pipeline_id: PIPELINE_ID },
    { id: STAGE_FAILED, name: "Отказ", stage_type: "closed_lost", pipeline_id: PIPELINE_ID },
    { id: STAGE_OTHER_OPEN, name: "Согласование", stage_type: "open", pipeline_id: PIPELINE_ID },
  ];
}

function validRouting() {
  return {
    enabled: true,
    pipeline_id: PIPELINE_ID,
    stage_on_pending: STAGE_PENDING,
    stage_on_success: STAGE_SUCCESS,
    stage_on_failed: STAGE_FAILED,
  };
}

function snapshot() {
  return {
    enabled: true,
    pipeline_id: PIPELINE_ID,
    stage_on_pending: STAGE_PENDING,
    stage_on_success: STAGE_SUCCESS,
    stage_on_failed: STAGE_FAILED,
    offer_id: OFFER_ID,
    offer_updated_at: "2025-04-01T00:00:00Z",
    pipeline_name: "Sales",
    stage_names: { pending: "В работе", success: "Оплачено", failed: "Отказ" },
    stage_types: { pending: "open", success: "closed_won", failed: "closed_lost" },
    offer_title: "Тариф PRO",
  };
}

// ---------- resolveOfferRouting ----------

Deno.test("resolveOfferRouting: invalid offer_id → no_offer_id", async () => {
  const sb = makeSupabase({ updates: [], audits: [] });
  const r = await resolveOfferRouting(sb, "");
  assertEquals(r.ok, false);
  assertEquals(r.reason, "no_offer_id");
});

Deno.test("resolveOfferRouting: offer not found", async () => {
  const sb = makeSupabase({ updates: [], audits: [] });
  const r = await resolveOfferRouting(sb, OFFER_ID);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "offer_not_found");
});

Deno.test("resolveOfferRouting: routing disabled", async () => {
  const sb = makeSupabase({
    offer: { id: OFFER_ID, button_label: "X", meta: { crm_routing: { ...validRouting(), enabled: false } }, updated_at: null, tariff_id: null },
    updates: [], audits: [],
  });
  const r = await resolveOfferRouting(sb, OFFER_ID);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "routing_disabled_or_missing");
});

Deno.test("resolveOfferRouting: duplicate stage ids", async () => {
  const routing = { ...validRouting(), stage_on_failed: STAGE_SUCCESS };
  const sb = makeSupabase({
    offer: { id: OFFER_ID, button_label: "X", meta: { crm_routing: routing }, updated_at: null, tariff_id: null },
    updates: [], audits: [],
  });
  const r = await resolveOfferRouting(sb, OFFER_ID);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "duplicate_stage_ids");
});

Deno.test("resolveOfferRouting v2: любой stage_type допустим (open для success)", async () => {
  // v2: семантика stage_type больше не валидируется helper-ом — менеджер сам
  // решает, какая стадия означает «успех». Резолв должен пройти.
  const stages = defaultStages().map((s) =>
    s.id === STAGE_SUCCESS ? { ...s, stage_type: "open" } : s
  );
  const sb = makeSupabase({
    offer: { id: OFFER_ID, button_label: "PRO", meta: { crm_routing: validRouting() }, updated_at: "2025-04-01T00:00:00Z", tariff_id: null },
    pipeline: { id: PIPELINE_ID, name: "Sales" },
    stages,
    updates: [], audits: [],
  });
  const r = await resolveOfferRouting(sb, OFFER_ID);
  assert(r.ok);
  assertEquals(r.snapshot?.stage_types.success, "open");
});

Deno.test("resolveOfferRouting: happy path → snapshot", async () => {
  const sb = makeSupabase({
    offer: { id: OFFER_ID, button_label: "PRO", meta: { crm_routing: validRouting() }, updated_at: "2025-04-01T00:00:00Z", tariff_id: null },
    pipeline: { id: PIPELINE_ID, name: "Sales" },
    stages: defaultStages(),
    updates: [], audits: [],
  });
  const r = await resolveOfferRouting(sb, OFFER_ID);
  assert(r.ok);
  assertEquals(r.snapshot?.pipeline_id, PIPELINE_ID);
  assertEquals(r.snapshot?.pipeline_name, "Sales");
  assertEquals(r.snapshot?.stage_names.success, "Оплачено");
  assertEquals(r.snapshot?.offer_title, "PRO");
});

// ---------- applyCrmStageOnTerminal ----------

Deno.test("applyCrmStageOnTerminal: no snapshot → skipped_invalid_config", async () => {
  const state: MockState = {
    order: { id: ORDER_ID, pipeline_id: null, pipeline_stage_id: null, meta: {}, offer_id: null },
    updates: [], audits: [],
  };
  const sb = makeSupabase(state);
  const r = await applyCrmStageOnTerminal(sb, ORDER_ID, "success", "test");
  assertEquals(r.applied, false);
  assertEquals(r.reason, "no_snapshot");
  assertEquals(state.audits[0].action, "crm_stage_apply_skipped_invalid_config");
  assertEquals(state.updates.length, 0);
});

Deno.test("applyCrmStageOnTerminal: success happy path", async () => {
  const state: MockState = {
    order: {
      id: ORDER_ID, pipeline_id: PIPELINE_ID, pipeline_stage_id: STAGE_PENDING,
      meta: { crm_routing_snapshot: snapshot() }, offer_id: OFFER_ID,
    },
    updates: [], audits: [],
  };
  const sb = makeSupabase(state);
  const r = await applyCrmStageOnTerminal(sb, ORDER_ID, "success", "webhook_paid");
  assertEquals(r.applied, true);
  assertEquals(state.updates.length, 1);
  assertEquals(state.updates[0].values.pipeline_stage_id, STAGE_SUCCESS);
  assertEquals(state.audits[0].action, "crm_stage_applied_success");
});

Deno.test("applyCrmStageOnTerminal: failed happy path", async () => {
  const state: MockState = {
    order: {
      id: ORDER_ID, pipeline_id: PIPELINE_ID, pipeline_stage_id: STAGE_PENDING,
      meta: { crm_routing_snapshot: snapshot() }, offer_id: OFFER_ID,
    },
    updates: [], audits: [],
  };
  const sb = makeSupabase(state);
  const r = await applyCrmStageOnTerminal(sb, ORDER_ID, "failed", "webhook_failed");
  assertEquals(r.applied, true);
  assertEquals(state.updates[0].values.pipeline_stage_id, STAGE_FAILED);
  assertEquals(state.audits[0].action, "crm_stage_applied_failed");
});

Deno.test("applyCrmStageOnTerminal: manual pipeline change → skip", async () => {
  const otherPipeline = "99999999-9999-9999-9999-999999999999";
  const state: MockState = {
    order: {
      id: ORDER_ID, pipeline_id: otherPipeline, pipeline_stage_id: STAGE_PENDING,
      meta: { crm_routing_snapshot: snapshot() }, offer_id: OFFER_ID,
    },
    updates: [], audits: [],
  };
  const sb = makeSupabase(state);
  const r = await applyCrmStageOnTerminal(sb, ORDER_ID, "success", "webhook_paid");
  assertEquals(r.applied, false);
  assertEquals(r.reason, "manual_pipeline_change");
  assertEquals(state.updates.length, 0);
  assertEquals(state.audits[0].action, "crm_stage_apply_skipped_manual_override");
});

Deno.test("applyCrmStageOnTerminal: manual stage change → skip", async () => {
  const state: MockState = {
    order: {
      id: ORDER_ID, pipeline_id: PIPELINE_ID, pipeline_stage_id: STAGE_OTHER_OPEN,
      meta: { crm_routing_snapshot: snapshot() }, offer_id: OFFER_ID,
    },
    updates: [], audits: [],
  };
  const sb = makeSupabase(state);
  const r = await applyCrmStageOnTerminal(sb, ORDER_ID, "success", "webhook_paid");
  assertEquals(r.applied, false);
  assertEquals(r.reason, "manual_stage_change");
  assertEquals(state.updates.length, 0);
});

Deno.test("applyCrmStageOnTerminal: idempotent — already at target", async () => {
  const state: MockState = {
    order: {
      id: ORDER_ID, pipeline_id: PIPELINE_ID, pipeline_stage_id: STAGE_SUCCESS,
      meta: { crm_routing_snapshot: snapshot() }, offer_id: OFFER_ID,
    },
    updates: [], audits: [],
  };
  const sb = makeSupabase(state);
  const r = await applyCrmStageOnTerminal(sb, ORDER_ID, "success", "webhook_paid");
  assertEquals(r.applied, false);
  assertEquals(r.reason, "idempotent");
  assertEquals(state.updates.length, 0);
  assertEquals(state.audits[0].action, "crm_stage_applied_success");
  assertEquals(state.audits[0].meta.result, "idempotent_already_at_target");
});

// ---------- B.0: resolveOfferRoutingWithFallback ----------

const TARIFF_ID = "88888888-8888-8888-8888-888888888888";
const OFFER_ID_2 = "99999999-9999-9999-9999-999999999990";

Deno.test("B.0 fallback: exact positive по offer_id", async () => {
  const sb = makeSupabase({
    offer: { id: OFFER_ID, button_label: "PRO", meta: { crm_routing: validRouting() }, updated_at: "2025-04-01T00:00:00Z", tariff_id: TARIFF_ID },
    pipeline: { id: PIPELINE_ID, name: "Sales" },
    stages: defaultStages(),
    updates: [], audits: [],
  });
  const r = await resolveOfferRoutingWithFallback(sb, { offer_id: OFFER_ID, tariff_id: TARIFF_ID });
  assert(r.ok);
  assertEquals(r.resolved_via, "offer_id");
  assertEquals(r.candidates_count, 1);
  assertEquals(r.snapshot?.pipeline_id, PIPELINE_ID);
});

Deno.test("B.0 fallback: positive по tariff_id с ровно одним кандидатом", async () => {
  const sb = makeSupabase({
    offersById: {
      [OFFER_ID]: { id: OFFER_ID, button_label: "PRO", meta: { crm_routing: validRouting() }, updated_at: "2025-04-01T00:00:00Z", tariff_id: TARIFF_ID },
    },
    pipeline: { id: PIPELINE_ID, name: "Sales" },
    stages: defaultStages(),
    tariffOfferCandidates: [
      { id: OFFER_ID, meta: { crm_routing: { enabled: true } } },
    ],
    updates: [], audits: [],
  });
  const r = await resolveOfferRoutingWithFallback(sb, { offer_id: null, tariff_id: TARIFF_ID });
  assert(r.ok);
  assertEquals(r.resolved_via, "tariff_fallback");
  assertEquals(r.candidates_count, 1);
  assertEquals(r.snapshot?.pipeline_id, PIPELINE_ID);
});

Deno.test("B.0 fallback: negative no_offer_for_tariff (0 routing-enabled кандидатов)", async () => {
  const sb = makeSupabase({
    tariffOfferCandidates: [
      // active pay_now offer без routing
      { id: OFFER_ID, meta: { crm_routing: { enabled: false } } },
    ],
    updates: [], audits: [],
  });
  const r = await resolveOfferRoutingWithFallback(sb, { offer_id: null, tariff_id: TARIFF_ID });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "no_offer_for_tariff");
  assertEquals(r.resolved_via, "tariff_fallback");
  assertEquals(r.candidates_count, 0);
});

Deno.test("B.0 fallback: negative ambiguous_offers_for_tariff (>1 кандидатов)", async () => {
  const sb = makeSupabase({
    tariffOfferCandidates: [
      { id: OFFER_ID, meta: { crm_routing: { enabled: true } } },
      { id: OFFER_ID_2, meta: { crm_routing: { enabled: true } } },
    ],
    updates: [], audits: [],
  });
  const r = await resolveOfferRoutingWithFallback(sb, { offer_id: null, tariff_id: TARIFF_ID });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "ambiguous_offers_for_tariff");
  assertEquals(r.resolved_via, "tariff_fallback");
  assertEquals(r.candidates_count, 2);
});

Deno.test("B.0 buildNegativeSnapshot: structural fields", () => {
  const ns = buildNegativeSnapshot({
    reason: "no_offer_for_tariff",
    offer_id: null,
    tariff_id: TARIFF_ID,
    resolved_via: "tariff_fallback",
    candidates_count: 0,
  });
  assertEquals(ns.enabled, false);
  assertEquals(ns.reason, "no_offer_for_tariff");
  assertEquals(ns.tariff_id, TARIFF_ID);
  assertEquals(ns.resolved_via, "tariff_fallback");
  assertEquals(ns.candidates_count, 0);
  assert(typeof ns.resolved_at === "string" && ns.resolved_at.length > 0);
});
