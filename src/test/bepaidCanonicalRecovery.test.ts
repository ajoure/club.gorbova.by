import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { reconcileExactQueuePayment, queueProviderSubscriptionId } from '../../supabase/functions/_shared/bepaid-canonical-recovery';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-08-31T08:00:00Z');
const paidAt = '2026-08-28T08:15:55.123Z';
const oldEnd = '2026-08-29T12:00:00.000Z';
const newEnd = '2026-09-29T12:00:00.000Z';
function fixture() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  const rows: Record<string, any[]> = {
    payment_reconcile_queue: [{ id: id(1), bepaid_uid: id(2), amount: 250, currency: 'BYN', status: 'processing', attempts: 1,
      updated_at: '2026-08-28T18:00:00Z', source: 'webhook', tracking_id: `${id(90)}_${id(91)}`, raw_payload: { id: 'sbs_test' } }],
    provider_subscriptions: [{ id: id(3), provider: 'bepaid', provider_subscription_id: 'sbs_test', state: 'active',
      subscription_v2_id: id(4), user_id: id(6), updated_at: '2026-08-28T18:00:00Z' }],
    subscriptions_v2: [{ id: id(4), order_id: id(5), profile_id: id(7), user_id: id(6), product_id: id(8), tariff_id: id(9),
      status: 'expired', access_end_at: oldEnd, meta: {} }],
    orders_v2: [{ id: id(5), profile_id: id(7), user_id: id(6), product_id: id(8), tariff_id: id(9),
      status: 'paid', final_price: 250, currency: 'BYN', meta: {} }],
    payments_v2: [{ id: id(10), provider: 'bepaid', provider_payment_id: id(11), order_id: id(5), status: 'succeeded', amount: 250, currency: 'BYN', paid_at: '2026-07-29T08:00:00Z' }],
    profiles: [{ id: id(7), user_id: id(6) }],
    products_v2: [{ id: id(8), meta: { access_window_rule: 'calendar_month' } }],
    tariffs: [{ id: id(9), product_id: id(8), access_days: 30 }],
    entitlements: [{ id: id(12), order_id: id(5), user_id: id(6), product_id: id(8), status: 'expired', expires_at: oldEnd, meta: {} }],
    access_grant_ledger: [], audit_logs: [],
  };
  const tx = { uid: id(2), status: 'successful', type: 'payment', amount: 25000, currency: 'BYN', paid_at: paidAt, tracking_id: `${id(90)}_${id(91)}` };
  const sbs = { id: 'sbs_test', state: 'active', last_transaction: { uid: id(2) }, renew_at: '2026-09-28T08:00:00Z' };
  const writes: any[] = [];
  let serial = 100;
  let claimConflict = false;
  let grantFails = false;
  let partialGrant = false;
  const queries: any[] = [];
  const db: any = {
    auth: { admin: { getUserById: vi.fn(async (userId: string) => ({ data: { user: { id: userId } }, error: null })) } },
    functions: { invoke: vi.fn(async (_name: string, { body }: any) => {
      if (grantFails && !partialGrant) return { error: { message: 'test failure' } };
      const order = rows.orders_v2.find(row => row.id === body.orderId);
      const end = body.customAccessEndAt || newEnd;
      Object.assign(rows.subscriptions_v2[0], { status: 'active', access_end_at: end,
        meta: { extended_by_orders: [order.id] } });
      if (partialGrant) return { error: { message: 'interrupted after subscription write' } };
      Object.assign(rows.entitlements[0], { status: 'active', expires_at: end, meta: { extended_by_orders: [order.id] } });
      rows.access_grant_ledger.push({ source_order_id: order.id, status: 'extended' });
      return { data: { success: true }, error: null };
    }) },
    from(table: string) {
      queries.push(table);
      if (!(table in rows)) throw new Error(`Unexpected table ${table}`);
      const filters: Array<(row: any) => boolean> = [];
      let op = 'select', values: any;
      let single = false;
      const builder: any = {
        select: () => builder,
        eq: (key: string, value: any) => { filters.push(row => row[key] === value); return builder; },
        gt: (key: string, value: any) => { filters.push(row => row[key] > value); return builder; },
        or: (expression: string) => {
          const uid = expression.split('provider_payment_id.eq.')[1].split(',')[0];
          filters.push(row => row.provider_payment_id === uid || row.meta?.parent_payment_uid === uid); return builder;
        },
        insert: (input: any) => { op = 'insert'; values = input; return builder; },
        update: (input: any) => { op = 'update'; values = input; return builder; },
        maybeSingle: () => { single = true; return builder; },
        single: () => { single = true; return builder; },
        then(resolve: (value: any) => any) {
          let found = rows[table].filter(row => filters.every(f => f(row)));
          if (op !== 'select') {
            writes.push({ table, op, values: structuredClone(values) });
            if (claimConflict && table === 'payment_reconcile_queue' && values.status === 'processing') found = [];
            if (op === 'insert') {
              const newRow = { id: id(serial++), ...structuredClone(values) };
              rows[table].push(newRow); found = [newRow];
            } else found.forEach(row => Object.assign(row, structuredClone(values), { updated_at: new Date(now.getTime() + serial++).toISOString() }));
          }
          if (single && found.length > 1) return Promise.resolve({ data: null, error: { message: 'multiple rows' } }).then(resolve);
          return Promise.resolve({ data: structuredClone(single ? found[0] || null : found), error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  const fetcher = vi.fn(async (url: string, options: any) => {
    expect(options.method).toBe('GET');
    expect(url.startsWith('https://gateway.bepaid.by/transactions/') || url.startsWith('https://api.bepaid.by/subscriptions/')).toBe(true);
    return new Response(JSON.stringify(url.includes('/transactions/') ? { transaction: tx } : { subscription: sbs }));
  });
  const run = (options: any = {}) => reconcileExactQueuePayment(db, { queueItemId: id(1), providerAuth: 'Basic fake', fetcher: fetcher as any, now, ...options });
  return { rows, tx, sbs, writes, queries, db, fetcher, run,
    loseClaim: () => { claimConflict = true; }, failGrant: (partial = false) => { grantFails = true; partialGrant = partial; },
    restoreGrant: () => { grantFails = false; partialGrant = false; } };
}
afterEach(() => vi.useRealTimers());

describe('canonical provider-verified queue recovery', () => {
  it('dry-runs legacy tracking through the exact provider link with zero writes', async () => {
    const h = fixture(); const before = structuredClone(h.rows);
    const result = await h.run({ dryRun: true });
    expect(result).toMatchObject({ no_writes: true, plan: { expected_orders_created: 1, expected_payments_created: 1,
      parent_order_id: id(5), subscription_v2_id: id(4), access_start_at: oldEnd, expected_access_end_at: newEnd, paid_at: paidAt } });
    expect(h.rows).toEqual(before); expect(h.writes).toEqual([]); expect(h.db.functions.invoke).not.toHaveBeenCalled();
    expect(h.queries).not.toContain('orders');
  });
  it('creates exactly one rebill/payment and extends the canonical subscription; replay is a no-op', async () => {
    const h = fixture();
    expect(await h.run()).toMatchObject({ success: true, stale_recovered: 1, results: { orders_created: 1 } });
    expect(h.rows.orders_v2).toHaveLength(2); expect(h.rows.payments_v2).toHaveLength(2);
    expect(h.rows.payments_v2[1].order_id).not.toBe(id(5));
    expect(h.db.functions.invoke.mock.calls[0][1].body).toMatchObject({ customAccessStartAt: oldEnd, customAccessEndAt: newEnd });
    expect(h.rows.subscriptions_v2[0].access_end_at).toBe(newEnd);
    expect(h.rows.payment_reconcile_queue[0].status).toBe('completed');
    const writes = h.writes.length;
    expect(await h.run()).toMatchObject({ already_completed: true });
    expect(h.writes).toHaveLength(writes); expect(h.db.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('resumes an interrupted grant without a duplicate or moving the saved window (partial=%s)', async partial => {
    const h = fixture(); h.failGrant(partial);
    await expect(h.run()).rejects.toThrow('recovery_materialized_grant_failed');
    expect(h.rows.orders_v2).toHaveLength(2); expect(h.rows.payments_v2).toHaveLength(2);
    expect(h.rows.payment_reconcile_queue[0].status).toBe('error');
    h.restoreGrant();
    await h.run();
    expect(h.rows.orders_v2).toHaveLength(2); expect(h.rows.payments_v2).toHaveLength(2);
    expect(h.rows.subscriptions_v2[0].access_end_at).toBe(newEnd);
    expect(h.db.functions.invoke.mock.calls[1][1].body.customAccessEndAt).toBe(newEnd);
  });
  it('follows the actual paid order for an existing UID without rebind or regrant', async () => {
    const h = fixture(); await h.run();
    Object.assign(h.rows.payment_reconcile_queue[0], { status: 'pending', attempts: 1 });
    const actualOrder = h.rows.payments_v2[1].order_id;
    const invoked = h.db.functions.invoke.mock.calls.length;
    expect(await h.run()).toMatchObject({ results: { already_materialized: 1, orders_created: 0 } });
    expect(h.rows.payments_v2[1].order_id).toBe(actualOrder);
    expect(h.db.functions.invoke).toHaveBeenCalledTimes(invoked);
  });
  it.each(['uid', 'amount', 'currency', 'status', 'paid_at', 'type'])('fails closed before writes on provider %s mismatch', async field => {
    const h = fixture(); (h.tx as any)[field] = field === 'amount' ? 1 : 'invalid';
    await expect(h.run()).rejects.toThrow('recovery_provider_payment_mismatch'); expect(h.writes).toEqual([]);
  });
  it.each(['refund', 'foreign', 'user', 'cancel', 'provider', 'duplicate'])('fails closed for %s conflicts', async kind => {
    const h = fixture();
    if (kind === 'refund') h.rows.payments_v2.push({ id: id(70), amount: -1, status: 'refunded', meta: { parent_payment_uid: id(2) } });
    if (kind === 'foreign') h.rows.subscriptions_v2.push({ ...h.rows.subscriptions_v2[0], id: id(71), status: 'active' });
    if (kind === 'user') h.rows.profiles[0].user_id = id(72);
    if (kind === 'cancel') h.rows.subscriptions_v2[0].status = 'canceled';
    if (kind === 'provider') h.sbs.state = 'cancelled';
    if (kind === 'duplicate') h.rows.payments_v2.push(...[1, 2].map(n => ({ ...h.rows.payments_v2[0], id: id(72 + n), provider_payment_id: id(2) })));
    await expect(h.run()).rejects.toThrow('recovery_'); expect(h.writes).toEqual([]);
  });
  it('a lost CAS does not invoke grants or write business data', async () => {
    const h = fixture(); h.loseClaim();
    expect(await h.run()).toMatchObject({ claim_conflicts: 1 });
    expect(h.writes).toHaveLength(1); expect(h.writes[0].table).toBe('payment_reconcile_queue');
    expect(h.db.functions.invoke).not.toHaveBeenCalled();
  });
  it('does not touch a fresh lease or changed snapshot', async () => {
    const h = fixture(); h.rows.payment_reconcile_queue[0].updated_at = now.toISOString();
    expect(await h.run()).toMatchObject({ claim_conflicts: 1 });
    await expect(h.run({ expectedUpdatedAt: oldEnd })).rejects.toThrow('snapshot_changed');
    expect(h.writes).toEqual([]); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each([{ attempts: 5 }, { source: 'file_import' }, { last_error: 'SOFT_CANCELLED: admin' }])('terminal stale rows are released without replay: %s', async values => {
    const h = fixture(); Object.assign(h.rows.payment_reconcile_queue[0], values);
    expect(await h.run({ dryRun: true })).toMatchObject({ no_writes: true }); expect(h.writes).toEqual([]);
    expect(await h.run()).toMatchObject({ stale_terminal: 1 });
    expect(h.rows.payment_reconcile_queue[0].status).toBe('error'); expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.writes).toHaveLength(1);
  });
  it('rejects ambiguous SBS evidence and has no legacy/direct access write path', () => {
    expect(() => queueProviderSubscriptionId({ raw_payload: { id: 'sbs_a', subscription_id: 'sbs_b' } })).toThrow('ambiguous');
    const source = readFileSync('supabase/functions/payments-reconcile/index.ts', 'utf8');
    expect(source).not.toContain('processLegacyQueueItem');
    expect(source).not.toContain('queue_item_processed_by_email');
    expect(source).toContain('reconcileExactQueuePayment');
  });
});
