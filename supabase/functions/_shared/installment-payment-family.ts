import { repaymentBalance, RepaymentPlanError, type RepaymentPayment } from './installment-repayment-plan.ts';

export interface InstallmentLedgerOrder {
  id: string;
  user_id: string | null;
  product_id?: string | null;
  tariff_id?: string | null;
  currency: string | null;
  bepaid_subscription_id?: string | null;
  is_deleted?: boolean;
  meta?: Record<string, unknown> | null;
  payments_v2?: RepaymentPayment[] | null;
}

/** Load explicit descendants before identity filtering can hide a re-bound row. */
export async function readInstallmentFamilyRows(
  root: InstallmentLedgerOrder,
  readChildren: (parents: string[]) => Promise<InstallmentLedgerOrder[]>,
) {
  const rows = [root];
  const seen = new Set([root.id]);
  let frontier = [root.id];
  while (frontier.length) {
    const children = await readChildren(frontier);
    if (rows.length + children.length >= 1001) throw new RepaymentPlanError('installment_family_incomplete');
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id)) throw new RepaymentPlanError('installment_family_cycle');
      seen.add(child.id);
      rows.push(child);
      frontier.push(child.id);
    }
  }
  return rows;
}

/** A rebill is a separate receipt/deal, not a second debt agreement. */
export function installmentPaymentFamily(root: InstallmentLedgerOrder, orders: InstallmentLedgerOrder[]) {
  if (!root.id || !root.user_id || !root.currency || root.is_deleted) {
    throw new RepaymentPlanError('installment_family_identity_missing');
  }
  const family = new Map<string, InstallmentLedgerOrder>([[root.id, root]]);
  const queue = [root.id];
  for (let index = 0; index < queue.length; index++) {
    if (queue.length > 1000) throw new RepaymentPlanError('installment_family_too_large');
    for (const child of orders) {
      if (child.meta?.parent_order_id !== queue[index]) continue;
      if (family.has(child.id)) throw new RepaymentPlanError('installment_family_cycle');
      if (!root.product_id || !root.tariff_id || child.user_id !== root.user_id
          || child.product_id !== root.product_id || child.tariff_id !== root.tariff_id
          || child.currency !== root.currency || child.is_deleted) {
        throw new RepaymentPlanError('installment_family_identity_mismatch');
      }
      const meta = child.meta ?? {};
      if (meta.manual_review === true || meta.refund_candidate === true || meta.do_not_grant_access === true) {
        throw new RepaymentPlanError('installment_family_requires_review');
      }
      if (meta.source !== 'bepaid_rebill' || meta.payment_flow !== 'bepaid_subscription_charge'
          || typeof meta.materialized_from_payment_uid !== 'string' || !meta.materialized_from_payment_uid
          || !root.bepaid_subscription_id || child.bepaid_subscription_id !== root.bepaid_subscription_id) {
        throw new RepaymentPlanError('installment_family_lineage_unproven');
      }
      const payments = child.payments_v2 ?? [];
      if (!payments.some(p => !p.is_deleted && p.provider === 'bepaid'
          && p.provider_payment_id === meta.materialized_from_payment_uid
          && ['succeeded', 'refunded', 'partially_refunded'].includes(p.status))) {
        throw new RepaymentPlanError('installment_family_receipt_missing');
      }
      family.set(child.id, child);
      queue.push(child.id);
    }
  }
  const payments = [...family.values()].flatMap(order => (order.payments_v2 ?? []).map(payment => {
    if (payment.order_id !== order.id || payment.user_id !== root.user_id || payment.currency !== root.currency) {
      throw new RepaymentPlanError('installment_family_payment_mismatch');
    }
    return payment;
  }));
  return { orders: [...family.values()], payments };
}

/** Normalize only this read projection; never move payment rows between deals. */
export function installmentFamilyBalance(root: InstallmentLedgerOrder, orders: InstallmentLedgerOrder[], total: unknown) {
  const family = installmentPaymentFamily(root, orders);
  const balance = repaymentBalance({
    orderId: root.id, userId: root.user_id!, currency: root.currency!, total,
    payments: family.payments.map(payment => ({ ...payment, order_id: root.id })),
  });
  return { ...balance, family };
}
