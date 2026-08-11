export type RefundAccessAction = "revoke" | "reduce" | "keep" | "keep_subscription";

/**
 * A refund must not revoke access unless an administrator explicitly chooses it.
 * Money and access are separate decisions, so the safe initial state is `keep`.
 */
export const DEFAULT_REFUND_ACCESS_ACTION: RefundAccessAction = "keep";

export function adjustRefundAccessActionForAmount(
  current: RefundAccessAction,
  isFullRefund: boolean,
): RefundAccessAction {
  if (!isFullRefund && current === "revoke") return "reduce";
  return current;
}
