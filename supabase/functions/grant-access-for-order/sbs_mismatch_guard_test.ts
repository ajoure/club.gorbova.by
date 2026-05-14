// §F SBS-mismatch no-new-sub guard — Deno tests.
// Чистые тесты на builders + decision-table. Production DML = 0.
//
// Покрытие (5 обязательных кейсов):
//   1) recurring tariffMatch=true, sbsMatch=false, payment_flow=bepaid_subscription_charge
//      → decision = skip_no_new_sub, response.skipped=true, manual_review=true,
//        granted_subscription_v2_id=null, granted_entitlement_id=null.
//   2) recurring tariffMatch=true, sbsMatch=true → decision = normal_extend.
//   3) primary flow (нет active candidate) → decision = create_new_primary
//      (create-new path не сломан §F-блоком).
//   4) Larisa anti-regression fixture: order sbs=sbs_OLD, кандидат sbs=sbs_NEW,
//      product/tariff совпадают → skip_no_new_sub, audit содержит обоих кандидатов,
//      response без extend/grant.
//   5) !tariffMatch regression → decision = create_new_tariff_mismatch
//      (текущее поведение НЕ меняется §F; помечен как backlog-risk).

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSbsMismatchAuditPayload,
  buildSbsMismatchOrderMetaMerge,
  buildSbsMismatchResponseBody,
  decideSbsMismatchAction,
  resolvePaymentFlow,
  type CandidateRow,
} from "./sbs_mismatch_guard.ts";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "22222222-2222-2222-2222-222222222222";
const TARIFF_ID = "33333333-3333-3333-3333-333333333333";
const SUB_NEW = "44444444-4444-4444-4444-444444444444";
const SUB_OLD = "55555555-5555-5555-5555-555555555555";

// ─── Decision table ──────────────────────────────────────────────────────────

Deno.test("§F decision: recurring tariffMatch=true, sbsMatch=false → skip_no_new_sub", () => {
  const d = decideSbsMismatchAction({
    hasActiveCandidate: true,
    tariffMatch: true,
    sbsMatch: false,
  });
  assertEquals(d, "skip_no_new_sub");
});

Deno.test("§F decision: tariffMatch=true && sbsMatch=true → normal_extend", () => {
  const d = decideSbsMismatchAction({
    hasActiveCandidate: true,
    tariffMatch: true,
    sbsMatch: true,
  });
  assertEquals(d, "normal_extend");
});

Deno.test("§F decision: primary flow без candidate → create_new_primary", () => {
  const d = decideSbsMismatchAction({
    hasActiveCandidate: false,
    tariffMatch: false,
    sbsMatch: false,
  });
  assertEquals(d, "create_new_primary");
});

Deno.test("§F decision: !tariffMatch (backlog-risk) → create_new_tariff_mismatch (legacy)", () => {
  const d = decideSbsMismatchAction({
    hasActiveCandidate: true,
    tariffMatch: false,
    sbsMatch: false,
  });
  // Текущее поведение НЕ изменено §F. Backlog: для recurring + foreign sbs +
  // tariff-mismatch одновременно нужен отдельный guard.
  assertEquals(d, "create_new_tariff_mismatch");
});

// ─── payment_flow resolver ───────────────────────────────────────────────────

Deno.test("resolvePaymentFlow: meta.payment_flow приоритетнее order.payment_flow", () => {
  assertEquals(
    resolvePaymentFlow({ meta: { payment_flow: "bepaid_subscription_charge" }, payment_flow: "x" }),
    "bepaid_subscription_charge",
  );
  assertEquals(resolvePaymentFlow({ payment_flow: "primary" }), "primary");
  assertEquals(resolvePaymentFlow({}), "");
  assertEquals(resolvePaymentFlow(null), "");
});

// ─── Audit payload ───────────────────────────────────────────────────────────

Deno.test("§F audit payload: содержит всех кандидатов, decision=no_new_sub_chain", () => {
  const candidates: CandidateRow[] = [
    { subscription_v2_id: SUB_NEW, bepaid_sbs: "sbs_NEW", tariff_id: TARIFF_ID, status: "active" },
  ];
  const p = buildSbsMismatchAuditPayload({
    orderId: ORDER_ID,
    productId: PRODUCT_ID,
    tariffId: TARIFF_ID,
    paymentFlow: "bepaid_subscription_charge",
    orderSbs: "sbs_OLD",
    primaryCandidateId: SUB_NEW,
    primaryCandidateSbs: "sbs_NEW",
    candidates,
  });
  assertEquals(p.action, "grant-access-for-order.skip_extend_bepaid_subscription_mismatch.no_new_sub");
  assertEquals(p.actor_type, "system");
  assertEquals(p.meta.decision, "no_new_sub_chain");
  assertEquals(p.meta.matched_by_tariff, true);
  assertEquals(p.meta.matched_by_sbs, false);
  assertEquals(p.meta.candidate_sub_ids, [SUB_NEW]);
  assertEquals(p.meta.order_bepaid_subscription_id, "sbs_OLD");
  assertEquals(p.meta.primary_candidate_bepaid_sbs, "sbs_NEW");
  assertEquals(p.meta.payment_flow, "bepaid_subscription_charge");
});

// ─── Order meta merge ────────────────────────────────────────────────────────

Deno.test("§F orders_v2.meta merge: НЕ overwrite, добавляет manual_review поля", () => {
  const existingMeta = {
    payment_flow: "bepaid_subscription_charge",
    bepaid_payment_id: "pay_1",
    custom_business_field: "must_survive",
  };
  const merged = buildSbsMismatchOrderMetaMerge({
    existingMeta,
    orderSbs: "sbs_OLD",
    primaryCandidateId: SUB_NEW,
    primaryCandidateSbs: "sbs_NEW",
    candidates: [{ subscription_v2_id: SUB_NEW, bepaid_sbs: "sbs_NEW", tariff_id: TARIFF_ID, status: "active" }],
    paymentFlow: "bepaid_subscription_charge",
    nowIso: "2026-05-14T00:00:00.000Z",
  }) as Record<string, any>;

  // existing fields сохранены
  assertEquals(merged.payment_flow, "bepaid_subscription_charge");
  assertEquals(merged.bepaid_payment_id, "pay_1");
  assertEquals(merged.custom_business_field, "must_survive");
  // manual_review поля добавлены
  assertEquals(merged.manual_review, true);
  assertEquals(merged.manual_review_reason, "bepaid_subscription_mismatch");
  assertEquals(merged.manual_review_at, "2026-05-14T00:00:00.000Z");
  assertEquals(merged.manual_review_context.decision, "no_new_sub_chain");
  assertEquals(merged.manual_review_context.candidate_sub_ids, [SUB_NEW]);
});

// ─── Response body contract ──────────────────────────────────────────────────

Deno.test("§F response body: skipped=true, оба case (snake+camel)=null, manual_review=true", () => {
  const body = buildSbsMismatchResponseBody({
    orderSbs: "sbs_OLD",
    primaryCandidateId: SUB_NEW,
    primaryCandidateSbs: "sbs_NEW",
    candidates: [{ subscription_v2_id: SUB_NEW, bepaid_sbs: "sbs_NEW", tariff_id: TARIFF_ID, status: "active" }],
  });
  assertEquals(body.success, true);
  assertEquals(body.skipped, true);
  assertEquals(body.manual_review, true);
  assertEquals(body.manualReview, true);
  assertEquals(body.reason, "bepaid_subscription_mismatch");
  // Все grant-id поля ОБЯЗАТЕЛЬНО null (caller-tolerant: snake + camel).
  assertEquals(body.granted_subscription_v2_id, null);
  assertEquals(body.grantedSubscriptionV2Id, null);
  assertEquals(body.granted_entitlement_id, null);
  assertEquals(body.grantedEntitlementId, null);
  assertEquals(body.subscription_id, null);
  assertEquals(body.subscription_v2_id, null);
  assertEquals(body.entitlement_id, null);
  assertExists(body.message);
  assertEquals(body.manual_review_context.candidate_sub_ids, [SUB_NEW]);
});

// ─── Larisa anti-regression fixture ──────────────────────────────────────────

Deno.test("Larisa fixture: old sbs payment + new sub same product/tariff different sbs → no extend, no new sub, manual_review, audit", () => {
  // Setup: rebill приходит с order.bepaid_subscription_id = sbs_OLD (старая sub Ларисы),
  // но активная sub в той же product/tariff = SUB_NEW под sbs_NEW.
  const candidates: CandidateRow[] = [
    { subscription_v2_id: SUB_NEW, bepaid_sbs: "sbs_NEW", tariff_id: TARIFF_ID, status: "active" },
  ];

  const decision = decideSbsMismatchAction({
    hasActiveCandidate: true,
    tariffMatch: true,
    sbsMatch: false,
  });
  assertEquals(decision, "skip_no_new_sub", "Должен сработать §F early return");

  const audit = buildSbsMismatchAuditPayload({
    orderId: ORDER_ID,
    productId: PRODUCT_ID,
    tariffId: TARIFF_ID,
    paymentFlow: "bepaid_subscription_charge",
    orderSbs: "sbs_OLD",
    primaryCandidateId: SUB_NEW,
    primaryCandidateSbs: "sbs_NEW",
    candidates,
  });
  // Audit фиксирует old sbs (order) и new sbs (candidate) — оба для разбора.
  assertEquals(audit.meta.order_bepaid_subscription_id, "sbs_OLD");
  assertEquals(audit.meta.primary_candidate_bepaid_sbs, "sbs_NEW");
  assertEquals(audit.meta.candidate_sub_ids.includes(SUB_NEW), true);
  assertEquals(audit.meta.decision, "no_new_sub_chain");

  const response = buildSbsMismatchResponseBody({
    orderSbs: "sbs_OLD",
    primaryCandidateId: SUB_NEW,
    primaryCandidateSbs: "sbs_NEW",
    candidates,
  });
  // No extend: granted_subscription_v2_id=null → bepaid-webhook INLINE-extend не сработает.
  assertEquals(response.granted_subscription_v2_id, null);
  // No new sub: skipped=true + manual_review=true → caller не материализует chain.
  assertEquals(response.skipped, true);
  assertEquals(response.manual_review, true);
  // No entitlement
  assertEquals(response.entitlement_id, null);
  assertEquals(response.granted_entitlement_id, null);
});
