import {sha} from './course-stt.mjs';
import {captionGaps} from './gap-media.mjs';
import {inspectSubtitles} from './subtitles.mjs';

const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const stamp=s=>{const m=s.match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if(!m||Number(m[2])>59||Number(m[3])>59)throw Error('cue_time_invalid');
  return ((Number(m[1]||0)*60+Number(m[2]))*60+Number(m[3]))*1000+Number(m[4]);};
const plain=s=>s.replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|nbsp|quot|apos);/g,x=>({
  '&amp;':'&','&lt;':'<','&gt;':'>','&nbsp;':' ','&quot;':'"','&apos;':"'"}[x])).replace(/\s+/g,' ').trim();

function cues(raw){
  const out=[];
  for(let block of raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n[ \t]*\n/)){
    if(block.startsWith('WEBVTT')){block=block.split('\n').slice(1).join('\n').trim();if(!block)continue;}
    if(/^(NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block))continue;
    const lines=block.split('\n'),i=lines.findIndex(x=>x.includes('-->'));
    if(i<0||i>1)throw Error('cue_invalid');
    const m=lines[i].match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if(!m)throw Error('cue_invalid');
    out.push({start_ms:stamp(m[1]),end_ms:stamp(m[2]),text:plain(lines.slice(i+1).join(' '))});
  }
  return out;
}

/** Pure, private assembly. The caller must authenticate the reviewer, re-read provider/source
 * state, and commit through a service-only RPC after approval of the exact manifest hash. */
export function assembleReviewedGaps({raw_vtt,duration_ms,source,parts,decisions,reviewer_id}){
  if(typeof raw_vtt!=='string'||!Number.isSafeInteger(duration_ms)||duration_ms<1000
    ||!Array.isArray(parts)||!Array.isArray(decisions)||parts.length<1||parts.length>7
    ||parts.length!==decisions.length||!reviewer_id)throw Error('review_input_invalid');
  const base=inspectSubtitles(raw_vtt,duration_ms,'ru');
  const historical=source?.source_scope==='historical_live_event';
  const gap=captionGaps(raw_vtt,duration_ms,{historicalLeadingGap:historical});
  if(!same(gap.gaps,source?.gaps)||gap.caption_sha256!==source.caption_sha256
    ||source.duration_ms!==duration_ms||!base.quality_flags.includes('long_gap'))throw Error('review_source_changed');
  const rows=cues(raw_vtt);
  if(rows.map(x=>x.text).join('\n')!==base.text)throw Error('review_cue_mismatch');
  const inserts=[];
  for(let i=0;i<parts.length;i++){
    const p=parts[i],d=decisions[i],g=gap.gaps[p?.gap_index];
    if(p?.part_index!==i||!g||!Number.isSafeInteger(p.start_ms)||!Number.isSafeInteger(p.end_ms)
      ||p.start_ms<g.start_ms||p.end_ms>g.end_ms+1||p.end_ms<=p.start_ms||p.end_ms-p.start_ms>90000
      ||p.attempts!==1||!['evidence','uncertain'].includes(p.status)
      ||!hash(p.audio_sha256)||!hash(p.text_sha256)||typeof p.asr_text!=='string'
      ||sha(p.asr_text)!==p.text_sha256
      ||d?.part_index!==i||d.evidence_sha256!==p.text_sha256||d.audio_sha256!==p.audio_sha256
      ||d.reviewer_id!==reviewer_id||typeof d.note!=='string'||d.note.trim().length<8
      ||d.note.length>1000||!['speech','non_speech'].includes(d.kind))throw Error('review_part_invalid');
    if(i>0&&p.start_ms<parts[i-1].end_ms)throw Error('review_parts_overlap');
    if(d.kind==='speech'){
      if(typeof d.text!=='string'||!d.text.trim()||d.text.length>100000||!/[А-Яа-яЁё]/.test(d.text))throw Error('review_speech_invalid');
      inserts.push({start_ms:p.start_ms,end_ms:p.end_ms,text:d.text.trim()});
    }else if(d.text!==null)throw Error('review_non_speech_invalid');
  }
  for(const g of gap.gaps){
    const selected=parts.filter(p=>p.gap_index===g.gap_index);
    if(!selected.length||selected[0].start_ms!==g.start_ms||Math.abs(selected.at(-1).end_ms-g.end_ms)>1
      ||selected.some((p,i)=>i>0&&p.start_ms!==selected[i-1].end_ms))throw Error('review_gap_uncovered');
  }
  const merged=[...rows.map(x=>({...x,kind:'caption'})),...inserts.map(x=>({...x,kind:'reviewed_speech'}))]
    .sort((a,b)=>a.start_ms-b.start_ms||a.end_ms-b.end_ms);
  const text=merged.map(x=>x.text).join('\n');
  return {text,content_sha256:sha(text),char_count:[...text].length,
    metadata:{...base.metadata,gap_review_status:'reviewed',
      reviewed_gap_parts:parts.length,reviewed_speech_parts:inserts.length,
      review_decisions_sha256:sha(canonical(decisions)),reviewer_id}};
}
