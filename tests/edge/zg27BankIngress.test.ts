import {describe,it,expect,vi} from 'vitest';
import {load} from './zg27-ingress-harness';
import * as guard from '../../supabase/functions/_shared/zg27-checkout-guard';
import * as bank from '../../supabase/functions/_shared/zg27-bank-checkout';
import {materializeComposableOrderGroup} from '../../supabase/functions/_shared/materialize-composable-order-group';
import {ZG27_PRODUCT_ID,ZG27_TIERS} from '../../supabase/functions/_shared/zg27-policy';

function fixture(tier:'first'|'repeat',patch:any={}){
 const cfg=ZG27_TIERS[tier],id='00000000-0000-4000-8000-000000000001';
 const offer={id,tariff_id:cfg.tariffId,offer_type:'bank_installment',amount:cfg.totalMinor/100,is_active:true,payment_method:'full_payment',installment_count:1,meta:{bank_installment:{rr_runtime:{enabled:true,provider:'rr'}}},tariffs:{id:cfg.tariffId,name:'Synthetic',is_active:true,product_id:ZG27_PRODUCT_ID,products_v2:{id:ZG27_PRODUCT_ID,is_active:true,status:'active',currency:'BYN'}},...patch};
 const order:any={id:'00000000-0000-4000-8000-000000000002',user_id:'user',product_id:ZG27_PRODUCT_ID,tariff_id:cfg.tariffId,status:'pending',provider:'rr',currency:'BYN',final_price:cfg.totalMinor/100,meta:{flow:'rr_installment'},purchase_snapshot:null,updated_at:'version'};
 const writes:string[]=[],credit=vi.fn(()=>{throw Error('credits must not run')}),provider=vi.fn(async()=>({outcomeClass:'upstream_created',paymentUrl:'https://pay.rrllc.ru/synthetic',providerRequestId:'synthetic',rrStatusRaw:'new',http:{json:{}},status:200}));
 const rpc=vi.fn(async(name:string,args:any)=>{if(name==='zg27_purchase_eligibility_v1')return {data:{eligible:true,category:tier,policy_version:'zg27-v1'}};
 if(name==='rr_public_rate_limit_hit')return{data:true};
 if(name==='rr_get_or_create_pending_order'){writes.push('order');order.meta=args._meta;order.final_price=args._amount;return{data:[{order_id:order.id,was_reused:false,order_number:'SYNTHETIC'}]}};
 if(name==='materialize_composable_order_group')return{data:'group'};if(name==='rr_mark_call_started')return{data:{ok:true,state:'call_started'}};if(name==='rr_finalize_created_order')return{data:{state:'finalized'}};throw Error('unexpected RPC '+name)});
 const db:any={rpc,auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='tariff_offers'?offer:order}),insert:async()=>{writes.push(table);return{error:null}},update:(v:any)=>{writes.push(table);Object.assign(order,v);return q}};return q}};
 const quote={total:cfg.totalMinor/100,subtotal:cfg.totalMinor/100,currency:'BYN',selected_addon_offer_ids:[],items:[{role:'primary',product_name:'Synthetic',tariff_name:'Synthetic'}]};
 const h=load('supabase/functions/public-rr-installment-initiate/index.ts',{
 '../_shared/zg27-checkout-guard.ts':guard,'../_shared/zg27-bank-checkout.ts':bank,
 '../_shared/cors.ts':{jsonResponse:(v:any)=>Response.json(v),errorResponse:(error:string,status:number)=>Response.json({error},{status})},
 '../_shared/rr/rr-config.ts':{createServiceClient:()=>db,loadRRConfig:async()=>({mode:'test'})},
 '../_shared/rr/rr-adapter.ts':{rrCreateOrder:provider,redactRRResponse:()=>({})},
 '../_shared/crm-routing.ts':{resolveOrderRouting:async()=>({ok:true,snapshot:{pipeline_id:'pipeline',stage_on_pending:'pending'}})},
 '../_shared/resolve-composable-checkout.ts':{resolveComposableCheckout:async()=>quote,ComposableCheckoutError:class extends Error{}},
 '../_shared/materialize-composable-order-group.ts':{materializeComposableOrderGroup},
 '../_shared/composable-checkout.ts':{allocateComposablePayableTotal:(q:any)=>q},
 '../_shared/referral-checkout-discount.ts':{resolveReferralCheckoutDiscount:credit},
 '../_shared/referral-customer-credit.ts':{reserveReferralCustomerCredit:credit},
 '../_shared/sales-runtime/checkout-auth.ts':{cbAlumniOfferAllowed:async()=>true},
 },{TextEncoder});
 return{h,offer,order,rpc,provider,credit,writes,request:(body:any={})=>new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({tariff_offer_id:id,name:'Synthetic',phone:'123456789',email:'synthetic@example.invalid',...body})})};
}
describe('actual RR initiation uses canonical ZG bank branch',()=>{
 for(const tier of ['first','repeat'] as const)it(`${tier}: creates full-price pending bank application, freezes cap, no card-plan/credit/access writes`,async()=>{
  const f=fixture(tier);const response=await f.h.handler(f.request());expect(await response.json()).toMatchObject({order_id:f.order.id,reused:false});expect(response.status).toBe(200);
  expect(f.provider).toHaveBeenCalledOnce();expect(f.provider.mock.calls[0][1]).toMatchObject({amountMinor:ZG27_TIERS[tier].totalMinor,currency:'BYN'});expect(f.order.purchase_snapshot.course_access.end_exclusive).toBe('2027-04-30T21:00:00.000Z');expect(f.order.status).toBe('pending');
  expect(f.credit).not.toHaveBeenCalled();expect(f.writes).not.toContain('payments_v2');expect(f.writes).not.toContain('entitlements');expect(f.h.effects).not.toHaveBeenCalled();
 });
 for(const [name,patch,body,code]of [
 ['wrong price',{amount:1},{},'zg27_price_mismatch'],
 ['customer credit',{}, {customer_credit_requested_minor:1},'zg27_fixed_price_required'],
 ['addons',{}, {addon_offer_ids:['00000000-0000-4000-8000-000000000003']},'zg27_fixed_price_required'],
 ]as const)it(`${name} stops actual handler before application/provider/credit`,async()=>{
  const f=fixture('repeat',patch);const response=await f.h.handler(f.request(body));expect((await response.json()).error).toBe(code);expect(f.provider).not.toHaveBeenCalled();expect(f.credit).not.toHaveBeenCalled();expect(f.writes).toEqual([]);
 });
});
