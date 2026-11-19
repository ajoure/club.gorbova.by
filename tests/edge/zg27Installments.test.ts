import { describe, it, expect, vi } from 'vitest';
import { generateInstallmentSchedule } from '../../supabase/functions/_shared/installment-schedule';
import { zg27InstallmentContract, validateZg27InstallmentContract, requireZg27InstallmentExecution } from '../../supabase/functions/_shared/zg27-installments';
import { ZG27_PRODUCT_ID, ZG27_TIERS } from '../../supabase/functions/_shared/zg27-policy';

function fixture(tier: 'first' | 'repeat' = 'repeat', count = 3) {
  const plan = zg27InstallmentContract({ productId: ZG27_PRODUCT_ID, tariffId: ZG27_TIERS[tier].tariffId,
    offerTariffId: ZG27_TIERS[tier].tariffId, offerId: 'synthetic-offer', amountByn: ZG27_TIERS[tier].totalMinor / 100,
    currency: 'BYN', count, intervalDays: 30, firstDelayDays: 0 });
  const order = { id: 'order', product_id: ZG27_PRODUCT_ID, tariff_id: ZG27_TIERS[tier].tariffId, user_id: 'user', currency: 'BYN', meta: { zg27_installment: plan } };
  const pay = { id: 'pay', order_id: 'order', user_id: 'user', status: 'succeeded', provider: 'bepaid', amount: plan.amounts_minor[0] / 100, currency: 'BYN', paid_at: '2026-11-18T12:00:00Z', refunded_amount: 0 };
  const sub = { id: 'sub', order_id: 'order', user_id: 'user', product_id: order.product_id, tariff_id: order.tariff_id,
    billing_type: 'mit', auto_renew: false, payment_method_id: 'card', meta: { zg27_hosted_recurring_consent: true } };
  const card = { id: 'card', user_id: 'user', status: 'active', provider: 'bepaid', provider_token: 'synthetic-test-only' };
  const tables: Record<string, any[]> = { orders_v2: [order], payments_v2: [pay], subscriptions_v2: [sub], payment_methods: [card], installment_payments: [] };
  const writes: string[] = [];
  let race = false, readError = false;
  const db = { from(table: string) {
    const filters: [string, unknown][] = [];
    const query: any = { select: () => query, eq: (k: string, v: unknown) => { filters.push([k, v]); return query; },
      maybeSingle: async () => ({ data: tables[table].find(row => filters.every(([k, v]) => row[k] === v)) || null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: tables[table].filter(row => filters.every(([k, v]) => row[k] === v)), error: readError ? Error('read') : null })),
      insert: async (rows: any) => { writes.push(table); if (table === 'installment_payments') { tables[table].push(...structuredClone(rows)); return { error: race ? { code: '23505' } : null }; } return { error: null }; } };
    return query;
  } };
  const params = { supabase: db, offer: null, order, subscription: { id: 'sub' }, user: { id: 'user' }, totalAmount: 1, currency: 'BYN', firstPayment: { paymentId: 'pay' }, scheduleSource: 'order_meta' as const };
  return { plan, order, pay, sub, card, tables, writes, params, race: () => { race = true; }, readError: () => { readError = true; } };
}

describe('exact ZG27 application managed schedules', () => {
  it.each([['first', 2, [645, 645]], ['first', 3, [430, 430, 430]], ['repeat', 2, [445, 445]], ['repeat', 3, [296.67, 296.67, 296.66]]] as const)(
    'materializes %s/%s exact agreement after confirmed first receipt', async (tier, count, amounts) => {
      const h = fixture(tier, count); const result = await generateInstallmentSchedule(h.params);
      expect(result).toMatchObject({ ok: true, created: true, count });
      const rows = h.tables.installment_payments;
      expect(rows.map(row => row.amount)).toEqual([...amounts]);
      expect(rows.map(row => row.due_date)).toEqual(amounts.map((_, i) => new Date(Date.parse(h.pay.paid_at) + i * 30 * 86400000).toISOString()));
      expect(rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0)).toBe(ZG27_TIERS[tier].totalMinor);
      expect(rows[0]).toMatchObject({ status: 'succeeded', payment_id: 'pay' }); expect(h.writes).toEqual(['installment_payments']);
    });
  it('ignores caller total and proves amount from the stored scope and schedule', async () => {
    const h = fixture(); h.params.totalAmount = 900;
    await generateInstallmentSchedule(h.params);
    expect(h.tables.installment_payments.map(row => row.amount)).toEqual([296.67, 296.67, 296.66]);
  });
  it('replays exact rows without inserting or resetting charged later rows', async () => {
    const h = fixture(); await generateInstallmentSchedule(h.params);
    h.tables.installment_payments[1].status = 'succeeded'; h.tables.installment_payments[1].payment_id = 'second-real-receipt';
    const before = structuredClone(h.tables); expect(await generateInstallmentSchedule(h.params)).toMatchObject({ ok: true, created: false });
    expect(h.writes).toEqual(['installment_payments']); expect(h.tables).toEqual(before);
  });
  it('re-reads an exact unique-key race instead of another insert', async () => {
    const h = fixture(); h.race(); expect(await generateInstallmentSchedule(h.params)).toMatchObject({ ok: true, created: false }); expect(h.writes).toHaveLength(1);
  });
  it('holds a partial/foreign/wrong-amount schedule without resetting it', async () => {
    const h = fixture(); await generateInstallmentSchedule(h.params); h.tables.installment_payments[2].amount = 300;
    expect(await generateInstallmentSchedule(h.params)).toMatchObject({ ok: false, error: 'zg27_schedule_existing_mismatch' }); expect(h.writes).toHaveLength(1);
  });
  it.each(['foreign-user', 'refunded', 'wrong-first', 'no-consent', 'foreign-card', 'no-token', 'forged-total', 'wrong-product'])(
    'fails closed for %s before any schedule write', async kind => {
      const h = fixture();
      if (kind === 'foreign-user') h.pay.user_id = 'other';
      if (kind === 'refunded') h.pay.refunded_amount = 1;
      if (kind === 'wrong-first') h.pay.amount = 300;
      if (kind === 'no-consent') h.sub.meta.zg27_hosted_recurring_consent = false;
      if (kind === 'foreign-card') h.card.user_id = 'other';
      if (kind === 'no-token') h.card.provider_token = '';
      if (kind === 'forged-total') h.plan.total_minor = 90000;
      if (kind === 'wrong-product') h.order.product_id = 'other';
      expect(await generateInstallmentSchedule(h.params)).toMatchObject({ ok: false }); expect(h.writes).toEqual([]);
    });
  it('does not write after a schedule read error', async () => { const h = fixture(); h.readError(); expect(await generateInstallmentSchedule(h.params)).toMatchObject({ ok: false }); expect(h.writes).toEqual([]); });
  it('rejects fabricated amounts and uniform provider execution but leaves existing unrelated products alone', () => {
    const h = fixture(); h.plan.amounts_minor[2] = 29667;
    expect(() => validateZg27InstallmentContract(h.plan, h.order.product_id, h.order.tariff_id)).toThrow();
    expect(() => requireZg27InstallmentExecution({ productId: ZG27_PRODUCT_ID, count: 3, mode: 'provider_managed' })).toThrow();
    expect(() => requireZg27InstallmentExecution({ productId: ZG27_PRODUCT_ID, count: 1, mode: 'provider_managed' })).not.toThrow();
    expect(() => requireZg27InstallmentExecution({ productId: 'existing-debt-product', count: 3, mode: 'provider_managed' })).not.toThrow();
  });
});

it('preserves the old uniform generator for unrelated products without changing their totals', async () => {
  const h = fixture(); h.params.order = { id: 'legacy', meta: {} } as any;
  h.params.offer = { id: 'legacy-offer', payment_method: 'internal_installment', installment_count: 3,
    installment_interval_days: 30, first_payment_delay_days: 0 } as any;
  h.params.scheduleSource = 'offer' as any; h.params.totalAmount = 890;
  const result = await generateInstallmentSchedule(h.params);
  expect(result).toMatchObject({ ok: true, created: true, count: 3 });
  expect(h.tables.installment_payments.map(row => row.amount)).toEqual([296.67, 296.67, 296.67]);
});
