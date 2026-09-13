import assert from 'node:assert/strict';
import {hydrateMedia} from '../../supabase/functions/_shared/sales-runtime/media.ts';
import {describeAttachment} from '../../supabase/functions/_shared/sales-runtime/history.mjs';
function fixture() {
 const message={id:'message1',meta:{file_type:'photo',file_id:'file1',uploaded_file_id:'file1',upload_status:'ok',storage_bucket:'telegram-media',storage_path:'chat-media/customer1/test.png',mime_type:'image/png'}};
 const cache:any[]=[];let downloads=0;
 const db:any={from:(table:string)=>{
  const filters:Record<string,unknown>={};let insert:any;
  const q:any={select:()=>q,eq:(k:string,v:unknown)=>{filters[k]=v;return q;},maybeSingle:()=>q,single:()=>q,
   upsert:(row:unknown)=>{insert=row;return q;},then:(resolve:any)=>{
    if(insert){cache.push(insert);return Promise.resolve(resolve({data:null,error:null}));}
    const data=table==='telegram_messages'?message:cache.find(row=>Object.entries(filters).every(([k,v])=>row[k]===v))??null;
    return Promise.resolve(resolve({data,error:null}));
   }};return q;
 },storage:{from:(bucket:string)=>({download:async(path:string)=>{
  assert.equal(bucket,'telegram-media');assert.equal(path,message.meta.storage_path);downloads++;
  return {data:new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}),error:null};
 }})}};
 const context=()=>({mediaSources:[describeAttachment(message,'customer1')],history:[{source_message_id:message.id,role:'customer',text:'Вот ошибка'}]});
 const scope={test_user_id:'customer1',bot_id:'bot',business_account_id:'business'};
 return {db,context,scope,message,cache,downloads:()=>downloads};
}
Deno.test('private image is read once, cached, then resumes using caption and visual problem',async()=>{
 const f=fixture();let calls=0;
 const analyze=async(content:any[])=>{calls++;assert.match(content[1].image_url.url,/^data:image\/png;base64,/);assert.doesNotMatch(JSON.stringify(content),/chat-media|customer1|file1/);
  return {status:'readable',text:'Ошибка 404',problem:'Страница оплаты недоступна',uncertainties:[]};};
 const first=await hydrateMedia(f.db,f.context(),{},f.scope,analyze);assert.equal(first.ready,false);assert.equal(f.cache.length,1);
 assert.match(f.cache[0].source_hash,/^[a-f0-9]{64}$/);assert.equal(f.cache[0].sourceIdentity,undefined);
 const second:any=f.context();assert.equal((await hydrateMedia(f.db,second,{},f.scope,analyze)).ready,true);
 assert.equal(second.history[0].text,'Вот ошибка');assert.equal(second.history[0].attachment.problem,'Страница оплаты недоступна');
 assert.equal(calls,1);assert.equal(f.downloads(),1);
});
Deno.test('pending upload never calls AI, and changed image cannot store stale observation',async()=>{
 const f=fixture();f.message.meta.upload_status='pending';let calls=0;
 const analyze=async()=>{calls++;f.message.meta.file_id='replacement';return {status:'readable',text:'old',problem:'',uncertainties:[]};};
 assert.equal((await hydrateMedia(f.db,f.context(),{},f.scope,analyze)).reason,'media_upload_pending');assert.equal(calls,0);
 f.message.meta.upload_status='ok';assert.equal((await hydrateMedia(f.db,f.context(),{},f.scope,analyze)).reason,'media_source_changed');assert.equal(f.cache.length,0);
 assert.equal(describeAttachment(f.message,'customer1')?.state,'unavailable');
});
Deno.test('unreadable screenshot and cross-contact storage fail closed without guessed facts',async()=>{
 const f=fixture();await assert.rejects(hydrateMedia(f.db,f.context(),{},f.scope,async()=>({status:'unreadable',text:'',problem:'',uncertainties:['blurred']})),/media_needs_human/);
 f.message.meta.storage_path='chat-media/other/person.png';
 await assert.rejects(hydrateMedia(f.db,f.context(),{},f.scope,async()=>{throw Error('must not call')}),/media_unavailable/);
 assert.equal(f.downloads(),1);
});
