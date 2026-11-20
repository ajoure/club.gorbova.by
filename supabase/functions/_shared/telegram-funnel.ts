import { logAutomatedTelegramMessage } from './log-automated-telegram.ts';
// This is the single transport boundary for funnel starts, scheduled jobs and button transitions.
export const funnelHash = async (value: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
export type FunnelButton = {id:string;text:string;kind:'url'|'next';url?:string;target_block_id?:string};
export type FunnelBlock = {id:string;text:string;image_path?:string;buttons:FunnelButton[]};
export function classifyFunnelTelegramFailure(status:number,result:unknown):string {
  const value=result&&typeof result==='object'?result as Record<string,unknown>:{};
  const code=typeof value.error_code==='number'?value.error_code:status;
  const description=typeof value.description==='string'?value.description.slice(0,600).toLowerCase():'';
  if(code===429||status===429)return 'rate_limited';
  if((code===403||status===403)&&/blocked by the user|bot was blocked/.test(description))return 'bot_blocked';
  if(/chat not found|user not found|user is deactivated|initiate conversation|bot was kicked/.test(description))return 'chat_unavailable';
  if(/photo|file identifier|file_id|http url|image_process|media|failed to get/.test(description))return 'media_unavailable';
  if(/parse entities|reply.?markup|button|text is empty|too long|entity|message is empty/.test(description))return 'invalid_message';
  return 'telegram_rejected';
}
async function rpc(db:any,name:string,args:Record<string,unknown>){const {data,error}=await db.rpc(name,args);if(error)throw Error(`funnel_state_${name}`);return data;}
export async function deliverFunnelStep(db:any,deliveryId:string,options:{supabaseUrl:string;fetch?:typeof fetch;depth?:number;botToken?:string}):Promise<{state:string}> {
  const context=await rpc(db,'telegram_funnel_delivery_context',{p_delivery:deliveryId});
  if(!context?.block)return {state:'not_found'};
  const block=context.block as FunnelBlock;
  const tokens=await Promise.all(block.buttons.map(async button=>{const raw=crypto.randomUUID();return {button,raw,hash:await funnelHash(button.kind==='next'?`tf:${raw}`:raw)}}));
  const claim=await rpc(db,'telegram_funnel_claim_send',{p_delivery:deliveryId,p_tokens:tokens.filter(t=>t.button.kind==='next').map(t=>({button_id:t.button.id,token_hash:t.hash}))});
  if(claim?.state!=='claimed')return {state:claim?.state||'unknown'};
  let requestStarted=false;
  let outcome='failed',messageId:number|null=null,errorCode='preflight_failed';
  try {
    await rpc(db,'telegram_funnel_prepare_links',{p_delivery:deliveryId,p_lease:claim.lease_id,p_tokens:tokens.filter(t=>t.button.kind==='url').map(t=>({button_id:t.button.id,token_hash:t.hash}))});
    const {data:bot,error}=await Promise.resolve(db.from('telegram_bots').select('id,status,bot_token_encrypted').eq('id',claim.bot_id).eq('status','active').maybeSingle()).catch(()=>({data:null,error:true}));
    if(error||!bot?.bot_token_encrypted)throw Error('bot_unavailable');
    const keyboard={inline_keyboard:tokens.map(t=>[{text:t.button.text,...(t.button.kind==='next'?{callback_data:`tf:${t.raw}`}:{url:`${options.supabaseUrl}/functions/v1/broadcast-track/c/${t.raw}?funnel=1`})}])};
    const body:any={chat_id:claim.chat_id,parse_mode:'Markdown',reply_markup:keyboard};
    let method='sendMessage';
    if(block.image_path){const signed=await db.storage.from('telegram-media').createSignedUrl(block.image_path,300).catch(()=>null);if(!signed||signed.error||!signed.data?.signedUrl)throw Error('media_unavailable');body.photo=signed.data.signedUrl;body.caption=block.text;method='sendPhoto'}
    else body.text=block.text;
    requestStarted=true;
    const response=await (options.fetch||fetch)(`https://api.telegram.org/bot${bot.bot_token_encrypted}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'});
    // Telegram transport acceptance is proved only by ok=true and its own message ID.
    const result=await response.json().catch(()=>null);
    if(response.ok&&result?.ok===true&&Number.isSafeInteger(result.result?.message_id)&&result.result.message_id>0&&Number.isSafeInteger(result.result?.chat?.id)&&result.result.chat.id===Number(claim.chat_id)){outcome='sent';messageId=result.result.message_id;errorCode=''}
    else if(response.status>=400&&response.status<500&&result?.ok===false){outcome='failed';errorCode=classifyFunnelTelegramFailure(response.status,result)}
    else {outcome='unknown';errorCode='telegram_unconfirmed'}
  } catch(error) {outcome=requestStarted?'unknown':'failed';errorCode=requestStarted?'transport_unknown':error instanceof Error&&['bot_unavailable','media_unavailable'].includes(error.message)?error.message:'preflight_failed'}
  // A failed persistence after transport never authorizes another send. The lease remains durable.
  await rpc(db,'telegram_funnel_finish_send',{p_delivery:deliveryId,p_lease:claim.lease_id,p_outcome:outcome,p_message_id:messageId,p_error:errorCode||null});
  if(outcome==='sent'){
    if(claim.user_id) await logAutomatedTelegramMessage({supabase:db,user_id:claim.user_id,telegram_user_id:claim.chat_id,bot_id:claim.bot_id,text:block.text,telegram_message_id:messageId,source:'telegram-funnel',extra_meta:{funnel_delivery_id:deliveryId,idempotency_key:`funnel:${deliveryId}`}}).catch(()=>undefined);
    const children=await rpc(db,'telegram_funnel_reconcile_callbacks',{p_source_delivery:deliveryId});
    if((options.depth||0)<8)for(const child of children||[])await deliverFunnelStep(db,child,{...options,depth:(options.depth||0)+1});
  }
  return {state:outcome};
}
export async function handleFunnelCallback(db:any,botId:string,update:any,options:{supabaseUrl:string;fetch?:typeof fetch;depth?:number;botToken?:string}):Promise<{handled:boolean;state?:string}> {
  const cb=update?.callback_query;if(typeof cb?.data!=='string'||!cb.data.startsWith('tf:'))return {handled:false};
  if(!/^tf:[0-9a-f-]{36}$/i.test(cb.data)||cb.message?.chat?.type!=='private'||!Number.isSafeInteger(cb.from?.id)||!Number.isSafeInteger(cb.message?.chat?.id)||!Number.isSafeInteger(cb.message?.message_id)||!Number.isSafeInteger(update.update_id))return {handled:true,state:'invalid'};
  const claim=await rpc(db,'telegram_funnel_claim_callback',{p_hash:await funnelHash(cb.data),p_bot:botId,p_chat:cb.message.chat.id,p_user:cb.from.id,p_message:cb.message.message_id,p_callback:cb.id,p_update:update.update_id});
  if(options.botToken){
    try {await (options.fetch||fetch)(`https://api.telegram.org/bot${options.botToken}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:cb.id}),signal:AbortSignal.timeout(3000),redirect:'error'})}catch{/* UI acknowledgement must never retry delivery */}
  }
  if(claim?.state==='claimed')await deliverFunnelStep(db,claim.delivery_id,options);
  // No ACK is a delivery proof. Telegram will also expire the visual spinner itself.
  return {handled:true,state:claim?.state||'unknown'};
}
export async function drainFunnelQueue(db:any,options:{supabaseUrl:string;fetch?:typeof fetch;depth?:number;botToken?:string},launchId?:string):Promise<any> {
  await rpc(db,'telegram_funnel_reconcile_callbacks',{p_source_delivery:null});
  const ids=await rpc(db,'telegram_funnel_due_deliveries',{p_launch:launchId||null,p_limit:10});
  const results=[];for(const id of ids||[])results.push({delivery_id:id,...await deliverFunnelStep(db,id,options)});
  return {results};
}
