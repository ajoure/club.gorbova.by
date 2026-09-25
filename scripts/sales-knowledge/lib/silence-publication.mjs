import {validateLongManifest,inspectLongSource,openLongAudio} from './long-course-stt.mjs';
import {verifyDigitalSilence} from './verified-silence.mjs';
import {sha} from './course-stt.mjs';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);

export async function prepareSilencePublication(io,publicIo,media,actor,original,indices){
 validateLongManifest(original);
 if(!Array.isArray(indices)||!indices.length||indices.length>20||new Set(indices).size!==indices.length
  ||indices.some(i=>!Number.isSafeInteger(i)||original.parts[i]?.digital_silence!==true))throw Error('silence_selection_invalid');
 const source=original.source;
 const fresh=async()=>{
  const s=await inspectLongSource(io,publicIo,actor,source.alias,source.bindings.map(b=>b.block_id));
  if(!same(s.identity,source))throw Error('source_changed');return s;
 };
 const current=await fresh();
 const sources=await io.rows('course_transcription_sources','*',{video_id:`eq.${source.video_id}`});
 const s=sources[0];
 if(sources.length!==1||!uuid(s?.id)||s.enabled!==true||s.source_scope!=='course'||s.revision_basis!=='provider_api'
  ||['duration_ms','audio_track_id','audio_bytes','source_revision'].some(k=>s[k]!==source[k]))throw Error('source_readback_failed');
 const links=await io.rows('course_transcription_bindings','*',{source_id:`eq.${s.id}`});
 if(links.length!==source.bindings.length||source.bindings.some(b=>!links.some(l=>l.block_id===b.block_id
  &&l.lesson_id===b.lesson_id&&l.product_id===b.product_id&&Date.parse(l.block_updated_at)===Date.parse(b.block_updated_at))))throw Error('binding_readback_failed');
 const jobs=await io.rows('course_transcription_jobs','*',{source_id:`eq.${s.id}`}),job=jobs[0];
 if(jobs.length!==1||!uuid(job?.id)||job.requested_by!==actor||job.duration_ms!==source.duration_ms
  ||job.total_parts!==original.parts.length||!['pending','transcribing','ready'].includes(job.status))throw Error('silence_job_held');
 const rows=await io.rows('course_transcription_parts','*',{job_id:`eq.${job.id}`,order:'part_index.asc'});
 if(rows.length!==original.parts.length||rows.some((p,i)=>p.part_index!==i||p.start_ms!==original.parts[i].start_ms
  ||p.end_ms!==original.parts[i].end_ms||(!indices.includes(i)&&(p.status!=='ready'||p.audio_sha256!==original.parts[i].audio_sha256))
  ||(indices.includes(i)&&!((p.status==='pending'&&p.attempts===0&&p.audio_sha256===null&&p.claim_token===null&&p.transcript_text===null)
    ||(p.status==='ready'&&p.attempts===0&&p.silence_evidence?.method==='pcm_s16le_16000_mono_all_zero_v1'&&p.audio_sha256===original.parts[i].audio_sha256)))))throw Error('silence_parts_held');
 const capture=await openLongAudio(publicIo,media,current),proofs=[];
 for(const i of indices)proofs.push(verifyDigitalSilence(original.parts[i],await capture(original.parts[i])));
 await fresh();
 const captureManifest=canonical(original);
 return {manifest:{schema_version:1,mode:'verified_silence_publication_dry_run',source_id:s.id,job_id:job.id,
  source_revision:source.source_revision,capture_manifest_sha256:sha(captureManifest),proofs,stt_calls:0},captureManifest,original};
}

export async function publishSilence(io,actor,approved,prepared){
 if(!same(approved,prepared.manifest))throw Error('silence_approval_changed');
 for(const proof of approved.proofs){
  const args={_job_id:approved.job_id,_part_index:proof.part_index,_actor:actor,
   _source_revision:approved.source_revision,_audio_sha256:proof.audio_sha256,_long_manifest:prepared.captureManifest};
  const expected={...proof,actor,manifest_sha256:approved.capture_manifest_sha256};
  const result=await io.rpc('course_transcription_mark_verified_silence',args);
  if(result?.status!=='ready'||!same(result.evidence,expected))throw Error('silence_readback_failed');
  const rows=await io.rows('course_transcription_parts','*',{job_id:`eq.${approved.job_id}`,part_index:`eq.${proof.part_index}`}),p=rows[0];
  const annotation=`[Редакционная отметка: цифровая тишина; ${proof.start_ms}–${proof.end_ms} мс; речь отсутствует.]`;
  if(rows.length!==1||p.status!=='ready'||p.attempts!==0||p.audio_sha256!==proof.audio_sha256
   ||p.transcript_text!==annotation||!same(p.silence_evidence,expected))throw Error('silence_readback_failed');
  if((await io.rpc('course_transcription_mark_verified_silence',args)).reused!==true)throw Error('silence_replay_failed');
 }
 const all=await io.rows('course_transcription_parts','*',{job_id:`eq.${approved.job_id}`,order:'part_index.asc'});
 if(all.length!==prepared.original.parts.length||all.some((p,i)=>p.part_index!==i||p.status!=='ready'
  ||p.audio_sha256!==prepared.original.parts[i].audio_sha256||p.start_ms!==prepared.original.parts[i].start_ms
  ||p.end_ms!==prepared.original.parts[i].end_ms||typeof p.transcript_text!=='string'||!p.transcript_text.trim()))throw Error('silence_finalization_incomplete');
 const args={_job_id:approved.job_id,_source_revision:approved.source_revision};
 await io.rpc('course_transcription_finalize',args);
 if((await io.rpc('course_transcription_finalize',args)).reused!==true)throw Error('finalize_replay_failed');
 const texts=await io.rows('course_transcripts','*',{source_id:`eq.${approved.source_id}`}),t=texts[0],text=all.map(p=>p.transcript_text).join('\n\n');
 if(texts.length!==1||t.source_revision!==approved.source_revision||t.job_id!==approved.job_id||t.origin!=='stt'
  ||t.classification!=='paid_private'||t.quality_status!=='unreviewed'||t.transcript_text!==text
  ||t.content_sha256!==sha(text)||t.char_count!==[...text].length||t.duration_ms!==prepared.original.source.duration_ms)throw Error('transcript_readback_failed');
 return {status:'ready',source_id:approved.source_id,job_id:approved.job_id,parts:all.length,
  sha256:t.content_sha256,chars:t.char_count,stt_calls:0,replay_changes:0};
}
