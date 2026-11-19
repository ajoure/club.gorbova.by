import { CASES, requestId, validateInput, validationFields, type Input } from './runner.ts';
import { zg27HostedWidgetFields } from '../_shared/zg27-hosted-installments.ts';
export type HostedInput=Input&{operation:'hosted_create'|'hosted_inspect'|'hosted_finish_test';checkout_token?:string};
const TOKEN=/^[a-f0-9]{64}$/i,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RETURN='https://gorbova.by/admin/zg27-sandbox?mode=hosted';
export function validateHosted(raw:unknown,now=Date.now()):HostedInput{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid_hosted_input');
  const v=raw as Record<string,unknown>,create=v.operation==='hosted_create';
  if(!['hosted_create','hosted_inspect','hosted_finish_test'].includes(String(v.operation))
    ||Object.keys(v).sort().join(',')!==(create?'case_id,operation,run_id,started_at':'case_id,checkout_token,operation,run_id,started_at'))throw Error('invalid_hosted_input');
  const base=validateInput({run_id:v.run_id,case_id:v.case_id,started_at:v.started_at},now,v.operation==='hosted_inspect'?7*86400000:3600000);
  if(!create&&(typeof v.checkout_token!=='string'||!TOKEN.test(v.checkout_token)))throw Error('invalid_checkout_token');
  return {...base,operation:v.operation as HostedInput['operation'],...(create?{}:{checkout_token:v.checkout_token as string})};
}
type Options={actorId:string;authorization:string;notificationUrl:string;fetcher?:typeof fetch};
type RecordValue=Record<string,any>;
const record=(v:unknown):v is RecordValue=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const VERIFICATION_FIELDS=['test','type','token','tracking','amount','currency','finished','expired','contract'] as const;
type VerificationField=typeof VERIFICATION_FIELDS[number];
/** Private typed failure. It never retains a provider body, error values or request identity. */
class HostedFailure extends Error{
  readonly provider_http_status?:number;
  readonly validation_fields:string[];
  readonly verification_fields:VerificationField[];
  constructor(code:string,metadata:{provider_http_status?:number;validation_fields?:string[];verification_fields?:VerificationField[]}={}){
    super(code);
    this.provider_http_status=Number.isInteger(metadata.provider_http_status)&&metadata.provider_http_status!>=100&&metadata.provider_http_status!<=599?metadata.provider_http_status:undefined;
    this.validation_fields=(metadata.validation_fields??[]).slice(0,24);
    this.verification_fields=VERIFICATION_FIELDS.filter(field=>metadata.verification_fields?.includes(field));
  }
}
async function provider(url:string,init:RequestInit,options:Options){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
  try{
    // Gateway rejects a JSON Content-Type on bodyless status GETs; JSON POSTs retain it.
    const response=await(options.fetcher??fetch)(url,{...init,redirect:'error',signal:abort.signal,headers:{Authorization:options.authorization,Accept:'application/json',...(init.body==null?{}:{'Content-Type':'application/json'}),'X-API-Version':'2',...init.headers}});
    const reader=response.body?.getReader();if(!reader)throw new HostedFailure('provider_unknown',{provider_http_status:response.status});let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new HostedFailure('provider_unknown',{provider_http_status:response.status})}chunks.push(value)}}finally{reader.releaseLock()}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
    if(response.status===404)return {notFound:true as const,provider_http_status:response.status};
    let data;try{data=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new HostedFailure(response.ok?'provider_result_unknown':'provider_http_unconfirmed',{provider_http_status:response.status})}
    if(!response.ok)throw new HostedFailure('provider_http_unconfirmed',{provider_http_status:response.status,validation_fields:validationFields(data)});
    return {data,provider_http_status:response.status};
  }finally{clearTimeout(timer)}
}
async function binding(input:HostedInput,actorId:string,index=0){
  const id=await requestId(actorId,input.run_id,`hosted_${input.case_id}`,index);
  return {id,tracking:`zg27-sandbox:hosted:${id}`};
}
export async function hostedPayload(input:HostedInput,actorId:string,notificationUrl:string){
  const {tracking}=await binding(input,actorId),amounts=CASES[input.case_id];
  return {checkout:{test:true,transaction_type:'payment',attempts:1,
    settings:{return_url:RETURN,success_url:RETURN,decline_url:RETURN,fail_url:RETURN,notification_url:notificationUrl,language:'ru'},
    order:{amount:amounts[0],currency:'BYN',description:`ZG27 isolated hosted TEST ${input.case_id}`,tracking_id:tracking,
      additional_data:amounts.length>1?zg27HostedWidgetFields().additional_data:{}},
    customer:{email:'sandbox@example.invalid'}}};
}
function assertTx(tx:unknown,tracking:string,amount:number):RecordValue{
  if(!record(tx)||tx.test!==true||tx.type!=='payment'||tx.tracking_id!==tracking||tx.amount!==amount||tx.currency!=='BYN'
    ||typeof tx.uid!=='string'||!UUID.test(tx.uid))throw Error('receipt_unconfirmed');
  if(tx.status!=='successful')throw Error(tx.status==='incomplete'||tx.status==='pending'?'receipt_pending':'receipt_failed');
  return tx;
}
async function transaction(tracking:string,amount:number,options:Options){
  const r=await provider(`https://gateway.bepaid.by/v2/transactions/tracking_id/${encodeURIComponent(tracking)}`,{method:'GET'},options);
  if(r.notFound)return null;
  const d=r.data;const list=Array.isArray(d)?d:Array.isArray(d?.transaction)?d.transaction:Array.isArray(d?.transactions)?d.transactions:[d?.transaction];
  if(list.length===0)return null;if(list.length!==1)throw Error('receipt_ambiguous');
  const tx=record(list[0])&&record(list[0].transaction)?list[0].transaction:list[0];return assertTx(tx,tracking,amount);
}
async function checkout(input:HostedInput,options:Options){
  const r=await provider(`https://checkout.bepaid.by/ctp/api/checkouts/${input.checkout_token}`,{method:'GET'},options);
  const c=r.data?.checkout,{tracking}=await binding(input,options.actorId);
  const contract=c?.order?.additional_data?.contract;
  const checks:Record<VerificationField,boolean>={
    test:record(c)&&c.test===true,type:record(c)&&c.transaction_type==='payment',token:record(c)&&c.token===input.checkout_token,
    tracking:record(c)&&c.order?.tracking_id===tracking,amount:record(c)&&c.order?.amount===CASES[input.case_id][0],currency:record(c)&&c.order?.currency==='BYN',
    finished:record(c)&&typeof c.finished==='boolean',expired:record(c)&&typeof c.expired==='boolean',
    contract:CASES[input.case_id].length>1?JSON.stringify(contract)===JSON.stringify(['recurring']):contract===undefined||JSON.stringify(contract)==='[]',
  };
  const failed=VERIFICATION_FIELDS.filter(field=>!checks[field]);
  if(failed.length)throw new HostedFailure('checkout_unconfirmed',{provider_http_status:r.provider_http_status,verification_fields:failed});
  return c;
}
async function firstReceipt(input:HostedInput,options:Options){
  const c=await checkout(input,options);
  if(c.expired===true)throw Error('checkout_expired');
  if(c.finished!==true)throw Error('awaiting_customer');
  if(c.status!=='successful')throw Error('receipt_failed');
  const uid=c.gateway_response?.payment?.uid;if(typeof uid!=='string'||!UUID.test(uid))throw Error('receipt_unconfirmed');
  const r=await provider(`https://gateway.bepaid.by/transactions/${uid}`,{method:'GET'},options);
  const {tracking}=await binding(input,options.actorId);const tx=assertTx(r.data?.transaction,tracking,CASES[input.case_id][0]);
  if(tx.uid!==uid)throw Error('receipt_unconfirmed');return tx;
}
const CODES=new Set(['provider_unknown','provider_http_unconfirmed','receipt_unconfirmed','receipt_pending','receipt_failed','receipt_ambiguous','checkout_unconfirmed','checkout_expired','awaiting_customer','mandate_missing','provider_uid_reused']);
async function execute(input:HostedInput,options:Options){
  const amounts=CASES[input.case_id],base={operation:input.operation,case_id:input.case_id,coverage:'hosted_test_no_business_writes',interval_days:30,accelerated:true};
  try{
    if(input.operation==='hosted_create'){
      const payload=await hostedPayload(input,options.actorId,options.notificationUrl);
      const {id}=await binding(input,options.actorId);
      const r=await provider('https://checkout.bepaid.by/ctp/api/checkouts',{method:'POST',headers:{RequestID:id},body:JSON.stringify(payload)},options);
      const token=r.data?.checkout?.token;if(typeof token!=='string'||!TOKEN.test(token))throw new HostedFailure('checkout_unconfirmed',{provider_http_status:r.provider_http_status,verification_fields:['token']});
      // Payment token is public browser transport. Card token never leaves this module.
      const verified=await checkout({...input,checkout_token:token},options);if(verified.expired)throw Error('checkout_expired');
      return {...base,status:'hosted_ready',test_confirmed:true,checkout_token:token,checkout_url:`https://checkout.bepaid.by/v2/checkout?token=${token}`};
    }
    const first=await firstReceipt(input,options),uids=new Set<string>([first.uid.toLowerCase()]);
    if(amounts.length>1&&(typeof first.credit_card?.token!=='string'||!first.credit_card.token.trim()||first.credit_card.token.length>2048))throw Error('mandate_missing');
    let confirmed=1,sum=amounts[0] as number;
    for(let index=1;index<amounts.length;index++){
      const {id,tracking}=await binding(input,options.actorId,index);
      let tx=await transaction(tracking,amounts[index],options);
      if(!tx){
        if(input.operation==='hosted_inspect')return {...base,status:'first_verified',test_confirmed:true,confirmed_payments:confirmed,sum_minor:sum};
        const payload={request:{test:true,amount:amounts[index],currency:'BYN',description:`ZG27 hosted TEST ${input.case_id} ${index+1}/${amounts.length}`,
          tracking_id:tracking,notification_url:options.notificationUrl,return_url:RETURN,duplicate_check:false,
          credit_card:{token:first.credit_card.token},additional_data:{contract:['recurring']}}};
        const r=await provider('https://gateway.bepaid.by/transactions/payments',{method:'POST',headers:{RequestID:id},body:JSON.stringify(payload)},options);
        tx=assertTx(r.data?.transaction,tracking,amounts[index]);
      }
      if(uids.has(tx.uid.toLowerCase()))throw Error('provider_uid_reused');uids.add(tx.uid.toLowerCase());confirmed++;sum+=amounts[index];
    }
    return {...base,status:'passed',test_confirmed:true,confirmed_payments:confirmed,sum_minor:sum};
  }catch(error){const code=error instanceof Error&&CODES.has(error.message)?error.message:'provider_result_unknown';
    return {...base,status:code==='awaiting_customer'?'awaiting_customer':'stopped',test_confirmed:false,checkout_verified:code==='awaiting_customer',code,
      ...(error instanceof HostedFailure?{...(error.provider_http_status?{provider_http_status:error.provider_http_status}:{}),validation_fields:error.validation_fields,verification_fields:error.verification_fields}:{})};}
}
/** Single-flight only; browser persists started stages and never retries an uncertain POST.
 * H2H cross-isolate replay additionally checks existing exact receipts and stable RequestID (<24h).
 * A lost hosted_create response cannot be recreated safely and remains stopped.
 */
export function makeHostedRunner(){
  const cache=new Map<string,{at:number;work:ReturnType<typeof execute>}>();
  return(raw:HostedInput,options:Options)=>{
    const input=validateHosted(raw);if(!options.actorId)throw Error('actor_required');
    if(!/^https:\/\/[^/]+\/functions\/v1\/zg27-sandbox-acceptance\/callback$/.test(options.notificationUrl))throw Error('callback_unavailable');
    const now=Date.now();for(const[k,v]of cache)if(now-v.at>3600000)cache.delete(k);
    if(input.operation==='hosted_inspect')return execute(input,options);
    const key=`${options.actorId}:${input.run_id}:${input.case_id}:${input.operation}:${input.checkout_token??''}`;
    const prior=cache.get(key);if(prior)return prior.work;if(cache.size>=128)throw Error('runner_busy');
    const work=execute(input,options);cache.set(key,{at:now,work});return work;
  };
}
