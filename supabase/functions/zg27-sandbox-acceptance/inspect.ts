import { CASES, requestId, validateInput, safeProviderCode, type Input } from './runner.ts';
export type InspectInput=Input&{operation:'inspect';index:number};
export function validateInspect(raw:unknown,now=Date.now()):InspectInput{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid_inspection');
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='case_id,index,operation,run_id,started_at'||v.operation!=='inspect')throw Error('invalid_inspection');
  const input=validateInput({run_id:v.run_id,case_id:v.case_id,started_at:v.started_at},now,7*24*3600000);
  if(!Number.isInteger(v.index)||(v.index as number)<0||(v.index as number)>=CASES[input.case_id].length)throw Error('invalid_inspection');
  return {...input,operation:'inspect',index:v.index as number};
}
const ENVELOPE_KEYS=['transaction','transactions','response','errors','error','message','status','checkout','code'] as const;
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
export function normalizeStatusResponse(data:unknown){
  const envelope_type=Array.isArray(data)?'array':record(data)?'object':'primitive';
  const envelope_keys=record(data)?ENVELOPE_KEYS.filter(k=>Object.hasOwn(data,k)):[];
  let response_shape='unrecognized',items:unknown[]=[];
  if(Array.isArray(data)){response_shape='raw_array';items=data}
  else if(record(data)){
    if(Array.isArray(data.transaction)){response_shape='transaction_array';items=data.transaction}
    else if(record(data.transaction)){response_shape='transaction_object';items=[data.transaction]}
    else if(Array.isArray(data.transactions)){response_shape='transactions_array';items=data.transactions}
    else if(Object.hasOwn(data,'uid')&&Object.hasOwn(data,'status')){response_shape='direct_transaction';items=[data]}
  }
  const candidate_count=Math.min(items.length,11); // 11 means more than the documented maximum ten.
  const candidates=items.slice(0,10).map(v=>record(v)&&Object.hasOwn(v,'transaction')?v.transaction:v);
  return {response_shape,envelope_type,envelope_keys,candidate_count,candidates};
}
async function boundedJson(response:Response){
  const reader=response.body?.getReader();if(!reader)throw Error('empty');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>65536){await reader.cancel();throw Error('oversize')}chunks.push(value);}
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength}
  return JSON.parse(new TextDecoder().decode(bytes));
}
/** Read-only reconciliation. Never calls runCase/makeRunner or any payment writer. */
export async function inspectCase(raw:InspectInput,options:{actorId:string;authorization:string;fetcher?:typeof fetch}){
  const input=validateInspect(raw);if(!options.actorId)throw Error('actor_required');
  const amount=CASES[input.case_id][input.index];
  const tracking=`zg27-sandbox:${await requestId(options.actorId,input.run_id,input.case_id,input.index)}`;
  const base={operation:'inspect' as const,case_id:input.case_id,index:input.index,amount_minor:amount,currency:'BYN',requests:1};
  let providerCode:string|undefined,provider_http_status:number|undefined;
  let diagnostic={response_shape:'unread',envelope_type:'primitive',envelope_keys:[] as string[],candidate_count:0};
  const unknown=(code:string)=>({...base,status:'unknown',test_confirmed:false,code,...diagnostic,...(provider_http_status?{provider_http_status}:{}),...(providerCode?{provider_code:providerCode}:{})});
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
  try{
    const response=await(options.fetcher??fetch)(`https://gateway.bepaid.by/v2/transactions/tracking_id/${encodeURIComponent(tracking)}`,{
      method:'GET',redirect:'error',signal:abort.signal,headers:{Authorization:options.authorization,Accept:'application/json','X-API-Version':'2'}});
    provider_http_status=response.status;
    if(!response.ok){diagnostic.response_shape='http_error';return unknown(response.status===401?'inspection_http_401':response.status===403?'inspection_http_403':response.status===404?'inspection_not_found':response.status>=500?'inspection_http_5xx':'inspection_http_other');}
    let data;try{data=await boundedJson(response)}catch{diagnostic.response_shape='malformed';return unknown('inspection_malformed_response')}
    const normalized=normalizeStatusResponse(data);
    const {candidates,...safe}=normalized;diagnostic=safe;
    if(diagnostic.response_shape==='unrecognized')return unknown('inspection_unknown_shape');
    if(diagnostic.candidate_count===0)return unknown('inspection_not_found');
    if(diagnostic.candidate_count>1)return unknown('inspection_ambiguous');
    if(!record(candidates[0])||Object.hasOwn(candidates[0],'transaction'))return unknown('inspection_unknown_shape');
    const tx=candidates[0];
    if(tx.test!==true)return unknown('provider_test_unconfirmed');
    providerCode=safeProviderCode(tx.code);
    if(tx.amount!==amount||tx.currency!=='BYN'||tx.tracking_id!==tracking)return unknown('provider_identity_mismatch');
    if(typeof tx.uid!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tx.uid))return unknown('provider_uid_invalid');
    if(typeof tx.status!=='string'||!['successful','failed','error','incomplete','pending','expired'].includes(tx.status))return unknown('provider_status_unknown');
    return {...base,...diagnostic,provider_http_status,status:'inspected',test_confirmed:true,provider_status:tx.status,tracking_verified:true,uid_suffix:tx.uid.slice(-8),
      ...(safeProviderCode(tx.code)?{provider_code:safeProviderCode(tx.code)}:{})};
  }catch{return unknown('inspection_result_unknown')}finally{clearTimeout(timer)}
}
