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
export async function prepareReviewedGapPublication(io,publicIo,actor,original,review,reviewFileHash){
  if(!uuid(actor)||!hex(reviewFileHash)||original?.mode!=='caption_gap_dry_run'
    ||review?.schema_version!==1||review.mode!=='reviewed_gap_assembly'
    ||!uuid(review.audit_id)||review.reviewer_id!==actor
    ||!Array.isArray(review.decisions)||review.decisions.length!==original.parts?.length)
    throw Error('review_manifest_invalid');
  const fresh=await inspectGapSource(io,publicIo,actor,original.source?.alias);
  if(!same(fresh.identity,original.source)||fresh.raw!==undefined&&sha(fresh.raw)!==original.source.caption_sha256)
    throw Error('review_source_changed');
  const audits=await io.rows('course_caption_gap_audits','*',{id:`eq.${review.audit_id}`}),a=audits[0];
  if(audits.length!==1||a.requested_by!==actor||a.status!=='review_required'
    ||a.classification!=='paid_private'||a.quality_status!=='unreviewed'
    ||a.source_revision!==original.source.source_revision||a.caption_sha256!==original.source.caption_sha256
    ||a.raw_vtt!==fresh.raw||a.manifest_sha256!==sha(canonical(original)))throw Error('review_audit_changed');
  const sources=await io.rows('course_transcription_sources','*',{id:`eq.${a.source_id}`}),s=sources[0];
  if(sources.length!==1||s.enabled!==true||s.source_revision!==a.source_revision
    ||s.video_id!==original.source.video_id||s.duration_ms!==original.source.duration_ms)throw Error('review_source_changed');
  const continuations=await io.rows('course_gap_continuations','*',{audit_id:`eq.${a.id}`}),c=continuations[0];
  if(continuations.length!==1||c.status!=='collected'||c.reviewed_by!==actor
    ||!same(c.audit_context,Object.fromEntries(Object.entries(a).filter(([k])=>!['raw_vtt','created_at'].includes(k)))))
    throw Error('review_continuation_changed');
  const parts=await io.rows('course_caption_gap_parts','*',{audit_id:`eq.${a.id}`,order:'part_index.asc'});
  if(parts.length!==original.parts.length||parts.some((p,i)=>!same(partMeta(p),partMeta(original.parts[i]))
    ||p.status!==(i===0?'uncertain':'evidence')||p.attempts!==1)
    ||!same(c.held_part_snapshot,parts[0]))throw Error('review_parts_changed');
  const annotations=await io.rows('course_gap_evidence_annotations','*',{audit_id:`eq.${a.id}`,order:'part_index.asc'});
  if(annotations.length!==parts.length-1||annotations.some((x,i)=>x.continuation_id!==c.id
    ||x.part_index!==i+1||x.text_sha256!==parts[i+1].text_sha256))throw Error('review_annotations_changed');
  if((await io.rows('course_transcripts','source_id',{source_id:`eq.${s.id}`})).length
    ||(await io.rows('course_transcription_jobs','source_id',{source_id:`eq.${s.id}`})).length)
    throw Error('review_existing_transcript_or_job');
  const assembled=assembleReviewedGaps({raw_vtt:a.raw_vtt,duration_ms:s.duration_ms,
    source:original.source,parts,decisions:review.decisions,reviewer_id:actor});
  const manifest={schema_version:1,mode:'reviewed_gap_publication_dry_run',audit_id:a.id,
    source_revision:s.source_revision,caption_sha256:a.caption_sha256,
    source_manifest_sha256:a.manifest_sha256,review_file_sha256:reviewFileHash,
    parts_snapshot_sha256:sha(canonical(parts)),decisions_sha256:sha(canonical(review.decisions)),
    transcript_sha256:assembled.content_sha256,transcript_chars:assembled.char_count,
    metadata_sha256:sha(canonical(assembled.metadata)),stt_calls:0};
  return {manifest,assembled};
}

export async function publishReviewedGap(io,actor,approved,prepared,review,approvedFileHash){
  if(!same(approved,prepared.manifest)||approved?.mode!=='reviewed_gap_publication_dry_run'
    ||approved.stt_calls!==0||approved.decisions_sha256!==sha(canonical(review.decisions))
    ||!hex(approvedFileHash))
    throw Error('review_approval_changed');
  const {assembled}=prepared;
  const args={_audit_id:approved.audit_id,_actor:actor,_manifest_sha256:approvedFileHash,
    _decisions:review.decisions,_transcript_text:assembled.text,_metadata:assembled.metadata};
  const result=await io.rpc('course_gap_publish_reviewed',args);
  if(result?.sha256!==approved.transcript_sha256||result.reused!==false)throw Error('review_publication_readback_failed');
  const rows=await io.rows('course_transcripts','*',{source_id:`eq.${result.source_id}`}),row=rows[0];
  if(rows.length!==1||row.classification!=='paid_private'||row.quality_status!=='unreviewed'
    ||row.origin!=='provider_subtitles'||row.transcript_text!==assembled.text
    ||row.content_sha256!==approved.transcript_sha256||!same(row.subtitle_metadata,assembled.metadata))
    throw Error('review_publication_readback_failed');
  const again=await io.rpc('course_gap_publish_reviewed',args);
  if(again?.reused!==true||again.sha256!==result.sha256)throw Error('review_replay_failed');
  return {published:true,transcript_sha256:result.sha256,chars:approved.transcript_chars,
    quality_status:'unreviewed',classification:'paid_private',stt_calls:0,replay_changes:0};
}
