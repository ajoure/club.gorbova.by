import { describe, expect, it, vi } from 'vitest';
import { assertZg27BankOptions, freezeZg27BankSnapshot } from '../../supabase/functions/_shared/zg27-bank-checkout';
import * as guard from '../../supabase/functions/_shared/zg27-checkout-guard';
import { ZG27_PRODUCT_ID, ZG27_TIERS } from '../../supabase/functions/_shared/zg27-policy';
import { load } from './zg27-ingress-harness';

describe('fixed-price existing RR checkout', () => {
  for (const patch of [{adjustment_amount:1},{customer_credit_requested_minor:1},{partner_bonus_requested_minor:1},{adjustment_amount:'bad'}]) it(`rejects ${JSON.stringify(patch)} before credits or bank request`,()=>{
    expect(()=>assertZg27BankOptions(patch,[])).toThrow('zg27_fixed_price_required');
  });
  it('rejects addons and permits the unchanged full total',()=>{
    expect(()=>assertZg27BankOptions({},['addon'])).toThrow();expect(()=>assertZg27BankOptions({customer_credit_requested_minor:0},[])).not.toThrow();
  });
  function frozen(patch: any={}) {
    const order:any={id:'order',user_id:'user',product_id:ZG27_PRODUCT_ID,tariff_id:ZG27_TIERS.repeat.tariffId,provider:'rr',status:'pending',currency:'BYN',final_price:890,meta:{flow:'rr_installment'},updated_at:'version',purchase_snapshot:{untouched:'keep'},...patch};
    const update=vi.fn((body:any)=>{order.purchase_snapshot=body.purchase_snapshot;return q});
    let writing=false;const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:writing?{id:order.id}:order,error:null})};
    const db={from:()=>({...q,update:(body:any)=>{writing=true;return update(body)}})};
    const input={orderId:order.id,userId:'user',productId:ZG27_PRODUCT_ID,tariffId:ZG27_TIERS.repeat.tariffId,totalMinor:89000};return {order,db,input,update};
  }
  it('freezes Apr30 while preserving existing snapshot and replay does not update again',async()=>{
    const f=frozen();await freezeZg27BankSnapshot(f.db,f.input);expect(f.order.purchase_snapshot).toEqual({untouched:'keep',course_access:{kind:'fixed_exclusive_end',timezone:'Europe/Minsk',end_exclusive:'2027-04-30T21:00:00.000Z'}});
    expect(f.update).toHaveBeenCalledOnce();
    const again=frozen({purchase_snapshot:f.order.purchase_snapshot});await freezeZg27BankSnapshot(again.db,again.input);expect(again.update).not.toHaveBeenCalled();
  });
  for(const patch of [{user_id:'foreign'},{status:'paid'},{final_price:889},{currency:'RUB'},{purchase_snapshot:{course_access:{end_exclusive:'2028-01-01'}}}])it(`does not rewrite incompatible existing order ${JSON.stringify(patch)}`,async()=>{
    const f=frozen(patch);await expect(freezeZg27BankSnapshot(f.db,f.input)).rejects.toThrow();expect(f.update).not.toHaveBeenCalled();
  });
});

describe('actual server bank quote alongside three existing plans',()=>{
  for(const tier of ['first','repeat'] as const)it(`${tier} returns full bank price and still exactly three card plans`,async()=>{
    const cfg=ZG27_TIERS[tier];
    const offers=[1,2,3,0].map(n=>({id:`offer-${n}`,tariff_id:cfg.tariffId,offer_type:n===0?'bank_installment':'pay_now',payment_method:n>1?'internal_installment':'full_payment',installment_count:n||1,amount:cfg.totalMinor/100,is_active:true,meta:n===0?{bank_installment:{rr_runtime:{enabled:true,provider:'rr'}}}:{},tariffs:{id:cfg.tariffId,product_id:ZG27_PRODUCT_ID,is_active:true,products_v2:{id:ZG27_PRODUCT_ID,is_active:true,status:'active'}}}));
    const db:any={auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc:async()=>({data:{eligible:true,category:tier,policy_version:'zg27-v1'}}),from:()=>{let id:string|undefined;const q:any={select:()=>q,eq:(k:string,v:string)=>{if(k==='id')id=v;return q},maybeSingle:async()=>({data:offers.find(o=>o.id===id)}),then:(ok:any)=>Promise.resolve({data:offers}).then(ok)};return q}};
    const h=load('supabase/functions/zg27-public-quote/index.ts',{'npm:@supabase/supabase-js@2':{createClient:()=>db},'../_shared/zg27-checkout-guard.ts':guard,'../_shared/zg27-policy.ts':{ZG27_PRODUCT_ID,ZG27_TIERS,ZG27_ACCESS_END_EXCLUSIVE:'2027-04-30T21:00:00.000Z'},'../_shared/cors.ts':{jsonResponse:(b:any)=>Response.json(b),errorResponse:(error:string,status:number)=>Response.json({error},{status})}});
    const response=await h.exports.handleZg27Quote(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({page_slug:cfg.page})}),db);
    expect(response.status).toBe(200);const result=await response.json();expect(result.offers).toHaveLength(3);expect(result.offers.map((o:any)=>o.amounts_minor.length)).toEqual([1,2,3]);expect(result.bank_offer).toEqual({offer_id:'offer-0',tariff_id:cfg.tariffId,total_minor:cfg.totalMinor,provider:'rr'});expect(h.effects).not.toHaveBeenCalled();
  });
});
