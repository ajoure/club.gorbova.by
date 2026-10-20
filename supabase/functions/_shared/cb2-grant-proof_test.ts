import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { syncSecondaryProductAccessForUser } from './product-access-grants.ts';
import { CB2_PRODUCT_ID } from './cb2-access-window.ts';

for (const evidence of ['verified','rejected','unavailable'] as const) {
  Deno.test(`CB2 grant uses canonical proof despite a paid-looking cached row: ${evidence}`, async () => {
    let proofCalls=0;
    const client={
      from(table:string) {
        if(table==='products_v2') return {select:()=>({in:()=>Promise.resolve({data:[{id:CB2_PRODUCT_ID,code:'cb2'}]})})};
        if(table==='entitlements') return {select:()=>({eq:()=>({eq:()=>Promise.resolve({data:[]})})})};
        throw new Error(`Unexpected mutation/query: ${table}`);
      },
      rpc(name:string) {
        assertEquals(name,'get_cb2_access_window');proofCalls++;
        return Promise.resolve({data:evidence==='unavailable'?null:{has_access:false,effective_end_at:null,source_kind:null,
          has_prior_purchase:evidence==='verified',prior_order_id:'canonical-order',prior_tariff_id:'canonical-tariff'},
          error:evidence==='unavailable'?{code:'unavailable'}:null});
      },
    };
    const result=await syncSecondaryProductAccessForUser(client as never,{
      userId:'synthetic-buyer',sourceProductId:'club',sourceTariffId:'business',
      sourceSubscription:{id:'club-subscription',access_end_at:'2099-01-01T00:00:00Z'},
      rules:[{id:'rule',product_id:'club',tariff_id:'business',duration_days:null,scope:'tariff',
        conditions:{condition_type:'prior_purchase',match_mode:'per_product',target_product_ids:[CB2_PRODUCT_ID]}}],
      priorPurchaseCache:new Map([['synthetic-buyer',new Map([[CB2_PRODUCT_ID,{match_type:'direct' as const,order_id:'untrusted-cache',
        historical_purchase_type:'base_tariff_purchase' as const,historical_tariff_id:null,historical_module_product_ids:[]}]])]]),
      ctx:{dryRun:true,sourceEventType:'cron',sourceSubjectType:'subscription',sourceEventKeyPrefix:'synthetic-test'},
    });
    assertEquals(proofCalls,1);
    assertEquals(result[0].outcome,evidence==='verified'?'granted':evidence==='rejected'?'condition_not_met':'failed');
    if(evidence==='verified')assertEquals(result[0].planned_meta?.prior_purchase_order_id,'canonical-order');
  });
}
