import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getGroupChildPaymentId,
  getGroupChildReferences,
  isCanonicalGroupChildLink,
} from "./group_child_order.ts";

const PRIMARY_ORDER_ID = "f8814968-4e88-47dc-9d84-13d4c7992326";
const ORDER_GROUP_ID = "3d3cc262-4091-4fb3-bbd7-55a926f3074a";

Deno.test("returns the canonical parent payment for a group child", () => {
  assertEquals(
    getGroupChildPaymentId({
      group_child_order: true,
      group_payment_id: "A09169C1-0F94-4E40-8D8A-30EE79B07CA1",
      group_primary_order_id: PRIMARY_ORDER_ID,
      order_group_id: ORDER_GROUP_ID,
    }),
    "a09169c1-0f94-4e40-8d8a-30ee79b07ca1",
  );
});

Deno.test("accepts the legacy string boolean", () => {
  assertEquals(
    getGroupChildPaymentId({
      group_child_order: "true",
      group_payment_id: "80355c88-1b0f-4c25-a7d2-5d2d6d81a4e2",
      group_primary_order_id: PRIMARY_ORDER_ID,
      order_group_id: ORDER_GROUP_ID,
    }),
    "80355c88-1b0f-4c25-a7d2-5d2d6d81a4e2",
  );
});

Deno.test("fails closed for malformed or incomplete metadata", () => {
  assertEquals(getGroupChildPaymentId(null), null);
  assertEquals(getGroupChildPaymentId({ group_child_order: false, group_payment_id: crypto.randomUUID() }), null);
  assertEquals(getGroupChildPaymentId({ group_child_order: true }), null);
  assertEquals(getGroupChildPaymentId({ group_child_order: true, group_payment_id: "not-a-uuid" }), null);
  assertEquals(getGroupChildPaymentId({
    group_child_order: true,
    group_payment_id: crypto.randomUUID(),
    group_primary_order_id: PRIMARY_ORDER_ID,
  }), null);
});

Deno.test("returns every canonical reference required for database verification", () => {
  assertEquals(getGroupChildReferences({
    group_child_order: true,
    group_payment_id: "A09169C1-0F94-4E40-8D8A-30EE79B07CA1",
    group_primary_order_id: PRIMARY_ORDER_ID.toUpperCase(),
    order_group_id: ORDER_GROUP_ID,
  }), {
    paymentId: "a09169c1-0f94-4e40-8d8a-30ee79b07ca1",
    primaryOrderId: PRIMARY_ORDER_ID,
    orderGroupId: ORDER_GROUP_ID,
  });
});

Deno.test("accepts only the exact succeeded primary payment and canonical group", () => {
  const refs = {
    paymentId: "a09169c1-0f94-4e40-8d8a-30ee79b07ca1",
    primaryOrderId: PRIMARY_ORDER_ID,
    orderGroupId: ORDER_GROUP_ID,
  };
  const canonical = {
    refs,
    childUserId: "1658b558-edf3-46ab-89f3-0fe712bbfbe0",
    groupPayment: {
      order_id: PRIMARY_ORDER_ID,
      user_id: "1658b558-edf3-46ab-89f3-0fe712bbfbe0",
      status: "succeeded",
    },
    orderGroup: {
      primary_order_id: PRIMARY_ORDER_ID,
      user_id: "1658b558-edf3-46ab-89f3-0fe712bbfbe0",
      status: "paid",
    },
    hasAddonMembership: true,
  };
  assertEquals(isCanonicalGroupChildLink(canonical), true);
  assertEquals(isCanonicalGroupChildLink({
    ...canonical,
    groupPayment: { ...canonical.groupPayment, order_id: crypto.randomUUID() },
  }), false);
  assertEquals(isCanonicalGroupChildLink({
    ...canonical,
    groupPayment: { ...canonical.groupPayment, order_id: null },
  }), false);
  assertEquals(isCanonicalGroupChildLink({
    ...canonical,
    orderGroup: { ...canonical.orderGroup, primary_order_id: crypto.randomUUID() },
  }), false);
  assertEquals(isCanonicalGroupChildLink({ ...canonical, hasAddonMembership: false }), false);
  assertEquals(isCanonicalGroupChildLink({
    ...canonical,
    groupPayment: { ...canonical.groupPayment, status: "refunded" },
  }), false);
});
