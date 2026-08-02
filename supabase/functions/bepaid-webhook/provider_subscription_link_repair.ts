export type ProviderLinkRepairDecision =
  | { outcome: "noop"; reason: "already_linked" }
  | { outcome: "repair"; reason: "missing_link" | "terminal_stale_link" }
  | {
      outcome: "manual_review";
      reason:
        | "tracking_target_mismatch"
        | "identity_mismatch"
        | "target_terminal_status"
        | "current_link_non_terminal";
    };

export interface ProviderLinkRepairInput {
  trackingSubscriptionV2Id: string;
  targetSubscriptionV2Id: string;
  targetStatus: string;
  targetUserId: string | null;
  targetProductId: string | null;
  targetTariffId: string | null;
  targetOrderId: string | null;
  trackingOrderId: string;
  orderUserId: string | null;
  orderProductId: string | null;
  orderTariffId: string | null;
  currentLinkedSubscriptionV2Id: string | null;
  currentLinkedStatus: string | null;
}

const REPAIRABLE_STALE_STATUSES = new Set([
  "superseded",
  "expired_reentry",
  "canceled",
]);

const FORBIDDEN_TARGET_STATUSES = new Set([
  "superseded",
  "expired_reentry",
  "canceled",
]);

/**
 * Pure safety gate for repairing a lost bePaid sbs -> subscriptions_v2 link.
 * The webhook may repair only the exact subscription and order named by the
 * verified provider tracking id, with matching user/product/tariff identity.
 */
export function decideProviderSubscriptionLinkRepair(
  input: ProviderLinkRepairInput,
): ProviderLinkRepairDecision {
  const eq = (a: string | null, b: string | null) =>
    a != null && b != null && String(a) === String(b);

  if (
    !eq(input.trackingSubscriptionV2Id, input.targetSubscriptionV2Id) ||
    !eq(input.trackingOrderId, input.targetOrderId)
  ) {
    return { outcome: "manual_review", reason: "tracking_target_mismatch" };
  }

  if (
    !eq(input.targetUserId, input.orderUserId) ||
    !eq(input.targetProductId, input.orderProductId) ||
    !eq(input.targetTariffId, input.orderTariffId)
  ) {
    return { outcome: "manual_review", reason: "identity_mismatch" };
  }

  if (FORBIDDEN_TARGET_STATUSES.has(String(input.targetStatus))) {
    return { outcome: "manual_review", reason: "target_terminal_status" };
  }

  if (
    input.currentLinkedSubscriptionV2Id &&
    String(input.currentLinkedSubscriptionV2Id) ===
      String(input.targetSubscriptionV2Id)
  ) {
    return { outcome: "noop", reason: "already_linked" };
  }

  if (!input.currentLinkedSubscriptionV2Id) {
    return { outcome: "repair", reason: "missing_link" };
  }

  if (REPAIRABLE_STALE_STATUSES.has(String(input.currentLinkedStatus))) {
    return { outcome: "repair", reason: "terminal_stale_link" };
  }

  return { outcome: "manual_review", reason: "current_link_non_terminal" };
}
