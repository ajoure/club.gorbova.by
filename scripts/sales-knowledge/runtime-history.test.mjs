import test from 'node:test';
import assert from 'node:assert/strict';
import {readFullHistory,describeAttachment,validateMediaObservation} from '../../supabase/functions/_shared/sales-runtime/history.mjs';

test('reads a conversation beyond the previous 2000-message boundary without dropping old context',async()=>{
 const rows=Array.from({length:5201},(_,i)=>({id:`m${i}`,message_text:i===0?'old goal':`message ${i}`}));
 const seen=[];const result=await readFullHistory(async(a,b)=>{seen.push([a,b]);return rows.slice(a,b+1);});
 assert.equal(result.length,5201);assert.equal(result[0].message_text,'old goal');assert.equal(result.at(-1).id,'m5200');assert.equal(seen.length,27);
});
test('database failure or unstable pages never become a falsely complete history',async()=>{
 await assert.rejects(readFullHistory(async(a)=>{if(a)throw Error('database down');return [{id:'a'},{id:'b'}];},2),/database down/);
 await assert.rejects(readFullHistory(async()=>[{id:'a'},{id:'b'}],2),/snapshot_changed/);
});
test('attachment reads only its own stored upload, never arbitrary or cross-contact paths',()=>{
 const message={id:'m1',meta:{file_type:'photo',file_id:'file1',upload_status:'ok',storage_bucket:'telegram-media',storage_path:'chat-media/customer1/image.jpg',mime_type:'image/jpeg'}};
 assert.equal(describeAttachment(message,'customer1').state,'ready');
 for(const path of ['https://example.com/image.jpg','chat-media/customer2/image.jpg','chat-media/customer1/../customer2/image.jpg','chat-media/customer1/%2e%2e/image.jpg']){
  const result=describeAttachment({...message,meta:{...message.meta,storage_path:path}},'customer1');
  assert.equal(result.state,'unavailable');assert.equal(result.path,undefined);
 }
 assert.equal(describeAttachment({...message,meta:{...message.meta,storage_bucket:'private-docs'}},'customer1').state,'unavailable');
});
test('replacement changes cache identity and missing media stays explicit',()=>{
 const m={id:'m1',meta:{file_type:'photo',file_id:'a',upload_status:'pending'}};
 assert.equal(describeAttachment(m,'u').state,'pending');
 assert.notEqual(describeAttachment(m,'u').sourceIdentity,describeAttachment({...m,meta:{...m.meta,file_id:'b'}},'u').sourceIdentity);
 assert.equal(describeAttachment({id:'m2',meta:{file_type:'video'}},'u').state,'unsupported');
});
test('unreadable image cannot silently carry invented text or a problem',()=>{
 assert.throws(()=>validateMediaObservation({status:'unreadable',text:'invented',problem:'',uncertainties:[]}),/claims/);
 assert.deepEqual(validateMediaObservation({status:'partial',text:'НДС',problem:'Неясно заполнение поля',uncertainties:['Остальной текст размыт']}),{status:'partial',text:'НДС',problem:'Неясно заполнение поля',uncertainties:['Остальной текст размыт']});
});
