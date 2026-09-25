import {inspectGapSource} from './gap-audit.mjs';
import {assembleReviewedGaps} from './reviewed-gap-assembly.mjs';
import {sha} from './course-stt.mjs';

const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const partMeta=p=>Object.fromEntries(['part_index','gap_index','start_ms','end_ms','audio_sha256'].map(k=>[k,p[k]]));

/** Dry-run repeats provider and database reads, retaining paid material only in process memory. */
export async function prepareEvidenceGapPublication(io,publicIo,actor,original,review,reviewFileHash){
  if(!uuid(actor)||!hex(reviewFileHash)||original?.mode!=='caption_gap_dry_run'||!original.source?.reviewed_selection||!original.source?.caption_provenance
    ||review?.schema_version!==1||review.mode!=='reviewed_gap_assembly'
    ||!uuid(review.audit_id)||review.reviewer_id!==actor
    ||!Array.isArray(review.decisions)||review.decisions.length!==original.parts?.length)
    throw Error('review_manifest_invalid');
  const fresh=await inspectGapSource(io,publicIo,actor,original.source?.alias,original.source.reviewed_selection);
  if(!same(fresh.identity,original.source)||fresh.raw!==undefined&&sha(fresh.raw)!==original.source.caption_sha256)
    throw Error('review_source_changed');
  const audits=await io.rows('course_caption_gap_audits','*',{id:`eq.${review.audit_id}`}),a=audits[0];
  if(audits.length!==1||a.requested_by!==actor||a.status!=='evidence'
    ||a.classification!=='paid_private'||a.quality_status!=='unreviewed'
    ||a.source_revision!==original.source.source_revision||a.caption_sha256!==original.source.caption_sha256
    ||a.raw_vtt!==fresh.raw||a.manifest_sha256!==sha(canonical(original)))throw Error('review_audit_changed');
  const sources=await io.rows('course_transcription_sources','*',{id:`eq.${a.source_id}`}),s=sources[0];
  if(sources.length!==1||s.enabled!==true||s.source_revision!==a.source_revision
    ||s.source_scope!=='course'||s.revision_basis!=='provider_api'||s.video_id!==original.source.video_id||s.duration_ms!==original.source.duration_ms)throw Error('review_source_changed');
  const links=await io.rows('course_transcription_bindings','*',{source_id:`eq.${s.id}`});
  if(links.length!==original.source.bindings.length||original.source.bindings.some(b=>!links.some(l=>
    l.block_id===b.block_id&&l.lesson_id===b.lesson_id&&l.product_id===b.product_id
    &&Date.parse(l.block_updated_at)===Date.parse(b.block_updated_at))))throw Error('review_binding_changed');
  if((await io.rows('course_gap_continuations','id',{audit_id:a.id})).length)throw Error('evidence_has_continuation');
  const parts=await io.rows('course_caption_gap_parts','*',{audit_id:a.id,order:'part_index.asc'});
  if(parts.length!==original.parts.length||parts.some((p,i)=>!same(partMeta(p),partMeta(original.parts[i]))
    ||p.status!=='evidence'||p.attempts!==1))throw Error('review_parts_changed');
  if((await io.rows('course_transcription_jobs','source_id',{source_id:`eq.${s.id}`})).length)
    throw Error('review_existing_transcript_or_job');
  const assembled=assembleReviewedGaps({raw_vtt:a.raw_vtt,duration_ms:s.duration_ms,
    source:original.source,parts,decisions:review.decisions,reviewer_id:actor});
  const existing=await io.rows('course_transcripts','*',{source_id:`eq.${s.id}`});
  const reviews=await io.rows('course_gap_reviews','*',{audit_id:`eq.${a.id}`});
  if(existing.length!==reviews.length||existing.length>1)throw Error('review_publication_conflict');
  if(existing.length===1&&(existing[0].transcript_text!==assembled.text
    ||existing[0].content_sha256!==assembled.content_sha256
    ||existing[0].source_revision!==s.source_revision
    ||existing[0].classification!=='paid_private'||existing[0].quality_status!=='unreviewed'
    ||!same(existing[0].subtitle_metadata,assembled.metadata)
    ||!same(reviews[0].decisions,review.decisions)
    ||reviews[0].transcript_sha256!==assembled.content_sha256
    ||reviews[0].reviewed_by!==actor))throw Error('review_publication_conflict');
  if(existing.length===1&&(!same(existing[0].caption_provenance,{
    schema_version:1,revision_basis:'provider_api',gap_audit_id:a.id,
    review_manifest_sha256:reviews[0].manifest_sha256,source_caption_sha256:a.caption_sha256,
    caption_normalization:original.source.caption_provenance,capture_manifest_sha256:a.manifest_sha256,publication_path:'evidence_v1'})
    ||!hex(reviews[0].manifest_sha256)))throw Error('review_publication_conflict');
  const manifest={schema_version:1,mode:'evidence_gap_publication_dry_run',audit_id:a.id,
    source_revision:s.source_revision,caption_sha256:a.caption_sha256,
    source_manifest_sha256:a.manifest_sha256,review_file_sha256:reviewFileHash,
    parts_snapshot_sha256:sha(canonical(parts)),decisions_sha256:sha(canonical(review.decisions)),
    transcript_sha256:assembled.content_sha256,transcript_chars:assembled.char_count,
    metadata_sha256:sha(canonical(assembled.metadata)),stt_calls:0};
  return {manifest,assembled,captureManifest:canonical(original),normalization:original.source.caption_provenance,alreadyPublished:existing.length===1};
}

export async function publishEvidenceGap(io,actor,approved,prepared,review,approvedFileHash){
  if(!same(approved,prepared.manifest)||approved?.mode!=='evidence_gap_publication_dry_run'
    ||approved.stt_calls!==0||approved.decisions_sha256!==sha(canonical(review.decisions))
    ||!hex(approvedFileHash))
    throw Error('review_approval_changed');
  const {assembled}=prepared;
  const args={_audit_id:approved.audit_id,_actor:actor,_manifest_sha256:approvedFileHash,
    _decisions:review.decisions,_transcript_text:assembled.text,_metadata:assembled.metadata,_capture_manifest:prepared.captureManifest};
  const result=await io.rpc('course_gap_publish_evidence',args);
  if(result?.sha256!==approved.transcript_sha256||result.reused!==prepared.alreadyPublished)
    throw Error('review_publication_readback_failed');
  const rows=await io.rows('course_transcripts','*',{source_id:`eq.${result.source_id}`}),row=rows[0];
  if(rows.length!==1||row.classification!=='paid_private'||row.quality_status!=='unreviewed'
    ||row.origin!=='provider_subtitles'||row.transcript_text!==assembled.text
    ||row.content_sha256!==approved.transcript_sha256||!same(row.subtitle_metadata,assembled.metadata)
    ||!same(row.caption_provenance,{schema_version:1,revision_basis:'provider_api',
      gap_audit_id:approved.audit_id,review_manifest_sha256:approvedFileHash,
      source_caption_sha256:approved.caption_sha256,caption_normalization:prepared.normalization,
      capture_manifest_sha256:approved.source_manifest_sha256,publication_path:'evidence_v1'}))
    throw Error('review_publication_readback_failed');
  const again=await io.rpc('course_gap_publish_evidence',args);
  if(again?.reused!==true||again.sha256!==result.sha256)throw Error('review_replay_failed');
  return {published:true,cached:result.reused,transcript_sha256:result.sha256,chars:approved.transcript_chars,
    quality_status:'unreviewed',classification:'paid_private',stt_calls:0,replay_changes:0};
}
