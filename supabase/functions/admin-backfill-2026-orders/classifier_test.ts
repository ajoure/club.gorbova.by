import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyPayment } from "./classifier.ts";

const valid = {
  status: "succeeded",
  amount: 150,
  provider: "bepaid",
  paid_at: "2026-07-22T10:00:00Z",
  meta: {},
  provider_response: { transaction_type: "payment" },
};

Deno.test("accepts a confirmed provider sale", () => {
  assertEquals(classifyPayment(valid), null);
});

Deno.test("rejects refunds, voids, fees and zero amounts", () => {
  assertEquals(
    classifyPayment({
      ...valid,
      provider_response: { transaction_type: "refund" },
    }),
    "non_sale_transaction",
  );
  assertEquals(
    classifyPayment({ ...valid, amount: 0 }),
    "non_positive_amount",
  );
  assertEquals(
    classifyPayment({
      ...valid,
      meta: { source: "statement_sync", description: "Комиссия банка" },
    }),
    "manual_or_non_sale_source",
  );
});

Deno.test("rejects manual and synthetic records", () => {
  assertEquals(
    classifyPayment({ ...valid, meta: { source: "admin_manual" } }),
    "manual_or_non_sale_source",
  );
  assertEquals(
    classifyPayment({ ...valid, meta: { source: "synthetic_fixture" } }),
    "test_or_synthetic",
  );
});

Deno.test("only supported acquiring providers are eligible", () => {
  assertEquals(
    classifyPayment({ ...valid, provider: "cash" }),
    "unsupported_provider",
  );
});
