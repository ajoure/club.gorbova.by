import {DB, must, read} from './db.ts';
import {describeAttachment, MEDIA_SYSTEM, validateMediaObservation} from './history.mjs';
import {readAIConfig, requestAI} from './ai.mjs';
const VERSION='sales-media-v1';
export async function digest(value:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
function base64(bytes:Uint8Array) {
  let binary='';for(let i=0;i<bytes.length;i+=16384) binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}
/** Processes at most one uncached image per claim. Completed observations are
 * durable, so the next claim resumes preprocessing without repeating AI calls. */
export async function hydrateMedia(db:DB, context:any, config:any, scope:any, analyze?:(content:any[])=>Promise<unknown>) {
  const c=readAIConfig(config);let processed=0;
  for(const source of context.mediaSources) {
    const message=context.history.find((m:any)=>m.source_message_id===source.messageId);
    if(!message) throw Error('media_history_mismatch');
    if(source.state==='pending') return {ready:false,reason:'media_upload_pending'};
    if(source.state!=='ready'||source.type!=='image'||!c.vision_enabled) throw Error('media_unavailable');
    const hash=await digest(source.sourceIdentity);
    let cache=await must(db.from('sales_media_observations').select('observation')
      .eq('message_id',source.messageId).eq('source_hash',hash).eq('model',c.model).eq('version',VERSION).maybeSingle());
    if(!cache) {
      if(processed) return {ready:false,reason:'media_processing_pending'};
      const {data:blob,error}=await db.storage.from(source.bucket).download(source.path);
      if(error||!blob) throw Error('media_download_failed');
      if(blob.size>c.max_image_bytes||!blob.size) throw Error('media_size_unsupported');
      const content=[
        {type:'text',text:'Прочитай это изображение клиента. Верни только согласованный JSON.'},
        {type:'image_url',image_url:{url:`data:${source.mime};base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`}},
      ];
      const observation=validateMediaObservation(await (analyze ? analyze(content) : requestAI(c,MEDIA_SYSTEM,content,{key:Deno.env.get('LOVABLE_API_KEY')})));
      // Metadata may change while the model reads. Never cache a stale result as
      // current and never accept a path from the model or a different contact.
      const fresh=await read(db.from('telegram_messages').select('id,meta').eq('id',source.messageId)
        .eq('user_id',scope.test_user_id).eq('bot_id',scope.bot_id).eq('business_account_id',scope.business_account_id).single());
      if(describeAttachment(fresh,scope.test_user_id)?.sourceIdentity!==source.sourceIdentity) return {ready:false,reason:'media_source_changed'};
      await must(db.from('sales_media_observations').upsert({message_id:source.messageId,source_hash:hash,model:c.model,version:VERSION,observation},
        {onConflict:'message_id,source_hash,model,version',ignoreDuplicates:true}));
      cache={observation};processed++;
    }
    const observation=validateMediaObservation(cache.observation);
    message.attachment_status=observation.status;
    // Preserve the literal caption and a distinct, untrusted visual observation.
    message.attachment=observation;
    if(observation.status==='unreadable'||observation.status==='partial') throw Error('media_needs_human');
  }
  return processed ? {ready:false,reason:'media_processing_pending'} : {ready:true};
}
