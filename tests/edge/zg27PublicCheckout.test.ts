import { describe, expect, it, vi } from 'vitest';
import { load } from './zg27-ingress-harness';
import * as guard from '../../supabase/functions/_shared/zg27-checkout-guard';
import * as policy from '../../supabase/functions/_shared/zg27-policy';
import * as cors from '../../supabase/functions/_shared/cors';

function fixture(category: 'first' | 'repeat' = 'repeat') {
  const tier = policy.ZG27_TIERS[category];
  const offers = [1, 2, 3].map((count) => ({ id: `offer-${count}`, tariff_id: tier.tariffId,
    amount: tier.totalMinor / 100, is_active: true, payment_method: count === 1 ? 'full_payment' : 'internal_installment',
    installment_count: count, tariffs: { id: tier.tariffId, product_id: policy.ZG27_PRODUCT_ID, is_active: true, products_v2: { id: policy.ZG27_PRODUCT_ID, is_active: true, status: 'active' } } }));
  const writes: any[] = [];
  const state = { actor: 'owned-user', category: category as string, eligible: true, rpcError: false, reusable: null as any, insertError: false };
  const db = { auth: { getUser: vi.fn(async () => ({ data: { user: state.actor ? { id: state.actor } : null }, error: null })) },
    rpc: vi.fn(async () => ({ data: { eligible: state.eligible, category: state.category, policy_version: 'zg27-v1' }, error: state.rpcError ? {} : null })),
    from: (table: string) => {
      const filters: Record<string, any> = {};
      const result = () => ({ data: table === 'payment_links' ? state.reusable : offers.filter(o => Object.entries(filters).every(([k,v]) => (o as any)[k] === v)), error: null });
      const q: any = { select: () => q, eq: (k: string,v: any) => { filters[k] = v; return q; },
        gt: () => q, contains: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
        then: (done: any) => Promise.resolve(result()).then(done),
        insert: async (row: any) => { writes.push({ table, row }); return { error: state.insertError ? {} : null }; },
        update: () => { throw Error('unexpected update'); },
      }; return q;
    } };
  function handler(name: string) {
    return load(`supabase/functions/${name}/index.ts`, { 'npm:@supabase/supabase-js@2': { createClient: () => db },
      '../_shared/zg27-checkout-guard.ts': guard, '../_shared/zg27-policy.ts': policy, '../_shared/cors.ts': cors });
  }
  const request = (body: any = {}, auth = true, method = 'POST') => new Request('https://synthetic.invalid', {
    method, headers: auth ? { Authorization: 'Bearer synthetic' } : {}, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
  return { offers, writes, state, db, handler, request, tier };
}

describe('authenticated ZG27 quotes and hosted full-payment links', () => {
  for (const endpoint of ['zg27-public-quote', 'zg27-create-full-link']) {
    it(`${endpoint} rejects anonymous identity before any DB/provisioning`, async () => {
      const f = fixture(); const h = f.handler(endpoint);
      const response = await h.handler(f.request({ user_id: 'owned-user' }, false));
      expect(response.status).toBe(401); expect(f.db.auth.getUser).not.toHaveBeenCalled(); expect(f.writes).toEqual([]); expect(h.effects).not.toHaveBeenCalled();
    });
    it(`${endpoint} handles preflight without auth and forbids GET`, async () => {
      const f = fixture(); const h = f.handler(endpoint);
      expect((await h.handler(f.request({}, false, 'OPTIONS'))).status).toBe(200);
      expect((await h.handler(f.request({}, false, 'GET'))).status).toBe(405);
      expect(f.db.auth.getUser).not.toHaveBeenCalled(); expect(f.writes).toEqual([]);
    });
  }
  for (const category of ['first','repeat'] as const) it(`returns exact ${category} kopecks without writes or PII`, async () => {
    const f = fixture(category); const h = f.handler('zg27-public-quote');
    const response = await h.handler(f.request({ page_slug: f.tier.page, user_id: 'forged' }));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json(); expect(body.category).toBe(category);
    expect(body.offers.map((o: any) => o.amounts_minor)).toEqual(category === 'repeat' ? [[89000],[44500,44500],[29667,29667,29666]] : [[129000],[64500,64500],[43000,43000,43000]]);
    expect(JSON.stringify(body)).not.toContain('owned-user'); expect(f.writes).toEqual([]); expect(h.effects).not.toHaveBeenCalled();
    expect(f.db.rpc.mock.calls[0][1]).toMatchObject({ p_user_id: 'owned-user' });
  });
  it('wrong-page quote routes to canonical category and exposes no alternate offers', async () => {
    const f = fixture(); const response = await f.handler('zg27-public-quote').handler(f.request({ page_slug: 'zg27pervoe' }));
    expect(await response.json()).toEqual({ status: 'wrong_page', page_slug: 'zg27povtor' }); expect(f.writes).toEqual([]);
  });
  it.each(['rpc-error','unknown','not-eligible','missing-offer','wrong-amount'])('quote fails closed on %s', async kind => {
    const f = fixture(); if (kind === 'rpc-error') f.state.rpcError = true;
    if (kind === 'unknown') f.state.category = 'unknown';
    if (kind === 'not-eligible') { f.state.category = 'not_eligible'; f.state.eligible = false; }
    if (kind === 'missing-offer') f.offers.pop(); if (kind === 'wrong-amount') f.offers[2].amount = 900;
    const response = await f.handler('zg27-public-quote').handler(f.request({ page_slug: f.tier.page }));
    expect(response.status).toBeGreaterThanOrEqual(400); expect(f.writes).toEqual([]);
  });
  it('full link stores canonical TOTAL, authenticated owner and no provider side effect', async () => {
    const f = fixture(); const h = f.handler('zg27-create-full-link');
    const response = await h.handler(f.request({ offer_id: 'offer-1', tariff_id: f.tier.tariffId, page_slug: f.tier.page, amount: 1, user_id: 'forged' }));
    expect(response.status).toBe(200); expect((await response.json()).success).toBe(true);
    expect(f.writes).toHaveLength(1); expect(f.writes[0]).toMatchObject({ table: 'payment_links', row: {
      user_id: 'owned-user', amount: 89000, payment_type: 'one_time', max_uses: 1, meta: { source: 'zg27_hosted_full' } } });
    expect(h.effects).not.toHaveBeenCalled();
  });
  it('full link reuses existing active unused owned link', async () => {
    const f = fixture(); f.state.reusable = { url_token: 'same-token' };
    const response = await f.handler('zg27-create-full-link').handler(f.request({ offer_id: 'offer-1', tariff_id: f.tier.tariffId, page_slug: f.tier.page }));
    expect(await response.json()).toEqual({ success: true, url_token: 'same-token' }); expect(f.writes).toEqual([]);
  });
  it.each(['offer-2','foreign'])('full link rejects %s before materialization', async offer_id => {
    const f = fixture(); const response = await f.handler('zg27-create-full-link').handler(f.request({ offer_id, tariff_id: f.tier.tariffId, page_slug: f.tier.page }));
    expect(response.status).toBe(403); expect(f.writes).toEqual([]);
  });
});

describe('invoice offers stay closed to actual public ZG27 handlers', () => {
  for (const endpoint of ['zg27-public-quote','zg27-create-full-link']) it(`${endpoint} refuses invoice offers before any link or provider effect`, async () => {
    const f = fixture();
    Object.assign(f.offers[0], { offer_type: 'invoice', payment_method: 'bank_transfer', installment_count: 1 });
    const h = f.handler(endpoint);
    const response = await h.handler(f.request({ offer_id: 'offer-1', tariff_id: f.tier.tariffId, page_slug: f.tier.page,
      allowAdminInvoice: true, allow_admin_invoice: true }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(f.writes).toEqual([]); expect(h.effects).not.toHaveBeenCalled();
  });
});
