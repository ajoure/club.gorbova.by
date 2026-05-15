// Deno offline tests for rebill_flow.ts — fakes, no network.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runRebillFlow, type RebillFlowDeps, type RebillFlowInput } from "./rebill_flow.ts";
import type { PaymentRowForRefundCheck } from "./rebill_builders.ts";

interface FakeState {
  rebillOrderByUid: Map<string, { id: string }>;
  paymentByUid: Map<string, { id: string; order_id: string | null }>;
  paymentsByOrder: Map<string, PaymentRowForRefundCheck[]>;
  sbsMismatch: { mismatch: boolean; foreignSbs?: string | null; candidateSubId?: string | null };
  insertedOrders: Array<{ id: string; payload: Record<string, unknown> }>;
  upsertedPayments: Array<{
    rebill_order_id: string;
    payment_uid: string;
    repointed_from_order_id: string | null;
  }>;
  grantInvocations: string[];
  metaMerges: Array<{ orderId: string; reason: string; context: Record<string, unknown> }>;
  audits: Array<{ action: string; meta: Record<string, unknown> }>;
  shouldGrantThrow: boolean;
}

function newState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    rebillOrderByUid: new Map(),
    paymentByUid: new Map(),
    paymentsByOrder: new Map(),
    sbsMismatch: { mismatch: false },
    insertedOrders: [],
    upsertedPayments: [],
    grantInvocations: [],
    metaMerges: [],
    audits: [],
    shouldGrantThrow: false,
    ...overrides,
  };
}

function makeDeps(state: FakeState): RebillFlowDeps {
  return {
    findRebillOrderByPaymentUid: (uid) => Promise.resolve(state.rebillOrderByUid.get(uid) ?? null),
    findPaymentByUid: (uid) => Promise.resolve(state.paymentByUid.get(uid) ?? null),
    listPaymentsForOrder: (orderId) => Promise.resolve(state.paymentsByOrder.get(orderId) ?? []),
    checkSbsMismatchBeforeRebill: () => Promise.resolve(state.sbsMismatch),
    insertRebillOrder: (payload) => {
      const id = `rebill-${state.insertedOrders.length + 1}`;
      state.insertedOrders.push({ id, payload });
      return Promise.resolve({ id });
    },
    upsertPaymentForRebill: (input) => {
      const repointed = state.paymentByUid.get(input.payment_uid)?.order_id ?? null;
      state.upsertedPayments.push({
        rebill_order_id: input.rebill_order_id,
        payment_uid: input.payment_uid,
        repointed_from_order_id: repointed,
      });
      return Promise.resolve({
        payment_id: `pay-${state.upsertedPayments.length}`,
        repointed_from_order_id: repointed,
      });
    },
    invokeGrantAccess: (rebillOrderId) => {
      state.grantInvocations.push(rebillOrderId);
      if (state.shouldGrantThrow) throw new Error("grant boom");
      return Promise.resolve({ ok: true, rebill_order_id: rebillOrderId });
    },
    mergeOrderMetaManualReview: (input) => {
      state.metaMerges.push(input);
      return Promise.resolve();
    },
    writeAudit: (input) => {
      state.audits.push(input);
      return Promise.resolve();
    },
  };
}

const baseInput = (overrides: Partial<RebillFlowInput> = {}): RebillFlowInput => ({
  mode: "on",
  parentOrder: {
    id: "parent-1",
    user_id: "user-1",
    profile_id: "profile-1",
    product_id: "product-1",
    tariff_id: "tariff-1",
    currency: "BYN",
    pipeline_id: "pipe-1",
    pipeline_stage_id: "stage-1",
    bepaid_subscription_id: "sbs-A",
    customer_email: "a@b.c",
    customer_phone: null,
    payer_type: "individual",
    meta: { payment_flow: "bepaid_subscription_charge" },
  },
  payment: { uid: "7a64cd04-3d04-4a8e-9b1f-12ab34cd56ef", amount: 39, paid_at: "2026-05-15T10:00:00.000Z", currency: "BYN" },
  subscriptionId: "sbs-A",
  ...overrides,
});

Deno.test("Case 1: autocharge creates REBILL-order (mode=on)", async () => {
  const state = newState();
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "materialized");
  assertEquals(state.insertedOrders.length, 1);
  assertEquals(state.upsertedPayments.length, 1);
  assertEquals(state.grantInvocations, [state.insertedOrders[0].id]);
  assertEquals(state.audits.at(-1)?.action, "bepaid.rebill.materialized");
});

Deno.test("Case 2: payment linked to REBILL, not parent (repoint)", async () => {
  const state = newState();
  state.paymentByUid.set("7a64cd04-3d04-4a8e-9b1f-12ab34cd56ef", { id: "pay-x", order_id: "parent-1" });
  // Same parent order — это НЕ конфликт (это первичная привязка к parent), но мы repoint'нем.
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "materialized");
  assertEquals(state.upsertedPayments[0].repointed_from_order_id, "parent-1");
});

Deno.test("Case 3: duplicate webhook idempotent (mode=on)", async () => {
  const state = newState();
  state.rebillOrderByUid.set("7a64cd04-3d04-4a8e-9b1f-12ab34cd56ef", { id: "rebill-existing" });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "idempotent_skip");
  assertEquals(state.insertedOrders.length, 0);
  assertEquals(state.upsertedPayments.length, 0);
  assertEquals(state.grantInvocations.length, 0);
  assertEquals(state.audits.at(-1)?.action, "bepaid.rebill.idempotent_skip");
});

Deno.test("Case 4: conflict uid → manual_review/audit, no REBILL, no grant", async () => {
  const state = newState();
  state.paymentByUid.set("7a64cd04-3d04-4a8e-9b1f-12ab34cd56ef", { id: "pay-x", order_id: "OTHER-ORDER" });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "conflict_uid");
  assertEquals(state.insertedOrders.length, 0);
  assertEquals(state.grantInvocations.length, 0);
  assertEquals(state.metaMerges.length, 1);
  assertEquals(state.metaMerges[0].reason, "rebill_conflict_uid");
  assertEquals(state.audits.at(-1)?.action, "bepaid.rebill.conflict_uid");
});

Deno.test("Case 5: full-refunded parent → REBILL created BUT grant skipped", async () => {
  const state = newState();
  state.paymentsByOrder.set("parent-1", [
    { id: "p1", amount: 39, status: "paid", refunded_amount: 39 },
    { amount: -39, status: "refunded", transaction_type: "refund", meta: { parent_payment_id: "p1" } },
  ]);
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "skip_grant_full_refunded");
  assertEquals(state.insertedOrders.length, 1);
  assertEquals(state.grantInvocations.length, 0);
  assertEquals(state.audits.at(-1)?.action, "bepaid.rebill.skip_grant_full_refunded");
});

Deno.test("Case 6: dry_run mode → 0 INSERT/UPDATE, 1 audit dry_run", async () => {
  const state = newState();
  const result = await runRebillFlow(makeDeps(state), baseInput({ mode: "dry_run" }));
  assertEquals(result.decision, "dry_run_planned");
  assertEquals(state.insertedOrders.length, 0);
  assertEquals(state.upsertedPayments.length, 0);
  assertEquals(state.grantInvocations.length, 0);
  assertEquals(state.audits.length, 1);
  assertEquals(state.audits[0].action, "bepaid.rebill.dry_run");
  assert((state.audits[0].meta as any).planned_order_payload);
  assert((state.audits[0].meta as any).planned_grant_call);
});

Deno.test("Case 7: off mode → noop, no audit, no DML", async () => {
  const state = newState();
  const result = await runRebillFlow(makeDeps(state), baseInput({ mode: "off" }));
  assertEquals(result.decision, "off_noop");
  assertEquals(state.insertedOrders.length, 0);
  assertEquals(state.upsertedPayments.length, 0);
  assertEquals(state.grantInvocations.length, 0);
  assertEquals(state.audits.length, 0);
});

Deno.test("Case 8: SBS mismatch pre-check → skip, no REBILL, manual_review", async () => {
  const state = newState({
    sbsMismatch: { mismatch: true, foreignSbs: "sbs-B", candidateSubId: "sub-foreign" },
  });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "skip_sbs_mismatch_pre_check");
  assertEquals(state.insertedOrders.length, 0);
  assertEquals(state.grantInvocations.length, 0);
  assertEquals(state.metaMerges.length, 1);
  assertEquals(state.metaMerges[0].reason, "rebill_sbs_mismatch_pre_check");
  assertEquals(state.audits.at(-1)?.action, "bepaid.rebill.skip_sbs_mismatch_pre_check");
});

Deno.test("Case 9: grant invoke throws → still materialized, error captured in audit", async () => {
  const state = newState({ shouldGrantThrow: true });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "materialized");
  assertEquals(state.insertedOrders.length, 1);
  assertEquals(state.grantInvocations.length, 1);
  const lastAudit = state.audits.at(-1);
  assertEquals(lastAudit?.action, "bepaid.rebill.materialized");
  assert((lastAudit?.meta as any).grant_result?.error);
});

Deno.test("Case 10: grant called by REBILL.id, never by parent.id", async () => {
  const state = newState();
  await runRebillFlow(makeDeps(state), baseInput());
  // grant invocation must be on REBILL id, not parent
  assert(state.grantInvocations[0].startsWith("rebill-"));
  assert(state.grantInvocations[0] !== "parent-1");
});
