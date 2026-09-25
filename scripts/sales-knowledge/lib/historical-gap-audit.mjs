import {inspectEvent} from './historical-live-captions.mjs';
import {parsePublicPlayer} from './reviewed-captions.mjs';
import {captionGaps,captureGaps} from './gap-media.mjs';
import {STT_MODEL,sha} from './course-stt.mjs';
import {randomUUID} from 'node:crypto';

const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);

/** Historical live events have no lesson binding. The source identity is checked
 * against the existing event importer, then against the public player and VTT. */
export async function inspectHistoricalGap(io,publicIo,actor,eventId){
  const snapshot=await inspectEvent(io,actor,eventId);
  if(snapshot.source.status!=='quality_review'
    ||!snapshot.source.quality_flags.includes('late_start'))throw Error('historical_gap_not_required');
  const alias=snapshot.source.video_id;
  const player=parsePublicPlayer(await publicIo.page(alias),{includeHls:true});
  if(player.video_id!==alias||player.duration_ms!==snapshot.source.duration_ms)
    throw Error('historical_public_player_mismatch');
  const raw=await publicIo.caption(player.subtitle_url);
  const gap=captionGaps(raw,snapshot.source.duration_ms,{historicalLeadingGap:true});
  if(gap.caption_sha256!==snapshot.source.subtitle_sha256
    ||gap.content_sha256!==snapshot.source.content_sha256
    ||canonical(gap.quality_flags)!==canonical(snapshot.source.quality_flags))
    throw Error('historical_caption_changed');
  const sources=await io.rows('course_transcription_sources','id,source_revision,source_scope,enabled,duration_ms',
    {video_id:`eq.${alias}`});
  if(sources.length>1||sources.some(s=>s.source_scope!=='historical_live_event'
    ||s.source_revision!==snapshot.source.source_revision||s.duration_ms!==snapshot.source.duration_ms
    ||s.enabled!==true))throw Error('historical_source_conflict');
  if(sources.length){
    const lessonBindings=await io.rows('course_transcription_bindings','source_id',{source_id:`eq.${sources[0].id}`});
    if(lessonBindings.length)throw Error('historical_lesson_binding_forbidden');
    const eventBindings=await io.rows('course_historical_event_bindings','source_id,live_event_id',
      {source_id:`eq.${sources[0].id}`});
    if(eventBindings.length!==1||eventBindings[0].live_event_id!==eventId)
      throw Error('historical_event_binding_changed');
  }
  return {identity:{event:snapshot.event,source:snapshot.source,...gap},raw,hlsUrl:player.hls_url};
}

/** Read-only dry-run captures only the uncovered leading audio and hashes it.
 * Neither the VTT nor audio bytes are returned in the shareable manifest. */
export async function prepareHistoricalGapAudit(io,publicIo,actor,eventId,media){
  const before=await inspectHistoricalGap(io,publicIo,actor,eventId);
  const capture=await captureGaps(publicIo,media,before.hlsUrl,before.identity.gaps,before.identity.source.duration_ms);
  const after=await inspectHistoricalGap(io,publicIo,actor,eventId);
  if(canonical(before.identity)!==canonical(after.identity)||before.raw!==after.raw)
    throw Error('historical_gap_source_changed');
  const manifest={schema_version:1,mode:'historical_leading_gap_dry_run',model:STT_MODEL,
    ...before.identity,captures:capture.captures,playlist_duration_ms:capture.playlist_duration_ms,
    parts:capture.parts.map(({wav,...part})=>part),stt_calls:0};
  if(manifest.parts.length!==3||manifest.gaps.length!==1||manifest.gaps[0].start_ms!==0
    ||manifest.parts[0].start_ms!==0||manifest.parts.at(-1).end_ms!==manifest.gaps[0].end_ms)
    throw Error('historical_gap_expected_parts_changed');
  if(sha(before.raw)!==manifest.caption_sha256)throw Error('historical_caption_changed');
  return {manifest,raw:before.raw,parts:capture.parts};
}

/** Service-only, idempotent evidence collection. A claim is persisted before
 * every paid call; an uncertain outcome is held and never retried here. */
export async function executeHistoricalGapAudit(io,publicIo,actor,approved,captured,transcribe,onProgress=async()=>{}){
  if(approved?.schema_version!==1||approved.mode!=='historical_leading_gap_dry_run'
    ||approved.model!==STT_MODEL||!same(approved,captured.manifest)
    ||sha(captured.raw)!==approved.caption_sha256||approved.stt_calls!==0
    ||!Array.isArray(captured.parts)||captured.parts.length!==3
    ||approved.parts?.length!==3||approved.gaps?.length!==1||approved.gaps[0].start_ms!==0)
    throw Error('historical_gap_manifest_changed');
  for(const [i,p] of captured.parts.entries()){
    const {wav,...metadata}=p;
    if(!same(metadata,approved.parts[i])||p.part_index!==i||p.gap_index!==0
      ||!Buffer.isBuffer(wav)||sha(wav)!==p.audio_sha256||wav.length!==p.bytes
      ||p.start_ms!==(i?captured.parts[i-1].end_ms:0)
      ||p.end_ms<=p.start_ms||p.end_ms-p.start_ms>90000
      ||Math.abs((wav.length-44)/32-(p.end_ms-p.start_ms))>1)
      throw Error('historical_gap_part_changed');
  }
  if(captured.parts.at(-1).end_ms!==approved.gaps[0].end_ms)
    throw Error('historical_gap_coverage_changed');
  const fresh=async()=>{
    const now=await inspectHistoricalGap(io,publicIo,actor,approved.event.id);
    if(!same(now.identity,{event:approved.event,source:approved.source,gaps:approved.gaps,
      caption_sha256:approved.caption_sha256,content_sha256:approved.content_sha256,
      chars:approved.chars,quality_flags:approved.quality_flags})||now.raw!==captured.raw)
      throw Error('historical_gap_source_changed');
  };
  await fresh();
  let sources=await io.rows('course_transcription_sources','*',{video_id:`eq.${approved.source.video_id}`});
  if(sources.some(s=>s.source_scope!=='historical_live_event'
    ||s.source_revision!==approved.source.source_revision))throw Error('historical_source_conflict');
  if(!sources.length){
    await io.write('course_transcription_sources',{id:randomUUID(),provider:'kinescope',
      video_id:approved.source.video_id,source_revision:approved.source.source_revision,
      source_scope:'historical_live_event',revision_basis:'provider_api',
      duration_ms:approved.source.duration_ms,enabled:true,created_by:actor},
    'provider,video_id,source_revision');
    sources=await io.rows('course_transcription_sources','*',{video_id:`eq.${approved.source.video_id}`});
  }
  const s=sources[0];
  if(sources.length!==1||s.enabled!==true||s.source_scope!=='historical_live_event'
    ||s.revision_basis!=='provider_api'||s.duration_ms!==approved.source.duration_ms
    ||s.source_revision!==approved.source.source_revision)throw Error('historical_source_readback_failed');
  if((await io.rows('course_transcription_bindings','source_id',{source_id:`eq.${s.id}`})).length
    ||(await io.rows('course_transcripts','source_id',{source_id:`eq.${s.id}`})).length
    ||(await io.rows('course_transcription_jobs','source_id',{source_id:`eq.${s.id}`})).length)
    throw Error('historical_source_already_used');
  await io.write('course_historical_event_bindings',{source_id:s.id,live_event_id:approved.event.id,
    product_id:approved.event.product_id,provider_live_event_id:approved.event.provider_live_event_id,
    provider_project_id:approved.event.provider_project_id,event_updated_at:approved.event.event_updated_at,
    created_by:actor},'source_id');
  const bindings=await io.rows('course_historical_event_bindings','*',{source_id:`eq.${s.id}`});
  if(bindings.length!==1||bindings[0].live_event_id!==approved.event.id
    ||bindings[0].product_id!==approved.event.product_id
    ||bindings[0].provider_live_event_id!==approved.event.provider_live_event_id
    ||bindings[0].provider_project_id!==approved.event.provider_project_id
    ||Date.parse(bindings[0].event_updated_at)!==Date.parse(approved.event.event_updated_at))
    throw Error('historical_event_binding_readback_failed');
  await fresh();
  const manifestHash=sha(canonical(approved));
  const parts=captured.parts.map(({part_index,gap_index,start_ms,end_ms,audio_sha256})=>
    ({part_index,gap_index,start_ms,end_ms,audio_sha256}));
  const args={_source_id:s.id,_actor:actor,_source_revision:s.source_revision,_raw_vtt:captured.raw,
    _caption_sha256:approved.caption_sha256,_manifest_sha256:manifestHash,_parts:parts};
  const audit=await io.rpc('course_gap_audit_create',args);
  const replay=await io.rpc('course_gap_audit_create',args);
  if(!uuid(audit.audit_id)||replay.audit_id!==audit.audit_id||replay.reused!==true)
    throw Error('historical_audit_create_readback_failed');
  const audits=await io.rows('course_caption_gap_audits','*',{id:`eq.${audit.audit_id}`}),a=audits[0];
  if(audits.length!==1||a.source_id!==s.id||a.source_revision!==s.source_revision
    ||a.caption_sha256!==approved.caption_sha256||a.raw_vtt!==captured.raw
    ||a.manifest_sha256!==manifestHash||a.expected_parts!==3
    ||a.classification!=='paid_private'||a.quality_status!=='unreviewed')
    throw Error('historical_audit_readback_failed');
  let calls=0;
  for(const p of captured.parts){
    await fresh();
    const claim=await io.rpc('course_gap_claim',{_audit_id:a.id,_part_index:p.part_index,
      _audio_sha256:p.audio_sha256,_manifest_sha256:manifestHash});
    if(claim.action==='cached')continue;
    if(claim.action!=='transcribe'||!uuid(claim.claim_token)
      ||claim.start_ms!==p.start_ms||claim.end_ms!==p.end_ms)throw Error('historical_gap_part_held');
    let result;
    try{
      await onProgress({audit_id:a.id,stt_calls:calls,inflight_part:p.part_index,
        inflight_outcome:'unknown',possible_additional_call:1});
      calls++;result=await transcribe(p.wav);
      if(typeof result!=='string'||!result.trim()||result.length>100000||!/[а-яё]/i.test(result))
        throw Error('historical_asr_invalid');
    }catch{
      await io.rpc('course_gap_finish',{_audit_id:a.id,_part_index:p.part_index,
        _claim_token:claim.claim_token,_text:typeof result==='string'&&result.length<=100000?result:null,
        _error_code:'asr_outcome_uncertain'}).catch(()=>{});
      await onProgress({audit_id:a.id,stt_calls:calls,held_part:p.part_index});
      throw Error('historical_asr_uncertain');
    }
    const finish={_audit_id:a.id,_part_index:p.part_index,_claim_token:claim.claim_token,
      _text:result,_error_code:null};
    const saved=await io.rpc('course_gap_finish',finish);
    const again=await io.rpc('course_gap_finish',finish);
    if(saved.status!=='evidence'||again.status!=='evidence'||again.reused!==true)
      throw Error('historical_evidence_readback_failed');
    await onProgress({audit_id:a.id,stt_calls:calls,completed_part:p.part_index});
  }
  await fresh();
  const saved=await io.rows('course_caption_gap_parts','*',{audit_id:`eq.${a.id}`,order:'part_index.asc'});
  if(saved.length!==3||saved.some((p,i)=>!same(parts[i],Object.fromEntries(
    Object.keys(parts[i]).map(k=>[k,p[k]])))||p.status!=='evidence'||p.attempts!==1
    ||typeof p.asr_text!=='string'||p.text_sha256!==sha(p.asr_text)))
    throw Error('historical_parts_readback_failed');
  const final=await io.rows('course_caption_gap_audits','status,quality_status',{id:`eq.${a.id}`});
  if(final.length!==1||final[0].status!=='evidence'||final[0].quality_status!=='unreviewed')
    throw Error('historical_status_readback_failed');
  return {audit_id:a.id,source_id:s.id,stt_calls:calls,cached:calls===0,
    parts:saved.map(p=>({part_index:p.part_index,start_ms:p.start_ms,end_ms:p.end_ms,
      chars:[...p.asr_text].length,text_sha256:p.text_sha256})),
    quality_status:'unreviewed',classification:'paid_private',lesson_bindings_created:0,
    not_quality_approval:true};
}
