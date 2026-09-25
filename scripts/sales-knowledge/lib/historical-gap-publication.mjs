import {inspectHistoricalGap} from './historical-gap-audit.mjs';
import {assembleReviewedGaps} from './reviewed-gap-assembly.mjs';
import {sha} from './course-stt.mjs';

const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const partMeta=p=>Object.fromEntries(['part_index','gap_index','start_ms','end_ms','audio_sha256']
  .map(k=>[k,p[k]]));

/** No writes. Rebuilds the exact private transcript only from source captions
 * and one review decision for each already collected audio part. */
export async function prepareHistoricalGapPublication(io,publicIo,actor,original,review,reviewFileHash){
  if(!uuid(actor)||!hex(reviewFileHash)||original?.mode!=='historical_leading_gap_dry_run'
    ||original.parts?.length!==3||review?.schema_version!==1
    ||review.mode!=='reviewed_historical_leading_gap'||!uuid(review.audit_id)
    ||review.reviewer_id!==actor||!Array.isArray(review.decisions)
    ||review.decisions.length!==3)throw Error('historical_review_manifest_invalid');
  const fresh=await inspectHistoricalGap(io,publicIo,actor,original.event?.id);
  if(!same(fresh.identity,{event:original.event,source:original.source,gaps:original.gaps,
    caption_sha256:original.caption_sha256,content_sha256:original.content_sha256,
    chars:original.chars,quality_flags:original.quality_flags})
    ||sha(fresh.raw)!==original.caption_sha256)throw Error('historical_review_source_changed');
  const audits=await io.rows('course_caption_gap_audits','*',{id:`eq.${review.audit_id}`}),a=audits[0];
  if(audits.length!==1||a.requested_by!==actor
    ||!['evidence','review_required'].includes(a.status)
    ||a.expected_parts!==3||a.classification!=='paid_private'
    ||a.quality_status!=='unreviewed'||a.source_revision!==original.source.source_revision
    ||a.caption_sha256!==original.caption_sha256||a.raw_vtt!==fresh.raw
    ||a.manifest_sha256!==sha(canonical(original)))throw Error('historical_review_audit_changed');
  const sources=await io.rows('course_transcription_sources','*',{id:`eq.${a.source_id}`}),s=sources[0];
  if(sources.length!==1||s.enabled!==true||s.source_scope!=='historical_live_event'
    ||s.revision_basis!=='provider_api'||s.source_revision!==a.source_revision
    ||s.video_id!==original.source.video_id||s.duration_ms!==original.source.duration_ms)
    throw Error('historical_review_source_changed');
  const bindings=await io.rows('course_historical_event_bindings','*',{source_id:`eq.${s.id}`});
  if(bindings.length!==1||bindings[0].live_event_id!==original.event.id
    ||bindings[0].product_id!==original.event.product_id
    ||(await io.rows('course_transcription_bindings','source_id',{source_id:`eq.${s.id}`})).length
    ||(await io.rows('course_transcription_jobs','source_id',{source_id:`eq.${s.id}`})).length)
    throw Error('historical_review_binding_changed');
  const parts=await io.rows('course_caption_gap_parts','*',{audit_id:`eq.${a.id}`,order:'part_index.asc'});
  const held=parts.filter(p=>p.status==='uncertain');
  if(parts.length!==3||((a.status==='review_required')!== (held.length===1))
    ||held.some(p=>p.part_index!==2||p.error_code!=='asr_outcome_uncertain'
      ||!p.asr_text?.trim()||/[А-Яа-яЁё]/.test(p.asr_text)
      ||review.decisions[2]?.kind!=='non_speech'||review.decisions[2]?.text!==null)
    ||parts.some((p,i)=>!same(partMeta(p),partMeta(original.parts[i]))
      ||(p.status!=='evidence'&&p.status!=='uncertain')||p.attempts!==1
      ||typeof p.asr_text!=='string'||p.text_sha256!==sha(p.asr_text)))
    throw Error('historical_review_parts_changed');
  const silence=await io.rows('course_historical_gap_silence_proofs','*',
    {audit_id:`eq.${a.id}`,order:'part_index.asc'});
  if(silence.some(proof=>!Number.isInteger(proof.part_index)||proof.part_index<0
    ||proof.part_index>1||proof.verified_by!==actor
    ||proof.audio_sha256!==parts[proof.part_index]?.audio_sha256
    ||review.decisions[proof.part_index]?.kind!=='non_speech'
    ||review.decisions[proof.part_index]?.text!==null))
    throw Error('historical_silence_review_required');
  const assembled=assembleReviewedGaps({raw_vtt:a.raw_vtt,duration_ms:s.duration_ms,
    source:{...original,duration_ms:s.duration_ms,source_scope:'historical_live_event'},parts,
    decisions:review.decisions,reviewer_id:actor});
  const existing=await io.rows('course_transcripts','*',{source_id:`eq.${s.id}`});
  const reviews=await io.rows('course_gap_reviews','*',{audit_id:`eq.${a.id}`});
  if(existing.length!==reviews.length||existing.length>1)throw Error('historical_publication_conflict');
  if(existing.length&&(existing[0].transcript_text!==assembled.text
    ||existing[0].content_sha256!==assembled.content_sha256
    ||existing[0].classification!=='paid_private'||existing[0].quality_status!=='unreviewed'
    ||!same(existing[0].subtitle_metadata,assembled.metadata)
    ||!same(reviews[0].decisions,review.decisions)
    ||reviews[0].reviewed_by!==actor))throw Error('historical_publication_conflict');
  const manifest={schema_version:1,mode:'historical_gap_publication_dry_run',
    audit_id:a.id,source_revision:s.source_revision,caption_sha256:a.caption_sha256,
    source_manifest_sha256:a.manifest_sha256,review_file_sha256:reviewFileHash,
    parts_snapshot_sha256:sha(canonical(parts)),
    decisions_sha256:sha(canonical(review.decisions)),
    transcript_sha256:assembled.content_sha256,transcript_chars:assembled.char_count,
    metadata_sha256:sha(canonical(assembled.metadata)),stt_calls:0};
  return {manifest,assembled,alreadyPublished:existing.length===1};
}

export async function publishHistoricalGap(io,actor,approved,prepared,review,approvedFileHash){
  if(!same(approved,prepared.manifest)||approved?.mode!=='historical_gap_publication_dry_run'
    ||approved.stt_calls!==0||approved.decisions_sha256!==sha(canonical(review.decisions))
    ||!hex(approvedFileHash))throw Error('historical_publication_approval_changed');
  const args={_audit_id:approved.audit_id,_actor:actor,_manifest_sha256:approvedFileHash,
    _decisions:review.decisions,_transcript_text:prepared.assembled.text,
    _metadata:prepared.assembled.metadata};
  const result=await io.rpc('course_historical_gap_publish_reviewed',args);
  if(result?.sha256!==approved.transcript_sha256
    ||result.reused!==prepared.alreadyPublished)throw Error('historical_publication_readback_failed');
  const rows=await io.rows('course_transcripts','*',{source_id:`eq.${result.source_id}`}),row=rows[0];
  if(rows.length!==1||row.classification!=='paid_private'||row.quality_status!=='unreviewed'
    ||row.origin!=='provider_subtitles'||row.transcript_text!==prepared.assembled.text
    ||row.content_sha256!==approved.transcript_sha256
    ||!same(row.subtitle_metadata,prepared.assembled.metadata)
    ||!same(row.caption_provenance,{schema_version:1,revision_basis:'provider_api',
      gap_audit_id:approved.audit_id,review_manifest_sha256:approvedFileHash,
      source_caption_sha256:approved.caption_sha256}))
    throw Error('historical_publication_readback_failed');
  const again=await io.rpc('course_historical_gap_publish_reviewed',args);
  if(again?.reused!==true||again.sha256!==result.sha256)throw Error('historical_publication_replay_failed');
  return {published:true,cached:result.reused,transcript_sha256:result.sha256,
    chars:approved.transcript_chars,quality_status:'unreviewed',classification:'paid_private',
    lesson_bindings_created:0,stt_calls:0,replay_changes:0};
}
