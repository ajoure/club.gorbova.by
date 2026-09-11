import {createHash,randomUUID} from 'node:crypto';
import {readCourseBindings,COURSE_PRODUCT_IDS,safeSubtitleUrl} from './course-provider-import.mjs';
import {providerRevision} from './subtitles.mjs';
import {audioWindows} from './transcript.mjs';

export const STT_MODEL='openai/gpt-4o-transcribe';
export const STT_ENDPOINT='https://ai.gateway.lovable.dev/v1/audio/transcriptions';
export const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const unwrap=x=>x?.data??x;

export function pcmParts(pcm,providerDurationMs){
  if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2)throw Error('pcm_invalid');
  const durationMs=Math.round(pcm.length/32);
  if(!Number.isSafeInteger(providerDurationMs)||providerDurationMs<1000||providerDurationMs>1800000
    ||durationMs<1000||durationMs>1800000||Math.abs(durationMs-providerDurationMs)>1000)throw Error('audio_duration_mismatch');
  return {duration_ms:durationMs,parts:audioWindows(durationMs).map(w=>{
    const body=pcm.subarray(w.start_ms*32,Math.min(w.end_ms*32,pcm.length));
    if(!body.length||Math.abs(body.length/32-(w.end_ms-w.start_ms))>1)throw Error('pcm_window_mismatch');
    const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+body.length,4);
    header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);
    header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);
    header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(body.length,40);
    const wav=Buffer.concat([header,body]);return {...w,bytes:wav.length,audio_sha256:sha(wav),wav};
  })};
}

export async function inspectSttSource(io,actor,alias){
  if(!uuid(actor)||await io.rpc('has_role_v2',{_user_id:actor,_role_code:'super_admin'})!==true)throw Error('owner_required');
  const snapshot=await readCourseBindings(io);
  const bindings=snapshot.bindings.filter(b=>b.alias===alias).sort((a,b)=>a.block_id.localeCompare(b.block_id));
  if(!bindings.length||bindings.some(b=>b.lesson_active!==true||b.module_active!==true))throw Error('active_course_binding_required');
  const integrations=await io.rows('integration_instances','id,config',{provider:'eq.kinescope',status:'eq.connected'});
  if(integrations.length!==1||typeof integrations[0].config?.api_token!=='string')throw Error('kinescope_connection_ambiguous');
  const token=integrations[0].config.api_token;
  const video=unwrap(await io.provider('/videos/'+alias,token));
  const revision=providerRevision(video),duration=Math.round(video.duration*1000);
  if(!uuid(video.id)||duration<1000||duration>1800000)throw Error('source_over_budget');
  const tracks=video.audio_tracks;
  if(!Array.isArray(tracks)||tracks.length!==1)throw Error('single_audio_track_required');
  const audio=tracks[0];
  if(!uuid(audio.id)||!Number.isSafeInteger(audio.file_size)||audio.file_size<1||audio.file_size>60000000)throw Error('audio_metadata_required');
  safeSubtitleUrl(audio.download_link);
  for(let page=1;page<=20;page++){
    const response=await io.provider(`/videos/${video.id}/subtitles?page=${page}&per_page=100`,token);
    const rows=response?.data===null?[]:unwrap(response);
    if(!Array.isArray(rows))throw Error('subtitle_list_invalid');
    if(rows.some(r=>r.language==='ru'))throw Error('reuse_russian_subtitles_required');
    if(rows.length<100)break;if(page===20)throw Error('subtitle_pagination_incomplete');
  }
  const identity={alias,video_id:video.id,source_revision:revision,duration_ms:duration,
    audio_track_id:audio.id,audio_bytes:audio.file_size,bindings};
  return {identity,audioUrl:audio.download_link}; // URL stays in memory, never in manifests/logs.
}

export async function prepareStt(io,actor,alias,media){
  const initial=await inspectSttSource(io,actor,alias);
  const bytes=await media.download(initial.audioUrl,initial.identity.audio_bytes);
  if(bytes.length!==initial.identity.audio_bytes)throw Error('audio_size_mismatch');
  const pcm=await media.decode(bytes),windows=pcmParts(pcm,initial.identity.duration_ms);
  const final=await inspectSttSource(io,actor,alias);
  if(!same(initial.identity,final.identity))throw Error('source_changed_during_capture');
  const manifest={schema_version:1,mode:'course_stt_dry_run',product_ids:COURSE_PRODUCT_IDS,
    model:STT_MODEL,source:initial.identity,media_sha256:sha(bytes),pcm_sha256:sha(pcm),
    decoded_duration_ms:windows.duration_ms,
    parts:windows.parts.map(({wav,...metadata})=>metadata),stt_calls:0};
  return {manifest,parts:windows.parts};
}

export async function executeStt(io,actor,approved,captured,transcribe,onProgress=async()=>{}){
  if(approved?.schema_version!==1||approved.mode!=='course_stt_dry_run'||approved.model!==STT_MODEL
    ||!same(approved.product_ids,COURSE_PRODUCT_IDS)||!same(approved,captured.manifest))throw Error('stt_manifest_changed');
  const source=approved.source;
  const expected=audioWindows(approved.decoded_duration_ms);
  if(expected.length>20||expected.length!==captured.parts.length)throw Error('stt_part_budget');
  for(const [i,p] of captured.parts.entries()){
    if(!same({...expected[i],bytes:p.wav.length,audio_sha256:sha(p.wav)},approved.parts[i]))throw Error('part_hash_mismatch');
  }
  const fresh=await inspectSttSource(io,actor,source.alias);
  if(!same(fresh.identity,source))throw Error('source_changed_before_execute');
  let existing=await io.rows('course_transcription_sources','*',{video_id:`eq.${source.video_id}`});
  if(existing.some(s=>s.source_revision!==source.source_revision))throw Error('existing_source_revision_conflict');
  if(!existing.length){
    await io.write('course_transcription_sources',{id:randomUUID(),provider:'kinescope',video_id:source.video_id,
      source_revision:source.source_revision,duration_ms:source.duration_ms,audio_track_id:source.audio_track_id,
      audio_bytes:source.audio_bytes,enabled:true,created_by:actor},'provider,video_id,source_revision');
    existing=await io.rows('course_transcription_sources','*',{video_id:`eq.${source.video_id}`});
  }
  if(existing.length!==1||existing[0].enabled!==true||existing[0].revision_basis!=='provider_api'
    ||['duration_ms','audio_track_id','audio_bytes','source_revision'].some(k=>existing[0][k]!==source[k]))throw Error('source_readback_failed');
  const id=existing[0].id;
  for(const b of source.bindings)await io.write('course_transcription_bindings',{
    source_id:id,lesson_id:b.lesson_id,block_id:b.block_id,product_id:b.product_id,block_updated_at:b.block_updated_at},'source_id,block_id');
  const linked=await io.rows('course_transcription_bindings','*',{source_id:`eq.${id}`});
  if(linked.length!==source.bindings.length||source.bindings.some(b=>!linked.some(l=>l.block_id===b.block_id
    &&l.lesson_id===b.lesson_id&&l.product_id===b.product_id&&Date.parse(l.block_updated_at)===Date.parse(b.block_updated_at))))throw Error('binding_readback_failed');
  const prior=await io.rows('course_transcripts','*',{source_id:`eq.${id}`});
  const readBack=async(jobId)=>{
    const rows=await io.rows('course_transcripts','*',{source_id:`eq.${id}`});const r=rows[0];
    if(rows.length!==1||r.job_id!==jobId||r.origin!=='stt'||r.classification!=='paid_private'||r.quality_status!=='unreviewed'
      ||r.source_revision!==source.source_revision||r.duration_ms!==approved.decoded_duration_ms
      ||r.content_sha256!==sha(r.transcript_text)||r.char_count!==[...r.transcript_text].length)throw Error('transcript_readback_failed');
    return {source_id:id,job_id:jobId,chars:r.char_count,sha256:r.content_sha256,quality_status:r.quality_status};
  };
  if(prior.length)return {...await readBack(prior[0].job_id),stt_calls:0,cached:true};
  const job=await io.rpc('course_transcription_create_job',{_source_id:id,_actor:actor,_duration_ms:approved.decoded_duration_ms});
  if(!uuid(job.job_id))throw Error('job_readback_failed');
  let calls=0;const completed=[];
  for(const p of captured.parts){
    const now=await inspectSttSource(io,actor,source.alias);
    if(!same(now.identity,source))throw Error('source_changed_before_part');
    const claim=await io.rpc('course_transcription_claim_part',{_job_id:job.job_id,_part_index:p.part_index,
      _audio_sha256:p.audio_sha256,_source_revision:source.source_revision});
    if(claim.action==='cached'){completed.push({part_index:p.part_index,cached:true});continue;}
    if(claim.action!=='transcribe'||!uuid(claim.claim_token)||claim.start_ms!==p.start_ms||claim.end_ms!==p.end_ms)throw Error('part_held');
    let text;
    try{
      // A crash after claim can never cause an automatic second billed call.
      await onProgress({source_id:id,job_id:job.job_id,stt_calls:calls,inflight_part:p.part_index,
        inflight_outcome:'unknown',possible_additional_call:1,completed});
      calls++;text=await transcribe(p.wav);
      if(typeof text!=='string'||!text.trim()||text.length>100000||!/[а-яё]/i.test(text))throw Error('stt_result_invalid');
    }catch{
      await io.rpc('course_transcription_finish_part',{_job_id:job.job_id,_part_index:p.part_index,
        _claim_token:claim.claim_token,_text:null,_error_code:'stt_outcome_uncertain'}).catch(()=>{});
      await onProgress({source_id:id,job_id:job.job_id,stt_calls:calls,held_part:p.part_index,completed});
      throw Error('stt_outcome_uncertain');
    }
    const params={_job_id:job.job_id,_part_index:p.part_index,_claim_token:claim.claim_token,_text:text,_error_code:null};
    const saved=await io.rpc('course_transcription_finish_part',params);
    if(saved.status!=='ready')throw Error('part_save_held');
    const replay=await io.rpc('course_transcription_finish_part',params);
    if(replay.reused!==true||replay.status!=='ready')throw Error('part_replay_failed');
    completed.push({part_index:p.part_index,cached:false,sha256:sha(text.trim())});
    await onProgress({source_id:id,job_id:job.job_id,stt_calls:calls,completed});
  }
  const after=await inspectSttSource(io,actor,source.alias);
  if(!same(after.identity,source))throw Error('source_changed_before_finalize');
  const args={_job_id:job.job_id,_source_revision:source.source_revision};
  await io.rpc('course_transcription_finalize',args);
  const replay=await io.rpc('course_transcription_finalize',args);
  if(replay.reused!==true)throw Error('finalize_replay_failed');
  return {...await readBack(job.job_id),stt_calls:calls,cached:false,completed,replay_changes:0};
}

export function createSttGateway(key,fetchImpl=fetch){
  if(!key)throw Error('stt_credentials_missing');
  return async wav=>{
    if(!Buffer.isBuffer(wav)||wav.length<44||wav.length>3000000)throw Error('stt_audio_invalid');
    const form=new FormData();form.append('model',STT_MODEL);
    form.append('file',new Blob([wav],{type:'audio/wav'}),'part.wav');
    const r=await fetchImpl(STT_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${key}`},
      body:form,redirect:'error',signal:AbortSignal.timeout(180000)});
    if(!r.ok)throw Error('stt_provider_error');
    const reader=r.body?.getReader();if(!reader)throw Error('stt_response_missing');
    let size=0;const chunks=[];
    try{while(true){const part=await reader.read();if(part.done)break;
      size+=part.value.length;if(size>1000000)throw Error('stt_response_too_large');chunks.push(Buffer.from(part.value));}
    }finally{await reader.cancel().catch(()=>{});}
    const payload=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));return payload?.text;
  };
}
