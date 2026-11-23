import { resolveSmsAudience, validateSmsAudienceFilters } from '../_shared/sms-audience.ts';
import { evaluateWebinarBroadcastGuards } from '../broadcast-audience-preview/webinarRegistration.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { auditBlockedAttempt } from '../_shared/broadcast-guards.ts';
import { normalizeSmsPhone, smsConfiguration, sendSmsByTransport, drainSmsBroadcastQueue, smsDispatchSummary, checkSmsDelivery } from '../_shared/sms-transport.ts';
const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-supabase-client-platform,x-supabase-client-platform-version,x-supabase-client-runtime,x-supabase-client-runtime-version','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(req.method!=='POST')return json(405,{error:'method_not_allowed'});
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const systemActor=req.headers.get('x-system-actor'),provided=req.headers.get('x-broadcast-internal-secret');
  const expected=Deno.env.get('BROADCAST_INTERNAL_SECRET')||Deno.env.get('BROADCAST_FORCE_SECRET')||'';
  const body=await req.json().catch(()=>null);if(!body)return json(400,{error:'invalid_json'});
  let actor:string|null=null,isSystem=false;
  if(systemActor||provided){if(systemActor!=='broadcast-dispatcher'||!expected||provided!==expected)return json(403,{error:'invalid_internal_actor'});isSystem=true;}
  else{
   const authorization=req.headers.get('Authorization')||'';if(!authorization.startsWith('Bearer '))return json(401,{error:'missing_auth'});
   const userClient=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}});
   const {data,error}=await userClient.auth.getUser();if(error||!data?.user)return json(401,{error:'invalid_jwt'});actor=data.user.id;
   const checks=await Promise.all(['admin','super_admin'].map(role=>db.rpc('has_role_v2',{_user_id:actor,_role_code:role})));
   const manage=await db.rpc('has_admin_section_access',{_user_id:actor,_section_code:'communication',_min_level:'manage'});
   if(!checks.some(r=>r.data===true)&&manage.data!==true){
    const employee=await db.rpc('has_role_v2',{_user_id:actor,_role_code:'employee'});
    if(['broadcast','test_self','process_sms_queue'].includes(body.action)||employee.data!==true)return json(403,{error:'communication_manage_required'});
   }
  }
  if(body.action==='status'){
   if(isSystem||!uuid(body.sms_id))return json(400,{error:'sms_status_id_required'});
   const {data:row,error}=await db.from('sms_messages').select('id,status,external_id').eq('id',body.sms_id).maybeSingle();
   if(error||!row)return json(404,{error:'sms_not_found'});
   let delivery=row.status==='delivered'?'delivered':'pending';
   if(row.status==='sent'&&row.external_id){
    delivery=await checkSmsDelivery(await smsConfiguration(db),row.external_id);
    if(delivery==='delivered'){const {error:updateError}=await db.from('sms_messages').update({status:'delivered',updated_at:new Date().toISOString()}).eq('id',row.id).eq('external_id',row.external_id).eq('status','sent');if(updateError)throw Error('sms_status_persistence_failed');}
   }
   return json(200,{sms_id:row.id,external_id:row.external_id,status:delivery==='delivered'?'delivered':row.status,delivery_status:delivery});
  }
  if(body.action==='process_sms_queue'){if(!isSystem)return json(403,{error:'internal_only'});return json(200,await drainSmsBroadcastQueue(db));}
  if(body.action==='broadcast'||body.action==='test_self'){
   const text=String(body.text??'').trim();
   const filters=body.filters&&typeof body.filters==='object'&&!Array.isArray(body.filters)?body.filters:{};
   try{validateSmsAudienceFilters(filters);}catch{return json(400,{error:'sms_filter_invalid'});}
   if(!isSystem&&Object.keys(filters).some(k=>k.startsWith('__')||k==='direct_user_ids'||k==='direct_profile_ids'))return json(400,{error:'sms_filter_invalid'});
   const self=body.action==='test_self';if(self&&isSystem)return json(403,{error:'self_test_requires_user'});
   if(body.dry_run===true){
    if(filters.education===undefined&&filters.webinar_registration===undefined){const {data,error}=await db.rpc('sms_broadcast_audience_count',{p_filters:filters});if(error)throw Error('sms_audience_unavailable');return json(200,{sms_count:Number(data||0)});}
    return json(200,{sms_count:(await resolveSmsAudience(db,filters)).length});
   }
   // Bot selection narrows Telegram only. Webinar/education restrictions are
   // enforced again by the same server-side audience intersection before enqueue.
   if(!isSystem&&!self){const guard=evaluateWebinarBroadcastGuards({filters:{...filters,bot_ids:[]},messageText:text,isDryRun:body.dry_run===true,isTestSelf:false,allowFullAudience:body.allow_full_audience===true,confirmFullAudienceText:body.confirm_full_audience_text??null});if(guard.blocked){await auditBlockedAttempt({supabase:db,channel:'sms',actorUserId:actor,isSystemActor:false,reason:guard.reason,filters,messageText:text});return json(400,{error:guard.reason,message:guard.message});}}
   if(!text||text.length>1000)return json(400,{error:'sms_text_invalid'});
   if(!uuid(body.request_id))return json(400,{error:'sms_request_id_required'});
   await smsConfiguration(db);
   const metadata={campaign_id:uuid(body.analytics_campaign_id)?body.analytics_campaign_id:null,template_id:uuid(body.analytics_template_id)?body.analytics_template_id:null,run_id:uuid(body.analytics_run_id)?body.analytics_run_id:null,self_test:self};
   const {data,error}=await db.rpc('sms_broadcast_enqueue',{p_id:body.request_id,p_key:body.request_id,p_actor:actor,p_text:text,p_filters:filters,p_meta:metadata,p_self:self,p_eligible:self?null:(await resolveSmsAudience(db,filters)).map(r=>r.profile_id)});
   if(error)throw Error(error.message?.includes('sms_request_conflict')?'sms_request_conflict':'sms_enqueue_failed');
   if(!data.existing)await drainSmsBroadcastQueue(db,data.dispatch_id);
   return json(200,await smsDispatchSummary(db,data.dispatch_id));
  }
  // Existing contact-card/integrations send remains available; it uses the same provider boundary.
  if(isSystem)return json(403,{error:'unsupported_internal_action'});
  const text=String(body.text??'').trim();if(!text||text.length>1000)return json(400,{error:'sms_text_invalid'});
  const recipients=Array.isArray(body.recipients)?body.recipients:body.phone?[body]:[];
  if(!recipients.length||recipients.length>500)return json(400,{error:'sms_recipients_invalid'});
  const companyIds=[...new Set(recipients.map((r:any)=>r.company_id).filter(Boolean))];
  if(companyIds.length){const {data:companies,error}=await db.from('companies').select('id,status').in('id',companyIds);if(error)return json(500,{error:'company_lookup_failed'});const active=new Set((companies||[]).filter((c:any)=>c.status==='active').map((c:any)=>c.id));if(companyIds.some(id=>!active.has(id)))return json(404,{error:'company_not_found'});}
  const config=await smsConfiguration(db);let sent=0,failed=0,unknown=0;const ids:string[]=[];
  for(const recipient of recipients){
   const phone=normalizeSmsPhone(recipient.phone);if(!phone){failed++;continue;}
   const {data:row,error}=await db.from('sms_messages').insert({phone_e164:phone,text,contact_id:recipient.contact_id??null,company_id:recipient.company_id??null,deal_id:recipient.deal_id??null,provider:'smsby',status:'sending',initiator_user_id:actor}).select('id').single();if(error)throw Error('sms_insert_failed');
   ids.push(row.id);const outcome=await sendSmsByTransport(config,phone,text);
   const {error:saveError}=await db.from('sms_messages').update({...outcome,sender:config.sender||null,updated_at:new Date().toISOString()}).eq('id',row.id).eq('status','sending');if(saveError)throw Error('sms_result_persistence_unknown');
   if(outcome.status==='sent')sent++;else if(outcome.status==='failed')failed++;else unknown++;
  }
  return json(200,{ok:sent>0,count:sent,sent,failed,unknown,sms_ids:ids,delivery_status:'not_confirmed'});
 }catch(error){const code=error instanceof Error&&/^sms_[a-z_]+$/.test(error.message)?error.message:'sms_operation_failed';return json(500,{error:code});}
});
