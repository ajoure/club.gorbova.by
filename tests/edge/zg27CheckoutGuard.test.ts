import assert from 'node:assert/strict';
import { it } from 'vitest';
import { assertZg27Checkout, requireZg27Recipient } from '../../supabase/functions/_shared/zg27-checkout-guard';
const product='e71c0dbb-baf2-4b6c-a950-bf0f728708af',tariff='08059eb1-748a-4ad6-8283-e6f1efa2f40f';
function fixture(){
 const state: any={offer:{id:'synthetic-offer',tariff_id:tariff,amount:890,is_active:true,payment_method:'internal_installment',installment_count:3,tariffs:{id:tariff,product_id:product,is_active:true,products_v2:{id:product,is_active:true,status:'active'}}},eligibility:{eligible:true,category:'repeat',policy_version:'zg27-v1'},error:null,actor:'recipient',rpcCalls:0};
 const db={from(){return{select(){return this},eq(){return this},async maybeSingle(){return{data:state.offer,error:null}}}},async rpc(name,args){assert.equal(name,'zg27_purchase_eligibility_v1');assert.deepEqual(args,{p_user_id:'recipient',p_product_id:product});state.rpcCalls++;return{data:state.eligibility,error:state.error}},auth:{async getUser(){return{data:{user:{id:state.actor}},error:null}}}};
 const request={db,userId:'recipient',productId:product,tariffId:tariff,offerId:'synthetic-offer',now:new Date('2026-11-18T19:00:00Z')};return{state,db,request};
}
function test(name: string,run: () => Promise<void>) { it(name,run); }
await test('canonical quote preserves approved amounts',async()=>{const f=fixture();const q=await assertZg27Checkout(f.request);assert.deepEqual(q.amounts,[296.67,296.67,296.66]);assert.equal(q.pageSlug,'zg27povtor');assert.equal(q.totalMinor,89000)});
for(const [name,patch,code] of [
 ['no offer',{offerId:null},'zg27_offer_required'],['anonymous',{userId:null},'zg27_login_required'],
 ['forged product',{productId:'other'},'zg27_offer_invalid'],['forged tariff',{tariffId:'other'},'zg27_wrong_participation'],
 ['forged amount',{amountMinor:90000},'zg27_checkout_amount_mismatch'],['NaN amount',{amountMinor:NaN},'zg27_checkout_amount_mismatch'],
 ['first payment is not total',{amountMinor:29667},'zg27_checkout_amount_mismatch'],['client count cannot override offer',{installmentCount:2},'zg27_installment_count_mismatch'],
 ['wrong page',{pageSlug:'zg27pervoe'},'zg27_wrong_page'],['wrong currency',{currency:'RUB'},'zg27_price_mismatch'],
] as const)await test(name,async()=>{const f=fixture();await assert.rejects(()=>assertZg27Checkout({...f.request,...patch}),e=>e.code===code)});
await test('explicit first-payment scope',async()=>{const f=fixture();assert.equal((await assertZg27Checkout({...f.request,amountKind:'first_payment',amountMinor:29667})).applicable,true)});
for(const [name,mutate,code] of [
 ['inactive tariff',s=>s.offer.tariffs.is_active=false,'zg27_offer_inactive'],
 ['inactive product',s=>s.offer.tariffs.products_v2.is_active=false,'zg27_offer_inactive'],
 ['archived product',s=>s.offer.tariffs.products_v2.status='archived','zg27_offer_inactive'],
 ['unknown RPC',s=>s.error={message:'unavailable'},'zg27_eligibility_unavailable'],
 ['malformed RPC',s=>s.eligibility={eligible:true,category:'repeat'},'zg27_eligibility_unavailable'],
 ['inconsistent proof',s=>s.eligibility={eligible:false,category:'repeat',policy_version:'zg27-v1'},'zg27_eligibility_unavailable'],
 ['CB-only cannot borrow repeat price',s=>s.eligibility={eligible:true,category:'first',policy_version:'zg27-v1'},'zg27_wrong_participation'],
 ['outsider',s=>s.eligibility={eligible:false,category:'not_eligible',policy_version:'zg27-v1'},'zg27_not_eligible'],
 ['canonical stale price900',s=>s.offer.amount=900,'zg27_price_mismatch'],
 ['ambiguous joined tariffs',s=>s.offer.tariffs=[s.offer.tariffs],'zg27_offer_invalid'],
] as const)await test(name,async()=>{const f=fixture();mutate(f.state);await assert.rejects(()=>assertZg27Checkout(f.request),e=>e.code===code)});
await test('unrelated legacy no-offer path does not query eligibility',async()=>{const f=fixture();assert.deepEqual(await assertZg27Checkout({...f.request,productId:'other',tariffId:'other',offerId:null}),{applicable:false});assert.equal(f.state.rpcCalls,0)});
await test('unrelated product remains outside scoped gate',async()=>{const f=fixture();f.state.offer.tariffs.product_id='other';assert.deepEqual(await assertZg27Checkout({...f.request,productId:'other',tariffId:'other'}),{applicable:false});assert.equal(f.state.rpcCalls,0)});
await test('forwarded link still requires logged-in recipient',async()=>{const f=fixture();await assert.rejects(()=>requireZg27Recipient(new Request('https://example.test'),f.db,'recipient'),e=>e.code==='zg27_login_required');f.state.actor='other';await assert.rejects(()=>requireZg27Recipient(new Request('https://example.test',{headers:{Authorization:'Bearer synthetic-only'}}),f.db,'recipient'),e=>e.code==='zg27_recipient_mismatch');f.state.actor='recipient';await requireZg27Recipient(new Request('https://example.test',{headers:{Authorization:'Bearer synthetic-only'}}),f.db,'recipient')});


await test('invoice offers require explicit trusted admin opt-in', async () => {
 const f=fixture(); Object.assign(f.state.offer,{offer_type:'invoice',payment_method:'bank_transfer',installment_count:1});
 for (const allowAdminInvoice of [undefined,false]) {
  await assert.rejects(()=>assertZg27Checkout({...f.request,allowAdminInvoice}),e=>e.code==='zg27_invoice_unavailable'&&e.status===409);
 }
 const quote=await assertZg27Checkout({...f.request,allowAdminInvoice:true});
 assert.equal(quote.applicable,true); assert.equal(quote.invoiceAccess?.service_period_to,'2027-04-30');
});
