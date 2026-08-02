import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getGroupChildPaymentId } from "./group_child_order.ts";

Deno.test("returns the canonical parent payment for a group child", () => {
  assertEquals(
    getGroupChildPaymentId({
      group_child_order: true,
      group_payment_id: "A09169C1-0F94-4E40-8D8A-30EE79B07CA1",
    }),
    "a09169c1-0f94-4e40-8d8a-30ee79b07ca1",
  );
});

Deno.test("accepts the legacy string boolean", () => {
  assertEquals(
    getGroupChildPaymentId({
      group_child_order: "true",
      group_payment_id: "80355c88-1b0f-4c25-a7d2-5d2d6d81a4e2",
    }),
    "80355c88-1b0f-4c25-a7d2-5d2d6d81a4e2",
  );
});

Deno.test("fails closed for malformed or incomplete metadata", () => {
  assertEquals(getGroupChildPaymentId(null), null);
  assertEquals(getGroupChildPaymentId({ group_child_order: false, group_payment_id: crypto.randomUUID() }), null);
  assertEquals(getGroupChildPaymentId({ group_child_order: true }), null);
  assertEquals(getGroupChildPaymentId({ group_child_order: true, group_payment_id: "not-a-uuid" }), null);
});
