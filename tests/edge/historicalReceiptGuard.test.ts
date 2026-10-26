import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasHistoricalReceiptMarker, historicalWebhookReplay, HISTORICAL_RECEIPT_RUN, inspectHistoricalReceipt } from '../../supabase/functions/bepaid-webhook/historical-receipt-guard';
import { classifyRebillAccessOutcome, runRebillFlow } from '../../supabase/functions/bepaid-webhook/historical-rebill-flow';

const uid = '11111111-2222-4333-8444-555555555555';
const paidAt = '2026-08-31T12:45:22Z';
function fixture() {
  const identity = { user_id: 'user', profile_id: 'profile', product_id: 'product', tariff_id: 'tariff' };
  const parent = { id: 'parent', ...identity, status: 'paid', paid_amount: 100, currency: 'BYN', meta: {} };
  const order = { id: 'reconstructed', ...identity, status: 'paid', final_price: 100, paid_amount: 100,
    order_number: `REBILL-${uid.slice(0,12)}`, provider: 'bepaid', provider_payment_id: uid,
    currency: 'BYN', deal_date: paidAt, meta: {
      reconstructed_historical_deal: true, historical_repair_run: HISTORICAL_RECEIPT_RUN,
      historical_access_mode: 'retained_on_parent', do_not_grant_access: true,
      grant_status: 'historical_retained_on_parent', materialization_status: 'reconstructed_historical_deal',
      historical_parent_order_id: parent.id, parent_order_id: parent.id,
      historical_receipt_payment_id: 'receipt', materialized_from_payment_uid: uid,
    } };
  const payment = { id: 'receipt', order_id: order.id, user_id: identity.user_id, profile_id: identity.profile_id,
    provider: 'bepaid', provider_payment_id: uid, amount: 100, currency: 'BYN', status: 'succeeded',
    transaction_type: 'Платеж', paid_at: paidAt, refunded_amount: 0 };
  const rows: Record<string, any[]> = { orders_v2: [parent, order], payments_v2: [payment] };
  const reads: string[] = [];
  let fail = false;
  const db = { from(table: string) {
    reads.push(table);
    const filters: Array<(row: any) => boolean> = [];
    const b: any = { select: () => b, eq: (k: string,v: unknown) => { filters.push(r=>r[k]===v); return b; },
      maybeSingle: async () => {
        const found = rows[table].filter(row=>filters.every(f=>f(row)));
        return fail || found.length>1 ? { error: { message: 'synthetic read failure' }, data: null }
          : { error: null, data: structuredClone(found[0]||null) };
      } };
    return b;
  } };
  const tx = { uid, amount: 10000, currency: 'BYN', paid_at: paidAt, status: 'successful', type: 'payment' };
  return { db, rows, parent, order, payment, reads, tx, fail: () => { fail = true; } };
}

it('acknowledges exactly one historical receipt without reading or writing access, provider, or queue',async()=>{
  const h=fixture(), before=structuredClone(h.rows);
  expect(await inspectHistoricalReceipt(h.db,uid)).toEqual({kind:'preserved',orderId:h.order.id,parentOrderId:h.parent.id});
  expect(h.rows).toEqual(before);
  expect(h.reads).toEqual(['orders_v2','payments_v2','orders_v2']);
});

it('ignores an ordinary canonical rebill, without weakening normal processing',async()=>{
  const h=fixture(); h.order.meta={} as any;
  expect(await inspectHistoricalReceipt(h.db,uid)).toEqual({kind:'none'});
  expect(h.reads).toEqual(['orders_v2','payments_v2']);
});

describe('fail-closed stored proof',()=>{
  it.each([
    ['missing marker', (h: any)=>{delete h.order.meta.historical_repair_run;}],
    ['wrong run', (h: any)=>{h.order.meta.historical_repair_run='other';}],
    ['fake success', (h: any)=>{h.order.meta.grant_status='success';}],
    ['missing no-grant', (h: any)=>{h.order.meta.do_not_grant_access=false;}],
    ['uid', (h: any)=>{h.order.provider_payment_id='other';}],
    ['renamed canonical order', (h: any)=>{h.order.order_number='MANUAL-renamed';}],
    ['parent mismatch', (h: any)=>{h.order.meta.parent_order_id='other';}],
    ['payment moved', (h: any)=>{h.payment.order_id=h.parent.id;}],
    ['amount', (h: any)=>{h.payment.amount=200;}],
    ['currency', (h: any)=>{h.payment.currency='EUR';}],
    ['payment date', (h: any)=>{h.payment.paid_at='2026-09-01T12:00:00Z';}],
    ['payment status', (h: any)=>{h.payment.status='failed';}],
    ['refund type', (h: any)=>{h.payment.transaction_type='Возврат средств';}],
    ['refund', (h: any)=>{h.payment.refunded_amount=1;}],
    ['deleted receipt', (h: any)=>{h.payment.is_deleted=true;}],
    ['missing receipt', (h: any)=>{h.rows.payments_v2=[];}],
    ['duplicate uid', (h: any)=>{h.rows.payments_v2.push({...h.payment,id:'duplicate'});}],
    ['missing parent', (h: any)=>{h.rows.orders_v2=[h.order];}],
    ['wrong parent identity', (h: any)=>{h.parent.product_id='other';}],
    ['wrong receipt identity', (h: any)=>{h.payment.user_id='other';}],
    ['deleted parent', (h: any)=>{h.parent.is_deleted=true;}],
    ['deleted deal', (h: any)=>{h.order.is_deleted=true;}],
  ])('holds %s and changes no state',async(_name,mutate)=>{
    const h=fixture();mutate(h);const before=structuredClone(h.rows);
    expect((await inspectHistoricalReceipt(h.db,uid)).kind).toBe('hold');expect(h.rows).toEqual(before);
  });
  it('holds database uncertainty instead of using a legacy fallback',async()=>{
    const h=fixture();h.fail();expect(await inspectHistoricalReceipt(h.db,uid)).toEqual({kind:'hold',reason:'historical_receipt_lookup_failed'});
  });
});

describe('authenticated webhook replay entry point',()=>{
  it.each(['off','dry_run','on'])('stops before mode=%s and missing cycle metadata',async(mode)=>{
    const h=fixture(),before=structuredClone(h.rows);
    const response=await historicalWebhookReplay(h.db,{transaction:h.tx,paid_billing_cycles:0,mode},{});
    expect(response?.status).toBe(200);expect(await response?.json()).toEqual({ok:true,status:'historical_receipt_preserved',access_changed:false});
    expect(h.rows).toEqual(before);
  });
  it.each(['transaction','last_transaction','subscription'])('recognizes %s shape',async(key)=>{
    const h=fixture(); const body=key==='subscription'?{subscription:{last_transaction:h.tx}}:{[key]:h.tx};
    expect((await historicalWebhookReplay(h.db,body,{}))?.status).toBe(200);
  });
  it.each([{amount:9999},{currency:'EUR'},{paid_at:'2026-09-01T12:45:22Z'},{status:'failed'},{type:'refund'}])('holds mismatched event %j',async(patch)=>{
    const h=fixture();expect((await historicalWebhookReplay(h.db,{transaction:{...h.tx,...patch}},{}))?.status).toBe(202);
  });
});

it.each(['off','dry_run','on'] as const)('REBILL mode=%s never falls back, writes or grants a preserved historical receipt',async(mode)=>{
  const h=fixture();const mutation=vi.fn(()=>{throw Error('unexpected mutation');});
  const deps:any={inspectHistoricalReceipt:(v:string)=>inspectHistoricalReceipt(h.db,v),writeAudit:mutation,
    findRebillOrderByOrderNumber:mutation,checkSbsMismatchBeforeRebill:mutation,insertRebillOrder:mutation,
    insertPaymentRow:mutation,updatePaymentOrderId:mutation,invokeGrantAccess:mutation,mergeOrderMeta:mutation};
  const r=await runRebillFlow(deps,{mode,payment:{uid,amount:100,paid_at:paidAt},parentOrder:h.parent as any,subscriptionId:'sbs_test'});
  expect(r.decision).toBe('resumed_repoint_only');expect(r.reason).toBe('historical_receipt_preserved');expect(r.proceedLegacy).toBe(false);expect(mutation).not.toHaveBeenCalled();
  expect(classifyRebillAccessOutcome(r.decision)).toBe('skip');
});

it('blocks incomplete marker intent, but does not conflate post-cancel orders with historical reconstruction',()=>{
  expect(hasHistoricalReceiptMarker({reconstructed_historical_deal:false})).toBe(true);
  expect(hasHistoricalReceiptMarker({historical_repair_run:'incomplete'})).toBe(true);
  expect(hasHistoricalReceiptMarker({do_not_grant_access:true,grant_status:'suppressed_post_cancel_charge'})).toBe(false);
});

it('ships identical guards in each isolated managed function package',()=>{
  const file=(p:string)=>readFileSync(`supabase/functions/${p}`,'utf8');
  const canonical=file('bepaid-webhook/historical-receipt-guard.ts');
  for(const name of ['payments-reconcile','grant-access-for-order','bepaid-archive-import','admin-materialize-post-cancel-charge',
    'bepaid-get-subscription-details','bepaid-fetch-transactions','admin-bepaid-full-reconcile','bepaid-uid-resync']) {
    expect(file(`${name}/historical-receipt-guard.ts`)).toBe(canonical);
  }
  for(const name of ['bepaid-fetch-transactions','admin-bepaid-full-reconcile','bepaid-uid-resync']) {
    expect(file(`${name}/receipt-sync-policy.ts`)).toBe(file('bepaid-get-subscription-details/receipt-sync-policy.ts'));
  }
  expect(file('admin-materialize-post-cancel-charge/historical-rebill-flow.ts')).toBe(file('bepaid-webhook/historical-rebill-flow.ts'));
});

it('wires early boundaries before authenticated webhook queue, importer profile/product writes, recovery claims and 3DS writer',()=>{
  const source=(p:string)=>readFileSync(`supabase/functions/${p}`,'utf8');
  const w=source('bepaid-webhook/index.ts');
  expect(w.indexOf('if (!signatureVerified) {')).toBeLessThan(w.indexOf('await historicalWebhookReplay'));
  expect(w.indexOf('await historicalWebhookReplay')).toBeLessThan(w.indexOf('// CRITICAL: Save ALL incoming'));
  const a=source('bepaid-archive-import/index.ts');
  expect(a.indexOf('await inspectHistoricalReceipt')).toBeLessThan(a.indexOf('.from("products_v2")\n              .insert'));
  const r=source('payments-reconcile/historical-recovery.ts');
  expect(r.indexOf('const historical = await inspectHistoricalReceipt(db, item.bepaid_uid)')).toBeLessThan(r.indexOf('return canonicalRecovery(db, options)'));
  const g=source('grant-access-for-order/index.ts');
  expect(g.indexOf('hasHistoricalReceiptMarker(historicalOrderRead.data?.meta)')).toBeLessThan(g.indexOf("if (_body.context === '3ds_finalize')"));
});
