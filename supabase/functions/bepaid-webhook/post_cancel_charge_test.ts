import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyPostCancelCharge } from "./post_cancel_charge.ts";

const base = {
  subscriptionStatus: "active",
  autoRenew: false,
  canceledAt: "2026-08-10T11:10:45.000Z",
  autoRenewDisabledAt: "2026-08-10T11:10:45.000Z",
  transactionStatus: "successful",
  transactionPaidAt: "2026-08-11T03:00:51.000Z",
};

Deno.test("successful provider charge after confirmed cancel is isolated", () => {
  assertEquals(classifyPostCancelCharge(base), {
    outcome: "post_cancel_charge",
    cancellationConfirmedAt: "2026-08-10T11:10:45.000Z",
    chargedAt: "2026-08-11T03:00:51.000Z",
  });
});

Deno.test("charge before cancellation follows normal renewal processing", () => {
  assertEquals(
    classifyPostCancelCharge({
      ...base,
      transactionPaidAt: "2026-08-10T11:10:44.000Z",
    }),
    { outcome: "normal_processing", reason: "charge_not_after_cancel" },
  );
});

Deno.test("auto-renewing subscription is not treated as canceled", () => {
  assertEquals(
    classifyPostCancelCharge({
      ...base,
      autoRenew: true,
      subscriptionStatus: "active",
    }),
    { outcome: "normal_processing", reason: "cancellation_not_confirmed" },
  );
});

Deno.test("failed transaction is never a post-cancel charge", () => {
  assertEquals(
    classifyPostCancelCharge({
      ...base,
      transactionStatus: "failed",
    }),
    { outcome: "normal_processing", reason: "transaction_not_successful" },
  );
});

Deno.test("invalid timestamps fail closed to normal processing", () => {
  assertEquals(
    classifyPostCancelCharge({
      ...base,
      transactionPaidAt: "not-a-date",
    }),
    { outcome: "normal_processing", reason: "invalid_timestamp" },
  );
});
