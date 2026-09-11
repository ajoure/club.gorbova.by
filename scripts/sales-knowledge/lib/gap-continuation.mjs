import {prepareGapAudit,inspectGapSource} from './gap-audit.mjs';
import {sha} from './course-stt.mjs';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const digest=v=>sha(canonical(v));
const selection=[1,2,3,4,5,6];
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const partMetadata=p=>Object.fromEntries(['part_index','gap_index','start_ms','end_ms','audio_sha256'].map(k=>[k,p[k]]));

async function readContext(io,actor,original,auditId,heldHash){
  if(!uuid(auditId)||!hash(heldHash))throw Error('continuation_arguments_invalid');
  const rows=await io.rows('course_caption_gap_audits','*',{id:`eq.${auditId}`}),a=rows[0];
  if(rows.length!==1||a.status!=='review_required'||a.requested_by!==actor||a.expected_parts!==7||a.quality_status!=='unreviewed'
    ||a.classification!=='paid_private'||a.source_revision!==original.source.source_revision||a.caption_sha256!==original.source.caption_sha256
    ||sha(a.raw_vtt)!==a.caption_sha256||a.manifest_sha256!==digest(original))throw Error('continuation_context_changed');
  const parts=await io.rows('course_caption_gap_parts','*',{audit_id:`eq.${a.id}`,order:'part_index.asc'});
  if(parts.length!==7||!same(parts.map(partMetadata),original.parts.map(partMetadata)))throw Error('continuation_parts_changed');
  const held=parts[0];
  if(held.status!=='uncertain'||held.attempts!==1||held.error_code!=='asr_outcome_uncertain'||typeof held.asr_text!=='string'
    ||!held.asr_text.trim()||held.asr_text.length>100000||/[А-Яа-яЁё]/.test(held.asr_text)||held.text_sha256!==heldHash||sha(held.asr_text)!==heldHash)throw Error('held_evidence_changed');
  const sources=await io.rows('course_transcription_sources','*',{id:`eq.${a.source_id}`}),s=sources[0];
  if(sources.length!==1||s.enabled!==true||s.revision_basis!=='provider_api'||s.video_id!==original.source.video_id
    ||['source_revision','duration_ms','audio_track_id','audio_bytes'].some(k=>s[k]!==original.source[k]))throw Error('source_readback_failed');
  const links=await io.rows('course_transcription_bindings','*',{source_id:`eq.${s.id}`});
  if(links.length!==original.source.bindings.length||original.source.bindings.some(b=>!links.some(l=>l.block_id===b.block_id
    &&l.lesson_id===b.lesson_id&&l.product_id===b.product_id&&Date.parse(l.block_updated_at)===Date.parse(b.block_updated_at))))throw Error('binding_readback_failed');
  return {audit:a,held,parts};
}

export async function prepareGapContinuation(io,publicIo,actor,original,originalFileHash,auditId,heldHash,media){
  if(!hash(originalFileHash)||original?.mode!=='caption_gap_dry_run'||original.parts?.length!==7)throw Error('original_manifest_required');
  const captured=await prepareGapAudit(io,publicIo,actor,original.source?.alias,media);
  if(!same(original,captured.manifest))throw Error('original_manifest_changed');
  const context=await readContext(io,actor,original,auditId,heldHash);
  const manifest={schema_version:1,mode:'gap_continuation_dry_run',original_manifest:original,original_file_sha256:originalFileHash,
    audit_id:auditId,source_id:context.audit.source_id,held_text_sha256:heldHash,held_snapshot_sha256:digest(context.held),
    selected_parts:selection,max_new_stt_calls:6,non_cyrillic_policy:'retain_unreviewed_evidence',stt_calls:0};
  return {manifest,captured};
}

export async function executeGapContinuation(io,publicIo,actor,approved,prepared,transcribe,onProgress=async()=>{}){
  if(approved?.schema_version!==1||approved.mode!=='gap_continuation_dry_run'||!same(approved,prepared.manifest)
    ||!same(approved.selected_parts,selection)||approved.max_new_stt_calls!==6||approved.non_cyrillic_policy!=='retain_unreviewed_evidence')throw Error('continuation_manifest_changed');
  const original=approved.original_manifest,approvalHash=digest(approved),auditId=approved.audit_id;
  if(!same(original,prepared.captured.manifest)||sha(prepared.captured.raw)!==original.source.caption_sha256)throw Error('original_manifest_changed');
  for(const p of prepared.captured.parts)if(!same(partMetadata(p),partMetadata(original.parts[p.part_index]))||p.audio_sha256!==sha(p.wav)||p.bytes!==p.wav.length)throw Error('part_hash_mismatch');
  const fresh=async()=>{
    const source=await inspectGapSource(io,publicIo,actor,original.source.alias);
    if(!same(source.identity,original.source)||source.raw!==prepared.captured.raw)throw Error('gap_source_changed');
    const context=await readContext(io,actor,original,auditId,approved.held_text_sha256);
    if(digest(context.held)!==approved.held_snapshot_sha256)throw Error('held_evidence_changed');return context;
  };
  await fresh();
  const args={_audit_id:auditId,_actor:actor,_approval_sha256:approvalHash,_source_revision:original.source.source_revision,
    _caption_sha256:original.source.caption_sha256,_manifest_sha256:digest(original),_held_text_sha256:approved.held_text_sha256};
  const c=await io.rpc('course_gap_continue_authorize',args),replay=await io.rpc('course_gap_continue_authorize',args);
  if(!uuid(c.continuation_id)||c.continuation_id!==replay.continuation_id||replay.reused!==true||!['authorized','collected'].includes(c.status))throw Error('continuation_held');
  let calls=0;const completed=[];
  for(const index of selection){
    await fresh();const p=prepared.captured.parts[index];
    const claim=await io.rpc('course_gap_continue_claim',{_continuation_id:c.continuation_id,_approval_sha256:approvalHash,_part_index:index,_audio_sha256:p.audio_sha256});
    if(claim.action==='cached'){completed.push({part_index:index,cached:true});continue;}
    if(claim.action!=='transcribe'||!uuid(claim.claim_token)||claim.start_ms!==p.start_ms||claim.end_ms!==p.end_ms)throw Error('continuation_part_held');
    let text;
    try{
      await onProgress({audit_id:auditId,continuation_id:c.continuation_id,stt_calls:calls,inflight_part:index,inflight_outcome:'unknown',possible_additional_call:1,completed});
      calls++;text=await transcribe(p.wav);
      if(typeof text!=='string'||!text.trim()||text.length>100000)throw Error('invalid_asr');
    }catch{
      await io.rpc('course_gap_continue_finish',{_continuation_id:c.continuation_id,_part_index:index,_claim_token:claim.claim_token,
        _text:typeof text==='string'&&text.length<=100000?text:null,_error_code:'asr_outcome_uncertain'}).catch(()=>{});
      await onProgress({audit_id:auditId,continuation_id:c.continuation_id,stt_calls:calls,held_part:index,completed});throw Error('continuation_asr_uncertain');
    }
    const params={_continuation_id:c.continuation_id,_part_index:index,_claim_token:claim.claim_token,_text:text,_error_code:null};
    const saved=await io.rpc('course_gap_continue_finish',params),again=await io.rpc('course_gap_continue_finish',params);
    const flag=/[А-Яа-яЁё]/.test(text)?'cyrillic_present':'no_cyrillic';
    if(saved.status!=='evidence'||again.status!=='evidence'||again.reused!==true||saved.alphabet_flag!==flag)throw Error('continuation_finish_readback_failed');
    completed.push({part_index:index,cached:false,text_sha256:sha(text.trim()),alphabet_flag:flag});
    await onProgress({audit_id:auditId,continuation_id:c.continuation_id,stt_calls:calls,completed});
  }
  const context=await fresh(),annotations=await io.rows('course_gap_evidence_annotations','*',{continuation_id:`eq.${c.continuation_id}`,order:'part_index.asc'});
  if(annotations.length!==6||selection.some((index,i)=>{
    const p=context.parts[index],a=annotations[i],flag=/[А-Яа-яЁё]/.test(p.asr_text||'')?'cyrillic_present':'no_cyrillic';
    return p.status!=='evidence'||p.attempts!==1||typeof p.asr_text!=='string'||p.text_sha256!==sha(p.asr_text)
      ||a.audit_id!==auditId||a.part_index!==index||a.text_sha256!==p.text_sha256||a.alphabet_flag!==flag||a.evidence_kind!=='unreviewed_asr_evidence'
      ||(!completed[i].cached&&completed[i].text_sha256!==p.text_sha256);
  }))throw Error('continuation_evidence_readback_failed');
  const final=await io.rows('course_gap_continuations','status',{id:`eq.${c.continuation_id}`});
  if(final.length!==1||final[0].status!=='collected')throw Error('continuation_status_changed');
  return {audit_id:auditId,continuation_id:c.continuation_id,stt_calls:calls,cached:calls===0,held_part_unchanged:true,
    held_snapshot_sha256:approved.held_snapshot_sha256,quality_status:'unreviewed',audit_status:'review_required',not_quality_approval:true,
    parts:selection.map(i=>({part_index:i,chars:[...context.parts[i].asr_text].length,text_sha256:context.parts[i].text_sha256,
      alphabet_flag:annotations[i-1].alphabet_flag})),replay_changes:0};
}
