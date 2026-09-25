import test from 'node:test';
import assert from 'node:assert/strict';
import {COURSE_PRODUCT_IDS} from './lib/course-provider-import.mjs';
import {prepareHistoricalGapAudit,executeHistoricalGapAudit} from './lib/historical-gap-audit.mjs';
import {sha} from './lib/course-stt.mjs';

const owner='00000000-0000-4000-8000-000000000001';
const eventId='00000000-0000-4000-8000-000000000002';
const liveId='00000000-0000-4000-8000-000000000003';
const videoId='00000000-0000-4000-8000-000000000004';
const auditId='00000000-0000-4000-8000-000000000005';
const claimToken='00000000-0000-4000-8000-000000000006';
const vtt='WEBVTT\n\n00:03:03.360 --> 01:00:00.000\nПродолжение конференции после отсутствующего начала.\n';
const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n';
const playlist='#EXTM3U\n#EXT-X-MAP:URI="audio.m4a",BYTERANGE="4@0"\n'
  +Array.from({length:900},(_,i)=>`#EXTINF:4,\n#EXT-X-BYTERANGE:4@${4+i*4}\naudio.m4a`).join('\n')
  +'\n#EXT-X-ENDLIST';

function fixture(){
  const state={vtt,version:1,calls:0,writes:0};
  const sources=[],bindings=[],audits=[],parts=[];
  const event={id:eventId,title:'Конференция 5',product_id:COURSE_PRODUCT_IDS[1],
    scheduled_at:'2026-09-13T07:20:00Z',live_started_at:'2026-09-13T07:26:00Z',
    webinar_completed_at:'2026-09-13T12:18:00Z',kinescope_live_event_id:liveId,
    kinescope_project_id:'project-one',updated_at:'2026-09-13T12:19:00Z'};
  const video=()=>({id:videoId,title:'Конференция 5 13 сентября',project_id:'project-one',
    created_at:'2026-09-13T12:14:00Z',updated_at:'2026-09-13T12:15:00Z',
    version:state.version,duration:3600});
  const io={
    async rows(table,_select,filter={}){
      if(table==='integration_instances')return [{id:'i',config:{api_token:'synthetic'}}];
      if(table==='live_events')return [event];
      if(table==='course_transcription_sources')return sources.filter(s=>!filter.video_id||filter.video_id===`eq.${s.video_id}`);
      if(table==='course_historical_event_bindings')return bindings;
      if(table==='course_transcription_bindings'||table==='course_transcripts'||table==='course_transcription_jobs')return [];
      if(table==='course_caption_gap_audits')return audits;
      if(table==='course_caption_gap_parts')return parts;
      throw Error(`unexpected_table_${table}`);
    },
    async liveVideos(){return {data:[{id:videoId}]};},
    async provider(path){
      if(path===`/videos/${videoId}`)return {data:video()};
      if(path===`/videos/${videoId}/subtitles?page=1&per_page=100`)return {data:[{id:'sub',language:'ru',status:'done'}]};
      if(path===`/videos/${videoId}/subtitles/sub`)return {data:{id:'sub',language:'ru',status:'done',url:'https://kinescopecdn.net/sub.vtt'}};
      throw Error(`unexpected_provider_${path}`);
    },
    async subtitle(){return state.vtt;},
    async write(table,row){state.writes++;
      if(table==='course_transcription_sources')sources.push({...row,revision_basis:'provider_api'});
      else if(table==='course_historical_event_bindings'){
        if(!bindings.length)bindings.push(row);
      }
      else throw Error(`unexpected_write_${table}`);
    },
    async rpc(name,args){
      if(name==='has_role_v2')return args._user_id===owner;
      if(name==='course_gap_audit_create'){
        const reused=audits.length>0;
        if(!reused){audits.push({id:auditId,source_id:args._source_id,
          source_revision:args._source_revision,caption_sha256:args._caption_sha256,
          raw_vtt:args._raw_vtt,manifest_sha256:args._manifest_sha256,
          expected_parts:3,classification:'paid_private',quality_status:'unreviewed',status:'pending'});
          parts.push(...args._parts.map(p=>({...p,status:'pending',attempts:0})));}
        return {audit_id:auditId,reused};
      }
      const p=parts[args._part_index];
      if(name==='course_gap_claim'){
        if(p.status==='evidence')return {action:'cached'};
        if(p.status!=='pending')return {action:'hold'};
        p.status='claimed';p.attempts=1;
        return {action:'transcribe',claim_token:claimToken,start_ms:p.start_ms,end_ms:p.end_ms};
      }
      if(name==='course_gap_finish'){
        if(args._error_code){p.status='uncertain';audits[0].status='review_required';return {status:'uncertain'};}
        const reused=p.status==='evidence';p.status='evidence';p.asr_text=args._text.trim();
        p.text_sha256=sha(p.asr_text);
        if(parts.every(x=>x.status==='evidence'))audits[0].status='evidence';
        return {status:'evidence',reused};
      }
      throw Error(`unexpected_rpc_${name}`);
    },
  };
  const publicIo={page:async()=>`playerOptions = ${JSON.stringify({playlist:[{id:videoId,
    meta:{duration:3600},vtt:[{srcLang:'ru',src:'https://kinescopecdn.net/sub.vtt'}],
    sources:{hls:{src:'https://kinescopecdn.net/master.m3u8'}}}]})};`,
    caption:async url=>url.endsWith('sub.vtt')?state.vtt:url.endsWith('master.m3u8')?master:playlist};
  const media={range:async(_url,_offset,bytes)=>Buffer.alloc(bytes,1),
    decode:async(_bytes,_trim,duration)=>Buffer.alloc(duration*32,1)};
  const transcribe=async()=>{state.calls++;return 'Проверяемая реплика из аудио.';};
  return {io,publicIo,media,state,sources,bindings,audits,parts,transcribe};
}

test('historical dry-run captures exactly three opening parts without writes or STT',async()=>{
  const f=fixture(),captured=await prepareHistoricalGapAudit(f.io,f.publicIo,owner,eventId,f.media);
  assert.deepEqual(captured.manifest.parts.map(p=>[p.start_ms,p.end_ms]),
    [[0,90000],[90000,180000],[180000,183360]]);
  assert.equal(f.state.writes,0);assert.equal(f.state.calls,0);
  assert.doesNotMatch(JSON.stringify(captured.manifest),/https:|WEBVTT|Продолжение|wav/);
});

test('historical evidence is private and replay makes zero additional paid calls',async()=>{
  const f=fixture(),captured=await prepareHistoricalGapAudit(f.io,f.publicIo,owner,eventId,f.media);
  const first=await executeHistoricalGapAudit(f.io,f.publicIo,owner,captured.manifest,captured,f.transcribe);
  assert.equal(first.stt_calls,3);assert.equal(first.lesson_bindings_created,0);
  assert.equal(f.bindings.length,1);assert.equal(f.sources[0].source_scope,'historical_live_event');
  assert.equal(f.audits[0].raw_vtt,vtt);
  const replay=await executeHistoricalGapAudit(f.io,f.publicIo,owner,captured.manifest,captured,f.transcribe);
  assert.equal(replay.stt_calls,0);assert.equal(f.state.calls,3);
});

test('source drift and uncertain STT stop without silent retry',async()=>{
  const f=fixture(),captured=await prepareHistoricalGapAudit(f.io,f.publicIo,owner,eventId,f.media);
  f.state.version++;
  await assert.rejects(executeHistoricalGapAudit(f.io,f.publicIo,owner,captured.manifest,captured,f.transcribe),
    /historical_gap_source_changed/);
  assert.equal(f.state.writes,0);assert.equal(f.state.calls,0);
  f.state.version--;
  const uncertain=async()=>{f.state.calls++;throw Error('timeout');};
  await assert.rejects(executeHistoricalGapAudit(f.io,f.publicIo,owner,captured.manifest,captured,uncertain),
    /historical_asr_uncertain/);
  await assert.rejects(executeHistoricalGapAudit(f.io,f.publicIo,owner,captured.manifest,captured,uncertain),
    /historical_gap_part_held/);
  assert.equal(f.state.calls,1);
});
