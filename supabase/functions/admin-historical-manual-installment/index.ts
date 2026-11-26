import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getCallerUserId } from '../_shared/caller-user.ts';

const json = (value: unknown, status=200) => new Response(JSON.stringify(value), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({error:'method_not_allowed'},405);
  const actor = await getCallerUserId(req,'admin-historical-manual-installment');
  if (!actor) return json({error:'unauthorized'},401);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data: allowed,error: authError}=await db.rpc('has_admin_section_access',{
    _user_id:actor,_section_code:'payments',_min_level:'edit',
  });
  if(authError || allowed!==true) return json({error:'forbidden'},403);
  const body=await req.json().catch(()=>null);
  if(!body || !['preview','confirm','ensure_access'].includes(body.action)) return json({error:'invalid_action'},400);
  if(body.action==='ensure_access') {
    const {data:claim,error}=await db.rpc('admin_claim_historical_manual_access_v1',{
      p_actor_id:actor,p_order_id:body.order_id,p_profile_id:body.profile_id,
    });
    if(error) return json({error:error.message},409);
    if(claim.state!=='claimed') return json({success:true,access:claim});
    // Durable dispatch claim is consumed once. An unknown HTTP outcome stays
    // blocked; retry observes the canonical subscription/entitlement first.
    const result=await db.functions.invoke('grant-access-for-order',{body:{
      orderId:body.order_id,customAccessStartAt:claim.start_at,customAccessDays:claim.access_days,
      extendFromCurrent:false,grantTelegram:false,grantGetcourse:false,
    }}).catch(()=>({data:null,error:{message:'unknown'}}));
    const {data:readback,error:readError}=await db.rpc('admin_claim_historical_manual_access_v1',{
      p_actor_id:actor,p_order_id:body.order_id,p_profile_id:body.profile_id,
    });
    return json({success:!readError && readback?.state==='complete',agreement_saved:true,
      access:readback ?? {state:'unknown'},error:readError?'access_readback_failed':
        readback?.state==='complete'?undefined:result.error?'access_outcome_unknown':'access_not_confirmed'},
      !readError && readback?.state==='complete'?200:202);
  }
  const {data,error}=await db.rpc('admin_historical_manual_installment_v1',{
    p_actor_id:actor,p_profile_id:body.profile_id,p_order_id:body.order_id,
    p_first_payment_id:body.first_payment_id,p_total_byn:body.total_byn,
    p_interval_days:body.interval_days,p_reason:body.reason,p_request_id:body.request_id,
    p_confirm:body.action==='confirm',p_expected_fingerprint:body.fingerprint ?? null,
  });
  if(error) return json({error:error.message},409);
  return json(data);
});
