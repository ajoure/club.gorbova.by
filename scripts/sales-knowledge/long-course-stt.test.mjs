import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLongStt,executeLongBatch,validateLongManifest} from './lib/long-course-stt.mjs';
import {parsePublicPlayer} from './lib/reviewed-captions.mjs';
import {COURSE_PRODUCT_IDS} from './lib/course-provider-import.mjs';
import {sha} from './lib/course-stt.mjs';
const owner='00000000-0000-4000-8000-000000000001',video='11111111-1111-4111-8111-111111111111',block='22222222-2222-4222-8222-222222222222';
const jobId='33333333-3333-4333-8333-333333333333',claim='44444444-4444-4444-8444-444444444444';
function fixture(duration=1801){
 const state={revision:1,active:true,ru:false,writes:0,paid:0,decodes:0,finalized:0,mutate:false,fail:false};
 const sources=[],bindings=[],transcripts=[],parts=[];
 const io={
  async rows(table,select,filters={}){
   if(table==='course_transcription_parts')return parts.filter(p=>!filters.part_index||p.part_index===Number(filters.part_index.slice(3))).map(p=>({...p}));
   return ({training_modules:[{id:'m',product_id:COURSE_PRODUCT_IDS[0],is_active:state.active}],
    training_lessons:[{id:'l',module_id:'m',product_id:COURSE_PRODUCT_IDS[0],is_active:true}],
    lesson_blocks:[{id:block,lesson_id:'l',block_type:'video',content:{url:'https://kinescope.io/testAlias'},updated_at:'2026-01-01'}],
    integration_instances:[{id:'i',config:{api_token:'synthetic'}}],course_transcription_sources:sources,
    course_transcription_bindings:bindings,course_transcripts:transcripts})[table];
  },
  async provider(path){return path.includes('/subtitles?')?{data:state.ru?[{language:'ru'}]:[]}:{data:{id:video,duration,version:state.revision,updated_at:'2026-01-01',audio_tracks:[{id:claim,file_size:99999999,download_link:'https://kinescopecdn.net/audio'}]}};},
  async write(table,row){state.writes++;if(table==='course_transcription_sources')sources.push({...row,revision_basis:'provider_api'});if(table==='course_transcription_bindings'&&!bindings.length)bindings.push(row);},
  async rpc(name,a){
   if(name==='has_role_v2')return a._user_id===owner;
   if(name==='course_transcription_create_job'){
    if(!parts.length)for(let i=0;i<Math.ceil(duration/90);i++)parts.push({part_index:i,start_ms:i*90000,end_ms:Math.min((i+1)*90000,duration*1000),status:'pending',audio_sha256:null});
    return {job_id:jobId};
   }
   const p=parts[a._part_index];
   if(name==='course_transcription_claim_part'){
    if(p.status==='ready')return {action:'cached'};
    if(p.status!=='pending')return {action:'hold'};
    p.status='processing';p.audio_sha256=a._audio_sha256;return {action:'transcribe',claim_token:claim,start_ms:p.start_ms,end_ms:p.end_ms};
   }
   if(name==='course_transcription_finish_part'){
    if(a._error_code){p.status='uncertain';return {status:p.status};}
    const reused=p.status==='ready';p.status='ready';p.text=a._text.trim();return {status:'ready',reused};
   }
   if(name==='course_transcription_finalize'){
    assert.ok(parts.every(p=>p.status==='ready'));state.finalized++;
    if(!transcripts.length){const text=parts.map(p=>p.text).join('\n\n');transcripts.push({source_id:sources[0].id,job_id:jobId,source_revision:sources[0].source_revision,origin:'stt',classification:'paid_private',quality_status:'unreviewed',duration_ms:duration*1000,transcript_text:text,content_sha256:sha(text),char_count:[...text].length});}
    return {reused:state.finalized>1};
   }
   throw Error(name);
  },
 };
 const html=()=>`playerOptions = ${JSON.stringify({playlist:[{id:video,meta:{duration},vtt:[],sources:{hls:{src:'https://kinescopecdn.net/master'}}}]})};`;
 const publicIo={page:async()=>html(),caption:async url=>{
  if(url.endsWith('/master'))return '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio"\n';
  let text='#EXTM3U\n#EXT-X-MAP:URI="media",BYTERANGE="10@0"\n';
  for(let at=0,i=0;at<duration;at+=10,i++)text+=`#EXTINF:${Math.min(10,duration-at)},\n#EXT-X-BYTERANGE:10@${10+i*10}\nmedia\n`;
  return text+'#EXT-X-ENDLIST\n';
 }};
 const media={range:async(_url,_offset,bytes)=>Buffer.alloc(bytes),decode:async(_bytes,_trim,ms)=>{state.decodes++;assert.ok(ms<=90000);return Buffer.alloc(ms*32,state.mutate?2:1);}};
 const transcribe=async()=>{state.paid++;if(state.fail)throw Error('uncertain');return 'Учебная тема';};
 return {io,publicIo,media,state,parts,html,transcribe};
}
const prep=f=>prepareLongStt(f.io,f.publicIo,owner,'testAlias',[block],f.media);
const run=(f,m,indices,progress)=>executeLongBatch(f.io,f.publicIo,owner,m,indices,f.media,f.transcribe,progress);
test('208-minute dry-run uses 139 sequential bounded windows, no writes or paid calls',async()=>{
 const f=fixture(12480),m=await prep(f);assert.equal(m.parts.length,139);assert.equal(f.state.decodes,139);assert.equal(f.state.writes,0);assert.equal(f.state.paid,0);assert.equal(m.parts.at(-1).end_ms,12480000);
 assert.ok(!JSON.stringify(m).includes('kinescopecdn'));validateLongManifest(m);
});
test('batch resume reuses ready parts; finalize only after full coverage; completed replay is free',async()=>{
 const f=fixture(),m=await prep(f),first=await run(f,m,[0,1]);assert.equal(first.status,'partial');assert.equal(f.state.finalized,0);
 const replay=await run(f,m,[0,1]);assert.equal(replay.stt_calls,0);assert.equal(f.state.paid,2);
 const result=await run(f,m,Array.from({length:19},(_,i)=>i+2));assert.equal(result.status,'ready');assert.equal(f.state.paid,21);assert.equal(f.state.finalized,2);
 assert.equal((await run(f,m,[0])).cached,true);assert.equal(f.state.paid,21);
});
test('unknown billed result and crash after claim never cause a second paid attempt',async()=>{
 for(const crash of [false,true]){
  const f=fixture(),m=await prep(f);f.state.fail=!crash;
  await assert.rejects(run(f,m,[0],crash?async()=>{throw Error('crash');}:undefined),/stt_outcome_uncertain/);
  assert.equal(f.parts[0].status,'uncertain');const paid=f.state.paid;
  await assert.rejects(run(f,m,[0]),/part_held/);assert.equal(f.state.paid,paid);
 }
});
test('changed bytes, revision, manifest, inactive selection and over-budget batch fail closed',async()=>{
 for(const type of ['bytes','revision','manifest','active','batch']){
  const f=fixture(),m=await prep(f);let indices=[0];
  if(type==='bytes')f.state.mutate=true;if(type==='revision')f.state.revision++;
  if(type==='manifest')m.parts[0].end_ms--;if(type==='active')f.state.active=false;
  if(type==='batch')indices=Array.from({length:21},(_,i)=>i);
  await assert.rejects(run(f,m,indices));assert.equal(f.state.paid,0);assert.equal(f.state.finalized,0);
 }
});
test('Russian captions always require reuse; missing tracks remain rejected in ordinary caption parser',async()=>{
 const f=fixture();f.state.ru=true;await assert.rejects(prep(f),/reuse_russian_subtitles_required/);
 assert.throws(()=>parsePublicPlayer(f.html()),/public_russian_track_ambiguous/);
 assert.equal(parsePublicPlayer(f.html(),{includeHls:true,requireRussianCaption:false}).video_id,video);
});

test('digital silence is reported without paid recognition or database writes',async()=>{
 const f=fixture();f.media.decode=async(_bytes,_trim,ms)=>Buffer.alloc(ms*32);
 const m=await prep(f);assert.ok(m.parts.every(p=>p.digital_silence));
 await assert.rejects(run(f,m,[0]),/audio_silence_review_required/);assert.equal(f.state.writes,0);assert.equal(f.state.paid,0);
});
