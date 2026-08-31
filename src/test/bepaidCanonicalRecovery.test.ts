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

describe('automatic preflight failure backoff', () => {
  const auto = (h: ReturnType<typeof fixture>, options: any = {}) => h.run({
    recordPreflightFailure: true, expectedUpdatedAt: h.rows.payment_reconcile_queue[0].updated_at, ...options,
  });
  function declined() {
    const h = fixture(); h.tx.status = 'failed';
    Object.assign(h.rows.payment_reconcile_queue[0], { status: 'error', attempts: 0, next_retry_at: null });
    return h;
  }
  it.each(['pending', 'error', 'processing'])('defers a failed %s preflight using only one queue update', async status => {
    const h = declined(); h.rows.payment_reconcile_queue[0].status = status;
    const businessBefore = structuredClone(Object.fromEntries(Object.entries(h.rows).filter(([key]) => key !== 'payment_reconcile_queue')));
    await expect(auto(h)).rejects.toThrow('recovery_provider_payment_mismatch');
    expect(h.rows.payment_reconcile_queue[0]).toMatchObject({ status: 'error', attempts: 1,
      last_attempt_at: now.toISOString(), last_error: 'recovery_provider_payment_mismatch', next_retry_at: '2026-08-31T09:00:00.000Z' });
    expect(h.writes).toHaveLength(1); expect(h.writes[0].table).toBe('payment_reconcile_queue');
    expect(Object.fromEntries(Object.entries(h.rows).filter(([key]) => key !== 'payment_reconcile_queue'))).toEqual(businessBefore);
    expect(h.db.functions.invoke).not.toHaveBeenCalled();
  });
  it('never writes on a dry-run failure even with the automatic flag', async () => {
    const h = declined(); const before = structuredClone(h.rows);
    await expect(auto(h, { dryRun: true })).rejects.toThrow('recovery_provider_payment_mismatch');
    expect(h.rows).toEqual(before); expect(h.writes).toEqual([]);
  });
  it('requires an exact snapshot before automatic accounting', async () => {
    const h = declined();
    await expect(h.run({ recordPreflightFailure: true })).rejects.toThrow('recovery_preflight_snapshot_required');
    expect(h.writes).toEqual([]); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('does not mutate or fetch after a snapshot conflict', async () => {
    const h = declined();
    await expect(auto(h, { expectedUpdatedAt: 'different' })).rejects.toThrow('recovery_queue_snapshot_changed');
    expect(h.writes).toEqual([]); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('keeps manual and explicit-argument preflight guards zero-write', async () => {
    const h = declined();
    await expect(h.run()).rejects.toThrow('recovery_provider_payment_mismatch');
    h.tx.status = 'successful';
    await expect(auto(h, { providerSubscriptionId: 'sbs_wrong' })).rejects.toThrow('recovery_explicit_subscription_mismatch');
    expect(h.writes).toEqual([]);
  });
  it.each(['completed', 'successful'])('never demotes a %s row after preflight failure', async status => {
    const h = declined(); h.rows.payment_reconcile_queue[0].status = status;
    const before = structuredClone(h.rows);
    await expect(auto(h)).rejects.toThrow('recovery_provider_payment_mismatch');
    expect(h.rows).toEqual(before); expect(h.writes).toEqual([]);
  });
  it('never touches a fresh lease', async () => {
    const h = declined(); Object.assign(h.rows.payment_reconcile_queue[0], { status: 'processing', updated_at: now.toISOString() });
    expect(await auto(h)).toMatchObject({ claim_conflicts: 1 });
    expect(h.writes).toEqual([]); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each([{ source: 'file_import' }, { last_error: 'SOFT_CANCELLED: old' }, { last_error: 'CANCELLED_BY_ADMIN: old' }])('preserves terminal/import exclusion %j', patch => {
    const h = declined(); Object.assign(h.rows.payment_reconcile_queue[0], patch);
    return expect(auto(h)).rejects.toThrow('recovery_queue_requires_manual_review').then(() => {
      expect(h.writes).toEqual([]); expect(h.fetcher).not.toHaveBeenCalled();
    });
  });
  it('defers early automatic repeats without another GET or write', async () => {
    const h = declined(); await expect(auto(h)).rejects.toThrow('recovery_provider_payment_mismatch');
    const before = structuredClone(h.rows); const calls = h.fetcher.mock.calls.length;
    expect(await auto(h)).toMatchObject({ retry_deferred: 1, results: { orders_reconciled: 0 } });
    expect(await auto(h, { dryRun: true })).toMatchObject({ retry_deferred: 1, dry_run: true, no_writes: true });
    expect(h.rows).toEqual(before); expect(h.fetcher).toHaveBeenCalledTimes(calls); expect(h.writes).toHaveLength(1);
  });
  it('exhausts five validation attempts without completing or granting a failed payment', async () => {
    const h = declined();
    for (let i = 0; i < 5; i++) {
      await expect(auto(h, { now: new Date(now.getTime() + i * 3_600_000) })).rejects.toThrow('recovery_provider_payment_mismatch');
      expect(h.rows.payment_reconcile_queue[0].attempts).toBe(i + 1);
    }
    expect(h.rows.payment_reconcile_queue[0]).toMatchObject({ status: 'error', attempts: 5, next_retry_at: null });
    await expect(auto(h, { now: new Date(now.getTime() + 10 * 3_600_000) })).rejects.toThrow('recovery_queue_requires_manual_review');
    expect(h.writes).toHaveLength(5); expect(h.db.functions.invoke).not.toHaveBeenCalled();
  });
  it.each(['network', 'timeout', '429', '502', 'invalid_json'])('does not exhaust valid payments during provider unavailability (%s)', mode => {
    const h = declined(); h.rows.payment_reconcile_queue[0].attempts = 4;
    if (mode === 'network' || mode === 'timeout') h.fetcher.mockRejectedValue(new Error('private provider details'));
    else h.fetcher.mockResolvedValue(new Response(mode === 'invalid_json' ? 'not JSON' : '{}', { status: mode === 'invalid_json' ? 200 : Number(mode) }));
    return expect(auto(h)).rejects.toThrow('recovery_provider_unavailable').then(() => {
      expect(h.rows.payment_reconcile_queue[0]).toMatchObject({ status: 'error', attempts: 4,
        last_error: 'recovery_provider_unavailable', next_retry_at: '2026-08-31T09:00:00.000Z' });
      expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.writes).toHaveLength(1);
      expect(h.db.functions.invoke).not.toHaveBeenCalled();
    });
  });
  it('loses the preflight CAS without overwriting another worker', async () => {
    const h = declined();
    h.fetcher.mockImplementationOnce(async () => {
      Object.assign(h.rows.payment_reconcile_queue[0], { status: 'completed', updated_at: '2026-08-31T08:01:00Z' });
      return new Response(JSON.stringify({ transaction: h.tx }));
    });
    expect(await auto(h)).toMatchObject({ claim_conflicts: 1 });
    expect(h.rows.payment_reconcile_queue[0]).toMatchObject({ status: 'completed', attempts: 0, updated_at: '2026-08-31T08:01:00Z' });
    expect(h.db.functions.invoke).not.toHaveBeenCalled();
  });
  it('reports an execute-error CAS conflict without overwriting the changed lease', async () => {
    const h = fixture();
    h.db.functions.invoke.mockImplementation(async () => {
      h.rows.payment_reconcile_queue[0].updated_at = '2026-08-31T08:01:00Z';
      return { error: { message: 'interrupted' } };
    });
    expect(await h.run()).toMatchObject({ claim_conflicts: 1 });
    expect(h.rows.payment_reconcile_queue[0]).toMatchObject({ status: 'processing', updated_at: '2026-08-31T08:01:00Z' });
  });
  it('makes the automatic recurring reader respect backoff before LIMIT', () => {
    const source = readFileSync('supabase/functions/bepaid-auto-process/index.ts', 'utf8');
    expect(source).toContain('next_retry_at.is.null,next_retry_at.lte.${queueNow}');
    expect(source).toContain('recordPreflightFailure: !queueItemId');
    expect(source.indexOf('next_retry_at.is.null')).toBeLessThan(source.indexOf('.limit(limit)'));
  });
});

describe('canonical provider-verified queue recovery', () => {
  it('legacy event without SBS needs an explicit provider-proven subscription, never an order guess', async () => {
    const h = fixture(); h.rows.payment_reconcile_queue[0].raw_payload = {};
    await expect(h.run({ dryRun: true })).rejects.toThrow('recovery_no_canonical_order');
    expect(await h.run({ dryRun: true, providerSubscriptionId: 'sbs_test' })).toMatchObject({
      no_writes: true, plan: { expected_orders_created: 1, parent_order_id: id(5), expected_access_end_at: newEnd },
    });
    expect(h.writes).toEqual([]);
    h.sbs.last_transaction.uid = id(99);
    await expect(h.run({ providerSubscriptionId: 'sbs_test' })).rejects.toThrow('recovery_provider_subscription_mismatch');
    expect(h.writes).toEqual([]);
  });
  it('explicit SBS cannot replace contradictory event evidence', async () => {
    const h = fixture();
    await expect(h.run({ providerSubscriptionId: 'sbs_other' })).rejects.toThrow('recovery_explicit_subscription_mismatch');
    expect(h.writes).toEqual([]);
  });
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
  it.each(['subscription', 'entitlement', 'both'])('does not complete a paid cycle with an active but short %s window', async target => {
    const h = fixture(); await h.run();
    Object.assign(h.rows.payment_reconcile_queue[0], { status: 'pending', attempts: 1 });
    if (target !== 'entitlement') h.rows.subscriptions_v2[0].access_end_at = '2026-09-01T12:00:00Z';
    if (target !== 'subscription') h.rows.entitlements[0].expires_at = '2026-09-01T12:00:00Z';
    const before = structuredClone(h.rows);
    const writes = h.writes.length;
    const grants = h.db.functions.invoke.mock.calls.length;
    await expect(h.run({ dryRun: true })).rejects.toThrow('recovery_paid_access_window_short');
    await expect(h.run()).rejects.toThrow('recovery_paid_access_window_short');
    expect(h.rows).toEqual(before);
    expect(h.writes).toHaveLength(writes);
    expect(h.db.functions.invoke).toHaveBeenCalledTimes(grants);
  });
  it('does not silently accept a completed queue when paid access is short', async () => {
    const h = fixture(); await h.run();
    h.rows.subscriptions_v2[0].access_end_at = '2026-09-01T12:00:00Z';
    const writes = h.writes.length;
    await expect(h.run()).rejects.toThrow('recovery_paid_access_window_short');
    expect(h.writes).toHaveLength(writes);
    expect(h.db.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it('rejects a successful downstream response that did not deliver the paid window', async () => {
    const h = fixture();
    h.rows.payments_v2.push({ ...h.rows.payments_v2[0], id: id(13), provider_payment_id: id(2), paid_at: paidAt });
    const originalGrant = h.db.functions.invoke.getMockImplementation();
    h.db.functions.invoke.mockImplementation(async (name: string, options: any) => {
      const result = await originalGrant!(name, options);
      h.rows.subscriptions_v2[0].access_end_at = '2026-09-01T12:00:00Z';
      h.rows.entitlements[0].expires_at = '2026-09-01T12:00:00Z';
      return result;
    });
    await expect(h.run()).rejects.toThrow('recovery_fulfillment_readback_failed');
    expect(h.rows.payment_reconcile_queue[0].status).toBe('error');
    expect(h.rows.provider_subscriptions[0].last_charge_at).toBeUndefined();
  });
  it.each([0, 1])('accepts a fully paid window at or beyond the exact boundary (+%sms)', async delta => {
    const h = fixture(); await h.run();
    const end = new Date(Date.parse(newEnd) + delta).toISOString();
    h.rows.subscriptions_v2[0].access_end_at = end;
    h.rows.entitlements[0].expires_at = end;
    const writes = h.writes.length;
    expect(await h.run()).toMatchObject({ already_completed: true });
    expect(h.writes).toHaveLength(writes);
  });
  it('does not borrow the previous recovered cycle window for a new payment', async () => {
    const h = fixture(); await h.run();
    const nextUid = '11111111-1111-4111-8111-111111111111';
    h.rows.subscriptions_v2[0].order_id = h.rows.payments_v2[1].order_id;
    Object.assign(h.rows.payment_reconcile_queue[0], { bepaid_uid: nextUid, status: 'pending', attempts: 0 });
    Object.assign(h.tx, { uid: nextUid, paid_at: '2026-09-28T08:15:55.123Z' });
    h.sbs.last_transaction.uid = nextUid;
    const nextNow = new Date('2026-09-28T10:00:00Z');
    vi.setSystemTime(nextNow);
    const writes = h.writes.length;
    expect(await h.run({ dryRun: true, now: nextNow })).toMatchObject({ no_writes: true, plan: {
      expected_orders_created: 1, expected_payments_created: 1,
      access_start_at: newEnd, expected_access_end_at: '2026-10-29T12:00:00.000Z',
    } });
    expect(h.writes).toHaveLength(writes);
  });
  it('uses the saved same-cycle end on partial retry even if catalog duration changed', async () => {
    const h = fixture(); h.failGrant(true);
    await expect(h.run()).rejects.toThrow('recovery_materialized_grant_failed');
    h.rows.products_v2[0].meta.access_window_rule = 'days';
    h.rows.tariffs[0].access_days = 90;
    expect(await h.run({ dryRun: true })).toMatchObject({ plan: { expected_access_end_at: newEnd } });
    h.restoreGrant(); await h.run();
    expect(h.rows.subscriptions_v2[0].access_end_at).toBe(newEnd);
    expect(h.rows.payments_v2).toHaveLength(2);
  });
  it('does not borrow saved dates when statement sync attaches a later payment to the old order', async () => {
    const h = fixture(); await h.run();
    const laterUid = '22222222-2222-4222-8222-222222222222';
    h.rows.payments_v2.push({ ...h.rows.payments_v2[1], id: id(22), provider_payment_id: laterUid,
      paid_at: '2026-09-28T08:15:55.123Z' });
    Object.assign(h.rows.payment_reconcile_queue[0], { bepaid_uid: laterUid, status: 'pending', attempts: 0 });
    Object.assign(h.tx, { uid: laterUid, paid_at: '2026-09-28T08:15:55.123Z' });
    h.sbs.last_transaction.uid = laterUid;
    const nextNow = new Date('2026-09-28T10:00:00Z');
    vi.setSystemTime(nextNow);
    const writes = h.writes.length;
    await expect(h.run({ dryRun: true, now: nextNow })).rejects.toThrow('recovery_paid_access_window_short');
    expect(h.writes).toHaveLength(writes);
  });
  it('does not re-purchase a fixed course tariff duration with each existing installment', async () => {
    const h = fixture(); await h.run();
    h.rows.orders_v2[1].meta = {};
    h.rows.products_v2[0].meta = {};
    h.rows.tariffs[0].access_days = 365;
    const writes = h.writes.length;
    expect(await h.run()).toMatchObject({ already_completed: true });
    expect(h.writes).toHaveLength(writes);
    expect(h.db.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it('does not send another payment window to the downstream grant on an unfulfilled retry', async () => {
    const h = fixture(); await h.run();
    const laterUid = '33333333-3333-4333-8333-333333333333';
    h.rows.payments_v2.push({ ...h.rows.payments_v2[1], id: id(23), provider_payment_id: laterUid,
      paid_at: '2026-09-28T08:15:55.123Z' });
    Object.assign(h.rows.payment_reconcile_queue[0], { bepaid_uid: laterUid, status: 'pending', attempts: 0 });
    Object.assign(h.tx, { uid: laterUid, paid_at: '2026-09-28T08:15:55.123Z' });
    h.sbs.last_transaction.uid = laterUid;
    h.rows.subscriptions_v2[0].status = 'expired';
    h.rows.entitlements[0].status = 'expired';
    const nextNow = new Date('2026-09-28T10:00:00Z');
    vi.setSystemTime(nextNow);
    h.db.functions.invoke.mockImplementation(async (_name: string, { body }: any) => {
      expect(body.customAccessStartAt).toBeUndefined();
      expect(body.customAccessEndAt).toBeUndefined();
      const end = '2026-10-29T12:00:00Z';
      Object.assign(h.rows.subscriptions_v2[0], { status: 'active', access_end_at: end,
        meta: { extended_by_orders: [body.orderId] } });
      Object.assign(h.rows.entitlements[0], { status: 'active', expires_at: end,
        meta: { extended_by_orders: [body.orderId] } });
      h.rows.access_grant_ledger.push({ source_order_id: body.orderId, status: 'extended' });
      return { data: { success: true }, error: null };
    });
    expect(await h.run({ now: nextNow })).toMatchObject({ success: true, results: { orders_created: 0 } });
    expect(h.rows.orders_v2).toHaveLength(2);
    expect(h.rows.payments_v2).toHaveLength(3);
  });
  it.each([
    { recovery_access_start_at: oldEnd },
    { recovery_access_start_at: oldEnd, recovery_expected_end_at: 'invalid' },
    { recovery_access_start_at: oldEnd, recovery_expected_end_at: oldEnd },
    { recovery_access_start_at: oldEnd, recovery_expected_end_at: '2026-08-01T12:00:00Z' },
  ])('fails closed for a malformed same-payment saved window', async meta => {
    const h = fixture(); await h.run();
    h.rows.orders_v2[1].meta = meta;
    const writes = h.writes.length;
    await expect(h.run({ dryRun: true })).rejects.toThrow('recovery_invalid_saved_window');
    expect(h.writes).toHaveLength(writes);
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
