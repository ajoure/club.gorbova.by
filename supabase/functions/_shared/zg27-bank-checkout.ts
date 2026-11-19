import { Zg27CheckoutError } from './zg27-checkout-guard.ts';
import { ZG27_ACCESS_END_EXCLUSIVE } from './zg27-policy.ts';

/** A bank finances the full fixed price; no app-managed card installment/credit composition. */
export function assertZg27BankOptions(body: { adjustment_amount?: unknown; customer_credit_requested_minor?: unknown; partner_bonus_requested_minor?: unknown }, addonIds: string[]): void {
  if (addonIds.length || (['adjustment_amount', 'customer_credit_requested_minor', 'partner_bonus_requested_minor'] as const)
    .some(key => body[key] !== undefined && Number(body[key]) !== 0)) {
    throw new Zg27CheckoutError('zg27_fixed_price_required');
  }
}

/** Freeze the existing pending RR order before any provider request; never rewrite a receipt or paid order. */
export async function freezeZg27BankSnapshot(db: any, input: {
  orderId: string; userId: string; productId: string; tariffId: string; totalMinor: number;
}): Promise<void> {
  const { data: order, error } = await db.from('orders_v2')
    .select('id,user_id,product_id,tariff_id,provider,status,currency,final_price,purchase_snapshot,updated_at,meta')
    .eq('id', input.orderId).maybeSingle();
  if (error || !order || order.user_id !== input.userId || order.product_id !== input.productId
    || order.tariff_id !== input.tariffId || order.provider !== 'rr' || order.status !== 'pending'
    || order.meta?.flow !== 'rr_installment' || order.currency !== 'BYN'
    || Math.round(Number(order.final_price) * 100) !== input.totalMinor) throw Error('zg27_bank_order_proof_invalid');
  const policy = { kind: 'fixed_exclusive_end', timezone: 'Europe/Minsk', end_exclusive: ZG27_ACCESS_END_EXCLUSIVE };
  const existing = order.purchase_snapshot?.course_access;
  if (existing) {
    if (existing.kind !== policy.kind || existing.end_exclusive !== policy.end_exclusive || existing.timezone !== policy.timezone) throw Error('zg27_bank_access_policy_conflict');
    return;
  }
  const { data: changed, error: updateError } = await db.from('orders_v2')
    .update({ purchase_snapshot: { ...(order.purchase_snapshot ?? {}), course_access: policy } })
    .eq('id', order.id).eq('updated_at', order.updated_at).eq('status', 'pending').select('id').maybeSingle();
  if (updateError || !changed) throw Error('zg27_bank_snapshot_cas_failed');
}
