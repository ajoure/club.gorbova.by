import { ensureZg27PendingSubscription, requireZg27ReadySubscription, requireZg27ActivatedSubscription } from '../../supabase/functions/_shared/zg27-subscription';
import { settleZg27InstallmentReceipt } from '../../supabase/functions/_shared/zg27-installment-receipt';
import { resolveZg27DebtToken } from '../../supabase/functions/_shared/zg27-debt-proof';
import { getSubscriptionToken } from '../../supabase/functions/_shared/token-resolver';
import { zg27FixedEnd, cappedZg27Merge } from '../../supabase/functions/_shared/zg27-access-policy';
import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as checkoutGuard from '../../supabase/functions/_shared/zg27-checkout-guard';
import { load, loadText } from './zg27-ingress-harness';
import * as hosted from '../../supabase/functions/_shared/zg27-hosted-installments';
import * as installment from '../../supabase/functions/_shared/zg27-installments';
import * as referral from '../../supabase/functions/_shared/referral-checkout-discount';
import * as discount from '../../supabase/functions/_shared/checkout-discounts';
import { describe, it, expect } from 'vitest';
import { freezeZg27Consent, validateZg27HostedMeta, zg27HostedWidgetFields, handoffZg27HostedReceipt } from '../../supabase/functions/_shared/zg27-hosted-installments';
import { zg27InstallmentContract } from '../../supabase/functions/_shared/zg27-installments';
import { ZG27_PRODUCT_ID, ZG27_TIERS } from '../../supabase/functions/_shared/zg27-policy';
function fixture(tier:'first'|'repeat'='repeat', count=3) {
  const plan = zg27InstallmentContract({ productId: ZG27_PRODUCT_ID, tariffId: ZG27_TIERS[tier].tariffId,
    offerTariffId: ZG27_TIERS[tier].tariffId, offerId: 'offer', amountByn: ZG27_TIERS[tier].totalMinor/100, currency: 'BYN', count, intervalDays: 30, firstDelayDays: 0 });
  const raw = { accepted: true, policy_version: 'zg27-v1', amounts_minor: plan.amounts_minor, interval_days: 30, total_minor: plan.total_minor };
  const order = { id: 'order', user_id: 'user', product_id: ZG27_PRODUCT_ID, tariff_id: ZG27_TIERS[tier].tariffId,
    currency: 'BYN', status:'partial', final_price: plan.total_minor/100, meta: { zg27_installment: plan, zg27_schedule_consent: freezeZg27Consent(plan, raw, 'user') } };
  const pay = { id: 'pay', order_id: 'order', user_id: 'user', status: 'succeeded', provider: 'bepaid', provider_payment_id: 'receipt', amount: plan.amounts_minor[0]/100,
    currency: 'BYN', refunded_amount: 0, paid_at: '2026-11-18T12:00:00Z' };
  const sub = { id: 'sub', order_id: 'order', user_id: 'user', product_id: order.product_id, tariff_id: order.tariff_id,
    status: 'active', billing_type: 'mit', auto_renew: false, payment_method_id: null, meta: {}, access_end_at: '2027-04-30T21:00:00Z' };
  const tx = { uid: 'receipt', status: 'successful', amount: plan.amounts_minor[0], currency: 'BYN', credit_card: { token: 'synthetic-owned-token' } };
  const tables: Record<string, any[]> = { orders_v2: [order], payments_v2: [pay], subscriptions_v2: [sub], payment_methods: [], installment_payments: [], entitlements: [{user_id:'user',product_id:order.product_id,status:'active',expires_at:'2027-04-30T21:00:00Z'}] };
  const writes: string[] = [];
  const db = { from(table: string) {
    const filters: [string, unknown][] = []; let inserted: any = null, patch: any = null;
    const rows = () => tables[table].filter(row => filters.every(([k, v]) => Array.isArray(v)?v.includes(row[k]):row[k] === v));
    const apply = () => {
      if (inserted) { writes.push(table); const values = Array.isArray(inserted) ? inserted : [{ id: table==='payments_v2'&&tables[table].length>1?'next-payment':'card', provider_payment_id:null, ...inserted }]; tables[table].push(...values); inserted = null; return values[0]; }
      if (patch) { writes.push(table); const matched=rows(); for (const row of matched) Object.assign(row, patch); patch = null; return matched[0]??null; }
      return rows()[0] ?? null;
    };
    const q: any = { select: () => q, in: (k:string,v:any[])=>{filters.push([k,v]);return q;}, order:()=>q, limit:()=>q, eq: (k: string, v: unknown) => { filters.push([k,v]); return q; },
      is: (k: string,v: unknown) => {filters.push([k,v]);return q;},
      contains: (_k: string, value: any) => { if (!sub.meta || !(sub.meta as any).extended_by_orders?.includes(value.extended_by_orders[0])) filters.push(['id','none']); return q; },
      maybeSingle: async () => ({ data: apply(), error: null }), single: async () => ({ data: apply(), error: null }),
      insert: (v: any) => { inserted = v; return q; }, update: (v: any) => { patch = v; return q; },
      then: (resolve: any) => { apply(); return Promise.resolve(resolve({ data: rows(), error: null })); } };
    return q;
  } };
  return { plan, raw, order, pay, sub, tx, tables, writes, db };
}
describe('hosted finite contract and verified receipt handoff', () => {
  it.each([['first',2],['first',3],['repeat',2],['repeat',3]] as const)('actual common writer %s/%s charges first installment and owns pending finite subscription', async (tier,count) => {
    const f = fixture(tier,count); let proposal: any, payload: any, pendingCreated=false;
    const db = { rpc: async () => ({ data: 'ORD-SYNTHETIC', error: null }), from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data:
        table === 'products_v2' ? { id: f.order.product_id, name: 'Synthetic' } : table === 'tariffs'
          ? { id: f.order.tariff_id, name: 'Synthetic', meta: { course_access: { kind: 'fixed_exclusive_end', timezone: 'Europe/Minsk', end_exclusive: '2027-04-30T21:00:00Z' } } }
          : { id: 'profile', email: 'synthetic@example.invalid' }, error: null }), insert: async () => ({error:null}) }; return q;
    } };
    const h = load('supabase/functions/_shared/create-payment-checkout.ts', {
      './zg27-checkout-guard.ts': { assertZg27Checkout: async () => ({ applicable: true, totalMinor: f.plan.total_minor, amounts: f.plan.amounts_minor.map(n=>n/100), accessEndExclusive: '2027-04-30T21:00:00Z' }), Zg27CheckoutError: class extends Error {} },
      './zg27-hosted-installments.ts': hosted, './zg27-subscription.ts': {ensureZg27PendingSubscription:async()=>{pendingCreated=true}}, './zg27-installments.ts': installment,
      './referral-checkout-discount.ts': referral, './checkout-discounts.ts': discount,
      './bepaid-credentials.ts': { getBepaidCredsStrict: async () => ({ test_mode: true }), isBepaidCredsError: () => false, createBepaidAuthHeader: () => 'synthetic' },
      './course-access-window.ts': { courseAccessEnd: () => new Date('2027-04-30T21:00:00Z'), courseAccessSnapshot: () => ({}) },
      './build-purchase-snapshot.ts': { buildPurchaseSnapshot: (v: any) => v },
      './crm-routing.ts': { resolveOrderRouting: async () => ({ ok: true, snapshot: {} }) },
      './pending-purchase.ts': { claimPendingPurchase: async (_db: any, row: any) => { proposal = row; return {order:{id:'order',meta:row.meta},attemptId:'attempt'}; },
        requestCheckoutProvider: async (_db: any,_id: string, fn: any) => fn(), finishCheckoutAttempt: async () => {} },
      './payment-checkout-lifetime.ts': { paymentCheckoutExpiresAt: () => '2026-11-20T00:00:00Z' },
      './access-alias-origin.ts': { resolvePublicReturnOrigin: () => 'https://synthetic.invalid' },
    }, { fetch: async (_url: string, request: any) => { expect(pendingCreated).toBe(true); payload = JSON.parse(request.body); return new Response(JSON.stringify({ checkout: { token:'synthetic', redirect_url:'https://synthetic.invalid/hosted' } })); } });
    const result = await h.exports.createPaymentCheckout({supabase:db,user_id:'user',product_id:f.order.product_id,tariff_id:f.order.tariff_id,
      offer_id:'offer',amount:f.plan.total_minor,payment_type:'subscription',meta_extra:f.order.meta});
    expect(result.success).toBe(true); expect(proposal.final_price).toBe(f.plan.total_minor/100); expect(proposal.purchase_snapshot.price).toBe(f.plan.total_minor/100);
    expect(payload.checkout.attempts).toBe(1);expect(payload.checkout.order.amount).toBe(f.plan.amounts_minor[0]); expect(payload.checkout.order.additional_data.contract).toEqual(['recurring']);
    expect(payload.checkout.additional_data).toBeUndefined(); expect(payload.checkout.settings.save_card_toggle).toBeUndefined();
    expect(h.effects).not.toHaveBeenCalled();
  });
  it('actual public creation returns a recipient-bound finite subscription TOTAL link after explicit agreement',async()=>{
    const f=fixture(); f.tables.products_v2=[{id:f.order.product_id,is_active:true}];
    f.tables.tariffs=[{id:f.order.tariff_id,product_id:f.order.product_id,is_active:true}];
    f.tables.tariff_offers=[{id:'offer',tariff_id:f.order.tariff_id,is_active:true,offer_type:'pay_now',amount:890,payment_method:'internal_installment',installment_count:3,
      installment_interval_days:30,first_payment_delay_days:0,tariffs:{id:f.order.tariff_id,product_id:f.order.product_id,is_active:true,products_v2:{id:f.order.product_id,is_active:true,status:'active'}}}];f.tables.payment_links=[];
    const db={...f.db,auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})},rpc:async()=>({data:{eligible:true,category:'repeat',policy_version:'zg27-v1'},error:null})};
    const h=load('supabase/functions/public-create-installment-link/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>db},'../_shared/zg27-policy.ts':{ZG27_PRODUCT_ID},
      '../_shared/sales-runtime/checkout-auth.ts':{cbAlumniOfferAllowed:async()=>true},
      '../_shared/zg27-checkout-guard.ts':checkoutGuard,'../_shared/zg27-installments.ts':installment,'../_shared/zg27-hosted-installments.ts':hosted,
      '../_shared/cors.ts':{jsonResponse:(body:any,status=200)=>new Response(JSON.stringify(body),{status}),errorResponse:(error:string,status:number)=>new Response(JSON.stringify({error}),{status})},
    });
    const response=await h.handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({
      product_id:f.order.product_id,tariff_id:f.order.tariff_id,offer_id:'offer',zg27_consent:f.raw})}));
    expect(response.status).toBe(200);expect(f.tables.payment_links).toHaveLength(1);
    expect(f.tables.payment_links[0]).toMatchObject({amount:89000,payment_type:'subscription',user_id:'user',meta:{zg27_schedule_consent:{accepted:true,user_id:'user'}}});
    expect(h.effects).not.toHaveBeenCalled();
    const get=load('supabase/functions/public-checkout/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>db},'../_shared/zg27-checkout-guard.ts':checkoutGuard,'../_shared/zg27-hosted-installments.ts':hosted,
      '../_shared/cors.ts':{jsonResponse:(body:any,status=200)=>new Response(JSON.stringify(body),{status}),errorResponse:(error:string,status:number)=>new Response(JSON.stringify({error}),{status})},
    });
    const target=`https://synthetic.invalid?token=${f.tables.payment_links[0].url_token}`;
    expect(await(await get.handler(new Request(target))).json()).toMatchObject({requires_auth:true,zg27_installment:null});
    expect(await(await get.handler(new Request(target,{headers:{Authorization:'Bearer synthetic'}}))).json()).toMatchObject({
      zg27_installment:{amounts_minor:[29667,29667,29666],total_minor:89000,interval_days:30}});
    expect(get.effects).not.toHaveBeenCalled();
  });
  it('actual webhook receipt/finalization boundary resumes handoff on replay and persists missing mandate',async()=>{
    const f=fixture(); const source=readFileSync('supabase/functions/bepaid-webhook/index.ts','utf8');
    // Execute the production LINK receipt+finalization block, including real handoff, with owned in-memory DB.
    const start=source.indexOf('      const linkPaymentAmount ='); const end=source.indexOf('      // 8. Admin purchase notification',start);
    expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
    const rpc=vi.fn(async()=>({data:{order_id:'order',payment_id:'pay',access_allowed:true,duplicate:true},error:null}));
    const tx={...f.tx,credit_card:{token:''}}; const access=vi.fn(async()=>new Response(JSON.stringify({ok:true})));
    const h=loadText(`Deno.serve(async(req)=>{try{${source.slice(start,end)};return new Response('ok')}catch(e){return new Response('retry',{status:500})}})`,{}, {
      supabase:{...f.db,rpc},linkOrderV2:f.order,linkProfile:{id:'profile'},transaction:tx,transactionUid:'receipt',transactionStatus:'successful',rawTrackingId:'link:order:order',
      paymentMethod:'card',body:{},parsedOrderId:'order',effectiveKind:'link',startTime:0,corsHeaders:{},
      validateZg27HostedMeta,handoffZg27HostedReceipt,requireZg27ActivatedSubscription,extractBepaidDescription:()=>null,
      applyCrmStageOnTerminal:async()=>{},consumePaymentLinkForOrder:async()=>{},
      fetch:access,
    });
    expect((await h.handler(new Request('https://synthetic.invalid'))).status).toBe(202);
    expect(f.order.meta).toMatchObject({zg27_mandate_state:'setup_failed',zg27_mandate_reason:'provider_token_missing'});
    expect(f.tables.installment_payments).toHaveLength(0);expect(access).not.toHaveBeenCalled();
    tx.credit_card.token='synthetic-owned-token';
    expect((await h.handler(new Request('https://synthetic.invalid'))).status).toBe(200);
    expect((await h.handler(new Request('https://synthetic.invalid'))).status).toBe(200);
    expect(f.tables.installment_payments).toHaveLength(3);expect(f.writes.filter(t=>t==='installment_payments')).toHaveLength(1);
    expect(f.order.meta).toMatchObject({zg27_mandate_state:'ready'});expect(rpc).toHaveBeenCalledTimes(3);expect(h.effects).not.toHaveBeenCalled();
  });
  it('actual async cron callback before HTTP response settles only owned finite receipt and aggregate',async()=>{
    const f=fixture(); await handoffZg27HostedReceipt(f.db,'order','pay',f.tx);
    f.tables.installment_payments.forEach((row,i)=>row.id=`row${i}`);
    const row=f.tables.installment_payments[1];row.status='processing';row.payment_id='pay2';
    const pending={id:'pay2',order_id:'order',user_id:'user',provider:'bepaid',provider_payment_id:null,status:'processing',amount:296.67,currency:'BYN',installment_number:2,
      meta:{type:'installment_auto_charge',installment_id:'row1',subscription_id:'sub'}};
    f.tables.payments_v2.push(pending);
    const db={...f.db,rpc:async(name:string,args:any)=>{
      if(name==='crm_settle_one_time_receipt') {Object.assign(pending,{status:'succeeded',paid_at:args.p_payment.paid_at});return{data:{payment_id:'pay2',order_id:'order',access_allowed:true},error:null};}
      if(name==='crm_refresh_paid_purchase') {Object.assign(f.order,{paid_amount:f.tables.payments_v2.filter(p=>p.status==='succeeded').reduce((sum,p)=>sum+p.amount,0)});return{data:true,error:null};}
      throw Error('unexpected RPC');
    }};
    const tx={uid:'receipt2',status:'successful',amount:29667,currency:'BYN',paid_at:'2026-12-18T12:00:00Z'};
    const source=readFileSync('supabase/functions/bepaid-webhook/index.ts','utf8');
    const start=source.indexOf('    // Finite ZG27 callbacks');const end=source.indexOf('    // B3: IDEMPOTENCY GUARD (main branch)',start);
    const grant=vi.fn(()=>{throw Error('must not enter generic grant/auto-renew/provider-sync')});
    const h=loadText(`Deno.serve(async()=>{${source.slice(start,end)};grant();return new Response('wrong')})`,{}, {
      paymentV2:pending,transactionStatus:'successful',transaction:tx,supabase:db,settleZg27InstallmentReceipt,corsHeaders:{},grant,
    });
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-12-18T12:01:00Z'));
    try{
      expect((await h.handler(new Request('https://synthetic.invalid'))).status).toBe(200);
      // The HTTP response now arrives for the same payment/UID. No additive paid_amount update.
      expect(await settleZg27InstallmentReceipt(db,'pay2',tx)).toMatchObject({applicable:true});
      expect(await settleZg27InstallmentReceipt(db,'pay2',tx)).toMatchObject({applicable:true});
    }finally{vi.useRealTimers()}
    expect((f.order as any).paid_amount).toBe(593.34);expect(row.status).toBe('succeeded');expect(f.tables.payments_v2).toHaveLength(2);
    expect(f.sub.auto_renew).toBe(false);expect(f.sub.status).toBe('active');expect(f.sub.access_end_at).toBe('2027-04-30T21:00:00Z');expect(grant).not.toHaveBeenCalled();
    const finalRow=f.tables.installment_payments[2];finalRow.status='processing';finalRow.payment_id='pay3';
    const finalPay={...pending,id:'pay3',provider_payment_id:null,status:'processing',amount:296.66,installment_number:3,
      meta:{type:'installment_auto_charge',installment_id:'row2',subscription_id:'sub'}};
    f.tables.payments_v2.push(finalPay);
    const finalDb={...f.db,rpc:async(name:string,args:any)=>{
      if(name==='crm_settle_one_time_receipt'){Object.assign(finalPay,{status:'succeeded',paid_at:args.p_payment.paid_at});return{data:{payment_id:'pay3',order_id:'order',access_allowed:true},error:null};}
      Object.assign(f.order,{paid_amount:f.tables.payments_v2.filter(p=>p.status==='succeeded').reduce((sum,p)=>sum+p.amount,0)});return{data:true,error:null};
    }};
    vi.useFakeTimers();vi.setSystemTime(new Date('2027-01-17T12:01:00Z'));
    try{await settleZg27InstallmentReceipt(finalDb,'pay3',{uid:'receipt3',status:'successful',amount:29666,currency:'BYN',paid_at:'2027-01-17T12:00:00Z'});}finally{vi.useRealTimers()}
    expect(Math.round((f.order as any).paid_amount*100)).toBe(89000);
    expect(f.tables.installment_payments.filter(r=>r.status==='pending'||r.status==='processing')).toHaveLength(0);
    expect((f.sub.meta as any).zg27_installment_orders.order.completed).toBe(true);expect((f.sub as any).next_charge_at).toBeNull();expect(f.sub.auto_renew).toBe(false);expect(f.sub.status).toBe('active');
  });
  it('finite subscription is pending without access and cannot grant before actual receipt/card binding',async()=>{
    const f=fixture();f.tables.subscriptions_v2=[];f.tables.entitlements=[];
    const sub=await ensureZg27PendingSubscription(f.db,f.order,'profile');
    expect(sub).toMatchObject({status:'past_due',auto_renew:false,billing_type:'mit',meta:{model:'zg27_application_managed_v1',zg27_setup:'pending_mandate'}});
    expect(f.tables.entitlements).toHaveLength(0);
    await expect(requireZg27ReadySubscription(f.db,f.order)).rejects.toThrow('zg27_subscription_not_ready');
    await handoffZg27HostedReceipt(f.db,'order','pay',f.tx);
    await expect(requireZg27ReadySubscription(f.db,f.order)).resolves.toMatchObject({status:'past_due'});
    await expect(requireZg27ActivatedSubscription(f.db,f.order)).rejects.toThrow('zg27_subscription_activation_incomplete');
  });
  it('actual declined second-payment callback never fails the funded order and obeys reserved retry count',async()=>{
    const f=fixture();await handoffZg27HostedReceipt(f.db,'order','pay',f.tx);(f.order as any).paid_amount=296.67;
    f.tables.installment_payments.forEach((r,i)=>r.id=`row${i}`);const row=f.tables.installment_payments[1];
    Object.assign(row,{status:'processing',payment_id:'attempt2',charge_attempts:1});
    const attempt={id:'attempt2',order_id:'order',user_id:'user',provider:'bepaid',provider_payment_id:null,status:'processing',amount:296.67,currency:'BYN',installment_number:2,
      meta:{type:'installment_auto_charge',installment_id:'row1',subscription_id:'sub'}};f.tables.payments_v2.push(attempt);
    const orderBefore=JSON.stringify(f.order),firstBefore=JSON.stringify(f.pay),subBefore=JSON.stringify(f.sub);
    const tx={uid:'declined2',status:'failed',amount:29667,currency:'BYN'};const source=readFileSync('supabase/functions/bepaid-webhook/index.ts','utf8');
    const start=source.indexOf('    // Finite ZG27 callbacks'),end=source.indexOf('    // B3: IDEMPOTENCY GUARD (main branch)',start);const generic=vi.fn(()=>{throw Error('generic failure path forbidden')});
    const rpc=vi.fn(()=>{throw Error('no financial success RPC on declined attempt')});
    const h=loadText(`Deno.serve(async()=>{${source.slice(start,end)};generic();return new Response('wrong')})`,{}, {
      paymentV2:attempt,transactionStatus:'failed',transaction:tx,supabase:{...f.db,rpc},settleZg27InstallmentReceipt,corsHeaders:{},generic,
    });
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-12-18T12:01:00Z'));
    try{
      expect((await h.handler(new Request('https://synthetic.invalid'))).status).toBe(200);
      expect((await h.handler(new Request('https://synthetic.invalid'))).status).toBe(200);
      expect(row.status).toBe('pending');expect(row.charge_attempts).toBe(1);expect(attempt.status).toBe('failed');
      Object.assign(row,{status:'processing',payment_id:'attempt3',charge_attempts:100});
      const retry={...attempt,id:'attempt3',status:'processing'};f.tables.payments_v2.push(retry);
      await settleZg27InstallmentReceipt({...f.db,rpc},'attempt3',{...tx,uid:'declined3'});
      expect(row.status).toBe('failed');expect(row.charge_attempts).toBe(100);
    }finally{vi.useRealTimers()}
    expect(JSON.stringify(f.order)).toBe(orderBefore);expect(JSON.stringify(f.pay)).toBe(firstBefore);expect(JSON.stringify(f.sub)).toBe(subBefore);
    expect(generic).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();expect(f.tables.payments_v2).toHaveLength(3);
  });
  it.each([true,false])('actual cron request contract and RequestID scope ZG27=%s',async scoped=>{
    const source=readFileSync('supabase/functions/installment-charge-cron/index.ts','utf8');
    const start=source.indexOf('        const chargePayload =');const end=source.indexOf('        const chargeResult =',start);
    const sent=vi.fn(async(_url:string,request:any)=>{
      const payload=JSON.parse(request.body);expect(payload.request.amount).toBe(29666);expect(payload.request.tracking_id).toBe('owned-payment');
      expect(payload.request.additional_data.contract).toEqual(scoped?['recurring']:['recurring','unscheduled']);
      expect(request.headers.RequestID).toBe(scoped?'owned-payment':undefined);return new Response('{}');
    });
    const h=loadText(`Deno.serve(async()=>{let providerRequestStarted=false;${source.slice(start,end)};return new Response('ok')})`,{}, {
      ZG27_PRODUCT_ID,subscription:{product_id:scoped?ZG27_PRODUCT_ID:'legacy'},installment:{id:'row',amount:296.66,payment_number:3,total_payments:3},
      payment:{id:'owned-payment'},currency:'BYN',productName:'Synthetic',testMode:true,effectiveToken:'synthetic-token',bepaidAuth:'synthetic',shopId:'synthetic',
      supabase:{from:()=>({insert:async()=>({error:null})})},fetch:sent,
    });
    expect((await h.handler(new Request('https://synthetic.invalid'))).status).toBe(200);expect(sent).toHaveBeenCalledOnce();expect(h.effects).not.toHaveBeenCalled();
  });
  it('freezes precise agreement and uses primary documented widget hierarchy', () => {
    const f = fixture(); const fields = zg27HostedWidgetFields();
    expect(fields.additional_data).toEqual({ contract: ['recurring'] });
    expect((fields as any).save_card_toggle).toBeUndefined();
    expect(validateZg27HostedMeta(f.order.meta, f.order.product_id, f.order.tariff_id, 'user')).toEqual(f.plan);
    expect(f.order.meta.zg27_schedule_consent.text).toContain('296.67 + 296.67 + 296.66');
  });
  it.each([{ accepted: false }, { total_minor: 90000 }, { amounts_minor: [29667,29667,29667] }, { interval_days: 31 }])('rejects incomplete/altered upfront consent %j', patch => {
    const f = fixture(); expect(() => freezeZg27Consent(f.plan, { ...f.raw, ...patch }, 'user')).toThrow('zg27_schedule_consent_required');
  });
  it('missing widget token remains recoverable without card/binding/schedule writes', async () => {
    const f = fixture(); f.tx.credit_card.token = '';
    expect(await handoffZg27HostedReceipt(f.db, 'order', 'pay', f.tx)).toEqual({ state: 'setup_failed', reason: 'provider_token_missing' }); expect(f.writes).toEqual([]); expect(f.tables.installment_payments).toHaveLength(0);
  });
  it('first verified receipt binds owned token and creates exact rows once on replay', async () => {
    const f = fixture(); expect(await handoffZg27HostedReceipt(f.db, 'order', 'pay', f.tx)).toEqual({ state: 'ready' });
    expect(await handoffZg27HostedReceipt(f.db, 'order', 'pay', f.tx)).toEqual({ state: 'ready' });
    expect(f.tables.payment_methods).toHaveLength(1); expect(f.tables.installment_payments.map(r => r.amount)).toEqual([296.67,296.67,296.66]);
    expect(f.writes.filter(t => t === 'installment_payments')).toHaveLength(1);
    expect(f.sub.access_end_at).toBe('2027-04-30T21:00:00Z'); expect(f.sub.auto_renew).toBe(false);
  });
  it('canonical grant extension provenance supports the same order without rewriting subscription.order_id', async () => {
    const f = fixture(); f.sub.order_id = 'older-order'; f.sub.meta = { extended_by_orders: ['order'] };
    expect(await handoffZg27HostedReceipt(f.db,'order','pay',f.tx)).toEqual({state:'ready'});
    expect(f.sub.order_id).toBe('older-order'); expect(f.tables.installment_payments).toHaveLength(3);
    expect((f.sub.meta as any).zg27_installment_orders.order.payment_id).toBe('pay');
  });
  it('an unrelated product subscription is never adopted', async () => {
    const f = fixture(); f.sub.order_id='other-order'; f.sub.meta={extended_by_orders:['unrelated']};
    expect(await handoffZg27HostedReceipt(f.db,'order','pay',f.tx)).toMatchObject({state:'setup_failed',reason:'canonical_subscription_missing'});
    expect(f.tables.installment_payments).toHaveLength(0);
  });
  it('expired access permits only a verified outstanding finite debt, without access mutation', async () => {
    const f=fixture(); await handoffZg27HostedReceipt(f.db,'order','pay',f.tx);
    f.sub.status='expired'; f.tables.installment_payments.forEach((row,i)=>row.id=`row${i}`);
    const before=JSON.stringify(f.sub); const writes=f.writes.length;
    const proof=await resolveZg27DebtToken(f.db,'sub','row1',new Date('2027-06-01T00:00:00Z'));
    expect(proof).toMatchObject({payment_method_id:'card'}); expect(JSON.stringify(f.sub)).toBe(before); expect(f.writes.length).toBe(writes);
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-06-01T00:00:00Z'));
    try { expect(await getSubscriptionToken(f.db,'sub','row1')).toMatchObject({source:'payment_methods',payment_method_id:'card'}); }
    finally {vi.useRealTimers()}
    expect(await getSubscriptionToken(f.db,'sub')).toMatchObject({skip:true});
  });
  it.each(['canceled','refunded','wrong-amount','foreign-card','missing-binding','first-row','other-order'] as const)('expired debt proof rejects %s',async kind=>{
    const f=fixture();await handoffZg27HostedReceipt(f.db,'order','pay',f.tx); f.sub.status='expired';
    f.tables.installment_payments.forEach((row,i)=>row.id=`row${i}`);
    if(kind==='canceled') f.sub.status='canceled'; if(kind==='refunded') f.pay.refunded_amount=1;
    if(kind==='wrong-amount') f.tables.installment_payments[1].amount=300;
    if(kind==='foreign-card') f.tables.payment_methods[0].user_id='foreign';
    if(kind==='missing-binding') (f.sub.meta as any).zg27_installment_orders={};
    if(kind==='other-order') f.tables.installment_payments[1].order_id='foreign';
    expect(await resolveZg27DebtToken(f.db,'sub',kind==='first-row'?'row0':'row1',new Date('2027-06-01T00:00:00Z'))).toBeNull();
  });
  it('actual grant boundary refuses expired fixed-window replays before access writes',async()=>{
    const f=fixture(); const source=readFileSync('supabase/functions/grant-access-for-order/index.ts','utf8');
    const start=source.indexOf('    const tariffId = order.tariff_id;'); const end=source.indexOf('    let paidAddonWindow:',start);
    expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
    const order={...f.order,product:{},tariff:{meta:{}},purchase_snapshot:{course_access:{kind:'fixed_exclusive_end',timezone:'Europe/Minsk',end_exclusive:'2027-04-30T21:00:00Z'}}};
    const writes=vi.fn();
    class FixedDate extends Date {constructor(value?:any){super(value??'2027-04-30T21:00:00Z')}}
    const h=loadText(`Deno.serve(async()=>{${source.slice(start,end)};writes();return new Response('allowed')})`,{}, {
      order,orderId:'order',productId:order.product_id,customAccessDays:null,customAccessEndAt:null,
      isCalendarMonthProduct:async()=>false,supabase:{},zg27FixedEnd,Date:FixedDate,corsHeaders:{},writes,
    });
    const r=await h.handler(new Request('https://synthetic.invalid'));expect(await r.json()).toMatchObject({skipped:true,reason:'zg27_fixed_access_expired'});
    expect(writes).not.toHaveBeenCalled();expect(h.effects).not.toHaveBeenCalled();
  });
  it('fixed cap replaces an overshoot while other products retain greatest-end merge',()=>{
    const end=new Date('2027-04-30T21:00:00Z');const snapshot={course_access:{kind:'fixed_exclusive_end',timezone:'Europe/Minsk',end_exclusive:end.toISOString()}};
    const f=fixture();const scoped=zg27FixedEnd({...f.order,purchase_snapshot:snapshot},{});
    expect(cappedZg27Merge('2027-12-01T00:00:00Z',new Date('2027-06-01T00:00:00Z'),scoped)).toBe(end.toISOString());
    expect(cappedZg27Merge('2027-12-01T00:00:00Z',end,null)).toBe('2027-12-01T00:00:00Z');
    expect(zg27FixedEnd({product_id:'other'},{})).toBeNull();
    expect(()=>zg27FixedEnd({...f.order,purchase_snapshot:{}},{})).toThrow('zg27_access_policy_invalid');
  });
  it('canonical grant does not select the default card for hosted finite checkout',async()=>{
    const source=readFileSync('supabase/functions/grant-access-for-order/index.ts','utf8');
    const start=source.indexOf('    const { data: userPaymentMethod } ='); const end=source.indexOf('    // PATCH-ORDER-BASED-SKIP-SUB:',start);
    const effects=vi.fn(()=>{throw Error('must not select default card A')});
    const h=loadText(`Deno.serve(async()=>{${source.slice(start,end)};return new Response(JSON.stringify({hasPaymentMethod,shouldAutoRenew}))})`,{}, {
      zg27End:new Date('2027-04-30T21:00:00Z'),order:{meta:{zg27_installment:{},payment_flow:'renewal_one_time'}},userId:'user',supabase:{from:effects},
    });
    expect(await(await h.handler(new Request('https://synthetic.invalid'))).json()).toEqual({hasPaymentMethod:false,shouldAutoRenew:false});expect(effects).not.toHaveBeenCalled();
  });
  it('verified CIT card B replaces only this order incidental canonical default A',async()=>{
    const f=fixture(); (f.sub as any).payment_method_id='default-A';f.sub.meta={granted_by:'grant-access-for-order',initial_order_id:'order'};
    expect(await handoffZg27HostedReceipt(f.db,'order','pay',f.tx)).toEqual({state:'ready'});
    expect(f.sub.payment_method_id).toBe('card');expect(f.tables.installment_payments).toHaveLength(3);
  });
  it.each(['this-order','other-order'] as const)('committed %s ZG27 mandate A cannot be replaced by CIT card B',async scope=>{
    const f=fixture(); (f.sub as any).payment_method_id='default-A';
    f.sub.meta={granted_by:'grant-access-for-order',initial_order_id:'order',zg27_hosted_recurring_consent:true,
      zg27_installment_orders:{[scope==='this-order'?'order':'older-order']:{payment_id:'prior-pay',payment_method_id:'default-A',policy_version:'zg27-v1'}}};
    expect(await handoffZg27HostedReceipt(f.db,'order','pay',f.tx)).toMatchObject({state:'setup_failed',reason:'mandate_binding_conflict'});
    expect(f.sub.payment_method_id).toBe('default-A');expect(f.tables.installment_payments).toHaveLength(0);
  });
  it('foreign-owned token is not adopted', async () => {
    const f = fixture(); f.tables.payment_methods.push({ id:'foreign', user_id:'other', provider:'bepaid', status:'active', provider_token:f.tx.credit_card.token });
    expect(await handoffZg27HostedReceipt(f.db,'order','pay',f.tx)).toMatchObject({state:'setup_failed',reason:'provider_token_ownership_conflict'}); expect(f.writes).toEqual([]);
  });
  it.each(['decline','foreign-user','refund','missing-consent'] as const)('blocks %s before token/binding writes', async kind => {
    const f = fixture();
    if(kind==='decline') f.tx.status='failed'; if(kind==='foreign-user') f.pay.user_id='other';
    if(kind==='refund') f.pay.refunded_amount=1; if(kind==='missing-consent') f.order.meta.zg27_schedule_consent.accepted=false;
    await expect(handoffZg27HostedReceipt(f.db,'order','pay',f.tx)).rejects.toThrow(); expect(f.writes).toEqual([]);
  });
});
