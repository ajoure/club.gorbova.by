import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {COURSE_PRODUCT_IDS} from './lib/course-provider-import.mjs';
import {inspectSubtitles} from './lib/subtitles.mjs';
import {createPublicCaptionTransport,parsePublicPlayer,reviewCaption,captionSnapshotRevision,
  dryRunReviewedCaptions,importReviewedCaptionBatch} from './lib/reviewed-captions.mjs';

const owner='00000000-0000-4000-8000-000000000001';
const videoId='11111111-1111-4111-8111-111111111111';
const raw='WEBVTT\n\n00:00.000 --> 00:30.000\nПодробно рассматриваем учебные темы и практические задачи курса.';
const shuffled='WEBVTT\n\nsecond\n00:10.000 --> 00:30.000\nПродолжаем обсуждать практические вопросы обучения.\n\nfirst\n00:00.000 --> 00:10.000\nСначала рассмотрим задачи и содержание учебного модуля.';
const html=(id=videoId,duration=30,tracks=[{srcLang:'ru',src:'https://kinescopecdn.net/fixture.vtt?sign=synthetic'}])=>
  '<script>playerOptions = '+JSON.stringify({playlist:[{id,meta:{duration},vtt:tracks,title:'Ignored } title'}]})+'; harmless();</script>';
const sha=s=>createHash('sha256').update(s).digest('hex');

function fixture(){
  const writes=[],sources=[],bindings=[],transcripts=[];let currentRaw=raw,currentId=videoId;
  const modules=[{id:'m1',product_id:COURSE_PRODUCT_IDS[0],parent_module_id:null,is_active:true}];
  const lessons=[{id:'l1',module_id:'m1',product_id:COURSE_PRODUCT_IDS[0],is_active:true}];
  const blocks=[{id:'b1',lesson_id:'l1',parent_id:null,block_type:'video',content:{url:'https://kinescope.io/123456789'},updated_at:'2026-01-01'}];
  const io={
    async rows(table){return{training_modules:modules,training_lessons:lessons,lesson_blocks:blocks,
      course_transcription_sources:sources,course_transcription_bindings:bindings,course_transcripts:transcripts}[table]??[];},
    async write(table,data){
      writes.push({table,data});
      if(table==='course_transcription_sources')sources.push(data);
      if(table==='course_transcription_bindings'&&!bindings.some(b=>b.source_id===data.source_id&&b.block_id===data.block_id))bindings.push(data);
    },
    async rpc(name,args){
      if(name==='has_role_v2')return args._user_id===owner;
      if(name!=='course_transcription_import_reviewed_captions')throw new Error('unexpected_rpc');
      const reused=transcripts.length>0;
      if(!reused)transcripts.push({source_id:args._source_id,content_sha256:sha(args._text),char_count:[...args._text].length,
        classification:'paid_private',quality_status:'unreviewed',origin:'provider_subtitles',
        caption_provenance:Object.fromEntries(Object.entries(args._provenance).reverse())});
      return{reused};
    },
  };
  return {io,publicIo:{page:async()=>html(currentId),caption:async()=>currentRaw},writes,sources,bindings,transcripts,blocks,
    changeRaw:value=>{currentRaw=value;},changeId:value=>{currentId=value;}};
}

test('public player JSON is parsed without executing scripts or leaking unrelated fields',()=>{
  const got=parsePublicPlayer(html());assert.equal(got.video_id,videoId);assert.equal(got.duration_ms,30000);
  assert.deepEqual(Object.keys(got).sort(),['duration_ms','subtitle_url','video_id']);
  assert.throws(()=>parsePublicPlayer('playerOptions = (()=>{throw new Error("executed")})()'),/json_required/);
  assert.throws(()=>parsePublicPlayer(html()+html()),/ambiguous/);
  assert.throws(()=>parsePublicPlayer('playerOptions = {playlist: []}'),/json_invalid/);
});
test('public player rejects ambiguous videos, Russian tracks and untrusted caption URLs',()=>{
  assert.throws(()=>parsePublicPlayer('playerOptions = '+JSON.stringify({playlist:[]})),/playlist_ambiguous/);
  for(const tracks of [[],[{srcLang:'en',src:'https://kinescope.io/a'}],[{srcLang:'ru',src:'https://kinescope.io/a'},{srcLang:'ru',src:'https://kinescope.io/b'}]]){
    assert.throws(()=>parsePublicPlayer(html(videoId,30,tracks)),/russian_track_ambiguous/);
  }
  assert.throws(()=>parsePublicPlayer(html(videoId,30,[{srcLang:'ru',src:'https://127.0.0.1/a'}])),/not_allowed/);
  assert.throws(()=>parsePublicPlayer(html(videoId,'30')),/metadata_invalid/);
  assert.throws(()=>parsePublicPlayer(html(videoId,30000)),/metadata_invalid/);
});
test('public transports follow bounded allowlisted redirects without credentials',async()=>{
  const calls=[];const transport=createPublicCaptionTransport({fetchImpl:async(url,options)=>{
    calls.push({url:String(url),options});return calls.length===1?new Response(null,{status:308,headers:{location:'https://kinescope.io/newAlias'}}):new Response(html());
  }});
  assert.equal(await transport.page('123456789'),html());assert.equal(calls.length,2);
  for(const c of calls){assert.equal(c.options.headers,undefined);assert.equal(c.options.credentials,'omit');assert.equal(c.options.redirect,'manual');}
  for(const target of ['https://evil.invalid/x','https://127.0.0.1/x','https://kinescope.io/x?secret=a','https://user:pass@kinescope.io/x']){
    const bad=createPublicCaptionTransport({fetchImpl:async()=>new Response(null,{status:302,headers:{location:target}})});
    await assert.rejects(bad.page('123'),/host_rejected/);
  }
});
test('redirect loops, invalid UTF8 and oversized bodies stop public reads',async()=>{
  const loop=createPublicCaptionTransport({fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://kinescope.io/123'}})});
  await assert.rejects(loop.page('123'),/redirect_loop/);
  const large=createPublicCaptionTransport({fetchImpl:async()=>new Response('x',{headers:{'content-length':'10000001'}})});
  await assert.rejects(large.page('123'),/too_large/);
  const utf=createPublicCaptionTransport({fetchImpl:async()=>new Response(new Uint8Array([255]))});
  await assert.rejects(utf.page('123'));
});
test('cue ordering requires explicit review and preserves every timed text without changing strict parsing',()=>{
  assert.throws(()=>inspectSubtitles(shuffled,30000),/unordered/);
  assert.throws(()=>reviewCaption(shuffled,30000),/manual_review/);
  const result=reviewCaption(shuffled,30000,{allowCueOrderReview:true});
  assert.equal(result.provenance.transform,'stable_cue_order_v1');assert.equal(result.provenance.inversions,1);
  assert.equal(result.provenance.moved_positions,2);assert.equal(result.provenance.max_backstep_ms,10000);
  assert.equal(result.provenance.original_cue_multiset_sha256,result.provenance.normalized_cue_multiset_sha256);
  assert.equal(result.metadata.subtitle_sha256,sha(shuffled));assert.notEqual(result.provenance.normalized_sha256,sha(shuffled));
  assert.match(result.text,/^Сначала/);assert.equal(result.metadata.cue_count,2);assert.deepEqual(result.quality_flags,[]);
});
test('large backsteps and malformed cue intervals cannot be normalized into approval',()=>{
  assert.throws(()=>reviewCaption(shuffled.replace('00:10.000 --> 00:30.000','01:00.000 --> 01:30.000'),90000,{allowCueOrderReview:true}),/manual_review/);
  assert.throws(()=>reviewCaption(shuffled.replace('00:00.000 --> 00:10.000','00:00.000 --> 00:00.000'),30000,{allowCueOrderReview:true}),/invalid_cue_interval/);
  assert.throws(()=>reviewCaption('<html>failure</html>',30000,{allowCueOrderReview:true}));
});
test('snapshot revisions describe public caption bytes, not invented API update timestamps',()=>{
  const a={video_id:videoId,duration_ms:30000,raw_sha256:sha(raw)};
  assert.equal(captionSnapshotRevision(a),sha(`public_caption_snapshot:v1:${videoId}:30000:${sha(raw)}`));
  assert.notEqual(captionSnapshotRevision(a),captionSnapshotRevision({...a,raw_sha256:sha(raw+' ')}));
  assert.throws(()=>captionSnapshotRevision({...a,duration_ms:null}),/snapshot_invalid/);
});
test('review dry-run exposes provenance but no paid text, URLs or provider tokens',async()=>{
  const f=fixture(),manifest=await dryRunReviewedCaptions(f.io,f.publicIo,owner,{aliases:['123456789']});
  assert.equal(manifest.totals.ready,1);assert.equal(manifest.selection_complete,true);assert.equal(f.writes.length,0);
  assert.equal(manifest.sources[0].provenance.revision_basis,'public_caption_snapshot');
  assert.doesNotMatch(JSON.stringify(manifest),/Подробно|https:|sign=|api_token/);
});
test('long gaps retain quality review, even when a caller edits only the ready status',async()=>{
  const f=fixture();f.publicIo.page=async()=>html(videoId,600);
  f.changeRaw('WEBVTT\n\n00:00.000 --> 01:00.000\nОбсуждаем практические задания и обучение.\n\n05:00.000 --> 10:00.000\nПродолжаем разбирать задачи учебного курса.');
  const m=await dryRunReviewedCaptions(f.io,f.publicIo,owner,{aliases:['123456789'],allowCueOrderReview:true});
  assert.equal(m.totals.quality_review,1);
  await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,owner,m,[0]),/not_ready/);
  m.sources[0].status='ready_reviewed_caption';
  await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,owner,m,[0]),/snapshot_changed/);assert.equal(f.writes.length,0);
});
test('reviewed captions import once with exact provenance readback and no STT',async()=>{
  const f=fixture(),m=await dryRunReviewedCaptions(f.io,f.publicIo,owner,{aliases:['123456789']});
  const first=await importReviewedCaptionBatch(f.io,f.publicIo,owner,m,[0]);
  assert.equal(first.results[0].created,true);assert.equal(first.stt_calls,0);
  const second=await importReviewedCaptionBatch(f.io,f.publicIo,owner,m,[0]);
  assert.equal(second.results[0].created,false);assert.equal(second.results[0].replay_changes,0);
  assert.equal(f.sources.length,1);assert.equal(f.bindings.length,1);assert.equal(f.transcripts.length,1);
  assert.equal(f.sources[0].audio_track_id,null);assert.equal(f.sources[0].audio_bytes,null);
});
test('changed text, canonical video or curriculum stops before any write',async()=>{
  for(const change of ['text','video','binding']){
    const f=fixture(),m=await dryRunReviewedCaptions(f.io,f.publicIo,owner,{aliases:['123456789']});
    if(change==='text')f.changeRaw(raw.replace('Подробно','Сегодня'));
    if(change==='video')f.changeId('22222222-2222-4222-8222-222222222222');
    if(change==='binding')f.blocks[0].updated_at='2026-02-02';
    await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,owner,m,[0]),/changed/);assert.equal(f.writes.length,0);
  }
});
test('other existing source revision is held instead of duplicating an already registered video',async()=>{
  const f=fixture(),m=await dryRunReviewedCaptions(f.io,f.publicIo,owner,{aliases:['123456789']});
  f.sources.push({video_id:videoId,source_revision:'a'.repeat(64)});
  await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,owner,m,[0]),/other_revision/);assert.equal(f.writes.length,0);
});
test('incomplete selection, outsider owner, wrong scope and duplicate indices cannot execute',async()=>{
  const f=fixture(),m=await dryRunReviewedCaptions(f.io,f.publicIo,owner,{aliases:['123456789']});
  await assert.rejects(dryRunReviewedCaptions(f.io,f.publicIo,owner,{aliases:['outsider']}),/scope_invalid/);
  await assert.rejects(dryRunReviewedCaptions(f.io,f.publicIo,owner,{aliases:['123456789','123456789']}),/aliases_required/);
  await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,owner,{...m,selection_complete:false},[0]),/manifest_invalid/);
  await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,owner,{...m,product_ids:['other']},[0]),/manifest_invalid/);
  await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,'00000000-0000-4000-8000-000000000002',m,[0]),/owner_required/);
  await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,owner,m,[0,0]),/batch_invalid/);
  const oversized=structuredClone(m);oversized.sources[0].chars=1000001;
  await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,owner,oversized,[0]),/batch_not_ready/);assert.equal(f.writes.length,0);
});
test('every alias of a deduplicated source is rechecked before import',async()=>{
  const f=fixture();f.blocks.push({...f.blocks[0],id:'b2',content:{url:'https://kinescope.io/secondAlias'}});
  const m=await dryRunReviewedCaptions(f.io,f.publicIo,owner,{aliases:['123456789','secondAlias']});assert.equal(m.sources.length,1);
  f.publicIo.page=async alias=>html(alias==='secondAlias'?'22222222-2222-4222-8222-222222222222':videoId);
  await assert.rejects(importReviewedCaptionBatch(f.io,f.publicIo,owner,m,[0]),/alias_changed/);assert.equal(f.writes.length,0);
});
