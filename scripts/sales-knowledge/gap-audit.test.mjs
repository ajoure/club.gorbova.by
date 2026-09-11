import test from 'node:test';
import assert from 'node:assert/strict';
import {captionGaps,audioPlaylist,parseAudioPlaylist,gapRange,createGapMedia} from './lib/gap-media.mjs';
import {prepareGapAudit,executeGapAudit} from './lib/gap-audit.mjs';
import {COURSE_PRODUCT_IDS} from './lib/course-provider-import.mjs';
import {sha} from './lib/course-stt.mjs';
const owner='00000000-0000-4000-8000-000000000001',video='11111111-1111-4111-8111-111111111111';
const auditId='22222222-2222-4222-8222-222222222222',token='33333333-3333-4333-8333-333333333333';
const raw='WEBVTT\n\n00:00:00.000 --> 00:02:00.000\nТекст учебной конференции, первая часть разговора.\n\n00:04:11.000 --> 00:06:00.000\nПродолжение разговора, подробное обсуждение учебных вопросов.\n';
const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n';
const playlist='#EXTM3U\n#EXT-X-MAP:URI="audio.m4a",BYTERANGE="4@0"\n'+Array.from({length:90},(_,i)=>`#EXTINF:4,\n#EXT-X-BYTERANGE:4@${4+i*4}\naudio.m4a`).join('\n')+'\n#EXT-X-ENDLIST';
function fixture(){
 const state={active:true,revision:1,raw,writes:0,paid:0},sources=[],bindings=[],audits=[],parts=[];
 const io={
   async rows(table){return ({training_modules:[{id:'m',product_id:COURSE_PRODUCT_IDS[1],is_active:state.active}],
     training_lessons:[{id:'l',module_id:'m',product_id:COURSE_PRODUCT_IDS[1],is_active:true}],
     lesson_blocks:[{id:'b',lesson_id:'l',block_type:'video',content:{url:'https://kinescope.io/testAlias'},updated_at:'2026-01-01'}],
     integration_instances:[{id:'i',config:{api_token:'synthetic-secret'}}],course_transcription_sources:sources,
     course_transcription_bindings:bindings,course_transcripts:[],course_caption_gap_audits:audits,course_caption_gap_parts:parts})[table];},
   async provider(){return {data:{id:video,duration:360,version:state.revision,updated_at:'2026-01-01',audio_tracks:[{id:'44444444-4444-4444-8444-444444444444',file_size:100000000,download_link:'https://kinescopecdn.net/audio?secret=synthetic'}]}};},
   async write(table,data){state.writes++;if(table==='course_transcription_sources')sources.push({...data,revision_basis:'provider_api'});if(table==='course_transcription_bindings'&&!bindings.length)bindings.push(data);},
   async rpc(name,a){
     if(name==='has_role_v2')return a._user_id===owner;
     if(name==='course_gap_audit_create'){
       const reused=audits.length>0;if(!reused){audits.push({id:auditId,source_id:a._source_id,source_revision:a._source_revision,
         raw_vtt:a._raw_vtt,caption_sha256:a._caption_sha256,manifest_sha256:a._manifest_sha256,expected_parts:a._parts.length,classification:'paid_private',quality_status:'unreviewed',status:'pending'});
         parts.push(...a._parts.map(p=>({...p,status:'pending',attempts:0})));}return {audit_id:auditId,reused};
     }
     const p=parts[a._part_index];
     if(name==='course_gap_claim'){
       if(p.status==='evidence')return {action:'cached'};
       if(p.status!=='pending'||audits[0].status==='review_required')return {action:'hold'};
       p.status='claimed';p.attempts=1;return {action:'transcribe',claim_token:token,start_ms:p.start_ms,end_ms:p.end_ms};
     }
     if(name==='course_gap_finish'){
       if(a._error_code){p.status='uncertain';audits[0].status='review_required';return {status:'uncertain'};}
       const reused=p.status==='evidence';p.status='evidence';p.asr_text=a._text.trim();p.text_sha256=sha(p.asr_text);
       if(parts.every(p=>p.status==='evidence'))audits[0].status='evidence';return {status:'evidence',reused};
     }throw Error('unexpected_rpc');
   },
 };
 const publicIo={page:async()=>`playerOptions = ${JSON.stringify({playlist:[{id:video,meta:{duration:360},vtt:[{srcLang:'ru',src:'https://kinescopecdn.net/ru.vtt'}],sources:{hls:{src:'https://kinescopecdn.net/master.m3u8'}}}]})};`,
   caption:async url=>url.endsWith('ru.vtt')?state.raw:url.endsWith('master.m3u8')?master:playlist};
 const media={range:async(u,o,n)=>Buffer.alloc(n,1),decode:async(b,t,d)=>Buffer.alloc(d*32,1)};
 return {io,publicIo,media,state,audits,parts,transcribe:async()=>{state.paid++;return 'Пример распознанной реплики.';}};
}
test('strict caption gap extraction uses union coverage, exact offsets and budget',()=>{
 assert.deepEqual(captionGaps(raw,360000).gaps,[{gap_index:0,start_ms:120000,end_ms:251000}]);
 assert.throws(()=>captionGaps(raw.replace('00:04:11.000','00:01:00.000'),360000),/gap_budget/);
 assert.throws(()=>captionGaps(raw.replace('00:04:11.000','00:20:00.000').replace('00:06:00.000','00:22:00.000'),1320000),/quality_flags|gap_budget/);
});
test('HLS selection verifies explicit contiguous ranges and rejects unsupported/encrypted playlists',()=>{
 const url=audioPlaylist(master,'https://kinescopecdn.net/master.m3u8');assert.equal(url,'https://kinescopecdn.net/audio.m3u8');
 const p=parseAudioPlaylist(playlist,url,360000),range=gapRange(p,{start_ms:120000,end_ms:251000});
 assert.deepEqual(range,{url:'https://kinescopecdn.net/audio.m4a',offset:124,bytes:132,trim_ms:0});
 for(const invalid of [playlist.replace('4@124','4'),playlist+'\n#EXT-X-KEY:METHOD=AES-128',playlist+'\n#EXT-X-DISCONTINUITY',playlist.replace('#EXT-X-ENDLIST','')])assert.throws(()=>parseAudioPlaylist(invalid,url,360000));
 assert.throws(()=>parseAudioPlaylist(playlist,url,362000),/duration_mismatch/);
 p.segments[31].offset++;assert.throws(()=>gapRange(p,{start_ms:120000,end_ms:251000}),/not_contiguous/);
 assert.throws(()=>audioPlaylist(master.replace('audio.m3u8','https://evil.test/audio'),'https://kinescopecdn.net/master'),/host_not_allowed/);
});
test('range fetch is credentialless and requires exact 206 response, boundaries and byte count',async()=>{
 let calls=0;const m=createGapMedia(async(u,o)=>{calls++;assert.equal(o.credentials,'omit');assert.deepEqual(o.headers,{Range:'bytes=10-13'});return new Response('data',{status:206,headers:{'content-range':'bytes 10-13/100'}});});
 assert.equal((await m.range('https://kinescopecdn.net/audio',10,4)).toString(),'data');assert.equal(calls,1);
 for(const response of [new Response('data'),new Response('data',{status:206,headers:{'content-range':'bytes 11-14/100'}}),new Response('x',{status:206,headers:{'content-range':'bytes 10-13/100'}}),new Response(null,{status:302,headers:{location:'https://evil.test/a'}})])
   await assert.rejects(createGapMedia(async()=>response).range('https://kinescopecdn.net/audio',10,4));
});
test('dry run captures sparse windows only, emits no URLs/text/credentials and performs no writes/STT',async()=>{
 const f=fixture(),c=await prepareGapAudit(f.io,f.publicIo,owner,'testAlias',f.media);
 assert.equal(c.parts.length,2);assert.equal(c.parts[0].start_ms,120000);assert.equal(c.parts[1].end_ms,251000);
 assert.equal(f.state.writes,0);assert.equal(f.state.paid,0);assert.doesNotMatch(JSON.stringify(c.manifest),/https:|synthetic|Пример|Текст|wav/);
});
test('execute keeps raw VTT separate and private; two evidence parts, exact readback, replay zero calls',async()=>{
 const f=fixture(),c=await prepareGapAudit(f.io,f.publicIo,owner,'testAlias',f.media);
 const r=await executeGapAudit(f.io,f.publicIo,owner,c.manifest,c,f.transcribe);assert.equal(r.stt_calls,2);assert.equal(r.not_quality_approval,true);assert.equal(f.audits[0].raw_vtt,raw);
 const again=await executeGapAudit(f.io,f.publicIo,owner,c.manifest,c,f.transcribe);assert.equal(again.stt_calls,0);assert.equal(again.cached,true);assert.equal(f.state.paid,2);
});
for(const type of ['manifest','wav','revision','caption','active'])test(`changed ${type} stops before writes and billing`,async()=>{
 const f=fixture(),c=await prepareGapAudit(f.io,f.publicIo,owner,'testAlias',f.media),approved=structuredClone(c.manifest);
 if(type==='manifest')approved.parts[0].start_ms++;if(type==='wav')c.parts[0].wav[50]^=1;if(type==='revision')f.state.revision++;
 if(type==='caption')f.state.raw=raw.replace('Текст','Другой текст');if(type==='active')f.state.active=false;
 await assert.rejects(executeGapAudit(f.io,f.publicIo,owner,approved,c,f.transcribe));assert.equal(f.state.paid,0);assert.equal(f.state.writes,0);
});
for(const result of ['',null,'English',new Error('timeout')])test(`uncertain ASR (${String(result)}) is held without retry or silence conclusion`,async()=>{
 const f=fixture(),c=await prepareGapAudit(f.io,f.publicIo,owner,'testAlias',f.media),call=async()=>{f.state.paid++;if(result instanceof Error)throw result;return result;};
 await assert.rejects(executeGapAudit(f.io,f.publicIo,owner,c.manifest,c,call),/gap_asr_uncertain/);
 assert.equal(f.audits[0].status,'review_required');await assert.rejects(executeGapAudit(f.io,f.publicIo,owner,c.manifest,c,call),/gap_part_held/);assert.equal(f.state.paid,1);
});
