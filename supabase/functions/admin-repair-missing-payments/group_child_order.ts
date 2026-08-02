const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GroupChildReferences {
  paymentId: string;
  primaryOrderId: string;
  orderGroupId: string;
}

interface GroupChildLinkInput {
  refs: GroupChildReferences;
  childUserId: string | null;
  groupPayment: {
    order_id?: string | null;
    user_id?: string | null;
    status?: string | null;
  } | null;
  orderGroup: {
    primary_order_id?: string | null;
    user_id?: string | null;
    status?: string | null;
  } | null;
  hasAddonMembership: boolean;
}

function normalizedUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_RE.test(normalized) ? normalized : null;
}

/**
 * A composable checkout records one provider payment on the parent order and
 * creates child orders for the individual access targets. Child orders must
 * never receive an additional payments_v2 row of their own.
 */
export function getGroupChildReferences(meta: unknown): GroupChildReferences | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;

  const candidate = meta as Record<string, unknown>;
  const isGroupChild = candidate.group_child_order === true ||
    candidate.group_child_order === "true";
  if (!isGroupChild) return null;

  const paymentId = normalizedUuid(candidate.group_payment_id);
  const primaryOrderId = normalizedUuid(candidate.group_primary_order_id);
  const orderGroupId = normalizedUuid(candidate.order_group_id);
  if (!paymentId || !primaryOrderId || !orderGroupId) return null;

  return { paymentId, primaryOrderId, orderGroupId };
}

export function getGroupChildPaymentId(meta: unknown): string | null {
  return getGroupChildReferences(meta)?.paymentId ?? null;
}

export function isCanonicalGroupChildLink(input: GroupChildLinkInput): boolean {
  const { refs, childUserId, groupPayment, orderGroup, hasAddonMembership } = input;
  if (!groupPayment || !orderGroup || !hasAddonMembership) return false;
  if (groupPayment.status !== "succeeded" || orderGroup.status !== "paid") return false;
  if (!groupPayment.order_id || !orderGroup.primary_order_id) return false;
  if (groupPayment.order_id.toLowerCase() !== refs.primaryOrderId) return false;
  if (orderGroup.primary_order_id.toLowerCase() !== refs.primaryOrderId) return false;
  if (!childUserId || groupPayment.user_id !== childUserId) return false;
  return orderGroup.user_id === childUserId;
}
