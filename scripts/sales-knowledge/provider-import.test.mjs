import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_PRODUCT_IDS,createManagedTransport,dryRunCourse,importCourseBatch,safeSubtitleUrl } from './lib/course-provider-import.mjs';
const owner='00000000-0000-4000-8000-000000000001';
const videoId='11111111-1111-4111-8111-111111111111';
const vtt='WEBVTT\n\n00:00.000 --> 00:30.000\nСегодня подробно обсуждаем программу курса и вопросы обучения.';
function fixture(){
  const writes=[],sources=[],transcripts=[],bindings=[];let sourceChanged=false;
  const modules=[{id:'m1',product_id:COURSE_PRODUCT_IDS[0],parent_module_id:null,is_active:true}];
  const lessons=[{id:'l1',module_id:'m1',product_id:COURSE_PRODUCT_IDS[0],is_active:true}];
  const blocks=[{id:'b1',lesson_id:'l1',parent_id:null,block_type:'video',content:{url:'https://kinescope.io/testAlias123'},updated_at:'2026-01-01'}];
  const io={
    async rows(table){return {training_modules:modules,training_lessons:lessons,lesson_blocks:blocks,
      integration_instances:[{id:'i1',config:{api_token:'synthetic-test-token'}}],course_transcription_sources:sources,course_transcription_bindings:bindings,course_transcripts:transcripts}[table]??[];},
    async provider(path){
      if(path.includes('/subtitles?'))return{data:[{id:'s1',language:'ru',status:'done'}]};
      if(path.endsWith('/subtitles/s1'))return{data:{id:'s1',language:'ru',status:'done',url:'https://kinescopecdn.net/test.vtt?sign=synthetic'}};
      return{data:{id:videoId,version:sourceChanged?2:1,updated_at:'2026-01-01',duration:30,audio_tracks:[]}};
    },
    async subtitle(){return vtt;},
    async write(table,data){writes.push({table,data});if(table==='course_transcription_sources')sources.push(data);if(table==='course_transcription_bindings')bindings.push(data);return[data];},
    async rpc(name,args){
      if(name==='has_role_v2')return args._user_id===owner;
      if(name==='course_transcription_import_subtitles'){
        const {inspectSubtitles}=await import('./lib/subtitles.mjs');const parsed=inspectSubtitles(vtt,30000);
        const reused=transcripts.length>0;if(!reused)transcripts.push({source_id:args._source_id,content_sha256:parsed.content_sha256,char_count:parsed.chars,classification:'paid_private',origin:'provider_subtitles',quality_status:'unreviewed'});
        return{reused};
      }
      throw new Error('unexpected_rpc');
    },
  };
  return {io,writes,blocks,modules,lessons,changeSource:()=>{sourceChanged=true;}};
}

test('dry-run includes only fixed base/flow20 scope and never stores transcript/token/URLs',async()=>{
  const f=fixture(),plan=await dryRunCourse(f.io,owner);
  assert.deepEqual(plan.product_ids,COURSE_PRODUCT_IDS);assert.equal(plan.sources.length,1);
  assert.equal(plan.sources[0].status,'ready_to_import');assert.equal(f.writes.length,0);
  assert.doesNotMatch(JSON.stringify(plan),/https:|synthetic-test-token|Сегодня|storage_path/);
});
test('import verifies exact source, imports once with replay/readback, stays unreviewed',async()=>{
  const f=fixture(),plan=await dryRunCourse(f.io,owner);const result=await importCourseBatch(f.io,owner,plan,[0]);
  assert.equal(result.stt_calls,0);assert.equal(result.results[0].created,true);
  assert.equal(result.results[0].replay_changes,0);assert.equal(result.results[0].quality_status,'unreviewed');
  assert.deepEqual(f.writes.map(w=>w.table),['course_transcription_sources','course_transcription_bindings']);
});
test('new provider revision or curriculum edit stops before first write',async()=>{
  const f=fixture(),plan=await dryRunCourse(f.io,owner);f.changeSource();
  await assert.rejects(importCourseBatch(f.io,owner,plan,[0]),/source_changed_since_dry_run/);assert.equal(f.writes.length,0);
  const g=fixture(),plan2=await dryRunCourse(g.io,owner);g.blocks[0].updated_at='2026-02-02';
  await assert.rejects(importCourseBatch(g.io,owner,plan2,[0]),/course_binding_changed/);assert.equal(g.writes.length,0);
});
test('wrong product scope, duplicate indices, too-long batch and non-owner are rejected',async()=>{
  const f=fixture(),plan=await dryRunCourse(f.io,owner);
  await assert.rejects(importCourseBatch(f.io,owner,{...plan,product_ids:['flow21']},[0]),/manifest_scope_invalid/);
  await assert.rejects(importCourseBatch(f.io,owner,plan,[0,0]),/batch_size_invalid/);
  await assert.rejects(importCourseBatch(f.io,owner,plan,[0],{maxDurationMs:1000}),/over_budget/);
  await assert.rejects(importCourseBatch(f.io,owner,plan,[0],{maxChars:1}),/over_budget/);
  await assert.rejects(dryRunCourse(f.io,'00000000-0000-4000-8000-000000000002'),/owner_required/);
});
test('internal gaps stay unreviewed and are importable only below ten percent missing time',async()=>{
  const f=fixture(),provider=f.io.provider;
  f.io.provider=async(path)=>{const r=await provider(path);if(r.data.id===videoId)r.data.duration=3600;return r;};
  f.io.subtitle=async()=>`WEBVTT\n\n00:00:00.000 --> 00:10:00.000\nСегодня обсуждаем вопросы обучения.\n\n00:12:30.000 --> 01:00:00.000\nПродолжаем обсуждать программу курса.`;
  const plan=await dryRunCourse(f.io,owner),source=plan.sources[0];
  assert.equal(source.status,'ready_with_warnings');assert.equal(source.subtitle_metadata.uncovered_ms,150000);
  assert.equal(source.subtitle_metadata.gap_count_gt60,1);assert.deepEqual(source.subtitle_metadata.quality_flags,['long_gap']);
  f.io.subtitle=async()=>`WEBVTT\n\n00:00:00.000 --> 00:10:00.000\nСегодня обсуждаем вопросы обучения.\n\n00:20:00.000 --> 01:00:00.000\nПродолжаем обсуждать программу курса.`;
  const changed=await dryRunCourse(f.io,owner);assert.equal(changed.sources[0].status,'quality_review');
  await assert.rejects(importCourseBatch(f.io,owner,changed,[0]),/over_budget/);assert.equal(f.writes.length,0);
});
test('cross-product or nested curriculum structure requires review',async()=>{
  const f=fixture();f.lessons[0].product_id='other';await assert.rejects(dryRunCourse(f.io,owner),/course_binding_conflict/);
  const g=fixture();g.blocks[0].parent_id='unknown';await assert.rejects(dryRunCourse(g.io,owner),/nested_video/);
});
test('subtitle links cannot fetch private networks, credentials, HTTP, or lookalike domains',()=>{
  for(const url of ['http://kinescope.io/a','https://127.0.0.1/a','https://kinescopecdn.net.evil.test/a','https://user:secret@kinescope.io/a','https://kinescope.io:123/a'])assert.throws(()=>safeSubtitleUrl(url));
  assert.equal(safeSubtitleUrl('https://kinescopecdn.net/a').hostname,'kinescopecdn.net');
});
test('two aliases resolving to one video cannot hide changed subtitles during dry-run',async()=>{
  const f=fixture();f.blocks.push({...f.blocks[0],id:'b2',content:{url:'https://kinescope.io/secondAlias123'}});
  let calls=0;f.io.subtitle=async()=>++calls===1?vtt:vtt.replace('Сегодня','Завтра');
  await assert.rejects(dryRunCourse(f.io,owner),/subtitle_snapshot_changed/);
  assert.equal(f.writes.length,0);
});
test('subtitle fetch omits credentials and rejects redirect outside provider',async()=>{
  const calls=[];const io=createManagedTransport({supabaseUrl:'https://example.supabase.co',serviceKey:'test',fetchImpl:async(url,options)=>{
    calls.push({url:String(url),options});return new Response(null,{status:302,headers:{location:'http://127.0.0.1/a'}});
  }});
  await assert.rejects(io.subtitle('https://kinescopecdn.net/a'),/subtitle_host_not_allowed/);
  assert.equal(calls.length,1);assert.equal(calls[0].options.headers,undefined);
});
