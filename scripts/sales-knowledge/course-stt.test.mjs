import test from 'node:test';
import assert from 'node:assert/strict';
import {pcmParts,prepareStt,executeStt,createSttGateway,sha,STT_ENDPOINT} from './lib/course-stt.mjs';
import {createCourseMedia} from './lib/course-audio.mjs';
import {COURSE_PRODUCT_IDS} from './lib/course-provider-import.mjs';
const owner='00000000-0000-4000-8000-000000000001',video='11111111-1111-4111-8111-111111111111';
const jobId='22222222-2222-4222-8222-222222222222',claimToken='33333333-3333-4333-8333-333333333333';
function fixture(){
  const state={active:true,revision:1,ru:false,phase:'pending',text:null,writes:0,paid:0};
  const sources=[],bindings=[],transcripts=[];
  const media={download:async()=>Buffer.from('audio'),decode:async()=>Buffer.alloc(64000,1)};
  const io={
    async rows(table){return ({training_modules:[{id:'m',product_id:COURSE_PRODUCT_IDS[0],is_active:state.active}],
      training_lessons:[{id:'l',module_id:'m',product_id:COURSE_PRODUCT_IDS[0],is_active:true}],
      lesson_blocks:[{id:'b',lesson_id:'l',block_type:'video',content:{url:'https://kinescope.io/testAlias'},updated_at:'2026-01-01'}],
      integration_instances:[{id:'i',config:{api_token:'synthetic-secret'}}],course_transcription_sources:sources,
      course_transcription_bindings:bindings,course_transcripts:transcripts})[table];},
    async provider(path){if(path.includes('/subtitles?'))return {data:state.ru?[{language:'ru'}]:[]};
      return {data:{id:video,duration:2,version:state.revision,updated_at:'2026-01-01',audio_tracks:[{
        id:'44444444-4444-4444-8444-444444444444',language:'und',file_size:5,download_link:'https://kinescopecdn.net/audio?token=synthetic'}]}};},
    async write(table,data){state.writes++;
      if(table==='course_transcription_sources')sources.push({...data,revision_basis:'provider_api'});
      if(table==='course_transcription_bindings'&&!bindings.length)bindings.push(data);
    },
    async rpc(name,args){
      if(name==='has_role_v2')return args._user_id===owner;
      if(name==='course_transcription_create_job')return {job_id:jobId,status:'pending'};
      if(name==='course_transcription_claim_part'){
        if(state.phase==='ready')return {action:'cached'};
        if(state.phase!=='pending')return {action:'hold'};
        state.phase='processing';return {action:'transcribe',claim_token:claimToken,start_ms:0,end_ms:2000};
      }
      if(name==='course_transcription_finish_part'){
        if(args._error_code){state.phase='uncertain';return {status:'uncertain'};}
        const reused=state.phase==='ready';state.text=args._text.trim();state.phase='ready';return {status:'ready',reused};
      }
      if(name==='course_transcription_finalize'){
        assert.equal(state.phase,'ready');const reused=!!transcripts.length;
        if(!reused)transcripts.push({source_id:sources[0].id,job_id:jobId,origin:'stt',classification:'paid_private',quality_status:'unreviewed',
          source_revision:sources[0].source_revision,duration_ms:2000,transcript_text:state.text,content_sha256:sha(state.text),char_count:[...state.text].length});
        return {reused};
      }
      throw Error('unexpected_rpc');
    },
  };
  return {io,state,media,sources,transcripts,transcribe:async()=>{state.paid++;return 'Текст учебного занятия.';}};
}

test('PCM windows preserve every sample and exact 90-second boundaries',()=>{
  const pcm=Buffer.alloc(1194383*32,1),result=pcmParts(pcm,1194383);
  assert.equal(result.parts.length,14);assert.equal(result.parts[13].start_ms,1170000);
  assert.equal(result.parts[13].end_ms,1194383);
  assert.deepEqual(Buffer.concat(result.parts.map(p=>p.wav.subarray(44))),pcm);
  for(const p of result.parts){assert.equal(p.wav.readUInt32LE(40),p.wav.length-44);assert.equal(p.audio_sha256,sha(p.wav));}
});
test('decode duration mismatch and budgets stop rather than pad invented audio',()=>{
  assert.throws(()=>pcmParts(Buffer.alloc(64000),4000),/duration_mismatch/);
  assert.throws(()=>pcmParts(Buffer.alloc(3),2000),/pcm_invalid/);
  assert.throws(()=>pcmParts(Buffer.alloc(64000),1800001),/duration_mismatch/);
});
test('dry-run is read-only and excludes secrets, URLs and transcript text',async()=>{
  const f=fixture(),p=await prepareStt(f.io,owner,'testAlias',f.media);
  assert.equal(f.state.writes,0);assert.equal(f.state.paid,0);assert.equal(p.manifest.parts.length,1);
  assert.doesNotMatch(JSON.stringify(p.manifest),/https:|synthetic|wav|Текст/);
});
for(const variant of ['owner','active','ru','bytes'])test(`dry-run holds invalid ${variant} before writes`,async()=>{
  const f=fixture();if(variant==='active')f.state.active=false;if(variant==='ru')f.state.ru=true;
  if(variant==='bytes')f.media.download=async()=>Buffer.from('bad');
  await assert.rejects(prepareStt(f.io,variant==='owner'?'wrong':owner,'testAlias',f.media));
  assert.equal(f.state.writes,0);
});
test('source revision changing during capture stops',async()=>{
  const f=fixture();f.media.decode=async()=>{f.state.revision++;return Buffer.alloc(64000);};
  await assert.rejects(prepareStt(f.io,owner,'testAlias',f.media),/source_changed_during_capture/);
});
test('one source creates private transcript, finish/finalize replay, no paid replay',async()=>{
  const f=fixture(),c=await prepareStt(f.io,owner,'testAlias',f.media);
  const result=await executeStt(f.io,owner,c.manifest,c,f.transcribe);
  assert.equal(result.stt_calls,1);assert.equal(f.state.paid,1);assert.equal(result.replay_changes,0);
  assert.equal(result.quality_status,'unreviewed');
  const replay=await executeStt(f.io,owner,c.manifest,c,f.transcribe);
  assert.equal(replay.stt_calls,0);assert.equal(replay.cached,true);assert.equal(f.state.paid,1);
});
for(const result of [null,'','English only',new Error('provider_failed')])test(`uncertain outcome holds paid replay (${String(result)})`,async()=>{
  const f=fixture(),c=await prepareStt(f.io,owner,'testAlias',f.media);
  const call=async()=>{f.state.paid++;if(result instanceof Error)throw result;return result;};
  await assert.rejects(executeStt(f.io,owner,c.manifest,c,call),/stt_outcome_uncertain/);
  assert.equal(f.state.phase,'uncertain');assert.equal(f.transcripts.length,0);
  await assert.rejects(executeStt(f.io,owner,c.manifest,c,call),/part_held/);assert.equal(f.state.paid,1);
});
test('mutation of approved manifest, WAV bytes or provider revision causes zero paid calls',async()=>{
  for(const type of ['manifest','wav','provider']){
    const f=fixture(),c=await prepareStt(f.io,owner,'testAlias',f.media),approved=structuredClone(c.manifest);
    if(type==='manifest')approved.media_sha256='0'.repeat(64);
    if(type==='wav')c.parts[0].wav[60]^=1;
    if(type==='provider')f.state.revision++;
    await assert.rejects(executeStt(f.io,owner,approved,c,f.transcribe));
    assert.equal(f.state.paid,0);assert.equal(f.state.writes,0);
  }
});
test('gateway uses fixed provider/model with no automatic retry and sanitized errors',async()=>{
  let n=0;const call=createSttGateway('synthetic-secret',async(url,options)=>{
    n++;assert.equal(url,STT_ENDPOINT);assert.equal(options.body.get('model'),'openai/gpt-4o-transcribe');
    assert.equal(options.body.get('language'),null);assert.equal(options.redirect,'error');
    return new Response('private upstream details',{status:429});
  });
  await assert.rejects(call(pcmParts(Buffer.alloc(64000),2000).parts[0].wav),/^Error: stt_provider_error$/);
  assert.equal(n,1);
});
test('media download rejects foreign redirects, sends no auth, verifies complete byte count',async()=>{
  let calls=0;const media=createCourseMedia(async(_,options)=>{
    calls++;assert.equal(options.headers,undefined);return new Response(null,{status:302,headers:{location:'https://evil.test/audio'}});
  });
  await assert.rejects(media.download('https://kinescopecdn.net/audio',5),/host_not_allowed/);assert.equal(calls,1);
  await assert.rejects(createCourseMedia(async()=>new Response('short')).download('https://kinescopecdn.net/audio',10),/size_mismatch/);
  assert.equal((await createCourseMedia(async()=>new Response('audio')).download('https://kinescopecdn.net/audio',5)).length,5);
});
