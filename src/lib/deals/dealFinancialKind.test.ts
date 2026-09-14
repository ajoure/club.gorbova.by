import { describe, expect, it } from 'vitest';
import { dealStatusLabel, isContactMoneyDeal, isFreeDeal } from './dealFinancialKind';

describe('CRM money and free grant presentation', () => {
  it('excludes unpaid attempts and explicit free grants, includes partial money and refunds', () => {
    const rows = [
      { status: 'pending', final_price: 250 },
      { status: 'paid', final_price: 0, meta: { source: 'admin_grant' } },
      { status: 'paid', final_price: 0, meta: { source: 'admin_deal_only' } },
      { status: 'partial', paid_amount: 100, final_price: 250 },
      { status: 'refunded', paid_amount: 250, final_price: 250 },
    ];
    expect(rows.filter(isContactMoneyDeal)).toEqual(rows.slice(3));
    expect(dealStatusLabel(rows[1], 'Оплачен')).toBe('Бесплатно');
    expect(dealStatusLabel({status:'paid',paid_amount:0,final_price:250,meta:{source:'admin_grant'}}, 'Оплачен')).toBe('Бесплатно');
  });
  it('preserves zero amount confirmed historical purchases', () => {
    const deal = { status: 'paid', final_price: 0, reconcile_source: 'owner_confirmed_historical' };
    expect(isFreeDeal(deal)).toBe(false);
    expect(isContactMoneyDeal(deal)).toBe(true);
  });
  it('does not infer a free grant from zero price or a trial', () => {
    for (const meta of [{}, { source: 'trial_no_card' }, { source: 'getcourse_historical' }]) {
      expect(isFreeDeal({ status: 'paid', final_price: 0, meta })).toBe(false);
    }
  });
  it('labels an explicitly classified trial without payment as free', () => {
    const deal = { status: 'paid', final_price: 0, paid_amount: 0,
      meta: { source: 'trial_no_card', financial_kind: 'free_grant' } };
    expect(isFreeDeal(deal)).toBe(true);
    expect(isContactMoneyDeal(deal)).toBe(false);
    expect(dealStatusLabel(deal, 'Оплачен')).toBe('Бесплатно');
  });
  it('recognizes settled ledger money despite a stale order state or grant marker', () => {
    const deal = { status: 'pending', final_price: 0, meta: { source: 'admin_grant' },
      payments_v2: [{ status: 'succeeded', amount: 250 }] };
    expect(isFreeDeal(deal)).toBe(false);
    expect(isContactMoneyDeal(deal)).toBe(true);
    expect(isContactMoneyDeal({ payments_v2: [{ status: 'failed', amount: 250 }] })).toBe(false);
  });
  it('does not mistake voids, authorizations or deleted payments for money', () => {
    for (const payment of [
      {status:'succeeded',amount:250,transaction_type:'void'},
      {status:'succeeded',amount:250,transaction_type:'Отмена'},
      {status:'succeeded',amount:250,transaction_type:'authorization'},
      {status:'succeeded',amount:250,is_deleted:true},
    ]) expect(isContactMoneyDeal({status:'failed',payments_v2:[payment]})).toBe(false);
  });

  it('does not treat a stale positive order amount on a failed attempt as money', () => {
    expect(isContactMoneyDeal({ status: 'failed', paid_amount: 250, final_price: 250,
      payments_v2: [{ status: 'failed', amount: 250 }] })).toBe(false);
  });

});
