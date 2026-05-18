// PATCH-RB1.2 — post-rebind verification + payment_rebind_failed tests.
//
// Covers:
//   T1: payment exists BEFORE rebill flow → repoint successful → materialized
//   T2: payment created INSIDE flow (insertPaymentRow) → materialized
//   T3: post-grant verify finds payment.order_id != rebill_order_id
//       (simulates legacy STEP E overwriting back to parent) →
//       materialized_partial + payment_rebind_post_check_failed audit
//   T4: updatePaymentOrderId throws (affected_rows != 1) →
//       materialized_partial + payment_rebind_failed audit, no materialized
//   T5: successful materialization always implies payment.order_id == rebill_order_id

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runRebillFlow, type RebillFlowDeps, type PaymentRow } from "./rebill_flow.ts";
import { buildRebillOrderNumber } from "./rebill_builders.ts";

const UID = "111dfc17-80c2-477c-8ecd-9b768744e8b7";
const REBILL_NUM = buildRebillOrderNumber(UID);
const PARENT_ID = "91b98bf3-282a-4ef0-854d-f71a86577139";
const REBILL_ID = "06f22ceb-9792-464e-adfb-d15519352d21";
const PAYMENT_ID = "f2892a00-5731-4adb-97d8-ff8d3472f953";

const parentOrder = {
  id: PARENT_ID, user_id: "u", profile_id: "p", product_id: "prod",
  tariff_id: "tar", currency: "BYN", pipeline_id: null, pipeline_stage_id: null,
  bepaid_subscription_id: "sbs_e1f92ff0e3fa4bff", customer_email: null,
  customer_phone: null, payer_type: null, meta: {},
};
const payment = { uid: UID, amount: 250, paid_at: "2026-05-17T18:00:58Z", currency: "BYN" };

function makeDeps(overrides: Partial<RebillFlowDeps> = {}): {
  deps: RebillFlowDeps;
  audits: Array<{ action: string; meta: any }>;
  updates: number;
} {
  const audits: Array<{ action: string; meta: any }> = [];
  let updates = 0;
  const deps: RebillFlowDeps = {
    findRebillOrderByOrderNumber: async () => null,
    findMainPaymentByUid: async () => null,
    sumRefundsForPaymentUid: async () => 0,
    checkSbsMismatchBeforeRebill: async () => ({ mismatch: false }),
    insertRebillOrder: async () => ({ id: REBILL_ID }),
    insertPaymentRow: async () => ({ payment_id: PAYMENT_ID }),
    updatePaymentOrderId: async () => { updates++; },
    invokeGrantAccess: async () => ({ success: true }),
    mergeOrderMeta: async () => {},
    writeAudit: async (e) => { audits.push(e); },
    ...overrides,
  };
  return {
    deps: new Proxy(deps, {
      get(t, k) {
        if (k === "updatePaymentOrderId") {
          const orig = (t as any)[k];
          return async (i: any) => { updates++; return await orig(i); };
        }
        return (t as any)[k];
      },
    }),
    audits,
    get updates() { return updates; },
  } as any;
}

Deno.test("PATCH-RB1.2 T1: payment exists before flow, repoint succeeds → materialized", async () => {
  let payRow: PaymentRow = { id: PAYMENT_ID, order_id: PARENT_ID, transaction_type: "Платеж" };
  const { deps, audits } = makeDeps({
    findMainPaymentByUid: async () => payRow,
    updatePaymentOrderId: async ({ rebill_order_id }) => { payRow = { ...payRow, order_id: rebill_order_id }; },
  });
  const res = await runRebillFlow(deps, {
    mode: "on", parentOrder, payment, subscriptionId: "sbs_e1f92ff0e3fa4bff",
  });
  assertEquals(res.decision, "materialized");
  assertEquals(payRow.order_id, REBILL_ID);
  assert(audits.some((a) => a.action === "bepaid.rebill.materialized"));
  assert(!audits.some((a) => a.action === "bepaid.rebill.payment_rebind_post_check_failed"));
});

Deno.test("PATCH-RB1.2 T2: payment created inside flow → materialized", async () => {
  let inserted: PaymentRow | null = null;
  const { deps, audits } = makeDeps({
    findMainPaymentByUid: async () => inserted,
    insertPaymentRow: async ({ rebill_order_id }) => {
      inserted = { id: PAYMENT_ID, order_id: rebill_order_id, transaction_type: "Платеж" };
      return { payment_id: PAYMENT_ID };
    },
  });
  const res = await runRebillFlow(deps, {
    mode: "on", parentOrder, payment, subscriptionId: "sbs",
  });
  assertEquals(res.decision, "materialized");
  assertEquals(inserted!.order_id, REBILL_ID);
  assert(audits.some((a) => a.action === "bepaid.rebill.materialized"));
});

Deno.test("PATCH-RB1.2 T3: legacy overwrites payment to parent after grant → materialized_partial + post_check_failed audit", async () => {
  // Simulates the exact Case A bug: rebill_flow inserts payment with order_id=REBILL,
  // grant succeeds, but BEFORE post-check verify the legacy STEP E overwrote order_id=PARENT.
  let inserted: PaymentRow | null = null;
  let callCount = 0;
  const { deps, audits } = makeDeps({
    findMainPaymentByUid: async () => {
      callCount++;
      if (callCount === 1) return inserted; // initial check inside repoint helper
      // post-grant verify sees payment overwritten to parent
      return inserted ? { ...inserted, order_id: PARENT_ID } : null;
    },
    insertPaymentRow: async ({ rebill_order_id }) => {
      inserted = { id: PAYMENT_ID, order_id: rebill_order_id, transaction_type: "Платеж" };
      return { payment_id: PAYMENT_ID };
    },
  });
  const res = await runRebillFlow(deps, {
    mode: "on", parentOrder, payment, subscriptionId: "sbs",
  });
  assertEquals(res.decision, "materialized_partial");
  assertEquals(res.reason, "payment_rebind_post_check_failed");
  assert(audits.some((a) => a.action === "bepaid.rebill.payment_rebind_post_check_failed"));
  assert(!audits.some((a) => a.action === "bepaid.rebill.materialized"),
    "materialized must NOT be written when post-check fails");
});

Deno.test("PATCH-RB1.2 T4: updatePaymentOrderId throws (affected_rows=0) → payment_rebind_failed, no materialized", async () => {
  const payRow: PaymentRow = { id: PAYMENT_ID, order_id: PARENT_ID, transaction_type: "Платеж" };
  const { deps, audits } = makeDeps({
    findMainPaymentByUid: async () => payRow,
    updatePaymentOrderId: async () => { throw new Error("payment_rebind_failed:affected_rows=0"); },
  });
  const res = await runRebillFlow(deps, {
    mode: "on", parentOrder, payment, subscriptionId: "sbs",
  });
  assertEquals(res.decision, "materialized_partial");
  assert(audits.some((a) => a.action === "bepaid.rebill.payment_rebind_failed"),
    "explicit payment_rebind_failed audit required");
  assert(!audits.some((a) => a.action === "bepaid.rebill.materialized"));
});

Deno.test("PATCH-RB1.2 T5: successful materialization invariant — payment.order_id == rebill_order_id", async () => {
  let payRow: PaymentRow = { id: PAYMENT_ID, order_id: PARENT_ID, transaction_type: "Платеж" };
  const { deps } = makeDeps({
    findMainPaymentByUid: async () => payRow,
    updatePaymentOrderId: async ({ rebill_order_id }) => { payRow = { ...payRow, order_id: rebill_order_id }; },
  });
  const res = await runRebillFlow(deps, {
    mode: "on", parentOrder, payment, subscriptionId: "sbs",
  });
  if (res.decision === "materialized") {
    assertEquals(payRow.order_id, res.rebill_order_id);
  }
});
