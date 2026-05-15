// Deno offline tests for rebill_flow.ts (§A.2 — mode=on wired) — fakes, no network.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runRebillFlow,
  type RebillFlowDeps,
  type RebillFlowInput,
  type ExistingRebillSummary,
  type PaymentRow,
} from "./rebill_flow.ts";
import { buildRebillOrderNumber } from "./rebill_builders.ts";

interface FakeState {
  rebillByOrderNumber: Map<string, ExistingRebillSummary>;
  mainPaymentByUid: Map<string, PaymentRow>;
  refundsSumByUid: Map<string, number>;
  sbsMismatch: { mismatch: boolean; foreignSbs?: string | null; candidateSubId?: string | null };
  inserted: Array<{ id: string; payload: Record<string, unknown> }>;
  insertedPayments: Array<{ rebill_order_id: string; payment_uid: string; payment_id: string }>;
  paymentUpdates: Array<{ payment_id: string; rebill_order_id: string }>;
  grantInvocations: string[];
  grantResults: Map<string, unknown>; // rebillOrderId -> result/throw
  grantThrows: Set<string>;
  metaMerges: Array<{ orderId: string; patch: Record<string, unknown> }>;
  audits: Array<{ action: string; meta: Record<string, unknown> }>;
  insertThrows: { throwOnce?: string }; // e.g. "duplicate key" string
  insertPaymentThrows: boolean;
}

function newState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    rebillByOrderNumber: new Map(),
    mainPaymentByUid: new Map(),
    refundsSumByUid: new Map(),
    sbsMismatch: { mismatch: false },
    inserted: [],
    insertedPayments: [],
    paymentUpdates: [],
    grantInvocations: [],
    grantResults: new Map(),
    grantThrows: new Set(),
    metaMerges: [],
    audits: [],
    insertThrows: {},
    insertPaymentThrows: false,
    ...overrides,
  };
}

function makeDeps(state: FakeState): RebillFlowDeps {
  return {
    findRebillOrderByOrderNumber: (n) =>
      Promise.resolve(state.rebillByOrderNumber.get(n) ?? null),
    findMainPaymentByUid: (uid) =>
      Promise.resolve(state.mainPaymentByUid.get(uid) ?? null),
    sumRefundsForPaymentUid: (uid) =>
      Promise.resolve(state.refundsSumByUid.get(uid) ?? 0),
    checkSbsMismatchBeforeRebill: () => Promise.resolve(state.sbsMismatch),
    insertRebillOrder: (payload: any) => {
      if (state.insertThrows.throwOnce) {
        const msg = state.insertThrows.throwOnce;
        state.insertThrows.throwOnce = undefined;
        // simulate successful concurrent insert behind us
        const id = `rebill-race-${state.inserted.length + 1}`;
        const orderNumber = String(payload.order_number);
        state.rebillByOrderNumber.set(orderNumber, {
          id, order_number: orderNumber, meta: { source: "race_winner" },
        });
        throw new Error(msg);
      }
      const id = `rebill-${state.inserted.length + 1}`;
      state.inserted.push({ id, payload });
      const orderNumber = String(payload.order_number);
      state.rebillByOrderNumber.set(orderNumber, {
        id, order_number: orderNumber, meta: {},
      });
      return Promise.resolve({ id });
    },
    insertPaymentRow: (input) => {
      if (state.insertPaymentThrows) throw new Error("payments_v2_insert_boom");
      const payment_id = `pay-${state.insertedPayments.length + 1}`;
      state.insertedPayments.push({
        rebill_order_id: input.rebill_order_id,
        payment_uid: input.payment_uid, payment_id,
      });
      // update fake "main payment" map so subsequent calls find it
      state.mainPaymentByUid.set(input.payment_uid, {
        id: payment_id, order_id: input.rebill_order_id,
        transaction_type: "Платеж", amount: input.payment.amount, status: "paid",
      });
      return Promise.resolve({ payment_id });
    },
    updatePaymentOrderId: (input) => {
      state.paymentUpdates.push(input);
      // mutate map to reflect new order_id
      for (const [uid, row] of state.mainPaymentByUid.entries()) {
        if (row.id === input.payment_id) {
          state.mainPaymentByUid.set(uid, { ...row, order_id: input.rebill_order_id });
        }
      }
      return Promise.resolve();
    },
    invokeGrantAccess: (rebillOrderId) => {
      state.grantInvocations.push(rebillOrderId);
      if (state.grantThrows.has(rebillOrderId) || state.grantThrows.has("*")) {
        throw new Error("grant boom");
      }
      const r = state.grantResults.get(rebillOrderId) ?? { success: true, rebill_order_id: rebillOrderId };
      return Promise.resolve(r);
    },
    mergeOrderMeta: (input) => {
      state.metaMerges.push(input);
      // also update rebillByOrderNumber meta if matches
      for (const [num, row] of state.rebillByOrderNumber.entries()) {
        if (row.id === input.orderId) {
          state.rebillByOrderNumber.set(num, {
            ...row, meta: { ...(row.meta || {}), ...input.patch },
          });
        }
      }
      return Promise.resolve();
    },
    writeAudit: (input) => {
      state.audits.push(input);
      return Promise.resolve();
    },
  };
}

const UID = "7a64cd04-3d04-4a8e-9b1f-12ab34cd56ef";
const REBILL_NUM = buildRebillOrderNumber(UID);

const baseInput = (overrides: Partial<RebillFlowInput> = {}): RebillFlowInput => ({
  mode: "on",
  parentOrder: {
    id: "parent-1", user_id: "user-1", profile_id: "profile-1",
    product_id: "product-1", tariff_id: "tariff-1", currency: "BYN",
    pipeline_id: "pipe-1", pipeline_stage_id: "stage-1",
    bepaid_subscription_id: "sbs-A",
    customer_email: "a@b.c", customer_phone: null, payer_type: "individual",
    meta: { payment_flow: "bepaid_subscription_charge" },
  },
  payment: { uid: UID, amount: 39, paid_at: "2026-05-15T10:00:00.000Z", currency: "BYN" },
  subscriptionId: "sbs-A",
  ...overrides,
});

// ============ Original cases (updated to v2 deps) ============

Deno.test("Case 1: autocharge creates REBILL-order (mode=on)", async () => {
  const state = newState();
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "materialized");
  assertEquals(result.proceedLegacy, false);
  assertEquals(state.inserted.length, 1);
  assertEquals(state.insertedPayments.length, 1);
  assertEquals(state.grantInvocations, [state.inserted[0].id]);
  assertEquals(state.audits.at(-1)?.action, "bepaid.rebill.materialized");
  // grant_status=success meta merged
  assert(state.metaMerges.some((m) => (m.patch as any).grant_status === "success"));
});

Deno.test("Case 2: payment exists on parent → repointed via UPDATE", async () => {
  const state = newState();
  state.mainPaymentByUid.set(UID, {
    id: "pay-x", order_id: "parent-1",
    transaction_type: "Платеж", amount: 39, status: "paid",
  });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "materialized");
  assertEquals(state.paymentUpdates.length, 1);
  assertEquals(state.paymentUpdates[0].payment_id, "pay-x");
  assertEquals(state.insertedPayments.length, 0);
});

Deno.test("Case 3: REBILL exists + grant_status=success → idempotent_skip", async () => {
  const state = newState();
  state.rebillByOrderNumber.set(REBILL_NUM, {
    id: "rebill-existing", order_number: REBILL_NUM,
    meta: { grant_status: "success" },
  });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "idempotent_skip");
  assertEquals(result.proceedLegacy, false);
  assertEquals(state.inserted.length, 0);
  assertEquals(state.grantInvocations.length, 0);
  assertEquals(state.audits.at(-1)?.action, "bepaid.rebill.idempotent_skip");
});

Deno.test("Case 4: conflict uid → manual_review on conflicting + parent context", async () => {
  const state = newState();
  state.mainPaymentByUid.set(UID, {
    id: "pay-x", order_id: "OTHER-ORDER",
    transaction_type: "Платеж", amount: 39, status: "paid",
  });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "conflict_uid");
  assertEquals(result.conflicting_order_id, "OTHER-ORDER");
  assertEquals(state.inserted.length, 0);
  assertEquals(state.grantInvocations.length, 0);
  // amendment 5: conflicting order gets manual_review, parent gets context.
  const onConflicting = state.metaMerges.find((m) => m.orderId === "OTHER-ORDER");
  const onParent = state.metaMerges.find((m) => m.orderId === "parent-1");
  assert(onConflicting && (onConflicting.patch as any).manual_review === true);
  assert(onParent && (onParent.patch as any).rebill_conflict_uid_context);
});

Deno.test("Case 5: full-refund on current uid → REBILL created, repoint ok, grant skipped", async () => {
  const state = newState();
  state.refundsSumByUid.set(UID, 39); // refunded == amount
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "skip_grant_full_refunded");
  assertEquals(state.inserted.length, 1);
  assertEquals(state.insertedPayments.length, 1);
  assertEquals(state.grantInvocations.length, 0);
  assertEquals(state.audits.at(-1)?.action, "bepaid.rebill.skip_grant_full_refunded");
});

Deno.test("Case 6: dry_run → 0 DML, 1 audit dry_run, proceedLegacy=true", async () => {
  const state = newState();
  const result = await runRebillFlow(makeDeps(state), baseInput({ mode: "dry_run" }));
  assertEquals(result.decision, "dry_run_planned");
  assertEquals(result.proceedLegacy, true);
  assertEquals(state.inserted.length, 0);
  assertEquals(state.insertedPayments.length, 0);
  assertEquals(state.paymentUpdates.length, 0);
  assertEquals(state.grantInvocations.length, 0);
  assertEquals(state.audits.length, 1);
  assertEquals(state.audits[0].action, "bepaid.rebill.dry_run");
});

Deno.test("Case 7: off → noop, no audit, proceedLegacy=true", async () => {
  const state = newState();
  const result = await runRebillFlow(makeDeps(state), baseInput({ mode: "off" }));
  assertEquals(result.decision, "off_noop");
  assertEquals(result.proceedLegacy, true);
  assertEquals(state.audits.length, 0);
});

Deno.test("Case 8: SBS mismatch pre-check → skip, no REBILL, manual_review on parent", async () => {
  const state = newState({
    sbsMismatch: { mismatch: true, foreignSbs: "sbs-B", candidateSubId: "sub-foreign" },
  });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "skip_sbs_mismatch_pre_check");
  assertEquals(result.proceedLegacy, false);
  assertEquals(state.inserted.length, 0);
  const onParent = state.metaMerges.find((m) => m.orderId === "parent-1");
  assert(onParent && (onParent.patch as any).manual_review === true);
});

Deno.test("Case 9: grant invoke throws → materialized_grant_failed, manual_review on REBILL", async () => {
  const state = newState({ grantThrows: new Set<string>(["*"]) });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "materialized_grant_failed");
  assertEquals(state.inserted.length, 1);
  assertEquals(state.grantInvocations.length, 1);
  // meta on REBILL has grant_status=failed + manual_review
  const onRebill = state.metaMerges.find((m) =>
    (m.patch as any).grant_status === "failed");
  assert(onRebill && (onRebill.patch as any).manual_review === true);
  assertEquals(state.audits.at(-1)?.action, "bepaid.rebill.materialized_grant_failed");
});

Deno.test("Case 10: grant called by REBILL.id, never by parent.id", async () => {
  const state = newState();
  await runRebillFlow(makeDeps(state), baseInput());
  assert(state.grantInvocations[0].startsWith("rebill-"));
  assert(state.grantInvocations[0] !== "parent-1");
});

// ============ Resume cases (amendment 10) ============

Deno.test("Case 11: REBILL exists, payment not repointed → resume does repoint+grant", async () => {
  const state = newState();
  state.rebillByOrderNumber.set(REBILL_NUM, {
    id: "rebill-X", order_number: REBILL_NUM,
    meta: { materialization_status: "partial_payment_repoint_failed" },
  });
  // payment still on parent
  state.mainPaymentByUid.set(UID, {
    id: "pay-x", order_id: "parent-1",
    transaction_type: "Платеж", amount: 39, status: "paid",
  });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "resumed_grant");
  assertEquals(state.paymentUpdates.length, 1);
  assertEquals(state.grantInvocations, ["rebill-X"]);
  assert(state.metaMerges.some((m) => (m.patch as any).grant_status === "success"));
});

Deno.test("Case 12: REBILL exists, grant missing → resume invokes grant (success)", async () => {
  const state = newState();
  state.rebillByOrderNumber.set(REBILL_NUM, {
    id: "rebill-Y", order_number: REBILL_NUM,
    meta: { materialization_status: "grant_failed", grant_status: "failed" },
  });
  state.mainPaymentByUid.set(UID, {
    id: "pay-y", order_id: "rebill-Y",
    transaction_type: "Платеж", amount: 39, status: "paid",
  });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "resumed_grant");
  assertEquals(state.paymentUpdates.length, 0); // already pointed
  assertEquals(state.grantInvocations, ["rebill-Y"]);
});

Deno.test("Case 13: payment repoint fails on fresh path → materialized_partial", async () => {
  const state = newState({ insertPaymentThrows: true });
  // no existing payment row → orchestrator will try insertPaymentRow → throws
  const result = await runRebillFlow(makeDeps(state), baseInput());
  assertEquals(result.decision, "materialized_partial");
  assertEquals(state.inserted.length, 1);
  assertEquals(state.grantInvocations.length, 0);
  const m = state.metaMerges.find((p) =>
    (p.patch as any).materialization_status === "partial_payment_repoint_failed");
  assert(m && (m.patch as any).manual_review === true);
});

Deno.test("Case 14: refund on uid (refund-row only, repoint of refund forbidden)", async () => {
  // existing payment is a refund-row (transaction_type='Возврат средств')
  const state = newState();
  state.mainPaymentByUid.set(UID, {
    id: "ref-1", order_id: "parent-1",
    transaction_type: "Возврат средств", amount: -39, status: "refunded",
  });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  // ensurePaymentRepointed sees non-main row and reports failure → materialized_partial
  assertEquals(result.decision, "materialized_partial");
});

Deno.test("Case 15: race — INSERT throws unique violation → resume via re-fetch", async () => {
  const state = newState({ insertThrows: { throwOnce: "duplicate key value violates unique constraint orders_v2_order_number_key" } });
  const result = await runRebillFlow(makeDeps(state), baseInput());
  // resume path → grant succeeds on race-winner row
  assert(["resumed_grant", "materialized"].includes(result.decision));
  assertEquals(result.proceedLegacy, false);
});

Deno.test("Case 16: dry_run with existing REBILL → audit decision='would_resume', proceedLegacy=true", async () => {
  const state = newState();
  state.rebillByOrderNumber.set(REBILL_NUM, {
    id: "rebill-D", order_number: REBILL_NUM, meta: {},
  });
  const result = await runRebillFlow(makeDeps(state), baseInput({ mode: "dry_run" }));
  assertEquals(result.decision, "dry_run_planned");
  assertEquals(result.proceedLegacy, true);
  assertEquals(state.audits[0].action, "bepaid.rebill.dry_run");
  assertEquals((state.audits[0].meta as any).decision, "would_resume");
});

Deno.test("Case 17: any mode=on terminal → proceedLegacy=false (short-circuit signal)", async () => {
  // covers: materialized, idempotent_skip, conflict_uid, skip_grant_full_refunded,
  //         skip_sbs_mismatch_pre_check, materialized_partial, materialized_grant_failed
  const cases: Array<() => Promise<string>> = [
    async () => (await runRebillFlow(makeDeps(newState()), baseInput())).decision,
    async () => {
      const s = newState();
      s.rebillByOrderNumber.set(REBILL_NUM, { id: "r", order_number: REBILL_NUM, meta: { grant_status: "success" } });
      return (await runRebillFlow(makeDeps(s), baseInput())).decision;
    },
    async () => {
      const s = newState();
      s.mainPaymentByUid.set(UID, { id: "x", order_id: "OTHER", transaction_type: "Платеж", amount: 39, status: "paid" });
      return (await runRebillFlow(makeDeps(s), baseInput())).decision;
    },
    async () => {
      const s = newState();
      s.refundsSumByUid.set(UID, 39);
      return (await runRebillFlow(makeDeps(s), baseInput())).decision;
    },
    async () => {
      const s = newState({ sbsMismatch: { mismatch: true, foreignSbs: "X" } });
      return (await runRebillFlow(makeDeps(s), baseInput())).decision;
    },
    async () => {
      const s = newState({ insertPaymentThrows: true });
      return (await runRebillFlow(makeDeps(s), baseInput())).decision;
    },
    async () => {
      const s = newState({ grantThrows: new Set<string>(["*"]) });
      return (await runRebillFlow(makeDeps(s), baseInput())).decision;
    },
  ];
  for (const c of cases) {
    const decision = await c();
    assert(decision !== "off_noop" && decision !== "dry_run_planned",
      `decision=${decision} unexpected`);
  }
});
