import { getGroupChildReferences } from '../admin-repair-missing-payments/group_child_order.ts';

// This repair follows the separate CB20 product, never legacy or CB21 rights.
export const CB20_COURSE_PRODUCT_ID = '3e43fb28-8322-41bc-bfee-714731bdc630';

export function shouldAlignPaidAddonWindow(input: {
  customDays?: unknown; customEnd?: unknown; customStart?: unknown;
  source?: unknown; callerType: string;
}): boolean {
  if (input.customDays != null || input.customEnd) return false;
  if (!input.customStart) return true;
  // Scheduled opening supplies its activation time, not a manual duration.
  // Body source never confers authorization: the caller is already resolved.
  return input.callerType === 'service_role' &&
    ['scheduled_module_fixed_date','scheduled_module_manual_open'].includes(String(input.source));
}

export function laterAccessEnd(normal: Date | null, courseEnd: string | undefined): Date | null {
  if (!courseEnd) return normal;
  const course = new Date(courseEnd);
  if (!Number.isFinite(course.getTime())) throw new Error('paid_addon_invalid_course_window');
  return !normal || course > normal ? course : normal;
}

/** Read-only lineage check, before any fulfillment write. Never create a child payment. */
export async function resolvePaidCourseAddonWindow(
  db: any,
  order: any,
  productCode: string,
  now = new Date(),
): Promise<{ expiresAt: string; paidAt: string; baseEntitlementId: string; baseOrderId: string } | null> {
  if (!productCode.startsWith('cb_module_') && productCode !== 'prd_08a84b2b7223') return null;
  if (order.meta?.group_child_order !== true && order.meta?.group_child_order !== 'true') return null;
  const refs = getGroupChildReferences(order.meta);
  if (!refs) throw new Error('paid_addon_invalid_group_references');
  const read = async (query: any) => {
    const result = await query;
    if (result.error) throw new Error('paid_addon_lineage_lookup_failed');
    return result.data;
  };
  const parent = await read(db.from('orders_v2').select('id,user_id,product_id,status,is_deleted')
    .eq('id', refs.primaryOrderId).maybeSingle());
  if (!parent) throw new Error('paid_addon_primary_order_missing');
  if (parent.product_id !== CB20_COURSE_PRODUCT_ID) return null;
  if (order.status !== 'paid' || order.is_deleted || !(Number(order.final_price) > 0) || !(Number(order.paid_amount) > 0) ||
    !order.user_id || parent.user_id !== order.user_id || parent.is_deleted ||
    !['paid', 'partial_refund'].includes(parent.status)) throw new Error('paid_addon_order_not_eligible');

  const [group, item, payments, existing] = await Promise.all([
    read(db.from('order_groups').select('id,user_id,primary_order_id,status').eq('id', refs.orderGroupId).maybeSingle()),
    read(db.from('order_group_items').select('id').eq('order_id', order.id)
      .eq('order_group_id', refs.orderGroupId).eq('product_id', order.product_id).eq('role', 'addon').maybeSingle()),
    read(db.from('payments_v2').select('id,order_id,user_id,status,is_deleted,amount,refunded_amount,paid_at')
      .eq('order_id', refs.primaryOrderId)),
    read(db.from('entitlements').select('id,status,meta,expires_at')
      .eq('user_id', order.user_id).eq('product_id', order.product_id).maybeSingle()),
  ]);
  const payment = payments?.find((p: any) => p.id === refs.paymentId);
  if (!group || !item || group.primary_order_id !== parent.id || group.user_id !== order.user_id ||
    !['paid', 'partial_refund'].includes(group.status) || !payment || payment.is_deleted ||
    payment.user_id !== order.user_id || !['succeeded', 'partially_refunded'].includes(payment.status) ||
    !(Number(payment.amount) > Number(payment.refunded_amount || 0)) || !Number.isFinite(Date.parse(payment.paid_at)) ||
    payments.some((p: any) => p.status === 'refunded' || (Number(p.amount) > 0 && Number(p.refunded_amount) >= Number(p.amount)))) {
    throw new Error('paid_addon_group_payment_not_eligible');
  }
  const [requests, intents, base] = await Promise.all([
    read(db.from('payment_refund_requests').select('state,access_action').eq('order_group_item_id', item.id)),
    read(db.from('composable_refund_intents').select('status,access_action').eq('order_group_item_id', item.id)),
    read(db.from('entitlements').select('id,status,expires_at').eq('order_id', parent.id)
      .eq('user_id', order.user_id).eq('product_id', parent.product_id).maybeSingle()),
  ]);
  // The writer merges by user/product, including an older purchase. Protect
  // that row's explicit override too; an expired automatic Business gift does
  // not prevent fulfillment of this independently paid new order.
  if (existing && (existing.status === 'revoked' || existing.meta?.manual_access_edit_last_at)) {
    throw new Error('paid_addon_existing_access_override');
  }
  if (requests.some((q: any) => q.state !== 'failed' && ['revoke', 'reduce'].includes(q.access_action)) ||
    intents.some((q: any) => !['failed', 'cancelled'].includes(q.status) && ['revoke', 'reduce'].includes(q.access_action))) {
    throw new Error('paid_addon_refund_access_override');
  }
  if (!base || base.status !== 'active' || !base.expires_at || !(Date.parse(base.expires_at) > now.getTime())) {
    throw new Error('paid_addon_primary_access_missing');
  }
  return { expiresAt: base.expires_at, paidAt: payment.paid_at, baseEntitlementId: base.id, baseOrderId: parent.id };
}
