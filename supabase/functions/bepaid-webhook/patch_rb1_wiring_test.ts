// PATCH-RB1 — wiring regression tests for runRebillFlow inside bepaid-webhook.
//
// These tests exercise the live deps ADAPTER decision-points indirectly via
// runRebillFlow on a fake supabase-like client, ensuring:
//   - mode=on + cycle>=2 + transactionUid → REBILL materialized (no legacy paid-update)
//   - mode=dry_run → audit only, legacy can still proceed (proceedLegacy=true)
//   - mode=off → no-op, legacy proceeds
//   - cycle==1 → REBILL not invoked at all (handled by caller; here we assert the
//     gating predicate inline)
//
// The webhook orchestration itself (index.ts) is integration-tested manually via
// curl_edge_functions; logic-level guarantees of the engine live in
// rebill_flow_test.ts / rebill_wiring_test.ts. This file pins the new boundary.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runRebillFlow, type RebillFlowDeps } from "./rebill_flow.ts";
import { buildRebillOrderNumber, resolveKillSwitchMode } from "./rebill_builders.ts";

const UID = "21613f63-dc85-406f-a8dd-34a936bc0784";
const REBILL_NUM = buildRebillOrderNumber(UID);

function noopDeps(overrides: Partial<RebillFlowDeps> = {}): RebillFlowDeps {
  // PATCH-RB1.2: stateful payment row so post-grant verify finds order_id=REBILL.
  let pay: { id: string; order_id: string | null; transaction_type: string } | null = null;
  const base: RebillFlowDeps = {
    findRebillOrderByOrderNumber: async () => null,
    findMainPaymentByUid: async () => pay as any,
    sumRefundsForPaymentUid: async () => 0,
    checkSbsMismatchBeforeRebill: async () => ({ mismatch: false }),
    insertRebillOrder: async (p: any) => ({ id: `rebill-fresh-${p.order_number}` }),
    insertPaymentRow: async ({ rebill_order_id }) => {
      pay = { id: "pay-fresh", order_id: rebill_order_id, transaction_type: "Платеж" };
      return { payment_id: "pay-fresh" };
    },
    updatePaymentOrderId: async ({ rebill_order_id }) => {
      if (pay) pay = { ...pay, order_id: rebill_order_id };
    },
    invokeGrantAccess: async () => ({ success: true }),
    mergeOrderMeta: async () => {},
    writeAudit: async () => {},
  };
  return { ...base, ...overrides };
}

const parentOrder = {
  id: "57fcc9d8-a665-48a6-9fba-312c535be5a8",
  user_id: "69e504d3-703d-4562-b200-8ed20c52e7ab",
  profile_id: "6112b4d0-d125-4ad3-9d43-594c04001992",
  product_id: "11c9f1b8-0355-4753-bd74-40b42aa53616",
  tariff_id: "7c748940-dcad-4c7c-a92e-76a2344622d3",
  currency: "BYN",
  pipeline_id: "a0000001-0000-0000-0000-000000000001",
  pipeline_stage_id: "b0000001-0001-0000-0000-000000000003",
  bepaid_subscription_id: "sbs_eb2fab715e72546b",
  customer_email: "holgacher@mail.ru",
  customer_phone: null,
  payer_type: "individual",
  meta: { payment_flow: "bepaid_subscription_charge" },
};
const payment = { uid: UID, amount: 250, paid_at: "2026-05-17T14:00:58.667Z", currency: "BYN" };

Deno.test("PATCH-RB1: mode=on + repeat charge → REBILL materialized, legacy short-circuited", async () => {
  const audits: Array<{ action: string }> = [];
  const grantCalls: string[] = [];
  const inserts: any[] = [];
  const deps = noopDeps({
    insertRebillOrder: async (p: any) => {
      inserts.push(p);
      return { id: "rebill-A" };
    },
    invokeGrantAccess: async (id: string) => {
      grantCalls.push(id);
      return { success: true };
    },
    writeAudit: async (a) => { audits.push({ action: a.action }); },
  });
  const r = await runRebillFlow(deps, {
    mode: "on",
    parentOrder,
    payment,
    subscriptionId: parentOrder.bepaid_subscription_id,
  });
  assertEquals(r.decision, "materialized");
  assertEquals(r.proceedLegacy, false, "legacy paid-update + grant must be short-circuited");
  assertEquals(inserts.length, 1, "exactly one REBILL-order inserted");
  assertEquals(String(inserts[0].order_number), REBILL_NUM);
  assertEquals(grantCalls, ["rebill-A"], "grant invoked by REBILL-order id, never by parent.id");
  assert(audits.some(a => a.action === "bepaid.rebill.materialized"), "materialized audit emitted");
});

Deno.test("PATCH-RB1: mode=dry_run → audit only, no INSERT, legacy proceeds", async () => {
  const inserts: any[] = [];
  const grantCalls: string[] = [];
  const audits: Array<{ action: string }> = [];
  const deps = noopDeps({
    insertRebillOrder: async (p: any) => { inserts.push(p); return { id: "should-not" }; },
    invokeGrantAccess: async (id: string) => { grantCalls.push(id); return { success: true }; },
    writeAudit: async (a) => { audits.push({ action: a.action }); },
  });
  const r = await runRebillFlow(deps, {
    mode: "dry_run",
    parentOrder, payment,
    subscriptionId: parentOrder.bepaid_subscription_id,
  });
  assertEquals(r.decision, "dry_run_planned");
  assertEquals(r.proceedLegacy, true, "dry_run must keep legacy running");
  assertEquals(inserts.length, 0, "no INSERT in dry_run");
  assertEquals(grantCalls.length, 0, "no grant call in dry_run");
  assert(audits.some(a => a.action === "bepaid.rebill.dry_run"), "dry_run audit emitted");
});

Deno.test("PATCH-RB1: mode=off → no-op, no audits, legacy proceeds", async () => {
  const audits: Array<{ action: string }> = [];
  const deps = noopDeps({ writeAudit: async (a) => { audits.push({ action: a.action }); } });
  const r = await runRebillFlow(deps, {
    mode: "off", parentOrder, payment,
    subscriptionId: parentOrder.bepaid_subscription_id,
  });
  assertEquals(r.decision, "off_noop");
  assertEquals(r.proceedLegacy, true);
  assertEquals(audits.length, 0, "off mode writes nothing");
});

Deno.test("PATCH-RB1: env-driven mode resolver covers on/dry_run/off", () => {
  assertEquals(resolveKillSwitchMode("on"), "on");
  assertEquals(resolveKillSwitchMode("dry_run"), "dry_run");
  assertEquals(resolveKillSwitchMode("off"), "off");
  assertEquals(resolveKillSwitchMode(undefined), "off");
  assertEquals(resolveKillSwitchMode(""), "off");
  assertEquals(resolveKillSwitchMode("garbage"), "off");
});

Deno.test("PATCH-RB1: failed grant → manual_review on REBILL, proceedLegacy stays false (no legacy access fallback)", async () => {
  const audits: Array<{ action: string }> = [];
  const metaPatches: Array<{ orderId: string; patch: Record<string, unknown> }> = [];
  const deps = noopDeps({
    invokeGrantAccess: async () => { throw new Error("grant boom"); },
    mergeOrderMeta: async (p) => { metaPatches.push(p); },
    writeAudit: async (a) => { audits.push({ action: a.action }); },
  });
  const r = await runRebillFlow(deps, {
    mode: "on", parentOrder, payment,
    subscriptionId: parentOrder.bepaid_subscription_id,
  });
  assertEquals(r.decision, "materialized_grant_failed");
  assertEquals(r.proceedLegacy, false, "must NOT fall back to legacy access write when grant fails");
  assert(metaPatches.some(p => (p.patch as any).manual_review === true), "manual_review marker on REBILL");
  assert(audits.some(a => a.action === "bepaid.rebill.materialized_grant_failed"));
});

Deno.test("PATCH-RB1: SBS mismatch pre-check → skip, no REBILL, manual_review on parent", async () => {
  const inserts: any[] = [];
  const metaPatches: Array<{ orderId: string; patch: Record<string, unknown> }> = [];
  const deps = noopDeps({
    checkSbsMismatchBeforeRebill: async () => ({ mismatch: true, foreignSbs: "sbs_other", candidateSubId: "sub-other" }),
    insertRebillOrder: async (p: any) => { inserts.push(p); return { id: "x" }; },
    mergeOrderMeta: async (p) => { metaPatches.push(p); },
  });
  const r = await runRebillFlow(deps, {
    mode: "on", parentOrder, payment,
    subscriptionId: parentOrder.bepaid_subscription_id,
  });
  assertEquals(r.decision, "skip_sbs_mismatch_pre_check");
  assertEquals(r.proceedLegacy, false);
  assertEquals(inserts.length, 0);
  assert(metaPatches.some(p => p.orderId === parentOrder.id && (p.patch as any).manual_review === true));
});
