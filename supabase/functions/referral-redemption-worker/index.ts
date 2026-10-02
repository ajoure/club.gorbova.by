import { createClient } from 'npm:@supabase/supabase-js@2';
import { requestHasServiceRoleKey } from '../_shared/service-request-auth.ts';
import { resolveAccessForOrder } from '../_shared/access-resolver.ts';
import { resolveProductAccessRules, syncSecondaryProductAccessForUser } from '../_shared/product-access-grants.ts';

// Internal worker only. Admin RPCs retain the real JWT actor; this endpoint can
// neither redeem a wallet nor cancel/charge a provider subscription.
Deno.serve(async(req)=>{
 const headers={'Content-Type':'application/json'};
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 if(!requestHasServiceRoleKey(req,key))return new Response(JSON.stringify({error:'unauthorized'}),{status:401,headers});
 const client=createClient(Deno.env.get('SUPABASE_URL')!,key);
 const body=await req.json().catch(()=>({}));
 const limit=Math.min(Math.max(Number(body.limit)||20,1),50);
 if(body.dry_run!==false){
  const {count,error}=await client.from('referral_redemption_outbox').select('id',{count:'exact',head:true}).neq('status','done');
  return new Response(JSON.stringify(error?{error:'preflight_failed'}:{dry_run:true,pending:count}),{status:error?500:200,headers});
 }
 const {data:events,error}=await client.rpc('referral_redemption_claim_outbox',{p_limit:limit});
 if(error)return new Response(JSON.stringify({error:'claim_failed'}),{status:500,headers});
 let done=0,failed=0;
 const invoke=async(name:string,payload:Record<string,unknown>)=>{
  const {data,error}=await client.functions.invoke(name,{body:payload});
  if(error||data?.error||data?.success===false||data?.ok===false||(data?.results??[]).some((r:Record<string,unknown>)=>r.error))throw new Error(`${name}_failed`);
  return data;
 };
 for(const event of events??[]){
  try{
   const {data:item,error:itemError}=await client.from('referral_redemption_items').select('*,redemption:referral_redemptions(user_id,profile_id,status)').eq('id',event.item_id).single();
   if(itemError||!item)throw new Error('item_read_failed');
   const r=item.redemption;const now=Date.now();
   const active=r.status==='completed'&&item.phase==='active'&&Date.parse(item.starts_at)<=now&&Date.parse(item.expires_at)>now;
   const resolution=await resolveAccessForOrder(client,{order_id:item.order_id,product_id:item.product_id,tariff_id:item.tariff_id,offer_id:item.offer_id,user_id:r.user_id,profile_id:r.profile_id});
   if(resolution.blocked_reasons.length)throw new Error('resolution_blocked');
   const {data:product,error:productError}=await client.from('products_v2').select('telegram_club_id').eq('id',item.product_id).single();
   if(productError)throw new Error('product_read_failed');
   const clubs=new Map<string,number|null>(resolution.club_grants.map(grant=>[grant.club_id,grant.duration_days]));
   if(product.telegram_club_id&&!clubs.has(product.telegram_club_id))clubs.set(product.telegram_club_id,null);
   if(active){
    const rules=await resolveProductAccessRules(client,item.product_id,item.tariff_id);
    const actions=await syncSecondaryProductAccessForUser(client,{userId:r.user_id,profileId:r.profile_id,sourceProductId:item.product_id,sourceTariffId:item.tariff_id,sourceSubscription:null,sourceEntitlementSource:{id:item.source_id,access_end_at:item.expires_at},rules,excludeOrderId:item.order_id,ctx:{sourceEventType:'admin',sourceSubjectType:'admin_action',sourceEventKeyPrefix:`referral:projection:${item.id}`,orderId:item.order_id,allowReduceAccess:false}});
    if(actions.some(action=>action.outcome==='failed'||action.outcome.startsWith('conflict_')))throw new Error('secondary_projection_failed');
    for(const [clubId,duration] of clubs){
     const expires=duration?new Date(Math.min(Date.parse(item.expires_at),Date.parse(item.starts_at)+duration*86400000)).toISOString():item.expires_at;
     if(Date.parse(expires)<=now)continue;
     await invoke('telegram-grant-access',{user_id:r.user_id,club_id:clubId,source:'referral_redemption',source_id:item.order_id,valid_until:expires,notify_customer:false});
    }
    // GetCourse is a separate provider: use its canonical idempotent adapter.
    // A configured offer is necessary; the adapter records skip vs failure.
    const {data:offer,error:offerError}=await client.from('tariff_offers').select('getcourse_offer_id').eq('id',item.offer_id).single();
    if(offerError)throw new Error('offer_read_failed');
    if(offer.getcourse_offer_id){
     const result=await invoke('getcourse-grant-access',{order_id:item.order_id,dry_run:false});
     if(result?.status==='failed')throw new Error('getcourse_projection_failed');
    }
   }else{
    // Existing commercial guard preserves overlapping sources. No force revoke.
    for(const [clubId] of clubs)await invoke('telegram-revoke-access',{user_id:r.user_id,club_id:clubId,source:'referral_redemption',reason:'referral_source_ended',is_manual:true,respect_remaining_access:true,notify_customer:false});
   }
   const {error:completeError}=await client.from('referral_redemption_outbox').update({status:'done',completed_at:new Date().toISOString(),leased_until:null,error_code:null}).eq('id',event.id).eq('status','processing');
   if(completeError)throw new Error('completion_readback_failed');
   done++;
  }catch(error){
   failed++;
   // Only controlled codes, never provider replies, contacts or signed URLs.
   const code=error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'projection_failed';
   await client.from('referral_redemption_outbox').update({status:'failed',error_code:code,leased_until:null,available_at:new Date(Date.now()+Math.min(3600000,60000*2**Math.min(event.attempts,6))).toISOString()}).eq('id',event.id);
  }
 }
 return new Response(JSON.stringify({done,failed}),{headers});
});
