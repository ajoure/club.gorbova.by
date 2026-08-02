const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A composable checkout records one provider payment on the parent order and
 * creates child orders for the individual access targets. Child orders must
 * never receive an additional payments_v2 row of their own.
 */
export function getGroupChildPaymentId(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;

  const candidate = meta as Record<string, unknown>;
  const isGroupChild = candidate.group_child_order === true ||
    candidate.group_child_order === "true";
  const paymentId = candidate.group_payment_id;

  if (!isGroupChild || typeof paymentId !== "string") return null;
  const normalized = paymentId.trim().toLowerCase();
  return UUID_RE.test(normalized) ? normalized : null;
}
