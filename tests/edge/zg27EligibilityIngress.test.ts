import { describe, expect, it, vi } from 'vitest';
import { load } from './zg27-ingress-harness';
import * as guard from '../../supabase/functions/_shared/zg27-checkout-guard';
import * as policy from '../../supabase/functions/_shared/zg27-policy';
import * as referrals from '../../supabase/functions/_shared/referral-checkout-discount';
import * as discounts from '../../supabase/functions/_shared/checkout-discounts';
import * as installments from '../../supabase/functions/_shared/zg27-installments';

function fixture() {
  const state = { actor: 'recipient', offer: { id: 'offer', tariff_id: policy.ZG27_TIERS.repeat.tariffId,
    amount: 890, is_active: true, payment_method: 'full_payment', installment_count: 1,
    tariffs: { id: policy.ZG27_TIERS.repeat.tariffId, product_id: policy.ZG27_PRODUCT_ID, is_active: true, products_v2: { id: policy.ZG27_PRODUCT_ID, is_active: true, status: 'active' } } } };
  const effect = vi.fn(() => { throw Error('unexpected write/provider'); });
  const link = { status: 'active', id: 'link', product_id: policy.ZG27_PRODUCT_ID,
    tariff_id: state.offer.tariff_id, offer_id: 'offer', amount: 89000, currency: 'BYN', user_id: 'recipient', meta: {} as any };
  const db = { auth: { getUser: async () => ({ data: { user: { id: state.actor } }, error: null }), admin: { listUsers: effect } },
    rpc: async () => ({ data: { eligible: true, category: 'repeat', policy_version: 'zg27-v1' }, error: null }),
    from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'payment_links' ? link : state.offer, error: null }), insert: effect, update: effect };
      return q;
    } };
  return { db, state, link, effect };
}
const cors = { jsonResponse: (b: unknown, status = 200) => new Response(JSON.stringify(b), { status }),
  errorResponse: (error: string, status: number) => new Response(JSON.stringify({ error }), { status }) };
describe('actual new-sale eligibility boundaries', () => {
  for (const [name, patch, code] of [
    ['missing offer', { offer_id: undefined }, 'zg27_offer_required'],
    ['wrong amount', { amount: 90000 }, 'zg27_checkout_amount_mismatch'],
    ['wrong tariff', { tariff_id: 'foreign' }, 'zg27_wrong_participation'],
    ['credit price override', { customer_credit_requested_minor: 1 }, 'zg27_fixed_price_required'],
  ] as const) it(`common ${name} stops before provider/discount/order`, async () => {
    const f = fixture();
    const h = load('supabase/functions/_shared/create-payment-checkout.ts', {
      './zg27-checkout-guard.ts': guard, './zg27-installments.ts': installments });
    const result = await h.exports.createPaymentCheckout(Object.assign({ supabase: f.db, user_id: 'recipient', product_id: policy.ZG27_PRODUCT_ID,
      tariff_id: f.state.offer.tariff_id, offer_id: 'offer', amount: 89000, payment_type: 'one_time' }, patch));
    expect(result).toMatchObject({ success: false, error: code });
    expect(f.effect).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled();
  });
  for (const [name, actor, authenticated, code] of [
    ['anonymous with email', 'recipient', false, 'zg27_login_required'],
    ['forwarded recipient link', 'other', true, 'zg27_recipient_mismatch'],
  ] as const) it(`actual public handler rejects ${name}`, async () => {
    const f = fixture(); f.state.actor = actor;
    const h = load('supabase/functions/public-checkout/index.ts', {
      'npm:@supabase/supabase-js@2': { createClient: () => f.db }, '../_shared/zg27-checkout-guard.ts': guard,
      '../_shared/cors.ts': cors,
    });
    const r = await h.handler(new Request('https://synthetic.invalid', { method: 'POST',
      headers: authenticated ? { Authorization: 'Bearer synthetic' } : {}, body: JSON.stringify({ url_token: 'synthetic', email: 'unused@example.invalid' }) }));
    expect(r.status).toBe(authenticated ? 403 : 401); expect(await r.json()).toMatchObject({ error: code });
    expect(f.effect).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled();
  });
  it('approved Stripe common path preserves fixed price and trusted quote without discounts', async () => {
    const f = fixture();
    const stripe = vi.fn(async (_params: any) => ({ success: true, redirect_url: 'https://synthetic.invalid', order_id: 'order', payment_type: 'one_time', provider: 'stripe' }));
    const h = load('supabase/functions/_shared/create-payment-checkout.ts', {
      './zg27-checkout-guard.ts': guard, './zg27-installments.ts': installments,
      './referral-checkout-discount.ts': referrals, './checkout-discounts.ts': discounts,
      './create-stripe-checkout.ts': { createStripeCheckout: stripe },
    });
    const result = await h.exports.createPaymentCheckout({ supabase: f.db, user_id: 'recipient', product_id: policy.ZG27_PRODUCT_ID,
      tariff_id: f.state.offer.tariff_id, offer_id: 'offer', amount: 89000, provider: 'stripe', payment_type: 'one_time' });
    expect(result.success).toBe(true); expect(stripe).toHaveBeenCalledOnce();
    expect(stripe.mock.calls[0][0]).toMatchObject({ amount: 890, meta_extra: { zg27_checkout_quote: { totalMinor: 89000, policyVersion: 'zg27-v1' } } });
    expect(f.effect).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled();
  });
  it('verified repayment delegates before any new-sale proof or actor requirement', async () => {
    const f = fixture(); f.link.meta.repayment = { existing_order_id: 'owned' };
    const debt = vi.fn(async () => ({ success: true, redirect_url: 'https://synthetic.invalid/debt' }));
    const h = load('supabase/functions/public-checkout/index.ts', {
      'npm:@supabase/supabase-js@2': { createClient: () => f.db }, '../_shared/cors.ts': cors,
      '../_shared/existing-installment-checkout.ts': { createExistingInstallmentCheckout: debt },
      '../_shared/access-alias-origin.ts': { resolvePublicReturnOrigin: () => 'https://synthetic.invalid' },
      '../_shared/zg27-checkout-guard.ts': { ...guard, assertZg27Checkout: f.effect },
    });
    const r = await h.handler(new Request('https://synthetic.invalid', { method: 'POST', body: JSON.stringify({ url_token: 'synthetic' }) }));
    expect(r.status).toBe(200); expect(debt).toHaveBeenCalledOnce(); expect(f.effect).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled();
  });
});

describe('invoice offers cannot cross other new-sale ingress', () => {
  it('common checkout refuses an invoice offer before creating an order or provider checkout', async () => {
    const f = fixture(); Object.assign(f.state.offer, { offer_type: 'invoice', payment_method: 'bank_transfer' });
    const h = load('supabase/functions/_shared/create-payment-checkout.ts', {
      './zg27-checkout-guard.ts': guard, './zg27-installments.ts': installments });
    const result = await h.exports.createPaymentCheckout({ supabase: f.db, user_id: 'recipient', product_id: policy.ZG27_PRODUCT_ID,
      tariff_id: f.state.offer.tariff_id, offer_id: 'offer', amount: 89000, payment_type: 'one_time', allowAdminInvoice: true });
    expect(result).toMatchObject({ success: false, error: 'zg27_invoice_unavailable' });
    expect(f.effect).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled();
  });
  it('actual public payment-link handler refuses an invoice offer even with a forged opt-in body', async () => {
    const f = fixture(); Object.assign(f.state.offer, { offer_type: 'invoice', payment_method: 'bank_transfer' });
    const h = load('supabase/functions/public-checkout/index.ts', {
      'npm:@supabase/supabase-js@2': { createClient: () => f.db }, '../_shared/zg27-checkout-guard.ts': guard,
      '../_shared/cors.ts': cors });
    const response = await h.handler(new Request('https://synthetic.invalid', { method: 'POST',
      headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify({ url_token: 'synthetic', allowAdminInvoice: true }) }));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: 'zg27_invoice_unavailable' });
    expect(f.effect).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled();
  });
});

it('direct Stripe helper rejects invoice offers before credentials, order claims and provider calls', async () => {
  const f = fixture(); Object.assign(f.state.offer, { offer_type: 'invoice', payment_method: 'bank_transfer' });
  const h = load('supabase/functions/_shared/create-stripe-checkout.ts', {
    './zg27-checkout-guard.ts': guard, './zg27-installments.ts': installments });
  const result = await h.exports.createStripeCheckout({ supabase: f.db, user_id: 'recipient', product_id: policy.ZG27_PRODUCT_ID,
    tariff_id: f.state.offer.tariff_id, offer_id: 'offer', amount: 890, currency: 'BYN', payment_type: 'one_time', allowAdminInvoice: true });
  expect(result).toMatchObject({ success: false, error: 'zg27_invoice_unavailable' });
  expect(f.effect).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled();
});

for (const endpoint of ['invoice-checkout-issue', 'bepaid-create-token', 'public-create-installment-link']) {
  it(`actual ${endpoint} denies invoice offers without any document, link, order or provider writes`, async () => {
    const f = fixture(); Object.assign(f.state.offer, { offer_type: 'invoice', payment_method: 'bank_transfer' });
    f.db.auth.getUser = async () => ({ data: { user: { id: 'recipient', email: 'synthetic@example.invalid' } }, error: null });
    const h = load(`supabase/functions/${endpoint}/index.ts`, {
      'npm:@supabase/supabase-js@2': { createClient: () => f.db }, '../_shared/zg27-checkout-guard.ts': guard,
      '../_shared/cors.ts': cors,
      '../_shared/sales-runtime/checkout-auth.ts': { cbAlumniOfferAllowed: async () => true },
      '../_shared/resolve-composable-checkout.ts': { ComposableCheckoutError: class extends Error {}, resolveComposableCheckout: async () => ({
        total: 890, currency: 'BYN', items: [{ product_id: policy.ZG27_PRODUCT_ID, tariff_id: f.state.offer.tariff_id }] }) },
    });
    const response = await h.handler(new Request('https://synthetic.invalid', { method: 'POST',
      headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify({
        product_id: policy.ZG27_PRODUCT_ID, tariff_id: f.state.offer.tariff_id, offer_id: 'offer', legal_details_id: 'legal',
        productId: policy.ZG27_PRODUCT_ID, offerId: 'offer', customerEmail: 'synthetic@example.invalid', allowAdminInvoice: true,
      }) }));
    expect(response.status).toBe(endpoint === 'public-create-installment-link' ? 400 : 409);
    expect(await response.json()).toMatchObject({ error: endpoint === 'public-create-installment-link' ? 'offer_type_invoice_not_chargeable' : 'zg27_invoice_unavailable' });
    expect(f.effect).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled();
  });
}
