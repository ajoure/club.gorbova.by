import { describe, expect, it } from 'vitest';
import { installmentFamilyBalance, installmentPaymentFamily, readInstallmentFamilyRows, type InstallmentLedgerOrder } from '../../supabase/functions/_shared/installment-payment-family';

const payment = (id: string, order: string, uid = id) => ({
  id, order_id: order, user_id: 'buyer', currency: 'BYN', provider: 'bepaid',
  provider_payment_id: uid, status: 'succeeded', amount: 339, refunded_amount: 0,
});
const root: InstallmentLedgerOrder = {
  id: 'agreement', user_id: 'buyer', product_id: 'course', tariff_id: 'tier', currency: 'BYN',
  bepaid_subscription_id: 'bank-plan', payments_v2: [payment('july', 'agreement'), payment('august', 'agreement')],
};
const child = (id: string, parent = 'agreement'): InstallmentLedgerOrder => ({
  ...root, id, payments_v2: [payment(id, id)],
  meta: { parent_order_id: parent, source: 'bepaid_rebill', payment_flow: 'bepaid_subscription_charge', materialized_from_payment_uid: id },
});

describe('finite installment payment family', () => {
  it('counts separate rebill receipts without moving them back to the parent', () => {
    const september = child('september'), october = child('october');
    const before = JSON.stringify([root, september, october]);
    expect(installmentFamilyBalance(root, [root, september, october], 2034))
      .toMatchObject({ paidCount: 4, paidMinor: 135600, remainingMinor: 67800 });
    expect(JSON.stringify([root, september, october])).toBe(before);
    expect(installmentPaymentFamily(root, [september, october]).payments.map(p => p.order_id))
      .toEqual(['agreement', 'agreement', 'september', 'october']);
  });
  it('preserves the original agreed total, never deriving it from the monthly amount', () => {
    expect(installmentFamilyBalance(root, [child('september'), child('october')], 1950))
      .toMatchObject({ totalMinor: 195000, paidMinor: 135600, remainingMinor: 59400 });
  });
  it('ignores another purchase of the same product without an explicit parent link', () => {
    const other = { ...root, id: 'other-agreement', payments_v2: [payment('other', 'other-agreement')] };
    expect(installmentFamilyBalance(root, [other], 2034)).toMatchObject({ paidCount: 2, paidMinor: 67800 });
  });
  it.each(['user_id', 'product_id', 'tariff_id', 'currency', 'bepaid_subscription_id'] as const)(
    'rejects a re-bound child with a different %s', field => {
      expect(() => installmentPaymentFamily(root, [{ ...child('september'), [field]: 'foreign' }]))
        .toThrow(/installment_family_(identity_mismatch|lineage_unproven)/);
    },
  );
  it('rejects an unproven parent hint and a receipt UID that does not match the materialization', () => {
    expect(() => installmentPaymentFamily(root, [{ ...child('september'), meta: { parent_order_id: root.id } }]))
      .toThrow('installment_family_lineage_unproven');
    expect(() => installmentPaymentFamily(root, [{ ...child('september'), payments_v2: [payment('different', 'september')] }]))
      .toThrow('installment_family_receipt_missing');
  });
  it('requires a proven bank subscription identity before including child receipts', () => {
    expect(() => installmentPaymentFamily({ ...root, bepaid_subscription_id: null }, [child('september')]))
      .toThrow('installment_family_lineage_unproven');
  });
  it('deduplicates the same provider receipt across a parent and its materialized child', () => {
    expect(installmentFamilyBalance(root, [child('july')], 2034)).toMatchObject({ paidCount: 2, paidMinor: 67800 });
  });
  it('fails closed on a conflicting duplicate or a refund in a child deal', () => {
    expect(() => installmentFamilyBalance(root, [{ ...child('july'), payments_v2: [{ ...payment('july', 'july'), amount: 338 }] }], 2034))
      .toThrow('conflicting_payment_duplicate');
    expect(() => installmentFamilyBalance(root, [{ ...child('september'), payments_v2: [{ ...payment('september', 'september'), refunded_amount: 1 }] }], 2034))
      .toThrow('refunded_installment_requires_review');
  });
  it('does not collect from a post-cancellation or manually disputed child receipt', () => {
    const row = child('september');
    expect(() => installmentPaymentFamily(root, [{ ...row, meta: { ...row.meta, refund_candidate: true } }]))
      .toThrow('installment_family_requires_review');
  });
  it('accepts a proved descendant chain with the same purchase identity', () => {
    expect(installmentFamilyBalance(root, [child('september'), child('october', 'september')], 2034))
      .toMatchObject({ paidCount: 4, paidMinor: 135600 });
  });
  it('reads re-bound descendants before validating their purchase identity', async () => {
    const rebound = { ...child('september'), user_id: 'other-buyer' };
    const rows = await readInstallmentFamilyRows(root, async parents => parents.includes(root.id) ? [rebound] : []);
    expect(rows).toHaveLength(2);
    expect(() => installmentPaymentFamily(root, rows)).toThrow('installment_family_identity_mismatch');
  });
  it('rejects cycles including a root that points back to a descendant', async () => {
    const cyclicRoot = { ...root, meta: { parent_order_id: 'september' } };
    expect(() => installmentPaymentFamily(cyclicRoot, [cyclicRoot, child('september')])).toThrow('installment_family_cycle');
    await expect(readInstallmentFamilyRows(cyclicRoot, async parents =>
      parents.includes(root.id) ? [child('september')] : [cyclicRoot])).rejects.toThrow('installment_family_cycle');
  });
});
