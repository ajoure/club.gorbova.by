import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildOrderHeaderReconcilePatch } from "./order-header-reconcile.ts";

Deno.test("builds a deterministic order header patch from final payment evidence", () => {
  const patch = buildOrderHeaderReconcilePatch({
    paymentId: "payment-1",
    amount: 339,
    providerPaymentId: "provider-1",
    bepaidSubscriptionId: "sbs_1",
  }, "2026-07-23T14:00:00.000Z");

  assertEquals(patch.status, "paid");
  assertEquals(patch.paid_amount, 339);
  assertEquals(patch.provider, "bepaid");
  assertEquals(patch.provider_payment_id, "provider-1");
  assertEquals(patch.bepaid_subscription_id, "sbs_1");
  assertEquals(patch.reconcile_meta.payment_v2_id, "payment-1");
  assertEquals(patch.reconcile_meta.reconcile_reason, "subscription_phantom_uid_skipped_no_provider_event");
});
