import { createHash } from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
function time(value){
  const m=value.match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if(!m || Number(m[2])>59 || Number(m[3])>59) throw new Error('invalid_cue_time');
  return ((Number(m[1]||0)*60+Number(m[2]))*60+Number(m[3]))*1000+Number(m[4]);
}
function plain(value){
  // VTT styling/voice/timestamp tags are presentation, not transcript text.
  return value.replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|nbsp|quot|apos);/g,s=>({
    '&amp;':'&','&lt;':'<','&gt;':'>','&nbsp;':' ','&quot;':'"','&apos;':"'"}[s]))
    .replace(/\s+/g,' ').trim();
}

/** Parse an existing provider VTT/SRT. Metrics flag quality; they do not certify speech accuracy. */
export function inspectSubtitles(input,durationMs,language='ru'){
  if(typeof input!=='string'||input.length>10000000||!Number.isSafeInteger(durationMs)||durationMs<1000) throw new Error('invalid_subtitle_input');
  if(language!=='ru') throw new Error('russian_subtitles_required');
  const normalized=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
  if(!normalized||/^\s*</.test(normalized)) throw new Error('invalid_subtitle_format');
  const blocks=normalized.split(/\n[ \t]*\n/),cues=[];
  for(let block of blocks){
    if(block.startsWith('WEBVTT')){block=block.split('\n').slice(1).join('\n').trim();if(!block)continue;}
    if(/^(NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block))continue;
    const lines=block.split('\n');const ti=lines.findIndex(x=>x.includes('-->'));
    if(ti<0||ti>1)throw new Error('unparsed_subtitle_block');
    const match=lines[ti].match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if(!match)throw new Error('invalid_cue_timing');
    const start=time(match[1]),end=time(match[2]),text=plain(lines.slice(ti+1).join(' '));
    if(end<=start||end>durationMs+Math.max(2000,durationMs*0.005)||!text)throw new Error('invalid_cue_interval');
    if(cues.length && start<cues.at(-1).start)throw new Error('unordered_subtitle_cues');
    cues.push({start,end,text});
  }
  if(!cues.length)throw new Error('no_subtitle_cues');
  let covered=0,until=0,maxGap=0,gapCount=0;
  for(const cue of cues){if(cue.start-until>60000)gapCount++;maxGap=Math.max(maxGap,cue.start-until);covered+=Math.max(0,cue.end-Math.max(until,cue.start));until=Math.max(until,cue.end);}
  if(durationMs-until>60000)gapCount++;
  maxGap=Math.max(maxGap,durationMs-until);
  const text=cues.map(c=>c.text).join('\n');
  const letters=text.match(/\p{L}/gu)||[],cyrillic=text.match(/[А-Яа-яЁё]/g)||[];
  const flags=[];
  if(cyrillic.length<20||cyrillic.length/Math.max(1,letters.length)<0.5)flags.push('language_review');
  if(cues[0].start>60000)flags.push('late_start');
  if(durationMs-until>60000)flags.push('early_end');
  if(maxGap>120000)flags.push('long_gap');
  if(covered/durationMs<0.5)flags.push('low_timed_coverage');
  if(/subtitles by|субтитры (?:создал|сделал|подогнал)|amara\.org/i.test(text))flags.push('subtitle_artifact');
  return {text,content_sha256:hash(text),chars:[...text].length,quality_status:'unreviewed',quality_flags:flags,
    metadata:{language,cue_count:cues.length,subtitle_sha256:hash(input),first_ms:cues[0].start,last_ms:until,
      covered_ms:Math.min(covered,durationMs),max_gap_ms:maxGap,uncovered_ms:Math.max(0,durationMs-covered),
      gap_count_gt60:gapCount,quality_flags:flags},duration_ms:durationMs};
}

export function providerRevision(video){
  if(!/^[a-f0-9-]{36}$/i.test(video.id||'')||!Number.isFinite(video.duration)||video.duration<=0
    ||video.version==null||!video.updated_at)throw new Error('provider_revision_unknown');
  return hash(JSON.stringify({id:video.id,version:video.version,updated_at:video.updated_at,duration:video.duration}));
}
