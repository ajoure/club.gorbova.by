/** Isolated provider TEST acceptance. No Supabase/DB dependency and no business writer. */
export const CASES = Object.freeze({
  first_1:[129000],first_2:[64500,64500],first_3:[43000,43000,43000],
  repeat_1:[89000],repeat_2:[44500,44500],repeat_3:[29667,29667,29666],
} as const);
export type CaseId=keyof typeof CASES;
export type Input={run_id:string;case_id:CaseId;started_at:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateInput(raw:unknown,now=Date.now(),maxAgeMs=3600000):Input {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid_case');
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='case_id,run_id,started_at'||typeof v.run_id!=='string'||!UUID.test(v.run_id)
    ||typeof v.case_id!=='string'||!Object.hasOwn(CASES,v.case_id)||typeof v.started_at!=='string')throw Error('invalid_case');
  const age=now-Date.parse(v.started_at);
  if(!Number.isFinite(age)||age< -120000||age>maxAgeMs)throw Error('run_expired');
  return v as Input;
}
export async function requestId(actorId:string,run:string,plan:string,index:number):Promise<string>{
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`zg27-sandbox-v1\n${actorId}\n${run}\n${plan}\n${index}`)));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const s=Array.from(bytes.slice(0,16),n=>n.toString(16).padStart(2,'0')).join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export function callbackUrl(base:string):string {
  const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('callback_unavailable');
  return `${url.origin}/functions/v1/zg27-sandbox-acceptance/callback`;
}
export function safeProviderCode(value:unknown):string|undefined{
  return typeof value==='string'&&/^[A-Z]\.\d{4}$/.test(value)?value:undefined;
}
// Export only names from our fixed request schema, never provider error values.
const REQUEST_FIELDS=['test','amount','currency','description','tracking_id','notification_url','return_url','duplicate_check',
  'credit_card','credit_card.number','credit_card.verification_value','credit_card.holder','credit_card.exp_month','credit_card.exp_year','credit_card.token',
  'customer','customer.ip','customer.email','additional_data','additional_data.contract'] as const;
export function validationFields(data:unknown):string[]{
  const found=new Set<string>();let visited=0;
  const visit=(v:unknown,path='',depth=0)=>{
    if(depth>4||++visited>128||!v||typeof v!=='object')return;
    if(Array.isArray(v)){for(const item of v.slice(0,32))visit(item,path,depth+1);return}
    for(const [key,value] of Object.entries(v).slice(0,64)){
      const name=(path?`${path}.${key}`:key).replace(/^request\./,'');
      if(REQUEST_FIELDS.some(f=>f===name)){found.add(name);visit(value,name,depth+1)}
      else if(key==='request')visit(value,'',depth+1);
      else if((key==='field'||key==='parameter')&&typeof value==='string'&&REQUEST_FIELDS.some(f=>f===value))found.add(value);
    }
  };
  if(data&&typeof data==='object'){
    const d=data as Record<string,unknown>;visit(d.errors);if(d.response&&typeof d.response==='object')visit((d.response as Record<string,unknown>).errors);
  }
  return REQUEST_FIELDS.filter(f=>found.has(f));
}
type Step={index:number;amount_minor:number;status:'successful';test:true;uid_suffix:string};
export type Result={case_id:CaseId;status:'passed'|'stopped';test_confirmed:boolean;requests:number;sum_minor:number;steps:Step[];
  interval_days:30;accelerated:true;code?:string;provider_code?:string;provider_http_status?:number;validation_fields:string[];coverage:'test_h2h_no_widget_3ds'};
export async function runCase(input:Input,options:{actorId:string;authorization:string;notificationUrl:string;fetcher?:typeof fetch}):Promise<Result>{
  validateInput(input);if(!options.actorId)throw Error('actor_required');
  if(!/^https:\/\/[^/]+\/functions\/v1\/zg27-sandbox-acceptance\/callback$/.test(options.notificationUrl))throw Error('callback_unavailable');
  const amounts=CASES[input.case_id];const steps:Step[]=[];const uids=new Set<string>();let token:string|undefined,requests=0,providerCode:string|undefined,providerHttpStatus:number|undefined;let fields:string[]=[];
  const result=(code?:string):Result=>({case_id:input.case_id,status:code?'stopped':'passed',test_confirmed:steps.length===amounts.length,
    requests,validation_fields:fields,...(providerHttpStatus?{provider_http_status:providerHttpStatus}:{}),sum_minor:steps.reduce((n,s)=>n+s.amount_minor,0),steps,interval_days:30,accelerated:true,coverage:'test_h2h_no_widget_3ds',...(code?{code}:{}),...(providerCode?{provider_code:providerCode}:{})});
  for(let index=0;index<amounts.length;index++){
    providerHttpStatus=undefined;fields=[];
    providerCode=undefined; // A previous successful step is not evidence for this attempt.
    const id=await requestId(options.actorId,input.run_id,input.case_id,index);
    // Public bePaid no-3DS test fixture only. Never accepts client card/token/body.
    const card=index===0?{number:'4200000000000000',verification_value:'123',holder:'John Doe',exp_month:'05',exp_year:'2028'}:{token};
    const payload={request:{test:true,amount:amounts[index],currency:'BYN',description:`ZG27 isolated TEST ${input.case_id} ${index+1}/${amounts.length}`,
      tracking_id:`zg27-sandbox:${id}`,return_url:'https://gorbova.by/admin/zg27-sandbox',notification_url:options.notificationUrl,duplicate_check:false,
      credit_card:card,customer:{ip:'127.0.0.1',email:'sandbox@example.invalid'},
      ...(amounts.length>1?{additional_data:{contract:['recurring']}}:{})}};
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),10000);
    try{
      requests++;
      const response=await(options.fetcher??fetch)('https://gateway.bepaid.by/transactions/payments',{
        method:'POST',redirect:'error',signal:abort.signal,headers:{Authorization:options.authorization,'Content-Type':'application/json',Accept:'application/json','X-API-Version':'2',RequestID:id},body:JSON.stringify(payload)});
      providerHttpStatus=response.status;
      const text=await response.text();if(text.length>65536)return result('provider_response_unknown');
      const data=JSON.parse(text),tx=data?.transaction;
      // Strict boolean gate checked BEFORE status/token or any next request.
      fields=validationFields(data);
      if(tx?.test!==true)return result('provider_test_unconfirmed');
      providerCode=safeProviderCode(tx.code);
      if(!response.ok)return result('provider_rejected');
      if(tx.status!=='successful')return result(tx.status==='incomplete'?'requires_3ds_or_async':'provider_not_successful');
      if(tx.amount!==amounts[index]||tx.currency!=='BYN'||tx.tracking_id!==payload.request.tracking_id)return result('provider_identity_mismatch');
      if(typeof tx.uid!=='string'||!UUID.test(tx.uid))return result('provider_uid_invalid');
      if(uids.has(tx.uid.toLowerCase()))return result('provider_uid_reused');uids.add(tx.uid.toLowerCase());
      steps.push({index:index+1,amount_minor:amounts[index],status:'successful',test:true,
        uid_suffix:tx.uid.slice(-8)});
      if(index===0&&amounts.length>1){
        if(typeof tx.credit_card?.token!=='string'||!tx.credit_card.token||tx.credit_card.token.length>2048)return result('test_token_missing');
        token=tx.credit_card.token;
      }
    }catch{return result('provider_result_unknown');}finally{clearTimeout(timer)}
  }
  return result();
}
/** Isolate-level single flight/cache; cross-isolate replay retains stable provider RequestID.
 * No automatic retry on ambiguity. The accepted client run age is only one hour (<24h retention).
 */
export function makeRunner(){
  const cache=new Map<string,{at:number;work:Promise<Result>}>();
  return(input:Input,options:Parameters<typeof runCase>[1])=>{
    validateInput(input);const now=Date.now();for(const[k,v]of cache)if(now-v.at>3600000)cache.delete(k);
    if(!options.actorId)throw Error('actor_required');
    const key=`${options.actorId}:${input.run_id}:${input.case_id}`,prior=cache.get(key);if(prior)return prior.work;
    if(cache.size>=128)throw Error('runner_busy');
    const work=runCase(input,options);cache.set(key,{at:now,work});return work;
  };
}
