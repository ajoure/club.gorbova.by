/** Shared SMS.by boundary. A request whose outcome is unknown is never retried. */
export type SmsOutcome = { status: 'sent'|'failed'|'unknown'; external_id?: string; error?: string; cost?: number; segments?: number };
export const normalizeSmsPhone = (input: unknown): string|null => {
 const value=String(input??'').replace(/[^0-9+]/g,'');
 return /^\+?[0-9]{8,15}$/.test(value)?`+${value.replace(/^\+/,'')}`:null;
};
export async function smsConfiguration(db:any):Promise<{token:string;alphanameId:string;sender:string}> {
 const {data:integration,error}=await db.from('integrations').select('is_enabled').eq('provider','websms').maybeSingle();
 if(error||!integration?.is_enabled)throw Error('sms_integration_unavailable');
 const {data:rows,error:credentialsError}=await db.from('integration_credentials').select('config,secrets').eq('provider','websms');
 if(credentialsError)throw Error('sms_credentials_unavailable');
 const cfg=(rows||[]).reduce((a:any,r:any)=>({config:{...a.config,...r.config},secrets:{...a.secrets,...r.secrets}}),{config:{},secrets:{}});
 // Credentials may never turn this transport into an arbitrary URL fetcher.
 if(cfg.config.base_url&&new URL(cfg.config.base_url).origin!=='https://app.sms.by')throw Error('sms_provider_url_invalid');
 const token=String(cfg.secrets.token??cfg.secrets.apikey??'').trim();
 if(!token)throw Error('sms_credentials_unavailable');
 return {token,alphanameId:String(cfg.config.alphaname_id??'').trim(),sender:String(cfg.config.alphaname??cfg.config.sender??'').trim()};
}
export async function sendSmsByTransport(config:Awaited<ReturnType<typeof smsConfiguration>>,phone:string,text:string,fetcher:typeof fetch=fetch):Promise<SmsOutcome>{
 const normalized=normalizeSmsPhone(phone);if(!normalized||!text.trim()||text.length>1000)return {status:'failed',error:'sms_invalid_message'};
 const params=new URLSearchParams({token:config.token,message:text,phone:normalized.slice(1)});
 if(config.alphanameId)params.set('alphaname_id',config.alphanameId);
 try{
  const response=await fetcher(`https://app.sms.by/api/v1/sendQuickSMS?${params}`,{method:'POST',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000),redirect:'error'});
  const result=await response.json().catch(()=>null);
  // A provider receipt proves acceptance, not handset delivery.
  if(response.ok&&!result?.error&&result?.sms_id!=null&&/^[0-9]+$/.test(String(result.sms_id))){
   return {status:'sent',external_id:String(result.sms_id),cost:typeof result.cost==='number'?result.cost:undefined,segments:Number.isSafeInteger(result.parts)?result.parts:undefined};
  }
  if(response.status>=400&&response.status<500&&result?.error)return {status:'failed',error:'sms_provider_rejected'};
  if(response.ok&&result?.error)return {status:'failed',error:'sms_provider_rejected'};
  return {status:'unknown',error:'sms_provider_unconfirmed'};
 }catch{return {status:'unknown',error:'sms_transport_unknown'};}
}
export async function drainSmsBroadcastQueue(db:any,dispatchId?:string,fetcher:typeof fetch=fetch){
 // Config is checked before claiming. Once claimed a worker never requeues a message.
 const config=await smsConfiguration(db);
 const {data:rows,error}=await db.rpc('sms_broadcast_claim',{p_dispatch:dispatchId??null,p_limit:10});
 if(error)throw Error('sms_queue_claim_failed');
 const counts={sent:0,failed:0,unknown:0};
 for(const row of rows||[]){
  const outcome=await sendSmsByTransport(config,row.phone_e164,row.text,fetcher);
  const {error:saveError}=await db.from('sms_messages').update({...outcome,sender:config.sender||null,updated_at:new Date().toISOString()}).eq('id',row.id).eq('status','sending');
  if(saveError)throw Error('sms_result_persistence_unknown');
  counts[outcome.status]++;
 }
 // Only the existing cron drain reconciles accepted durable messages. A manual
 // dispatch remains scoped to its own request and never polls another batch.
 if(!dispatchId)await reconcileSmsDeliveries(db,config,fetcher);
 return counts;
}
export async function smsDispatchSummary(db:any,id:string){
 const {data,error}=await db.rpc('sms_broadcast_summary',{p_dispatch:id});
 if(error)throw Error('sms_dispatch_status_unavailable');
 return data;
}
/** Official SMS.by checkSMS is read-only. A missing timestamp never proves delivery. */
export async function readSmsDeliveryReceipt(config:Awaited<ReturnType<typeof smsConfiguration>>,externalId:string,fetcher:typeof fetch=fetch):Promise<{state:'delivered'|'pending'|'unknown';delivered_at?:number}>{
 if(!/^[1-9][0-9]*$/.test(externalId))return {state:'unknown'};
 const query=new URLSearchParams({token:config.token,sms_id:externalId});
 try{
  const response=await fetcher(`https://app.sms.by/api/v1/checkSMS?${query}`,{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(3000),redirect:'error'});
  const data=await response.json().catch(()=>null);
  if(!response.ok||String(data?.sms_id)!==externalId||data?.error)return {state:'unknown'};
  const value=data.delivered;
  const timestamp=typeof value==='number'?value:typeof value==='string'&&/^[0-9]+$/.test(value)?Number(value):NaN;
  if(Number.isSafeInteger(timestamp)&&timestamp>0)return {state:'delivered',delivered_at:timestamp};
  return {state:'pending'};
 }catch{return {state:'unknown'};}
}
export async function checkSmsDelivery(config:Awaited<ReturnType<typeof smsConfiguration>>,externalId:string,fetcher:typeof fetch=fetch):Promise<'delivered'|'pending'|'unknown'>{
 return (await readSmsDeliveryReceipt(config,externalId,fetcher)).state;
}
/** Reconcile at most five new durable rows. Legacy messages and uncertain sends
 * cannot enter this path, and checking a receipt never calls sendQuickSMS. */
export async function reconcileSmsDeliveries(db:any,config:Awaited<ReturnType<typeof smsConfiguration>>,fetcher:typeof fetch=fetch){
 const {data:rows,error}=await db.from('sms_messages').select('id,status,external_id,metadata')
  .not('dispatch_key','is',null).eq('status','sent').not('external_id','is',null)
  .order('updated_at',{ascending:true}).order('id',{ascending:true}).limit(5);
 if(error)throw Error('sms_status_queue_unavailable');
 let delivered=0;
 for(const row of (rows||[]).slice(0,5)){
  const receipt=await readSmsDeliveryReceipt(config,String(row.external_id),fetcher);
  const checkedAt=new Date().toISOString();
  const update:any={updated_at:checkedAt};
  if(receipt.state==='delivered'){
   // Preserve only the sanitized metadata created by this broadcast transport.
   const safeKeys=['campaign_id','template_id','run_id','self_test'];
   const metadata=Object.fromEntries(Object.entries(row.metadata||{}).filter(([key,value])=>safeKeys.includes(key)&&(value===null||typeof value==='string'||typeof value==='boolean')));
   update.status='delivered';update.metadata={...metadata,smsby_delivered_at:receipt.delivered_at,verified_at:checkedAt};
  }
  // Pending/unknown checks rotate this row fairly, without changing acceptance,
  // requeueing, clearing a receipt, or downgrading a concurrently delivered row.
  const {error:saveError}=await db.from('sms_messages').update(update).eq('id',row.id).eq('status','sent').eq('external_id',row.external_id);
  if(saveError)throw Error('sms_status_persistence_unavailable');
  if(receipt.state==='delivered')delivered++;
 }
 return {checked:Math.min((rows||[]).length,5),delivered};
}
