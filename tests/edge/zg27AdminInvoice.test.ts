import { describe, expect, it, vi } from 'vitest';
import { load } from './zg27-ingress-harness';
import * as guard from '../../supabase/functions/_shared/zg27-checkout-guard';
import * as policy from '../../supabase/functions/_shared/zg27-policy';
import * as pending from '../../supabase/functions/_shared/pending-purchase';
import { snapshotOrderDocumentData } from '../../supabase/functions/_shared/document-data-snapshot';

function fixture(category: 'first' | 'repeat' = 'repeat') {
  const tier = policy.ZG27_TIERS[category];
  const offer: any = { id: 'invoice-offer', tariff_id: tier.tariffId, amount: tier.totalMinor / 100,
    is_active: true, offer_type: 'invoice', payment_method: 'bank_transfer', installment_count: 1,
    tariffs: { id: tier.tariffId, product_id: policy.ZG27_PRODUCT_ID, is_active: true,
      products_v2: { id: policy.ZG27_PRODUCT_ID, is_active: true, status: 'active' } } };
  const state: any = { category, eligible: true, total: tier.totalMinor / 100, adjustment: 0,
    reused: false, addon: false, order: null, productId: policy.ZG27_PRODUCT_ID, tariffId: tier.tariffId };
  const writes: any[] = [];
  const item = () => ({ role: 'primary', product_id: state.productId, tariff_id: state.tariffId,
    offer_id: offer.id, final_amount: state.total, quantity: 1, product_name: 'ZG27', tariff_name: category });
  const db = { rpc: vi.fn(async (name: string, args: any) => {
    if (name === 'zg27_purchase_eligibility_v1') {
      expect(args.p_user_id).toBe('recipient');
      return { data: { eligible: state.eligible, category: state.category, policy_version: 'zg27-v1' }, error: null };
    }
    writes.push({ name, args });
    if (name === 'generate_order_number') return { data: 'SYNTHETIC-1', error: null };
    if (name === 'crm_claim_pending_purchase') {
      state.order = { ...args.p_order, id: 'owned-order' };
      return { data: { order: state.order, attempt_id: 'attempt', state: state.reused ? 'ready' : 'claimed',
        result: { success: true, order_id: 'same-order', document_id: 'same-doc' } }, error: null };
    }
    if (name === 'crm_finish_checkout_attempt') return { data: true, error: null };
    throw Error(`unexpected RPC ${name}`);
  }), from(table: string) {
    const data = () => table === 'profiles' ? { id: 'profile', user_id: 'recipient' }
      : table === 'tariff_offers' ? offer : table === 'tariffs' ? { id: state.tariffId, product_id: state.productId }
      : table === 'products_v2' ? { id: state.productId, currency: 'BYN' }
      : table === 'ai_generated_documents' ? { document_number: 'SYNTHETIC-DOC' } : null;
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: data(), error: null }),
      insert: async (row: any) => { writes.push({ table, row }); return { error: null }; } };
    return q;
  } };
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('canonical-document-send')
    ? { success: true } : { document_id: 'doc' }), { status: 200 }));
  const h = load('supabase/functions/admin-invoice-checkout-issue/index.ts', {
    'npm:@supabase/supabase-js@2': { createClient: () => db },
    '../_shared/pending-purchase.ts': pending,
    '../_shared/zg27-checkout-guard.ts': guard,
    '../_shared/sales-runtime/checkout-auth.ts': { requireSalesOrPaymentsEdit: async () => ({ ok: true, actor: { id: 'admin-actor' } }), cbAlumniOfferAllowed: async () => true },
    '../_shared/sales-manager-attribution.ts': { resolveSalesManagerForCreation: async () => 'manager', SalesManagerSelectionError: class extends Error {} },
    '../_shared/crm-routing.ts': { resolveOfferRouting: async () => ({ ok: false }) },
    '../_shared/resolve-composable-checkout.ts': { resolveComposableCheckout: async () => ({ total: state.total,
      subtotal: state.total, adjustment_amount: 0, currency: 'BYN', items: state.addon ? [item(), { ...item(), role: 'addon' }] : [item()] }), ComposableCheckoutError: class extends Error {} },
    '../_shared/composable-checkout.ts': { allocateComposablePayableTotal: (q: any, total: number) => ({ ...q, total, adjustment_amount: state.adjustment }) },
    '../_shared/purchase-composition-title.ts': { buildPurchaseCompositionTitle: () => 'ZG27' },
  }, { fetch });
  const request = () => new Request('https://synthetic.invalid', { method: 'POST', headers: { Authorization: 'Bearer synthetic' },
    body: JSON.stringify({ target_user_id: 'recipient', product_id: state.productId,
      offer_id: offer.id, adjustment_amount: state.adjustment, adjustment_reason: state.adjustment ? 'synthetic' : null }) });
  return { state, offer, writes, db, fetch, run: () => h.handler(request()) };
}

describe('ZG27 administrator invoice gate before effects', () => {
  it.each(['wrong-category', 'outsider', 'stale-price', 'wrong-total', 'installments', 'pay-now-bank', 'full-method-invoice', 'null-count', 'adjustment', 'addons'])('denies %s without claims, writes, PDF or sends', async kind => {
    const f = fixture();
    if (kind === 'wrong-category') f.state.category = 'first';
    if (kind === 'outsider') { f.state.category = 'not_eligible'; f.state.eligible = false; }
    if (kind === 'stale-price') f.offer.amount = 900;
    if (kind === 'wrong-total') f.state.total = 900;
    if (kind === 'installments') f.offer.installment_count = 2;
    if (kind === 'full-method-invoice') f.offer.payment_method = 'full_payment';
    if (kind === 'null-count') f.offer.installment_count = null;
    if (kind === 'pay-now-bank') f.offer.offer_type = 'pay_now';
    if (kind === 'adjustment') f.state.adjustment = 10;
    if (kind === 'addons') f.state.addon = true;
    const response = await f.run();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(f.writes).toEqual([]); expect(f.fetch).not.toHaveBeenCalled();
  });
  for (const category of ['first', 'repeat'] as const) it(`issues the exact ${category} full price and freezes access cap, no training start`, async () => {
    const f = fixture(category); const response = await f.run();
    expect(response.status).toBe(200); expect((await response.json()).total).toBe(policy.ZG27_TIERS[category].totalMinor / 100);
    expect(f.state.order.user_id).toBe('recipient');
    expect(f.state.order.meta.zg27_invoice_access).toEqual({ policy_version: 'zg27-v1', access_end_exclusive: policy.ZG27_ACCESS_END_EXCLUSIVE,
      service_period_from: null, service_period_to: '2027-04-30' });
    expect(f.state.order.purchase_snapshot.course_access.end_exclusive).toBe(policy.ZG27_ACCESS_END_EXCLUSIVE);
    expect(f.state.order.meta.document_data).toMatchObject({ service_period_from: null, service_period_to: '2027-04-30', months_count: null });
    expect(f.fetch.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['canonical-document-generate-strict', 'canonical-document-send']);
  });
  it('preserves generic bank-transfer invoices without applying the ZG cap or eligibility RPC', async () => {
    const f = fixture(); f.state.productId = 'other-product'; f.state.tariffId = 'other-tariff';
    f.offer.tariff_id = 'other-tariff'; f.offer.tariffs = { id: 'other-tariff', product_id: 'other-product' };
    expect((await f.run()).status).toBe(200);
    expect(f.state.order.meta.zg27_invoice_access).toBeUndefined();
    expect(f.state.order.purchase_snapshot).toBeUndefined();
    expect(f.db.rpc.mock.calls.some(([name]) => name === 'zg27_purchase_eligibility_v1')).toBe(false);
  });
  it('reuses a ready pending purchase without regenerating or resending documents', async () => {
    const f = fixture(); f.state.reused = true;
    expect(await (await f.run()).json()).toEqual({ success: true, order_id: 'same-order', document_id: 'same-doc' });
    expect(f.writes.map(w => w.name)).toEqual(['generate_order_number', 'crm_claim_pending_purchase']);
    expect(f.fetch).not.toHaveBeenCalled();
  });
});

// Exercise the real snapshot rebuild, which strict generation invokes, with
// deliberately stale CB document defaults. No remote APIs or customer records.
async function snapshotFixture(zg = true, corrupt = false) {
  const access = { policy_version: 'zg27-v1', access_end_exclusive: policy.ZG27_ACCESS_END_EXCLUSIVE,
    service_period_from: null, service_period_to: corrupt ? '2027-05-01' : '2027-04-30' };
  const defaults = { service_period_from: '2026-10-23', service_period_to: '2027-04-20', months_count: 6 };
  const order = { id: 'order', product_id: zg ? policy.ZG27_PRODUCT_ID : 'other', tariff_id: 'tariff', offer_id: 'offer',
    status: 'pending', final_price: 890, currency: 'BYN', created_at: '2026-11-26T12:00:00Z',
    meta: { source: 'admin_invoice_checkout', checkout_kind: 'invoice', awaits_payment: true, zg27_invoice_access: access } };
  const updates: any[] = [];
  const db = { from(table: string) {
    const data = table === 'orders_v2' ? order : ['tariff_offers', 'tariffs', 'products_v2'].includes(table)
      ? { id: 'row', meta: { document_defaults: defaults } } : table === 'payments_v2' ? [] : null;
    const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data, error: null }), then: (done: any) => Promise.resolve({ data, error: null }).then(done),
      insert: async () => ({ error: null }), update: (patch: any) => { updates.push(patch); return q; } };
    return q;
  } };
  return { result: await snapshotOrderDocumentData(db, 'order', { mode: 'rebuild', allowPrePaymentInvoice: true }), updates };
}
it('strict snapshot replaces CB dates with the frozen ZG27 cap and leaves start unspecified', async () => {
  const { result } = await snapshotFixture();
  expect(result.status).toBe('rebuilt');
  expect(result.document_data).toMatchObject({ service_period_from: null, service_period_to: '2027-04-30', months_count: null });
  expect((result.document_data as any).fields['FLD-000197'].value).toBe('');
  expect((result.document_data as any).fields['FLD-000198'].value).toBe('2027-04-30');
  expect((result.document_data as any).fields['FLD-000199'].value).toBe('');
});
it('other-product invoice snapshot keeps its existing document defaults', async () => {
  const { result } = await snapshotFixture(false);
  expect(result.status).toBe('rebuilt');
  expect(result.document_data).toMatchObject({ service_period_from: '2026-10-23', service_period_to: '2027-04-20', months_count: 6 });
});
it('malformed frozen ZG27 invoice period fails without updating the snapshot', async () => {
  const { result, updates } = await snapshotFixture(true, true);
  expect(result.status).toBe('failed'); expect(updates).toEqual([]);
});
