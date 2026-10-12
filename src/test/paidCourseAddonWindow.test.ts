import { describe, expect, it } from 'vitest';
import { CB20_COURSE_PRODUCT_ID, laterAccessEnd, resolvePaidCourseAddonWindow } from '../../supabase/functions/grant-access-for-order/paid_course_addon_window';
import { resolveGrantPaymentWindow } from '../../supabase/functions/grant-access-for-order/payment_window';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const order = { id: id(1), user_id: id(2), product_id: id(3), status: 'paid', is_deleted: false, final_price: 300, paid_amount: 300,
    meta: { group_child_order: true, group_primary_order_id: id(4), group_payment_id: id(5), order_group_id: id(6) } };
  const tables: Record<string, any[]> = {
    orders_v2: [{ id: id(4), user_id: id(2), product_id: CB20_COURSE_PRODUCT_ID, status: 'paid', is_deleted: false }],
    order_groups: [{ id: id(6), user_id: id(2), primary_order_id: id(4), status: 'paid' }],
    order_group_items: [{ id: id(7), order_id: id(1), product_id: id(3), order_group_id: id(6), role: 'addon' }],
    payments_v2: [{ id: id(5), order_id: id(4), user_id: id(2), status: 'succeeded', is_deleted: false, amount: 2650, refunded_amount: 0, paid_at: '2026-07-31T12:00:00Z' }],
    entitlements: [{ id: id(8), order_id: id(4), user_id: id(2), product_id: CB20_COURSE_PRODUCT_ID, status: 'active', expires_at: '2027-05-27T10:26:00.357Z' }],
    payment_refund_requests: [], composable_refund_intents: [],
  };
  let failure = '';
  const db = { from(table: string) {
    let rows = tables[table];
    const query: any = {
      select() { return query; },
      eq(field: string, value: unknown) { rows = rows.filter(r => r[field] === value); return query; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: failure === table || rows.length > 1 ? { message: 'read failed' } : null }); },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: rows, error: failure === table ? { message: 'read failed' } : null }).then(resolve); },
    };
    return query; // No write API: any accidental fulfillment in this helper fails.
  } };
  return { db, order, tables, fail: (table: string) => { failure = table; } };
}
const now = new Date('2026-10-12T12:00:00Z');
const resolve = (f: ReturnType<typeof fixture>, code = 'cb_module_retail') => resolvePaidCourseAddonWindow(f.db, f.order, code, now);

describe('paid CB20 addon window', () => {
  it('uses actual primary entitlement and canonical parent payment for a child without its own payment', async () => {
    const f = fixture(); const before = JSON.stringify(f.tables);
    const window = await resolve(f);
    expect(window).toEqual({ expiresAt: f.tables.entitlements[0].expires_at, paidAt: f.tables.payments_v2[0].paid_at, baseEntitlementId: id(8), baseOrderId: id(4) });
    const payment = resolveGrantPaymentWindow({ paidAt: window!.paidAt, durationDays: 30, calendarMonth: false });
    expect(laterAccessEnd(payment.expectedEnd, window!.expiresAt)?.toISOString()).toBe(window!.expiresAt);
    expect(JSON.stringify(f.tables)).toBe(before);
    expect(await resolve(f, 'prd_08a84b2b7223')).toEqual(window);
  });
  it('never shortens longer/manual windows or changes standalone, legacy or CB21 products', async () => {
    expect(laterAccessEnd(new Date('2028-01-01'), '2027-05-27')?.toISOString()).toBe('2028-01-01T00:00:00.000Z');
    expect(await resolve(fixture(), 'club')).toBeNull();
    const f = fixture(); f.order.meta.group_child_order = false; expect(await resolve(f)).toBeNull();
    const other = fixture(); other.tables.orders_v2[0].product_id = id(21); expect(await resolve(other)).toBeNull();
  });
  it('protects manual/revoked older purchases but lets a new paid order replace an expired automatic Business gift', async () => {
    const f = fixture();
    f.tables.entitlements.push({ order_id:id(99),user_id:id(2),product_id:id(3),status:'expired',meta:{source:'historical_purchase_with_business'} });
    expect(await resolve(f)).not.toBeNull();
    f.tables.entitlements[1].status='revoked';await expect(resolve(f)).rejects.toThrow('existing_access_override');
    f.tables.entitlements[1].status='active';f.tables.entitlements[1].meta.manual_access_edit_last_at='2026-10-01';
    await expect(resolve(f)).rejects.toThrow('existing_access_override');
  });
  it('permits another item partial refund and keep decisions without extending reduced/revoked access', async () => {
    const f = fixture(); f.tables.orders_v2[0].status = 'partial_refund'; f.tables.order_groups[0].status = 'partial_refund';
    f.tables.payments_v2[0].status = 'partially_refunded'; f.tables.payments_v2[0].refunded_amount = 100;
    f.tables.payment_refund_requests.push({ order_group_item_id: id(7), state: 'completed', access_action: 'keep' });
    expect(await resolve(f)).not.toBeNull();
    f.tables.payment_refund_requests[0].access_action = 'reduce'; await expect(resolve(f)).rejects.toThrow('refund_access_override');
    f.tables.payment_refund_requests[0].state = 'failed'; expect(await resolve(f)).not.toBeNull();
    f.tables.composable_refund_intents.push({ order_group_item_id: id(7), status: 'allocated', access_action: 'revoke' });
    await expect(resolve(f)).rejects.toThrow('refund_access_override');
  });
  it.each(['orders_v2','order_groups','order_group_items','payments_v2','entitlements','payment_refund_requests','composable_refund_intents'])('fails closed on %s lookup failure', async table => {
    const f = fixture(); f.fail(table); await expect(resolve(f)).rejects.toThrow('lookup_failed');
  });
  it.each([
    ['invalid group ID', (f: any) => { f.order.meta.group_payment_id = 'bad'; }],
    ['unpaid child', (f: any) => { f.order.status = 'pending'; }],
    ['free gift', (f: any) => { f.order.final_price = 0; }],
    ['missing paid amount', (f: any) => { delete f.order.paid_amount; }],
    ['other user', (f: any) => { f.tables.orders_v2[0].user_id = id(9); }],
    ['deleted parent', (f: any) => { f.tables.orders_v2[0].is_deleted = true; }],
    ['wrong group owner', (f: any) => { f.tables.order_groups[0].user_id = id(9); }],
    ['no addon membership', (f: any) => { f.tables.order_group_items.length = 0; }],
    ['wrong payment owner', (f: any) => { f.tables.payments_v2[0].user_id = id(9); }],
    ['fully refunded', (f: any) => { f.tables.payments_v2[0].refunded_amount = 2650; }],
    ['deleted payment', (f: any) => { f.tables.payments_v2[0].is_deleted = true; }],
    ['no payment timestamp', (f: any) => { f.tables.payments_v2[0].paid_at = null; }],
    ['missing primary access', (f: any) => { f.tables.entitlements.length = 0; }],
    ['expired primary', (f: any) => { f.tables.entitlements[0].expires_at = '2026-10-01'; }],
    ['revoked primary', (f: any) => { f.tables.entitlements[0].status = 'revoked'; }],
    ['revoked addon', (f: any) => { f.tables.entitlements.push({ order_id: id(1),user_id: id(2),product_id:id(3),status:'revoked' }); }],
    ['manual addon', (f: any) => { f.tables.entitlements.push({ order_id: id(1),user_id: id(2),product_id:id(3),status:'active',meta:{manual_access_edit_last_at:'2026-10-01'} }); }],
  ])('rejects %s before grants', async (_, mutate) => {
    const f = fixture(); mutate(f); await expect(resolve(f)).rejects.toThrow('paid_addon_');
  });
});
