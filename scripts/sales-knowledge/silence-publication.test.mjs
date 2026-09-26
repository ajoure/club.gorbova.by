import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLongSource} from './lib/long-course-stt.mjs';
import {prepareSilencePublication,publishSilence} from './lib/silence-publication.mjs';
import {pcmParts,STT_MODEL} from './lib/course-stt.mjs';
import {COURSE_PRODUCT_IDS,createManagedTransport} from './lib/course-provider-import.mjs';
const actor='00000000-0000-4000-8000-000000000001',video='11111111-1111-4111-8111-111111111111',block='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
async function fixture(){
 const state={active:true,revision:1,noise:false,writes:0};let tables={};
 const io={async rows(table){return ({training_modules:[{id:'m',product_id:COURSE_PRODUCT_IDS[0],is_active:state.active}],
  training_lessons:[{id:'l',module_id:'m',product_id:COURSE_PRODUCT_IDS[0],is_active:true}],
  lesson_blocks:[{id:block,lesson_id:'l',block_type:'video',content:{url:'https://kinescope.io/testAlias'},updated_at:'2026-01-01T00:00:00Z'}],
  integration_instances:[{config:{api_token:'synthetic'}}]})[table]??tables[table];},
  async rpc(name,a){assert.equal(name,'has_role_v2');return a._user_id===actor;},
  async write(){state.writes++;throw Error('unexpected_write');},
  async provider(path){return {data:path.includes('/subtitles?')?[]:{id:video,duration:1801,version:state.revision,updated_at:'2026-01-01',audio_tracks:[{id:block,file_size:10000,download_link:'https://kinescope.io/audio'}]}};}
 };
 const publicIo={page:async()=>`playerOptions = ${JSON.stringify({playlist:[{id:video,meta:{duration:1801},vtt:[],sources:{hls:{src:'https://kinescope.io/master'}}}]})};`,
 caption:async url=>url.endsWith('/master')?'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio"\n':'#EXTM3U\n#EXT-X-MAP:URI="media",BYTERANGE="10@0"\n'+Array.from({length:181},(_,i)=>`#EXTINF:${i===180?1:10},\n#EXT-X-BYTERANGE:10@${10+i*10}\nmedia\n`).join('')+'#EXT-X-ENDLIST\n'};
 const source=(await inspectLongSource(io,publicIo,actor,'testAlias',[block])).identity;
 const parts=Array.from({length:21},(_,i)=>{const duration=Math.min(90000,1801000-i*90000);const {wav,...p}=pcmParts(Buffer.alloc(duration*32),duration).parts[0];return {...p,part_index:i,start_ms:i*90000,end_ms:i*90000+duration,digital_silence:true};});
 const original={schema_version:1,mode:'long_course_stt_dry_run',model:STT_MODEL,product_ids:COURSE_PRODUCT_IDS,source,parts,max_batch_parts:20,stt_calls:0};
 tables={course_transcription_sources:[{id,...source,enabled:true,revision_basis:'provider_api',source_scope:'course'}],course_transcription_bindings:source.bindings,
  course_transcription_jobs:[{id,requested_by:actor,duration_ms:1801000,total_parts:parts.length,status:'transcribing'}],
  course_transcription_parts:parts.map(p=>({...p,status:p.part_index===0?'pending':'ready',attempts:p.part_index===0?0:1,audio_sha256:p.part_index===0?null:p.audio_sha256,claim_token:null,transcript_text:p.part_index===0?null:'Текст'}))};
 const media={range:async(_url,_offset,n)=>Buffer.alloc(n),decode:async(_data,_trim,ms)=>Buffer.alloc(ms*32,state.noise?1:0)};
 return {state,tables,run:()=>prepareSilencePublication(io,publicIo,media,actor,original,[0])};
}
test('dry-run recaptures the selected silent window without writes',async()=>{const f=await fixture(),p=await f.run();assert.equal(p.manifest.proofs.length,1);assert.equal(p.manifest.stt_calls,0);assert.equal(f.state.writes,0);});
for(const change of ['noise','revision','active','missing_job','unfinished_speech','changed_binding'])test('fresh silence preflight rejects '+change,async()=>{
 const f=await fixture();if(change==='noise')f.state.noise=true;if(change==='revision')f.state.revision++;if(change==='active')f.state.active=false;
 if(change==='missing_job')f.tables.course_transcription_jobs=[];
 if(change==='unfinished_speech')f.tables.course_transcription_parts[1].status='pending';
 if(change==='changed_binding')f.tables.course_transcription_bindings=[];
 await assert.rejects(f.run());assert.equal(f.state.writes,0);
});

test('publication reads marked parts through managed transport with their composite key',async()=>{
 const f=await fixture(),prepared=await f.run(),approved=prepared.manifest;
 const proof=approved.proofs[0],evidence={...proof,actor,manifest_sha256:approved.capture_manifest_sha256};
 let marks=0,readbacks=0;
 const io=createManagedTransport({supabaseUrl:'https://example.supabase.co',serviceKey:'synthetic',fetchImpl:async(url,options)=>{
  const u=new URL(url);
  if(u.pathname.endsWith('/rpc/course_transcription_mark_verified_silence')){
   marks++;return Response.json({status:'ready',evidence,reused:marks>1});
  }
  assert.equal(u.pathname,'/rest/v1/course_transcription_parts');
  assert.equal(u.searchParams.get('order'),'part_index.asc');
  assert.equal(u.searchParams.get('job_id'),'eq.'+approved.job_id);
  if(u.searchParams.has('part_index')){
   assert.equal(u.searchParams.get('part_index'),'eq.0');readbacks++;
   return Response.json([{status:'ready',attempts:0,audio_sha256:proof.audio_sha256,silence_evidence:evidence,
    transcript_text:`[Редакционная отметка: цифровая тишина; ${proof.start_ms}–${proof.end_ms} мс; речь отсутствует.]`}]);
  }
  // Stop before finalize: this transport regression only supplies the marked row.
  return Response.json([]);
 }});
 await assert.rejects(publishSilence(io,actor,approved,prepared),/silence_finalization_incomplete/);
 assert.equal(readbacks,1);assert.equal(marks,2);
});
