// Deno tests for rebill_builders.ts — offline, no network.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRebillOrderNumber,
  buildRebillOrderPayload,
  classifyRecurringAutocharge,
  isOrderFullyRefunded,
  resolveKillSwitchMode,
} from "./rebill_builders.ts";

Deno.test("resolveKillSwitchMode: default off", () => {
  assertEquals(resolveKillSwitchMode(undefined), "off");
  assertEquals(resolveKillSwitchMode(null), "off");
  assertEquals(resolveKillSwitchMode(""), "off");
  assertEquals(resolveKillSwitchMode("garbage"), "off");
  assertEquals(resolveKillSwitchMode("OFF"), "off");
});

Deno.test("resolveKillSwitchMode: dry_run variants", () => {
  assertEquals(resolveKillSwitchMode("dry_run"), "dry_run");
  assertEquals(resolveKillSwitchMode("DRY_RUN"), "dry_run");
  assertEquals(resolveKillSwitchMode("dryrun"), "dry_run");
  assertEquals(resolveKillSwitchMode("dry-run"), "dry_run");
});

Deno.test("resolveKillSwitchMode: on", () => {
  assertEquals(resolveKillSwitchMode("on"), "on");
  assertEquals(resolveKillSwitchMode("ON"), "on");
});

Deno.test("buildRebillOrderNumber: matches production pattern REBILL-<first 11>", () => {
  const uid = "7a64cd04-3d04-4a8e-9b1f-12ab34cd56ef";
  assertEquals(buildRebillOrderNumber(uid), "REBILL-7a64cd04-3d0");
});

Deno.test("buildRebillOrderNumber: throws on empty", () => {
  assertThrows(() => buildRebillOrderNumber(""));
});

Deno.test("buildRebillOrderPayload: canonical fields", () => {
  const payload = buildRebillOrderPayload({
    parentOrder: {
      id: "parent-uuid",
      user_id: "user-uuid",
      profile_id: "profile-uuid",
      product_id: "product-uuid",
      tariff_id: "tariff-uuid",
      currency: "BYN",
      pipeline_id: "pipeline-uuid",
      pipeline_stage_id: "stage-uuid",
      bepaid_subscription_id: "sbs-123",
      customer_email: "x@y.z",
      customer_phone: "+375290000000",
      payer_type: "individual",
      meta: { payment_flow: "bepaid_subscription_charge", deal_month: "2026-01" },
    },
    payment: {
      uid: "7a64cd04-3d04-4a8e-9b1f-12ab34cd56ef",
      amount: 39,
      paid_at: "2026-05-15T10:30:00.000Z",
      currency: "BYN",
    },
    subscriptionId: "sbs-123",
    materializationRun: "bepaid_webhook_rebill_v1",
  });

  assertEquals(payload.order_number, "REBILL-7a64cd04-3d0");
  assertEquals(payload.status, "paid");
  assertEquals(payload.provider, "bepaid");
  assertEquals(payload.provider_payment_id, "7a64cd04-3d04-4a8e-9b1f-12ab34cd56ef");
  assertEquals(payload.bepaid_subscription_id, "sbs-123");
  assertEquals(payload.final_price, 39);
  assertEquals(payload.paid_amount, 39);
  assertEquals(payload.user_id, "user-uuid");
  assertEquals(payload.product_id, "product-uuid");
  assertEquals(payload.tariff_id, "tariff-uuid");
  assertEquals(payload.pipeline_id, "pipeline-uuid");
  assertEquals(payload.pipeline_stage_id, "stage-uuid");
  assertEquals(payload.deal_date, "2026-05-15T10:30:00.000Z");
  assertEquals(payload.meta.source, "bepaid_rebill");
  assertEquals(payload.meta.payment_flow, "bepaid_subscription_charge");
  assertEquals(payload.meta.parent_order_id, "parent-uuid");
  assertEquals(payload.meta.materialized_from_payment_uid, "7a64cd04-3d04-4a8e-9b1f-12ab34cd56ef");
  assertEquals(payload.meta.materialization_run, "bepaid_webhook_rebill_v1");
  // Minsk timezone: 10:30 UTC + 3h = 13:30 → still 2026-05
  assertEquals(payload.meta.deal_month, "2026-05");
  // НЕТ do_not_grant_access — REBILL единый source
  assertEquals((payload.meta as any).do_not_grant_access, undefined);
});

Deno.test("isOrderFullyRefunded: empty → false", () => {
  assertEquals(isOrderFullyRefunded([]), false);
});

Deno.test("isOrderFullyRefunded: paid only → false", () => {
  assertEquals(
    isOrderFullyRefunded([
      { amount: 100, status: "paid", refunded_amount: 0 },
    ]),
    false,
  );
});

Deno.test("isOrderFullyRefunded: partial canonical → false", () => {
  assertEquals(
    isOrderFullyRefunded([
      { id: "p1", amount: 250, status: "paid", refunded_amount: 80 },
      { amount: -80, status: "refunded", transaction_type: "refund", meta: { parent_payment_id: "p1" } },
    ]),
    false,
  );
});

Deno.test("isOrderFullyRefunded: full canonical → true", () => {
  assertEquals(
    isOrderFullyRefunded([
      { id: "p1", amount: 250, status: "paid", refunded_amount: 250 },
      { amount: -250, status: "refunded", transaction_type: "refund", meta: { parent_payment_id: "p1" } },
    ]),
    true,
  );
});

Deno.test("isOrderFullyRefunded: legacy orphan refund → counts", () => {
  // legacy: refund-row без parent linkage; canonical formula
  assertEquals(
    isOrderFullyRefunded([
      { id: "p1", amount: 250, status: "paid", refunded_amount: 0 },
      { id: "p2", amount: 250, status: "paid", refunded_amount: 0 },
      { amount: -80, status: "succeeded", transaction_type: "refund", meta: {} },
    ]),
    false, // 80 < 500 → partial
  );
});

Deno.test("isOrderFullyRefunded: no double-count canonical pair", () => {
  // partial: parent.refunded=80 + refund-row.amount=-80, должно быть 80, не 160
  assertEquals(
    isOrderFullyRefunded([
      { id: "p1", amount: 100, status: "paid", refunded_amount: 80 },
      { amount: -80, status: "refunded", transaction_type: "refund", meta: { parent_payment_id: "p1" } },
    ]),
    false, // 80 < 100, partial
  );
  // но если parent refunded=100 → full
  assertEquals(
    isOrderFullyRefunded([
      { id: "p1", amount: 100, status: "paid", refunded_amount: 100 },
      { amount: -100, status: "refunded", transaction_type: "refund", meta: { parent_payment_id: "p1" } },
    ]),
    true,
  );
});

Deno.test("classifyRecurringAutocharge: no sbs → not_subscription", () => {
  assertEquals(
    classifyRecurringAutocharge({
      hasSubscriptionId: false,
      hasMatchingSubscriptionV2: false,
      transactionStatus: "successful",
      hasPriorSuccessfulPayment: false,
    }),
    "not_subscription",
  );
});

Deno.test("classifyRecurringAutocharge: initial sub charge", () => {
  assertEquals(
    classifyRecurringAutocharge({
      hasSubscriptionId: true,
      hasMatchingSubscriptionV2: true,
      transactionStatus: "successful",
      hasPriorSuccessfulPayment: false,
    }),
    "initial_subscription_charge",
  );
});

Deno.test("classifyRecurringAutocharge: rebill autocharge", () => {
  assertEquals(
    classifyRecurringAutocharge({
      hasSubscriptionId: true,
      hasMatchingSubscriptionV2: true,
      transactionStatus: "successful",
      hasPriorSuccessfulPayment: true,
    }),
    "recurring_autocharge",
  );
});

Deno.test("classifyRecurringAutocharge: failed status → not_subscription", () => {
  assertEquals(
    classifyRecurringAutocharge({
      hasSubscriptionId: true,
      hasMatchingSubscriptionV2: true,
      transactionStatus: "failed",
      hasPriorSuccessfulPayment: true,
    }),
    "not_subscription",
  );
});
