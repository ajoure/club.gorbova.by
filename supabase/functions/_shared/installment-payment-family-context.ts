import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { installmentPaymentFamily, readInstallmentFamilyRows, type InstallmentLedgerOrder } from './installment-payment-family.ts';
import { RepaymentPlanError } from './installment-repayment-plan.ts';

/** Read only the purchase identity; never merge other purchases of the same course. */
export async function loadInstallmentPaymentFamily(db: SupabaseClient, root: InstallmentLedgerOrder) {
  if (!root.user_id || !root.product_id || !root.tariff_id || !root.currency) {
    throw new RepaymentPlanError('installment_family_identity_missing');
  }
  const columns = `id,user_id,product_id,tariff_id,currency,bepaid_subscription_id,is_deleted,meta,
    payments_v2(id,order_id,user_id,currency,provider,provider_payment_id,status,amount,refunded_amount,is_deleted,transaction_type,updated_at)`;
  const { data: currentRoot, error } = await db.from('orders_v2').select(columns).eq('id', root.id).maybeSingle();
  if (error) throw new RepaymentPlanError('repayment_read_failed');
  if (!currentRoot) throw new RepaymentPlanError('installment_family_root_missing');
  if (currentRoot.user_id !== root.user_id || currentRoot.product_id !== root.product_id
      || currentRoot.tariff_id !== root.tariff_id || currentRoot.currency !== root.currency
      || currentRoot.bepaid_subscription_id !== root.bepaid_subscription_id) {
    throw new RepaymentPlanError('installment_family_identity_mismatch');
  }
  const rows = await readInstallmentFamilyRows(currentRoot as InstallmentLedgerOrder, async frontier => {
    // Query explicit lineage before validating identity. Filtering by tariff or
    // customer first would silently hide a re-bound child and quote a partial debt.
    const { data: children, error: childError } = await db.from('orders_v2').select(columns)
      .in('meta->>parent_order_id', frontier).limit(1001);
    if (childError) throw new RepaymentPlanError('repayment_read_failed');
    if (!children) throw new RepaymentPlanError('installment_family_incomplete');
    return children as InstallmentLedgerOrder[];
  });
  return installmentPaymentFamily(currentRoot as InstallmentLedgerOrder, rows);
}
