import {randomUUID} from 'node:crypto';
import {readCourseBindings,COURSE_PRODUCT_IDS,safeSubtitleUrl} from './course-provider-import.mjs';
import {parsePublicPlayer} from './reviewed-captions.mjs';
import {providerRevision} from './subtitles.mjs';
import {STT_MODEL,sha} from './course-stt.mjs';
import {captionGaps,captureGaps} from './gap-media.mjs';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);

export async function inspectGapSource(io,publicIo,actor,alias){
  if(!uuid(actor)||!/^[-a-zA-Z0-9]+$/.test(alias||'')||await io.rpc('has_role_v2',{_user_id:actor,_role_code:'super_admin'})!==true)throw Error('owner_required');
  const snapshot=await readCourseBindings(io);
  const bindings=snapshot.bindings.filter(b=>b.alias===alias).sort((a,b)=>a.block_id.localeCompare(b.block_id));
  if(!bindings.length||bindings.some(b=>b.lesson_active!==true||b.module_active!==true))throw Error('active_course_binding_required');
  const integrations=await io.rows('integration_instances','id,config',{provider:'eq.kinescope',status:'eq.connected'});
  if(integrations.length!==1||typeof integrations[0].config?.api_token!=='string')throw Error('kinescope_connection_ambiguous');
  const response=await io.provider('/videos/'+alias,integrations[0].config.api_token),video=response?.data??response;
  const revision=providerRevision(video),duration=Math.round(video.duration*1000),tracks=video.audio_tracks;
  if(!uuid(video.id)||duration<1000||duration>21600000||!Array.isArray(tracks)||tracks.length!==1)throw Error('gap_source_metadata_invalid');
  const audio=tracks[0];if(!uuid(audio.id)||!Number.isSafeInteger(audio.file_size)||audio.file_size<1)throw Error('audio_metadata_required');
  safeSubtitleUrl(audio.download_link); // Validate identity metadata; only sparse public HLS is fetched.
  const player=parsePublicPlayer(await publicIo.page(alias),{includeHls:true});
  if(player.video_id!==video.id||Math.abs(player.duration_ms-duration)>1)throw Error('public_provider_mismatch');
  const raw=await publicIo.caption(player.subtitle_url),caption=captionGaps(raw,duration);
  return {identity:{alias,video_id:video.id,source_revision:revision,duration_ms:duration,
    audio_track_id:audio.id,audio_bytes:audio.file_size,bindings,...caption},raw,hlsUrl:player.hls_url};
}

export async function prepareGapAudit(io,publicIo,actor,alias,media){
  const initial=await inspectGapSource(io,publicIo,actor,alias);
  const capture=await captureGaps(publicIo,media,initial.hlsUrl,initial.identity.gaps,initial.identity.duration_ms);
  const final=await inspectGapSource(io,publicIo,actor,alias);
  if(!same(initial.identity,final.identity)||initial.raw!==final.raw)throw Error('gap_source_changed');
  const manifest={schema_version:1,mode:'caption_gap_dry_run',model:STT_MODEL,product_ids:COURSE_PRODUCT_IDS,
    source:initial.identity,captures:capture.captures,playlist_duration_ms:capture.playlist_duration_ms,
    parts:capture.parts.map(({wav,...p})=>p),stt_calls:0};
  return {manifest,raw:initial.raw,parts:capture.parts};
}

export async function executeGapAudit(io,publicIo,actor,approved,captured,transcribe,onProgress=async()=>{}){
  if(approved?.schema_version!==1||approved.mode!=='caption_gap_dry_run'||approved.model!==STT_MODEL
    ||!same(approved.product_ids,COURSE_PRODUCT_IDS)||!same(approved,captured.manifest)
    ||sha(captured.raw)!==approved.source?.caption_sha256)throw Error('gap_manifest_changed');
  const source=approved.source,manifestHash=sha(canonical(approved));
  if(!Array.isArray(captured.parts)||!captured.parts.length||captured.parts.length>7
    ||captured.parts.reduce((n,p)=>n+p.end_ms-p.start_ms,0)>600000)throw Error('gap_budget');
  for(const [index,p] of captured.parts.entries()){
    const {wav,...metadata}=p,gap=source.gaps?.[p.gap_index];
    if(!same(metadata,approved.parts[index])||p.part_index!==index||!Buffer.isBuffer(wav)||sha(wav)!==p.audio_sha256
      ||wav.length!==p.bytes||!gap||p.start_ms<gap.start_ms||p.end_ms>gap.end_ms+1||p.end_ms<=p.start_ms
      ||p.end_ms-p.start_ms>90000||Math.abs((wav.length-44)/32-(p.end_ms-p.start_ms))>1)throw Error('gap_part_hash_mismatch');
  }
  for(const gap of source.gaps){
    const windows=captured.parts.filter(p=>p.gap_index===gap.gap_index);
    if(!windows.length||windows[0].start_ms!==gap.start_ms||Math.abs(windows.at(-1).end_ms-gap.end_ms)>1
      ||windows.some((p,i)=>i>0&&p.start_ms!==windows[i-1].end_ms))throw Error('gap_coverage_mismatch');
  }
  const fresh=async()=>{
    const current=await inspectGapSource(io,publicIo,actor,source.alias);
    if(!same(current.identity,source)||current.raw!==captured.raw)throw Error('gap_source_changed');
  };
  await fresh();
  let sources=await io.rows('course_transcription_sources','*',{video_id:`eq.${source.video_id}`});
  if(sources.some(s=>s.source_revision!==source.source_revision))throw Error('source_revision_conflict');
  if(!sources.length){
    await io.write('course_transcription_sources',{id:randomUUID(),provider:'kinescope',video_id:source.video_id,
      source_revision:source.source_revision,duration_ms:source.duration_ms,audio_track_id:source.audio_track_id,
      audio_bytes:source.audio_bytes,enabled:true,created_by:actor},'provider,video_id,source_revision');
    sources=await io.rows('course_transcription_sources','*',{video_id:`eq.${source.video_id}`});
  }
  const s=sources[0];
  if(sources.length!==1||s.enabled!==true||s.revision_basis!=='provider_api'
    ||['duration_ms','audio_track_id','audio_bytes','source_revision'].some(k=>s[k]!==source[k]))throw Error('source_readback_failed');
  if((await io.rows('course_transcripts','source_id',{source_id:`eq.${s.id}`})).length)throw Error('full_transcript_already_exists');
  for(const b of source.bindings)await io.write('course_transcription_bindings',{
    source_id:s.id,lesson_id:b.lesson_id,block_id:b.block_id,product_id:b.product_id,block_updated_at:b.block_updated_at},'source_id,block_id');
  const links=await io.rows('course_transcription_bindings','*',{source_id:`eq.${s.id}`});
  if(links.length!==source.bindings.length||source.bindings.some(b=>!links.some(l=>l.block_id===b.block_id
    &&l.lesson_id===b.lesson_id&&l.product_id===b.product_id&&Date.parse(l.block_updated_at)===Date.parse(b.block_updated_at))))throw Error('binding_readback_failed');
  const parts=captured.parts.map(({part_index,gap_index,start_ms,end_ms,audio_sha256})=>({part_index,gap_index,start_ms,end_ms,audio_sha256}));
  const args={_source_id:s.id,_actor:actor,_source_revision:source.source_revision,_raw_vtt:captured.raw,
    _caption_sha256:source.caption_sha256,_manifest_sha256:manifestHash,_parts:parts};
  const audit=await io.rpc('course_gap_audit_create',args),replay=await io.rpc('course_gap_audit_create',args);
  if(!uuid(audit.audit_id)||replay.audit_id!==audit.audit_id||replay.reused!==true)throw Error('audit_create_readback_failed');
  const rows=await io.rows('course_caption_gap_audits','*',{id:`eq.${audit.audit_id}`}),a=rows[0];
  if(rows.length!==1||a.source_id!==s.id||a.source_revision!==source.source_revision||a.raw_vtt!==captured.raw
    ||a.caption_sha256!==sha(a.raw_vtt)||a.manifest_sha256!==manifestHash||a.expected_parts!==parts.length
    ||a.classification!=='paid_private'||a.quality_status!=='unreviewed')throw Error('raw_caption_readback_failed');
  let calls=0;const completed=[];
  for(const p of captured.parts){
    await fresh();
    const claim=await io.rpc('course_gap_claim',{_audit_id:a.id,_part_index:p.part_index,_audio_sha256:p.audio_sha256,_manifest_sha256:manifestHash});
    if(claim.action==='cached'){completed.push({part_index:p.part_index,cached:true});continue;}
    if(claim.action!=='transcribe'||!uuid(claim.claim_token)||claim.start_ms!==p.start_ms||claim.end_ms!==p.end_ms)throw Error('gap_part_held');
    let text;
    try{
      await onProgress({audit_id:a.id,stt_calls:calls,inflight_part:p.part_index,inflight_outcome:'unknown',possible_additional_call:1,completed});
      calls++;text=await transcribe(p.wav);
      if(typeof text!=='string'||!text.trim()||text.length>100000||!/[а-яё]/i.test(text))throw Error('gap_asr_invalid');
    }catch{
      await io.rpc('course_gap_finish',{_audit_id:a.id,_part_index:p.part_index,_claim_token:claim.claim_token,
        _text:typeof text==='string'&&text.length<=100000?text:null,_error_code:'asr_outcome_uncertain'}).catch(()=>{});
      await onProgress({audit_id:a.id,stt_calls:calls,held_part:p.part_index,completed});throw Error('gap_asr_uncertain');
    }
    const finish={_audit_id:a.id,_part_index:p.part_index,_claim_token:claim.claim_token,_text:text,_error_code:null};
    const saved=await io.rpc('course_gap_finish',finish),again=await io.rpc('course_gap_finish',finish);
    if(saved.status!=='evidence'||again.status!=='evidence'||again.reused!==true)throw Error('gap_finish_readback_failed');
    completed.push({part_index:p.part_index,sha256:sha(text.trim()),cached:false});
    await onProgress({audit_id:a.id,stt_calls:calls,completed});
  }
  await fresh();
  const saved=await io.rows('course_caption_gap_parts','*',{audit_id:`eq.${a.id}`,order:'part_index.asc'});
  if(saved.length!==parts.length||saved.some((p,i)=>!same(parts[i],Object.fromEntries(Object.keys(parts[i]).map(k=>[k,p[k]])))
    ||p.status!=='evidence'||p.attempts!==1||typeof p.asr_text!=='string'||p.text_sha256!==sha(p.asr_text)
    ||(completed[i].cached!==true&&completed[i].sha256!==p.text_sha256)))throw Error('gap_evidence_readback_failed');
  const final=await io.rows('course_caption_gap_audits','status,quality_status',{id:`eq.${a.id}`});
  if(final.length!==1||final[0].status!=='evidence'||final[0].quality_status!=='unreviewed')throw Error('gap_status_readback_failed');
  return {audit_id:a.id,source_id:s.id,stt_calls:calls,cached:calls===0,parts:saved.map(p=>({part_index:p.part_index,
    gap_index:p.gap_index,start_ms:p.start_ms,end_ms:p.end_ms,chars:[...p.asr_text].length,text_sha256:p.text_sha256})),
    caption_sha256:a.caption_sha256,caption_chars:source.chars,quality_status:'unreviewed',not_quality_approval:true,replay_changes:0};
}
