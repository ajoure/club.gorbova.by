import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideProviderSubscriptionLinkRepair } from "./provider_subscription_link_repair.ts";

const base = {
  trackingSubscriptionV2Id: "sub-current",
  targetSubscriptionV2Id: "sub-current",
  targetStatus: "expired",
  targetUserId: "user-1",
  targetProductId: "product-1",
  targetTariffId: "tariff-1",
  targetOrderId: "order-1",
  trackingOrderId: "order-1",
  orderUserId: "user-1",
  orderProductId: "product-1",
  orderTariffId: "tariff-1",
  currentLinkedSubscriptionV2Id: "sub-old",
  currentLinkedStatus: "superseded",
};

Deno.test("repairs sbs link from superseded chain to exact tracked subscription", () => {
  assertEquals(decideProviderSubscriptionLinkRepair(base), {
    outcome: "repair",
    reason: "terminal_stale_link",
  });
});

Deno.test("keeps an already correct provider link", () => {
  assertEquals(decideProviderSubscriptionLinkRepair({
    ...base,
    currentLinkedSubscriptionV2Id: "sub-current",
    currentLinkedStatus: "active",
  }), { outcome: "noop", reason: "already_linked" });
});

Deno.test("does not steal an sbs from another non-terminal subscription", () => {
  assertEquals(decideProviderSubscriptionLinkRepair({
    ...base,
    currentLinkedStatus: "active",
  }), { outcome: "manual_review", reason: "current_link_non_terminal" });
});

Deno.test("rejects a tracking/order or identity mismatch", () => {
  assertEquals(decideProviderSubscriptionLinkRepair({
    ...base,
    trackingOrderId: "other-order",
  }), { outcome: "manual_review", reason: "tracking_target_mismatch" });

  assertEquals(decideProviderSubscriptionLinkRepair({
    ...base,
    orderUserId: "other-user",
  }), { outcome: "manual_review", reason: "identity_mismatch" });
});

Deno.test("does not target a superseded subscription", () => {
  assertEquals(decideProviderSubscriptionLinkRepair({
    ...base,
    targetStatus: "superseded",
  }), { outcome: "manual_review", reason: "target_terminal_status" });
});
