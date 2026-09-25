import {randomUUID} from 'node:crypto';
import {readCourseBindings,COURSE_PRODUCT_IDS,safeSubtitleUrl} from './course-provider-import.mjs';
import {providerRevision} from './subtitles.mjs';
import {parsePublicPlayer} from './reviewed-captions.mjs';
import {audioPlaylist,parseAudioPlaylist,gapRange} from './gap-media.mjs';
import {audioWindows} from './transcript.mjs';
import {pcmParts,STT_MODEL,sha} from './course-stt.mjs';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const unwrap=x=>x?.data??x;

/** Explicit active lesson selection; never enables or links closed historical modules. */
export async function inspectLongSource(io,publicIo,actor,alias,blockIds){
 if(!uuid(actor)||!/^[-a-zA-Z0-9]+$/.test(alias??'')||await io.rpc('has_role_v2',{_user_id:actor,_role_code:'super_admin'})!==true)throw Error('owner_required');
 if(!Array.isArray(blockIds)||!blockIds.length||blockIds.some(x=>!uuid(x))||new Set(blockIds).size!==blockIds.length)throw Error('explicit_active_bindings_required');
 const snapshot=await readCourseBindings(io);
 const bindings=snapshot.bindings.filter(b=>blockIds.includes(b.block_id)).sort((a,b)=>a.block_id.localeCompare(b.block_id));
 if(bindings.length!==blockIds.length||bindings.some(b=>b.alias!==alias||b.lesson_active!==true||b.module_active!==true))throw Error('active_course_binding_required');
 const integrations=await io.rows('integration_instances','id,config',{provider:'eq.kinescope',status:'eq.connected'});
 if(integrations.length!==1||typeof integrations[0].config?.api_token!=='string')throw Error('kinescope_connection_ambiguous');
 const token=integrations[0].config.api_token,video=unwrap(await io.provider('/videos/'+alias,token));
 const duration=Math.round(video.duration*1000),tracks=video.audio_tracks;
 if(!uuid(video.id)||!Number.isSafeInteger(duration)||duration<=1800000||duration>21600000||!Array.isArray(tracks)||tracks.length!==1)throw Error('long_source_budget');
 const audio=tracks[0];
 if(!uuid(audio.id)||!Number.isSafeInteger(audio.file_size)||audio.file_size<1)throw Error('audio_metadata_required');
 safeSubtitleUrl(audio.download_link);
 for(let page=1;page<=20;page++){
  const response=await io.provider(`/videos/${video.id}/subtitles?page=${page}&per_page=100`,token);
  const rows=response?.data===null?[]:unwrap(response);
  if(!Array.isArray(rows))throw Error('subtitle_list_invalid');
  if(rows.some(r=>r.language==='ru'))throw Error('reuse_russian_subtitles_required');
  if(rows.length<100)break;if(page===20)throw Error('subtitle_pagination_incomplete');
 }
 const player=parsePublicPlayer(await publicIo.page(alias),{includeHls:true,requireRussianCaption:false});
 if(player.subtitle_url)throw Error('reuse_russian_subtitles_required');
 if(player.video_id!==video.id||player.duration_ms!==duration)throw Error('public_provider_mismatch');
 return {identity:{alias,video_id:video.id,source_revision:providerRevision(video),duration_ms:duration,
  audio_track_id:audio.id,audio_bytes:audio.file_size,bindings},hlsUrl:player.hls_url};
}

/** Retains only playlist metadata, init bytes, and one decoded 90-second window. */
export async function openLongAudio(publicIo,media,source){
 const url=audioPlaylist(await publicIo.caption(source.hlsUrl),source.hlsUrl);
 const playlist=parseAudioPlaylist(await publicIo.caption(url),url,source.identity.duration_ms);
 const init=await media.range(playlist.init.url,playlist.init.offset,playlist.init.bytes);
 return async window=>{
  const range=gapRange(playlist,window);
  const fragment=await media.range(range.url,range.offset,range.bytes);
  const pcm=await media.decode(Buffer.concat([init,fragment]),range.trim_ms,window.end_ms-window.start_ms);
  const parts=pcmParts(pcm,window.end_ms-window.start_ms).parts;
  if(parts.length!==1)throw Error('long_window_invalid');
  const wav=parts[0].wav;
  return {...window,bytes:wav.length,audio_sha256:sha(wav),wav};
 };
}

export async function prepareLongStt(io,publicIo,actor,alias,blockIds,media){
 const initial=await inspectLongSource(io,publicIo,actor,alias,blockIds);
 const capture=await openLongAudio(publicIo,media,initial),parts=[];
 for(const window of audioWindows(initial.identity.duration_ms)){
  const {wav,...metadata}=await capture(window);parts.push(metadata);
 }
 const final=await inspectLongSource(io,publicIo,actor,alias,blockIds);
 if(!same(initial.identity,final.identity))throw Error('source_changed_during_capture');
 return {schema_version:1,mode:'long_course_stt_dry_run',model:STT_MODEL,product_ids:COURSE_PRODUCT_IDS,
  source:initial.identity,parts,max_batch_parts:20,stt_calls:0};
}

export function validateLongManifest(m){
 if(m?.schema_version!==1||m.mode!=='long_course_stt_dry_run'||m.model!==STT_MODEL||m.max_batch_parts!==20
  ||m.stt_calls!==0||!same(m.product_ids,COURSE_PRODUCT_IDS)||!uuid(m.source?.video_id)
  ||!Number.isSafeInteger(m.source.duration_ms)||m.source.duration_ms<=1800000||m.source.duration_ms>21600000)throw Error('long_manifest_invalid');
 const windows=audioWindows(m.source.duration_ms);
 if(!Array.isArray(m.parts)||m.parts.length!==windows.length||m.parts.length>240)throw Error('long_manifest_coverage');
 for(const [i,p] of m.parts.entries())if(!same({part_index:p.part_index,start_ms:p.start_ms,end_ms:p.end_ms},windows[i])
  ||p.bytes!==44+(p.end_ms-p.start_ms)*32||!/^[a-f0-9]{64}$/.test(p.audio_sha256??''))throw Error('long_manifest_part');
 return windows;
}

/** One bounded invocation. DB claims enforce one billed attempt even after a crash. */
export async function executeLongBatch(io,publicIo,actor,approved,indices,media,transcribe,onProgress=async()=>{}){
 validateLongManifest(approved);
 if(!Array.isArray(indices)||!indices.length||indices.length>20||new Set(indices).size!==indices.length
  ||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=approved.parts.length))throw Error('long_batch_budget');
 const source=approved.source,blockIds=source.bindings.map(b=>b.block_id);
 const fresh=async()=>{const s=await inspectLongSource(io,publicIo,actor,source.alias,blockIds);if(!same(s.identity,source))throw Error('source_changed');return s;};
 await fresh();
 let sources=await io.rows('course_transcription_sources','*',{video_id:`eq.${source.video_id}`});
 if(sources.some(s=>s.source_revision!==source.source_revision))throw Error('existing_source_revision_conflict');
 if(!sources.length){
  await io.write('course_transcription_sources',{id:randomUUID(),provider:'kinescope',video_id:source.video_id,
   source_revision:source.source_revision,duration_ms:source.duration_ms,audio_track_id:source.audio_track_id,
   audio_bytes:source.audio_bytes,enabled:true,created_by:actor},'provider,video_id,source_revision');
  sources=await io.rows('course_transcription_sources','*',{video_id:`eq.${source.video_id}`});
 }
 const registered=sources[0];
 if(sources.length!==1||!registered.enabled||registered.revision_basis!=='provider_api'
  ||['duration_ms','audio_track_id','audio_bytes','source_revision'].some(k=>registered[k]!==source[k]))throw Error('source_readback_failed');
 const id=registered.id;
 for(const b of source.bindings)await io.write('course_transcription_bindings',{source_id:id,lesson_id:b.lesson_id,
  block_id:b.block_id,product_id:b.product_id,block_updated_at:b.block_updated_at},'source_id,block_id');
 const linked=await io.rows('course_transcription_bindings','*',{source_id:`eq.${id}`});
 if(linked.length!==source.bindings.length||source.bindings.some(b=>!linked.some(l=>l.block_id===b.block_id
  &&l.lesson_id===b.lesson_id&&l.product_id===b.product_id&&Date.parse(l.block_updated_at)===Date.parse(b.block_updated_at))))throw Error('binding_readback_failed');
 const readTranscript=async()=>{
  const rows=await io.rows('course_transcripts','*',{source_id:`eq.${id}`});if(!rows.length)return null;
  const t=rows[0];if(rows.length!==1||t.source_revision!==source.source_revision||t.origin!=='stt'||t.classification!=='paid_private'
   ||t.quality_status!=='unreviewed'||t.duration_ms!==source.duration_ms||t.content_sha256!==sha(t.transcript_text)
   ||t.char_count!==[...t.transcript_text].length)throw Error('transcript_readback_failed');
  return {source_id:id,job_id:t.job_id,chars:t.char_count,sha256:t.content_sha256};
 };
 const prior=await readTranscript();if(prior)return {...prior,status:'ready',cached:true,stt_calls:0};
 const job=await io.rpc('course_transcription_create_job',{_source_id:id,_actor:actor,_duration_ms:source.duration_ms});
 if(!uuid(job.job_id))throw Error('job_readback_failed');
 let calls=0;const completed=[];
 for(const index of indices){
  const expected=approved.parts[index],current=await fresh();
  const ledger=await io.rows('course_transcription_parts','part_index,start_ms,end_ms,status,audio_sha256',{job_id:`eq.${job.job_id}`,part_index:`eq.${index}`,order:'part_index.asc'});
  if(ledger.length!==1||ledger[0].start_ms!==expected.start_ms||ledger[0].end_ms!==expected.end_ms)throw Error('part_ledger_mismatch');
  const row=ledger[0];
  if(row.status==='ready'){
   if(row.audio_sha256!==expected.audio_sha256)throw Error('part_audio_changed');
   completed.push({part_index:index,cached:true});continue;
  }
  if(row.status!=='pending')throw Error('part_held');
  const capture=await openLongAudio(publicIo,media,current),part=await capture(expected);
  const {wav,...metadata}=part;
  if(!same(metadata,expected))throw Error('part_hash_mismatch');
  const claim=await io.rpc('course_transcription_claim_part',{_job_id:job.job_id,_part_index:index,
   _audio_sha256:expected.audio_sha256,_source_revision:source.source_revision});
  if(claim.action==='cached'){completed.push({part_index:index,cached:true});continue;}
  if(claim.action!=='transcribe'||!uuid(claim.claim_token)||claim.start_ms!==expected.start_ms||claim.end_ms!==expected.end_ms)throw Error('part_held');
  let text;
  try{
   await onProgress({job_id:job.job_id,stt_calls:calls,inflight_part:index,inflight_outcome:'unknown',possible_additional_call:1,completed});
   calls++;text=await transcribe(wav);
   if(typeof text!=='string'||!text.trim()||text.length>100000||!/[а-яё]/i.test(text))throw Error('stt_result_invalid');
  }catch{
   await io.rpc('course_transcription_finish_part',{_job_id:job.job_id,_part_index:index,_claim_token:claim.claim_token,_text:null,_error_code:'stt_outcome_uncertain'}).catch(()=>{});
   throw Error('stt_outcome_uncertain');
  }
  const args={_job_id:job.job_id,_part_index:index,_claim_token:claim.claim_token,_text:text,_error_code:null};
  if((await io.rpc('course_transcription_finish_part',args)).status!=='ready')throw Error('part_save_held');
  if((await io.rpc('course_transcription_finish_part',args)).reused!==true)throw Error('part_replay_failed');
  completed.push({part_index:index,cached:false});
  await onProgress({job_id:job.job_id,stt_calls:calls,completed});
 }
 await fresh();
 const all=await io.rows('course_transcription_parts','part_index,start_ms,end_ms,status,audio_sha256',{job_id:`eq.${job.job_id}`,order:'part_index.asc'});
 if(all.length!==approved.parts.length||all.some((p,i)=>p.part_index!==i||p.start_ms!==approved.parts[i].start_ms||p.end_ms!==approved.parts[i].end_ms))throw Error('job_coverage_mismatch');
 if(all.every(p=>p.status==='ready')){
  if(all.some((p,i)=>p.audio_sha256!==approved.parts[i].audio_sha256))throw Error('part_audio_changed');
  await io.rpc('course_transcription_finalize',{_job_id:job.job_id,_source_revision:source.source_revision});
  const t=await readTranscript();if(!t)throw Error('transcript_readback_failed');return {...t,status:'ready',stt_calls:calls,completed};
 }
 return {source_id:id,job_id:job.job_id,status:'partial',ready_parts:all.filter(p=>p.status==='ready').length,total_parts:all.length,stt_calls:calls,completed};
}
