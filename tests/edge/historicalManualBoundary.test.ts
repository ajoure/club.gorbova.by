import { describe,it,expect,vi } from 'vitest';
import { load } from './zg27-ingress-harness';
import { loadInstallmentRepaymentContext,quoteInstallmentRepayment } from '../../supabase/functions/_shared/installment-repayment-context';
import { mapOrderToPlan } from '../../src/hooks/useContactInstallmentsData';
import { handleExistingInstallmentRepaymentWebhook } from '../../supabase/functions/_shared/existing-installment-webhook';
const id='00000000-0000-4000-8000-000000000004';
const agreement={model:'historical_manual_installment',infinite:false,original_order_id:id,billing_cycles:2,
  per_payment_byn:1325,effective_total_byn:2650,first_payment_id:'receipt',interval_days:30,second_due_at:'2026-08-14T10:00:00Z'};
function fixture(){
  const order={id,user_id:'buyer',profile_id:'profile',product_id:'course',tariff_id:'tier',status:'partial',currency:'BYN',paid_amount:1325,
    meta:{installment:agreement,historical_manual_agreement_id:'saved'},updated_at:'2026-11-26',bepaid_subscription_id:null,
    payments_v2:[{id:'receipt',order_id:id,user_id:'buyer',currency:'BYN',status:'succeeded',amount:1325,provider:'bepaid',provider_payment_id:'original-uid',updated_at:'2026-07-15'}],provider_subscriptions:[]};
  const saved={id:'saved',order_id:id,profile_id:'profile',user_id:'buyer',first_payment_id:'receipt',total_byn:2650,per_payment_byn:1325,interval_days:30};
  const sub={id:'sub',order_id:id,user_id:'buyer',product_id:'course',tariff_id:'tier',status:'active',meta:{},updated_at:'2026-07-15'};
  const providers:any[]=[];const effect=vi.fn(()=>{throw Error('unexpected side effect');});
  const db={from(table:string){let child=false;const data=()=>table==='orders_v2'?(child?[]:order):table==='subscriptions_v2'?[sub]:table==='historical_manual_installments'?saved:providers;
    return {select(){return this;},eq(){return this;},in(){child=true;return this;},limit(){return Promise.resolve({data:data(),error:null});},
      maybeSingle(){return Promise.resolve({data:data(),error:null});},then(resolve:any){return Promise.resolve({data:data(),error:null}).then(resolve);},insert:effect,update:effect};}};
  return {db,order,saved,sub,providers,effect};
}
describe('historical manual repayment boundaries',()=>{
  it('loads genuine saved agreement without a provider and quotes only1325 remaining on same purchase',async()=>{
    const f=fixture();const c=await loadInstallmentRepaymentContext(f.db as never,id);
    expect(quoteInstallmentRepayment(c,{payment_type:'one_time',count:1})).toMatchObject({agreement_model:agreement.model,
      original_order_id:id,subscription_v2_id:'sub',total_minor:265000,paid_minor:132500,remaining_minor:132500,
      schedule_minor:[132500],changes_access:false,replaces_live_mandate:false});
    expect(()=>quoteInstallmentRepayment(c,{payment_type:'subscription',count:2})).toThrow('historical_manual_single_repayment_only');
    expect(()=>quoteInstallmentRepayment(c,{payment_type:'one_time',count:2})).toThrow('historical_manual_single_repayment_only');
    expect(f.effect).not.toHaveBeenCalled();
  });
  it('rejects a forged JSON marker, changed amount and a newly present provider',async()=>{
    for(const patch of [(f:ReturnType<typeof fixture>)=>{f.saved.id='other';},(f:ReturnType<typeof fixture>)=>{f.saved.total_byn=3000;},
      (f:ReturnType<typeof fixture>)=>{f.providers.push({state:'active'});}]){
      const f=fixture();patch(f);await expect(loadInstallmentRepaymentContext(f.db as never,id)).rejects.toThrow('historical_manual_agreement_mismatch');
      expect(f.effect).not.toHaveBeenCalled();
    }
  });
  it('projects manual debt and due date without inventing a provider or a monthly charge',()=>{
    const f=fixture();expect(mapOrderToPlan(f.order)).toMatchObject({model:agreement.model,effectiveTotal:2650,paidTotal:1325,
      remainingTotal:1325,totalCycles:2,paidCycles:1,nextChargeAt:agreement.second_due_at,uiStatus:'active'});
  });
  it('actual staff endpoint rejects an unauthenticated caller before any RPC or grant',async()=>{
    const effect=vi.fn();const h=load('supabase/functions/admin-historical-manual-installment/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>({rpc:effect})},'npm:@supabase/supabase-js@2/cors':{corsHeaders:{}},
      '../_shared/caller-user.ts':{getCallerUserId:async()=>null}});
    expect((await h.handler(new Request('https://synthetic.invalid',{method:'POST',body:'{}'}))).status).toBe(401);
    expect(effect).not.toHaveBeenCalled();expect(h.effects).not.toHaveBeenCalled();
  });
  it('actual staff preview never invokes grant; a claimed confirm/readback dispatch invokes it once',async()=>{
    let accessCalls=0;const grant=vi.fn(async()=>({data:{success:true},error:null}));
    const rpc=vi.fn(async(name:string)=>({data:name==='has_admin_section_access'?true:name==='admin_claim_historical_manual_access_v1'
      ? (++accessCalls===1?{state:'claimed',start_at:'2026-11-24T10:00:00Z',access_days:180}:{state:'complete'})
      : {success:true,confirmed:false,fingerprint:'checked'},error:null}));
    const h=load('supabase/functions/admin-historical-manual-installment/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>({rpc,functions:{invoke:grant}})},'npm:@supabase/supabase-js@2/cors':{corsHeaders:{}},
      '../_shared/caller-user.ts':{getCallerUserId:async()=> 'staff'}});
    const request=(action:string)=>new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action,order_id:id,profile_id:'profile'})});
    expect((await h.handler(request('preview'))).status).toBe(200);expect(grant).not.toHaveBeenCalled();
    expect((await h.handler(request('ensure_access'))).status).toBe(200);
    expect(grant).toHaveBeenCalledExactlyOnceWith('grant-access-for-order',{body:{orderId:id,customAccessStartAt:'2026-11-24T10:00:00Z',customAccessDays:180,
      extendFromCurrent:false,grantTelegram:false,grantGetcourse:false}});
    await h.handler(request('ensure_access'));expect(grant).toHaveBeenCalledOnce();expect(h.effects).not.toHaveBeenCalled();
  });
  it('actual manual webhook uses only atomic debt receipt RPC, never generic upsert/provider/grant',async()=>{
    const linkId='00000000-0000-4000-8000-000000000009';
    const rpc=vi.fn(async()=>({data:{success:true,reused:false,payment_id:'last'},error:null}));
    const upsert=vi.fn(()=>{throw Error('generic receipt mutation forbidden');});
    const db={rpc,from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:linkId,user_id:'buyer',
      meta:{repayment:{contract_version:1,agreement_model:agreement.model,original_order_id:id,preserves_purchase:true,
        changes_access:false,payment_type:'one_time',schedule_minor:[132500]}}},error:null})})};
    const input={supabase:db as never,body:{},rawTrackingId:`repayment:${linkId}:order:${id}`,
      transaction:{uid:'synthetic-paid-uid',status:'successful',type:'payment',amount:132500,currency:'BYN',paid_at:'2026-11-26T10:00:00Z'},
      subscription:null,upsertPayment:upsert,corsHeaders:{}};
    const response=await handleExistingInstallmentRepaymentWebhook(input);
    expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledExactlyOnceWith('record_historical_manual_repayment_v1',{
      p_link_id:linkId,p_provider_uid:'synthetic-paid-uid',p_amount_minor:132500,p_currency:'BYN',p_paid_at:'2026-11-26T10:00:00Z'});
    expect(upsert).not.toHaveBeenCalled();
    rpc.mockClear();await handleExistingInstallmentRepaymentWebhook({...input,transaction:{...input.transaction,status:'authorized'}});
    expect(rpc).not.toHaveBeenCalled();expect(upsert).not.toHaveBeenCalled();
  });
});
