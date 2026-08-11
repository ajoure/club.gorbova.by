export interface PostCancelChargeInput {
  subscriptionStatus: string | null | undefined;
  autoRenew: boolean | null | undefined;
  canceledAt: string | null | undefined;
  autoRenewDisabledAt: string | null | undefined;
  transactionStatus: string | null | undefined;
  transactionPaidAt: string | null | undefined;
}
export type PostCancelChargeDecision =
  | {
    outcome: "post_cancel_charge";
    cancellationConfirmedAt: string;
    chargedAt: string;
  }
  | {
    outcome: "normal_processing";
    reason:
      | "transaction_not_successful"
      | "cancellation_not_confirmed"
      | "invalid_timestamp"
      | "charge_not_after_cancel";
  };

const SUCCESSFUL_TRANSACTION_STATUSES = new Set([
  "successful",
  "success",
  "paid",
]);

/**
 * Fail-closed classifier for money received after a locally confirmed cancel.
 * A local end-of-period cancel is still a confirmed cancel even while the
 * access row remains active, therefore auto_renew=false plus a persisted
 * cancellation timestamp is sufficient.
 */
export function classifyPostCancelCharge(
  input: PostCancelChargeInput,
): PostCancelChargeDecision {
  const transactionStatus = String(input.transactionStatus || "").toLowerCase();
  if (!SUCCESSFUL_TRANSACTION_STATUSES.has(transactionStatus)) {
    return {
      outcome: "normal_processing",
      reason: "transaction_not_successful",
    };
  }

  const cancellationConfirmed =
    String(input.subscriptionStatus || "").toLowerCase() === "canceled" ||
    input.autoRenew === false;
  const cancellationConfirmedAt = input.autoRenewDisabledAt ||
    input.canceledAt || null;
  if (!cancellationConfirmed || !cancellationConfirmedAt) {
    return {
      outcome: "normal_processing",
      reason: "cancellation_not_confirmed",
    };
  }

  const canceledMs = Date.parse(cancellationConfirmedAt);
  const chargedMs = Date.parse(input.transactionPaidAt || "");
  if (!Number.isFinite(canceledMs) || !Number.isFinite(chargedMs)) {
    return { outcome: "normal_processing", reason: "invalid_timestamp" };
  }
  if (chargedMs <= canceledMs) {
    return { outcome: "normal_processing", reason: "charge_not_after_cancel" };
  }

  return {
    outcome: "post_cancel_charge",
    cancellationConfirmedAt: new Date(canceledMs).toISOString(),
    chargedAt: new Date(chargedMs).toISOString(),
  };
}
