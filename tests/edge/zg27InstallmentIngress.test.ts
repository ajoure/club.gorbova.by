import { describe, expect, it, vi } from 'vitest';
import * as exact from '../../supabase/functions/_shared/zg27-installments';
import * as policy from '../../supabase/functions/_shared/zg27-policy';
import { load } from './zg27-ingress-harness';

describe('real scoped checkout entry guards', () => {
  it('common new-sale helper rejects uniform ZG27 before DB, provider, discounts or order writes', async () => {
    const h = load('supabase/functions/_shared/create-payment-checkout.ts', { './zg27-installments.ts': exact, './zg27-checkout-guard.ts': { assertZg27Checkout: async () => ({ applicable: true, amounts: [890] }), Zg27CheckoutError: Error } });
    const db = new Proxy({}, { get: () => h.effects });
    for (const amount of [29667, 30000, 89000]) {
      const result = await h.exports.createPaymentCheckout({ supabase: db, user_id: 'user',
        product_id: policy.ZG27_PRODUCT_ID, tariff_id: policy.ZG27_TIERS.repeat.tariffId,
        amount, payment_type: 'subscription', meta_extra: { installment: { billing_cycles: 'not-a-number' } } });
      expect(result).toMatchObject({ success: false, error: 'zg27_requires_application_managed_installments' });
    }
    expect(h.effects).not.toHaveBeenCalled();
  });
  it('actual public link writer refuses missing upfront consent without link/order/provider writes', async () => {
    const writes = vi.fn(() => { throw Error('unexpected write'); });
    const rows: Record<string, unknown> = {
      products_v2: { id: policy.ZG27_PRODUCT_ID, is_active: true },
      tariffs: { id: policy.ZG27_TIERS.repeat.tariffId, product_id: policy.ZG27_PRODUCT_ID, is_active: true, products_v2: { id: policy.ZG27_PRODUCT_ID, is_active: true, status: 'active' } },
      tariff_offers: { id: 'offer', tariff_id: policy.ZG27_TIERS.repeat.tariffId, amount: 890, is_active: true, offer_type: 'pay_now', payment_method: 'internal_installment', installment_count: 3, installment_interval_days: 30, first_payment_delay_days: 0 },
    };
    const db = { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: rows[table], error: null }), insert: writes };
      return q;
    } };
    const h = load('supabase/functions/public-create-installment-link/index.ts', {
      '../_shared/zg27-policy.ts': policy,
      '../_shared/zg27-checkout-guard.ts': { assertZg27Checkout: async () => ({ applicable: true }), requireZg27Recipient: async () => {}, Zg27CheckoutError: class extends Error {} },
      '../_shared/zg27-installments.ts': exact,
      '../_shared/zg27-hosted-installments.ts': { freezeZg27Consent: () => { throw Error('no-consent'); } },
      'npm:@supabase/supabase-js@2': { createClient: () => db },
      '../_shared/sales-runtime/checkout-auth.ts': { cbAlumniOfferAllowed: async () => true },
      '../_shared/cors.ts': { jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
        errorResponse: (error: string, status: number) => new Response(JSON.stringify({ error }), { status }) },
    });
    const response = await h.handler(new Request('https://synthetic.invalid', { method: 'POST', headers: { authorization: 'Bearer synthetic' },
      body: JSON.stringify({ product_id: policy.ZG27_PRODUCT_ID, tariff_id: policy.ZG27_TIERS.repeat.tariffId, offer_id: 'offer' }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'zg27_schedule_consent_required' });
    expect(writes).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled();
  });
});
