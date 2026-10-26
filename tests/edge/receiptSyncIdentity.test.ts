import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as receiptPolicy from '../../supabase/functions/bepaid-get-subscription-details/receipt-sync-policy';
import { receiptFixture, id, uid, paidAt } from './fixtures/receiptSyncFixture';

const { inspectReceiptSync, enqueueReceiptForRecovery, updateLegacyReceipt } = receiptPolicy;

describe('immutable receipt identity across observation and import', () => {
  it.each(['historical', 'canonical'] as const)('preserves %s receipt, exact month, metadata and all access without any write', async kind => {
    const h = receiptFixture(kind), before = structuredClone(h.rows);
    expect(await inspectReceiptSync(h.db, uid, h.tx)).toEqual({ kind: 'preserved', orderId: h.order.id, historical: kind === 'historical' });
    expect(h.rows).toEqual(before); expect(h.attempts).toEqual([]);
    expect(h.reads.every(t => ['orders_v2', 'payments_v2'].includes(t))).toBe(true);
  });

  it.each([
    ['amount', (h: any) => { h.payment.amount = 99; }],
    ['currency', (h: any) => { h.payment.currency = 'EUR'; }],
    ['paid date', (h: any) => { h.payment.paid_at = '2026-08-01T00:00:00Z'; }],
    ['failed status', (h: any) => { h.payment.status = 'failed'; }],
    ['deleted receipt', (h: any) => { h.payment.is_deleted = true; }],
    ['deleted deal', (h: any) => { h.order.is_deleted = true; }],
    ['refund', (h: any) => { h.payment.refunded_amount = 1; }],
    ['refund type', (h: any) => { h.payment.transaction_type = 'refund'; }],
    ['duplicate receipt', (h: any) => { h.rows.payments_v2.push({ ...h.payment, id: id(80) }); }],
    ['missing receipt', (h: any) => { h.rows.payments_v2 = []; }],
    ['wrong link', (h: any) => { h.payment.order_id = h.parent.id; }],
    ['renamed period', (h: any) => { h.order.order_number = 'MANUAL'; }],
    ['partial marker', (h: any) => { h.order.meta.historical_repair_run = 'partial'; }],
    ['payment marker', (h: any) => { h.payment.meta.historical_access_mode = 'partial'; }],
    ['wrong parent', (h: any) => { h.parent.product_id = id(81); }],
    ['missing parent', (h: any) => { h.rows.orders_v2 = [h.order]; }],
  ])('holds %s and never falls back to a parent update', async (_name, mutate) => {
    const h = receiptFixture(); mutate(h); const before = structuredClone(h.rows);
    expect((await inspectReceiptSync(h.db, uid, h.tx)).kind).toBe('hold');
    expect(h.rows).toEqual(before); expect(h.attempts).toEqual([]);
  });

  it.each([{ amount: 9999 }, { currency: 'EUR' }, { status: 'refunded' }, { type: 'authorization' }, { paid_at: '2026-09-02T00:00:00Z' }])(
    'holds provider-event drift %j without corrupting the receipt', async patch => {
      const h = receiptFixture();
      expect((await inspectReceiptSync(h.db, uid, { ...h.tx, ...patch })).kind).toBe('hold');
      expect(h.attempts).toEqual([]);
    });

  it('holds lookup uncertainty instead of treating a protected receipt as absent', async () => {
    const h = receiptFixture(); h.failRead.add('orders_v2');
    expect((await inspectReceiptSync(h.db, uid)).kind).toBe('hold'); expect(h.writes).toEqual([]);
  });
});

describe('canonical recovery handoff', () => {
  it('queues one unseen paid UID with its own exact date/amount/tracking, without creating money or access', async () => {
    const h = receiptFixture('new');
    const result = await enqueueReceiptForRecovery(h.db,
      { ...h.tx, credit_card: { token: 'synthetic-do-not-copy' }, customer: { email: 'fixture@example.test' } },
      'subscription_snapshot', 'sbs_fixture');
    expect(result.kind).toBe('queued'); expect(h.rows.payments_v2).toEqual([]);
    expect(h.writes.map(w => w.table)).toEqual(['payment_reconcile_queue']);
    expect(h.rows.payment_reconcile_queue[0]).toMatchObject({ amount: 100, currency: 'BYN', paid_at: paidAt,
      tracking_id: h.tx.tracking_id, status: 'pending', raw_payload: { uid, subscription_id: 'sbs_fixture' } });
    expect(h.rows.payment_reconcile_queue[0].raw_payload).not.toHaveProperty('credit_card');
    expect(h.rows.payment_reconcile_queue[0].raw_payload).not.toHaveProperty('customer');
    expect(result).toMatchObject({ fulfillment_verified: false });
  });

  it.each(['processing', 'pending', 'error', 'completed', 'cancelled', 'manual_review'])('never reopens/resets an existing %s job', async status => {
    const h = receiptFixture('new');
    h.rows.payment_reconcile_queue.push({ id: id(30), provider: 'bepaid', bepaid_uid: uid, status,
      attempts: 5, last_error: 'operator hold', next_retry_at: '2026-12-01T00:00:00Z', matched_order_id: h.parent.id });
    const before = structuredClone(h.rows);
    expect((await enqueueReceiptForRecovery(h.db, h.tx, 'subscription_snapshot')).kind).toBe('queued_existing');
    expect(h.rows).toEqual(before); expect(h.attempts).toEqual([]);
  });

  it('re-reads a unique-key race winner and does not steal its processing lease', async () => {
    const h = receiptFixture('new'); h.raceQueue();
    expect((await enqueueReceiptForRecovery(h.db, h.tx, 'subscription_snapshot')).kind).toBe('queued_existing');
    expect(h.writes).toEqual([]);
    expect(h.rows.payment_reconcile_queue).toHaveLength(1);
    expect(h.rows.payment_reconcile_queue[0]).toMatchObject({ status: 'processing', attempts: 5, last_error: 'do not reset' });
  });

  it.each([{ amount: null }, { amount: 0 }, { amount: 1.5 }, { paid_at: 'bad', created_at: null },
    { tracking_id: null }, { tracking_id: 'subv2:unknown:order:unknown' }, { currency: null }, { type: 'authorization' },
    { status: 'failed' }, { subscription_id: 'sbs_other' }])('holds incomplete/unsafe queue input %j', async patch => {
    const h = receiptFixture('new');
    expect((await enqueueReceiptForRecovery(h.db, { ...h.tx, ...patch }, 'subscription_snapshot', 'sbs_fixture')).kind).toBe('hold');
    expect(h.attempts).toEqual([]);
  });

  it('does not enqueue a receipt already on a legacy parent as an unreviewed historical repair', async () => {
    const h = receiptFixture('legacy'), before = structuredClone(h.rows);
    expect((await enqueueReceiptForRecovery(h.db, h.tx, 'subscription_snapshot')).kind).toBe('existing');
    expect(h.rows).toEqual(before); expect(h.attempts).toEqual([]);
  });
});

describe('legacy enrichment CAS', () => {
  it('merges metadata while preserving identity and unrelated keys', async () => {
    const h = receiptFixture('legacy'), expected = structuredClone(h.payment);
    expect(await updateLegacyReceipt(h.db, uid, expected, { meta: { verified: true } })).toBe(true);
    expect(h.payment.meta).toEqual({ preserved_field: 'original', verified: true });
    expect(h.payment.order_id).toBe(h.parent.id);
  });
  it('refuses identity fields instead of silently stripping them', async () => {
    const h = receiptFixture('legacy');
    await expect(updateLegacyReceipt(h.db, uid, h.payment, { order_id: id(70) })).rejects.toThrow('identity_patch_forbidden');
    expect(h.attempts).toEqual([]);
  });
  it('refuses a stale read and a concurrent row-lock/CAS race', async () => {
    const h = receiptFixture('legacy'), expected = structuredClone(h.payment);
    h.payment.updated_at = '2026-10-26T00:00:00Z';
    expect(await updateLegacyReceipt(h.db, uid, expected, { status: 'failed' })).toBe(false);
    expect(h.attempts).toEqual([]);
    const current = structuredClone(h.payment);
    h.beforeWrite(() => { h.payment.updated_at = '2026-10-26T02:00:00Z'; });
    expect(await updateLegacyReceipt(h.db, uid, current, { status: 'failed' })).toBe(false);
    expect(h.payment.status).toBe('succeeded'); expect(h.writes).toEqual([]);
  });
  it.each(['canonical', 'historical'] as const)('never changes status/meta on a protected %s receipt', async kind => {
    const h = receiptFixture(kind);
    expect(await updateLegacyReceipt(h.db, uid, h.payment, { status: 'failed', meta: { source: 'resync' } })).toBe(false);
    expect(h.attempts).toEqual([]);
  });
});

function loadHandler(folder: string, h: ReturnType<typeof receiptFixture>, subscriptionPatch: any = {}) {
  const source = readFileSync(`supabase/functions/${folder}/index.ts`, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let handler!: (req: Request) => Promise<Response>, fetchCalls = 0;
  const exported: any = {};
  const sub = { id: 'sbs_fixture', state: 'active', renew_at: '2026-11-30T00:00:00Z',
    active_to: '2026-11-30T00:00:00Z', last_transaction: h.tx, ...subscriptionPatch };
  runInNewContext(compiled + '\nif(typeof routeFetchedReceipt!=="undefined") exports.routeFetchedReceipt=routeFetchedReceipt;\n' +
    'if(typeof runUidVerifyMode!=="undefined") exports.runUidVerifyMode=runUidVerifyMode;\n' +
    'if(typeof processListModeTransactions!=="undefined") exports.processListModeTransactions=processListModeTransactions;', {
    exports: exported, Request, Response, Date, URL, AbortSignal, setTimeout, clearTimeout,
    console: { log() {}, error() {}, warn() {}, info() {} },
    Deno: { env: { get: () => 'synthetic' }, serve: (fn: typeof handler) => { handler = fn; } },
    fetch: async () => { fetchCalls++; return new Response(JSON.stringify({ subscription: sub })); },
    require(path: string) {
      if (path.includes('@supabase/supabase-js')) return { createClient: () => h.db };
      if (path.includes('/http/server.ts')) return { serve: (fn: typeof handler) => { handler = fn; } };
      if (path === './receipt-sync-policy.ts') return receiptPolicy;
      if (path.includes('bepaid-credentials')) return { getBepaidCredsStrict: async () => ({}),
        isBepaidCredsError: () => false, createBepaidAuthHeader: () => 'Basic synthetic' };
      if (path.includes('bepaid-tracking-id')) return { parseBepaidTrackingId: () => ({ kind: 'subv2', orderId: h.parent.id }) };
      throw Error(`Unexpected dependency: ${path}`);
    },
  });
  return { exported, fetchCalls: () => fetchCalls,
    run: (authorization = true, method = 'POST') => handler(new Request('https://example.test', {
      method, headers: authorization ? { Authorization: 'Bearer synthetic' } : {},
      ...(method === 'POST' ? { body: JSON.stringify({ subscription_id: 'sbs_fixture' }) } : {}),
    })) };
}

describe('actual subscription snapshot HTTP entrypoint', () => {
  it.each(['canonical', 'historical', 'legacy'] as const)('refreshes cache only for %s receipt; never replays access or rewrites payment', async kind => {
    const h = receiptFixture(kind), payments = structuredClone(h.rows.payments_v2), orders = structuredClone(h.rows.orders_v2);
    const r = await loadHandler('bepaid-get-subscription-details', h).run();
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ success: true, snapshot_updated: true,
      direct_business_writes: 0, fulfillment_verified: false });
    expect(h.writes.map(w => w.table)).toEqual(['provider_subscriptions']);
    expect(h.rows.payments_v2).toEqual(payments); expect(h.rows.orders_v2).toEqual(orders);
    expect(h.provider.meta.retained_cache_field).toBe(true);
  });
  it('queues an unseen paid UID and keeps financial/access mutation exclusively in recovery', async () => {
    const h = receiptFixture('new'); const r = await loadHandler('bepaid-get-subscription-details', h).run();
    expect(await r.json()).toMatchObject({ success: true, receipt_processing: { kind: 'queued' }, fulfillment_verified: false });
    expect(h.writes.map(w => w.table)).toEqual(['payment_reconcile_queue', 'provider_subscriptions']);
    expect(h.rows.payments_v2).toEqual([]);
  });
  it('holds partial historical intent before cache, queue or any business write', async () => {
    const h = receiptFixture('historical'); delete h.order.meta.historical_repair_run;
    const r = await loadHandler('bepaid-get-subscription-details', h).run();
    expect(r.status).toBe(202); expect(await r.json()).toMatchObject({ success: false, manual_review: true });
    expect(h.attempts).toEqual([]);
  });
  it('does not create a payment/grant from a failed card, missing amount or missing UID', async () => {
    const failed = receiptFixture('new');
    const r = await loadHandler('bepaid-get-subscription-details', failed,
      { state: 'failed_attempt', last_transaction: { ...failed.tx, status: 'failed', amount: null } }).run();
    expect(r.status).toBe(200); expect(failed.writes.map(w => w.table)).toEqual(['provider_subscriptions']);
    for (const patch of [{ amount: null }, { uid: null }, { type: undefined }]) {
      const h = receiptFixture('new');
      expect((await loadHandler('bepaid-get-subscription-details', h, { last_transaction: { ...h.tx, ...patch } }).run()).status).toBe(202);
      expect(h.attempts).toEqual([]);
    }
  });
  it('reports a snapshot CAS conflict without pretending successful synchronization', async () => {
    const h = receiptFixture(); h.beforeWrite(() => { h.provider.updated_at = 'newer'; });
    const r = await loadHandler('bepaid-get-subscription-details', h).run();
    expect(r.status).toBe(500); expect(await r.json()).toEqual({ error: 'provider_snapshot_conflict' });
    expect(h.writes).toEqual([]);
  });
  it('rejects anonymous/staff callers before provider and data effects', async () => {
    for (const staff of [false, true]) {
      const h = receiptFixture(); if (staff) h.db.rpc = async () => ({ data: false, error: null });
      const entry = loadHandler('bepaid-get-subscription-details', h);
      expect((await entry.run(staff)).status).toBe(staff ? 403 : 401);
      expect(entry.fetchCalls()).toBe(0); expect(h.attempts).toEqual([]); expect(h.reads).toEqual([]);
    }
  });
});

describe('actual import entrypoint boundaries', () => {
  it.each(['canonical', 'historical'] as const)('all fetch modes preserve %s instead of reaching a destructive upsert', async kind => {
    for (const mode of ['execute', 'dry-run', 'diagnose']) {
      const h = receiptFixture(kind), entry = loadHandler('bepaid-fetch-transactions', h);
      const result: any = { errors: 0, already_exists: 0, dry_run_items: [], queued_for_processing: 0 };
      expect(await entry.exported.routeFetchedReceipt(h.db, h.tx, mode, 'uid_fallback', result)).toBe(true);
      expect(h.attempts).toEqual([]); expect(result.protected_receipts).toBe(1);
    }
  });
  it('the UID fallback delegates an unseen successful charge to the queue without marking fulfillment processed', async () => {
    const h = receiptFixture('new'), entry = loadHandler('bepaid-fetch-transactions', h);
    const result: any = { errors: 0, already_exists: 0, dry_run_items: [], queued_for_processing: 0 };
    expect(await entry.exported.routeFetchedReceipt(h.db, h.tx, 'execute', 'uid_fallback', result)).toBe(true);
    expect(result.queued_for_processing).toBe(1); expect(h.rows.payments_v2).toEqual([]);
    expect(h.rows.payment_reconcile_queue[0].status).toBe('pending');
  });
  it.each([undefined, 'unknown'])('holds successful unclassified type %s rather than inserting a default payment', async type => {
    const h = receiptFixture('new'), entry = loadHandler('bepaid-fetch-transactions', h);
    const result: any = { errors: 0, already_exists: 0, dry_run_items: [], queued_for_processing: 0 };
    expect(await entry.exported.routeFetchedReceipt(h.db, { ...h.tx, type }, 'execute', 'uid_fallback', result)).toBe(true);
    expect(result.errors).toBe(1); expect(h.attempts).toEqual([]);
    const reconcile = loadHandler('admin-bepaid-full-reconcile', h);
    const r = await reconcile.exported.processListModeTransactions(h.db, [{ ...h.tx, type }], false);
    expect(r.counters.errors).toBe(1); expect(h.attempts).toEqual([]);
  });
  it.each(['canonical', 'historical'] as const)('full reconciliation cannot mutate amount/status/meta of %s receipt', async kind => {
    const h = receiptFixture(kind), entry = loadHandler('admin-bepaid-full-reconcile', h);
    await entry.exported.processListModeTransactions(h.db, [{ ...h.tx, amount: 9999, status: 'failed' }], false);
    expect(h.attempts).toEqual([]);
    const verify = await entry.exported.runUidVerifyMode(h.db, 'synthetic', '2026-08-01', '2026-09-01', false, 10, Date.now());
    expect(verify.stats.protected_receipts).toBe(1); expect(entry.fetchCalls()).toBe(0); expect(h.attempts).toEqual([]);
  });
});
