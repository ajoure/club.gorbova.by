import { HISTORICAL_RECEIPT_RUN } from '../../../supabase/functions/bepaid-webhook/historical-receipt-guard';

export const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const uid = '11111111-2222-4333-8444-555555555555';
export const paidAt = '2026-08-31T21:15:22Z';

export function receiptFixture(kind: 'historical' | 'canonical' | 'legacy' | 'new' = 'canonical') {
  const identity = { user_id: id(3), profile_id: id(4), product_id: id(5), tariff_id: id(6) };
  const parent: any = { id: id(1), ...identity, status: 'paid', is_deleted: false, meta: { deal_month: '2026-07' } };
  const order: any = { id: id(2), ...identity, status: 'paid', is_deleted: false,
    order_number: `REBILL-${uid.slice(0, 12)}`, provider: 'bepaid', provider_payment_id: uid,
    final_price: 100, paid_amount: 100, currency: 'BYN', deal_date: paidAt,
    meta: { source: 'bepaid_rebill', parent_order_id: parent.id, materialized_from_payment_uid: uid,
      deal_month: '2026-09', grant_status: 'success', materialization_status: 'success' } };
  const payment: any = { id: id(7), ...identity, order_id: order.id, provider: 'bepaid',
    provider_payment_id: uid, amount: 100, currency: 'BYN', paid_at: paidAt,
    status: 'succeeded', transaction_type: 'Платеж', refunded_amount: 0, is_deleted: false,
    updated_at: '2026-09-01T00:00:00Z', meta: { preserved_field: 'original' } };
  if (kind === 'historical') Object.assign(order.meta, { reconstructed_historical_deal: true,
    historical_repair_run: HISTORICAL_RECEIPT_RUN, historical_access_mode: 'retained_on_parent',
    do_not_grant_access: true, grant_status: 'historical_retained_on_parent',
    materialization_status: 'reconstructed_historical_deal', historical_parent_order_id: parent.id,
    historical_receipt_payment_id: payment.id });
  if (kind === 'legacy') payment.order_id = parent.id;
  const provider: any = { id: id(8), provider: 'bepaid', provider_subscription_id: 'sbs_fixture',
    user_id: identity.user_id, subscription_v2_id: id(9), order_id: parent.id,
    state: 'active', updated_at: '2026-10-26T00:00:00Z', meta: { retained_cache_field: true } };
  const rows: Record<string, any[]> = { orders_v2: kind === 'new' || kind === 'legacy' ? [parent] : [parent, order],
    payments_v2: kind === 'new' ? [] : [payment], provider_subscriptions: [provider],
    payment_reconcile_queue: [], audit_logs: [] };
  const reads: string[] = [], writes: any[] = [], attempts: any[] = [];
  const failRead = new Set<string>(), failWrite = new Set<string>();
  let beforeWrite: ((table: string) => void) | undefined, queueRace = false;
  const db: any = {
    auth: { getUser: async () => ({ data: { user: { id: id(20) } }, error: null }) },
    rpc: async () => ({ data: true, error: null }),
    from(table: string) {
      rows[table] ||= [];
      const filters: Array<(r: any) => boolean> = [];
      let method = 'read', values: any, limit = Infinity;
      const b: any = {};
      b.select = () => b;
      b.eq = (k: string, v: any) => { filters.push(r => r[k] === v); return b; };
      b.is = (k: string, v: any) => { filters.push(r => (r[k] ?? null) === v); return b; };
      b.in = (k: string, vs: any[]) => { filters.push(r => vs.includes(r[k])); return b; };
      b.gt = (k: string, v: any) => { filters.push(r => r[k] > v); return b; };
      b.gte = (k: string, v: any) => { filters.push(r => r[k] >= v); return b; };
      b.lte = (k: string, v: any) => { filters.push(r => r[k] <= v); return b; };
      b.not = (k: string, op: string, v: any) => { filters.push(r => op === 'is' ? (r[k] ?? null) !== v : true); return b; };
      b.order = () => b;
      b.limit = (n: number) => { limit = n; return b; };
      b.insert = (v: any) => { method = 'insert'; values = v; return b; };
      b.update = (v: any) => { method = 'update'; values = v; return b; };
      b.upsert = () => { throw Error('unexpected destructive upsert'); };
      const complete = (single: boolean) => {
        if (method === 'read') {
          reads.push(table);
          const found = rows[table].filter(r => filters.every(f => f(r))).slice(0, limit);
          if (failRead.has(table) || (single && found.length > 1)) return { data: null, error: { message: 'read uncertainty' } };
          return { data: structuredClone(single ? found[0] || null : found), error: null };
        }
        attempts.push({ table, method, values: structuredClone(values) });
        if (beforeWrite) { const callback = beforeWrite; beforeWrite = undefined; callback(table); }
        if (failWrite.has(table)) return { data: null, error: { message: 'write uncertainty' } };
        if (method === 'insert') {
          if (table === 'payment_reconcile_queue' && queueRace) {
            queueRace = false;
            rows[table].push({ id: id(30), provider: 'bepaid', bepaid_uid: values.bepaid_uid,
              status: 'processing', attempts: 5, last_error: 'do not reset' });
            return { data: null, error: { code: '23505', message: 'another worker won' } };
          }
          const row = { id: id(40 + writes.length), ...structuredClone(values) };
          rows[table].push(row); writes.push({ table, method, values: structuredClone(values) });
          return { data: single ? row : [row], error: null };
        }
        const found = rows[table].filter(r => filters.every(f => f(r)));
        for (const row of found) Object.assign(row, structuredClone(values), { updated_at: '2026-10-26T01:00:00Z' });
        if (found.length) writes.push({ table, method, values: structuredClone(values) });
        return { data: single ? structuredClone(found[0] || null) : structuredClone(found), error: null };
      };
      b.maybeSingle = b.single = () => Promise.resolve(complete(true));
      b.then = (resolve: any, reject: any) => Promise.resolve(complete(false)).then(resolve, reject);
      return b;
    },
  };
  const tx = { uid, amount: 10000, currency: 'BYN', paid_at: paidAt, created_at: paidAt,
    status: 'successful', type: 'payment', tracking_id: `subv2:${id(9)}:order:${parent.id}` };
  return { db, rows, writes, attempts, reads, parent, order, payment, provider, tx,
    failRead, failWrite, beforeWrite: (cb: typeof beforeWrite) => { beforeWrite = cb; },
    raceQueue: () => { queueRace = true; } };
}
