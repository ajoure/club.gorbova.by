import { createHash, randomUUID } from 'node:crypto';
import { inspectSubtitles } from './subtitles.mjs';
import { COURSE_PRODUCT_IDS, readCourseBindings, safeSubtitleUrl } from './course-provider-import.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const isUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sortedIds=ids=>[...ids].sort();
const MAX_BYTES=10000000;

function pageUrl(value){
  let u;try{u=new URL(value);}catch{throw new Error('public_page_url_invalid');}
  if(u.origin!=='https://kinescope.io'||u.username||u.password||u.search||u.hash||!/^\/[a-zA-Z0-9-]+$/.test(u.pathname))throw new Error('public_page_host_rejected');
  return u;
}

/** No provider/database credentials enter this separate public transport. */
export function createPublicCaptionTransport({fetchImpl=fetch}={}){
  async function get(url,validate){
    let target=validate(url);const seen=new Set();
    for(let hop=0;hop<4;hop++){
      if(seen.has(target.href))throw new Error('public_caption_redirect_loop');seen.add(target.href);
      const r=await fetchImpl(target,{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(60000)});
      if([301,302,303,307,308].includes(r.status)){
        const location=r.headers.get('location');if(!location)throw new Error('public_caption_redirect_missing');
        target=validate(new URL(location,target).href);continue;
      }
      if(!r.ok)throw new Error(`public_caption_http_${r.status}`);
      if(Number(r.headers.get('content-length'))>MAX_BYTES)throw new Error('public_caption_too_large');
      const reader=r.body?.getReader();if(!reader)throw new Error('public_caption_empty');
      const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
      try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;
        if(size>MAX_BYTES)throw new Error('public_caption_too_large');text+=decoder.decode(part.value,{stream:true});}
        text+=decoder.decode();return text;
      }finally{await reader.cancel().catch(()=>{});}
    }
    throw new Error('public_caption_redirect_limit');
  }
  return {page:alias=>get('https://kinescope.io/'+alias,pageUrl),caption:url=>get(url,safeSubtitleUrl)};
}

/** Extract one JSON literal; never execute the surrounding player JavaScript. */
export function parsePublicPlayer(html,{includeHls=false}={}){
  if(typeof html!=='string'||html.length>MAX_BYTES)throw new Error('public_player_invalid');
  const matches=[...html.matchAll(/\bplayerOptions\s*=\s*/g)];
  if(matches.length!==1)throw new Error('public_player_ambiguous');
  const start=matches[0].index+matches[0][0].length;
  if(html[start]!=='{')throw new Error('public_player_json_required');
  let depth=0,quoted=false,escaped=false,end=-1;
  for(let i=start;i<html.length;i++){
    const c=html[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;continue;}
    if(c==='{'||c==='['){depth++;if(depth>80)throw new Error('public_player_depth_limit');}
    if(c==='}'||c===']'){depth--;if(depth===0){end=i+1;break;}}
  }
  let data;try{data=JSON.parse(html.slice(start,end<0?html.length:end));}catch{throw new Error('public_player_json_invalid');}
  if(!Array.isArray(data.playlist)||data.playlist.length!==1)throw new Error('public_playlist_ambiguous');
  const video=data.playlist[0],duration=Math.round(video?.meta?.duration*1000);
  if(!isUuid(video?.id)||typeof video?.meta?.duration!=='number'||!Number.isSafeInteger(duration)||duration<1000||duration>21600000)throw new Error('public_video_metadata_invalid');
  if(!Array.isArray(video.vtt))throw new Error('public_caption_tracks_missing');
  const tracks=video.vtt.filter(track=>track.srcLang==='ru');
  if(tracks.length!==1)throw new Error('public_russian_track_ambiguous');
  return {video_id:video.id.toLowerCase(),duration_ms:duration,subtitle_url:safeSubtitleUrl(tracks[0].src).href,
    ...(includeHls?{hls_url:safeSubtitleUrl(video.sources?.hls?.src).href}:{})};
}

function timestamp(value){
  const m=value.match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if(!m||Number(m[2])>59||Number(m[3])>59)throw new Error('review_cue_time_invalid');
  return ((Number(m[1]||0)*60+Number(m[2]))*60+Number(m[3]))*1000+Number(m[4]);
}

function cueBlocks(raw){
  const result=[];
  for(let block of raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n[ \t]*\n/)){
    if(block.startsWith('WEBVTT')){block=block.split('\n').slice(1).join('\n').trim();if(!block)continue;}
    if(/^(NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block))continue;
    const lines=block.split('\n'),ti=lines.findIndex(line=>line.includes('-->'));
    if(ti<0||ti>1)throw new Error('review_cue_block_invalid');
    const m=lines[ti].match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if(!m)throw new Error('review_cue_time_invalid');
    result.push({start:timestamp(m[1]),end:timestamp(m[2]),text:lines.slice(ti+1).join('\n'),block,index:result.length});
  }
  if(!result.length)throw new Error('review_cues_empty');
  return result;
}

const cueFingerprint=cues=>hash(JSON.stringify(cues.map(c=>JSON.stringify([c.start,c.end,c.text])).sort()));

/** A review transform, not an automatic relaxation of the strict parser. */
export function reviewCaption(raw,durationMs,{allowCueOrderReview=false}={}){
  if(typeof raw!=='string'||raw.length>MAX_BYTES||raw.includes('\0'))throw new Error('review_caption_invalid');
  const cues=cueBlocks(raw),ordered=[...cues].sort((a,b)=>a.start-b.start||a.index-b.index);
  let inversions=0,maxBackstep=0;
  for(let i=1;i<cues.length;i++){const step=cues[i-1].start-cues[i].start;if(step>0){inversions++;maxBackstep=Math.max(maxBackstep,step);}}
  const moved=ordered.filter((cue,i)=>cue.index!==i).length;
  const duplicates=cues.length-new Set(cues.map(c=>JSON.stringify([c.start,c.end,c.text]))).size;
  if(inversions&&(!allowCueOrderReview||maxBackstep>30000||inversions>3||moved>32||duplicates>0))throw new Error('cue_order_requires_manual_review');
  const normalized=inversions?'WEBVTT\n\n'+ordered.map(c=>c.block).join('\n\n')+'\n':raw;
  const before=cueFingerprint(cues),after=cueFingerprint(cueBlocks(normalized));
  if(before!==after||cueBlocks(normalized).length!==cues.length)throw new Error('cue_preservation_failed');
  const parsed=inspectSubtitles(normalized,durationMs,'ru');
  const rawHash=hash(raw);
  parsed.metadata.subtitle_sha256=rawHash;
  return {...parsed,provenance:{schema_version:1,revision_basis:'public_caption_snapshot',raw_sha256:rawHash,
    normalized_sha256:hash(normalized),transform:inversions?'stable_cue_order_v1':'none',cue_count:cues.length,
    inversions,max_backstep_ms:maxBackstep,moved_positions:moved,duplicate_cues:duplicates,
    original_cue_multiset_sha256:before,normalized_cue_multiset_sha256:after}};
}

export function captionSnapshotRevision({video_id,duration_ms,raw_sha256}){
  if(!isUuid(video_id)||!Number.isSafeInteger(duration_ms)||duration_ms<1000||duration_ms>21600000||!/^[a-f0-9]{64}$/.test(raw_sha256||''))throw new Error('caption_snapshot_invalid');
  return hash(`public_caption_snapshot:v1:${video_id.toLowerCase()}:${duration_ms}:${raw_sha256}`);
}

async function owner(io,actor){
  if(!isUuid(actor)||await io.rpc('has_role_v2',{_user_id:actor,_role_code:'super_admin'})!==true)throw new Error('owner_required');
}

async function inspect(publicIo,alias,allowCueOrderReview){
  const video=parsePublicPlayer(await publicIo.page(alias));
  const parsed=reviewCaption(await publicIo.caption(video.subtitle_url),video.duration_ms,{allowCueOrderReview});
  const provenance={...parsed.provenance,video_id:video.video_id,duration_ms:video.duration_ms};
  return {video_id:video.video_id,duration_ms:video.duration_ms,source_revision:captionSnapshotRevision({...video,raw_sha256:provenance.raw_sha256}),
    status:parsed.quality_flags.length?'quality_review':'ready_reviewed_caption',content_sha256:parsed.content_sha256,chars:parsed.chars,
    subtitle_metadata:parsed.metadata,provenance,text:parsed.text};
}

/** Explicit selected aliases only. The report contains metadata, never paid text or URLs. */
export async function dryRunReviewedCaptions(io,publicIo,actor,{aliases,allowCueOrderReview=false,onProgress=async()=>{}}={}){
  await owner(io,actor);
  if(!Array.isArray(aliases)||!aliases.length||aliases.length>100||new Set(aliases).size!==aliases.length)throw new Error('review_aliases_required');
  const snapshot=await readCourseBindings(io);
  if(snapshot.unresolved.length||aliases.some(alias=>!snapshot.bindings.some(b=>b.alias===alias)))throw new Error('review_scope_invalid');
  const sources=[];
  for(const alias of aliases){
    await onProgress({mode:'reviewed_caption_progress',selection_complete:false,current_alias:alias,sources:structuredClone(sources)});
    const {text,...candidate}=await inspect(publicIo,alias,allowCueOrderReview);
    const duplicate=sources.find(s=>s.video_id===candidate.video_id);
    const bindings=snapshot.bindings.filter(b=>b.alias===alias);
    if(duplicate){
      if(duplicate.source_revision!==candidate.source_revision||duplicate.content_sha256!==candidate.content_sha256||!same(duplicate.provenance,candidate.provenance))throw new Error('review_snapshot_changed');
      duplicate.aliases.push(alias);duplicate.bindings.push(...bindings);
    }else sources.push({...candidate,aliases:[alias],bindings});
  }
  if(!same(await readCourseBindings(io),snapshot))throw new Error('course_snapshot_changed');
  return {schema_version:1,mode:'reviewed_caption_dry_run',selection_complete:true,product_ids:COURSE_PRODUCT_IDS,
    selected_aliases:aliases,allow_cue_order_review:allowCueOrderReview,captured_at:new Date().toISOString(),sources,
    totals:{source_count:sources.length,ready:sources.filter(s=>s.status==='ready_reviewed_caption').length,quality_review:sources.filter(s=>s.status==='quality_review').length}};
}

export async function importReviewedCaptionBatch(io,publicIo,actor,manifest,indices,{onProgress=async()=>{}}={}){
  if(manifest?.schema_version!==1||manifest.mode!=='reviewed_caption_dry_run'||manifest.selection_complete!==true
    ||!same(sortedIds(manifest.product_ids||[]),sortedIds(COURSE_PRODUCT_IDS)))throw new Error('review_manifest_invalid');
  if(!Array.isArray(indices)||!indices.length||indices.length>3||indices.some(i=>!Number.isSafeInteger(i)||i<0)||new Set(indices).size!==indices.length)throw new Error('review_batch_invalid');
  const selected=indices.map(i=>manifest.sources?.[i]);
  if(selected.some(s=>s?.status!=='ready_reviewed_caption'||!Number.isSafeInteger(s.chars)||s.chars<1)
    ||selected.reduce((n,s)=>n+s.chars,0)>1000000)throw new Error('review_batch_not_ready');
  await owner(io,actor);const current=await readCourseBindings(io),results=[];
  if(current.unresolved.length)throw new Error('review_scope_invalid');
  for(const source of selected){
    if(!Array.isArray(source.bindings)||!source.bindings.length||!Array.isArray(source.aliases)||!source.aliases.length
      ||source.aliases.some(a=>!manifest.selected_aliases?.includes(a)))throw new Error('review_binding_invalid');
    for(const binding of source.bindings){
      const actual=current.bindings.find(b=>b.block_id===binding.block_id);
      if(!actual||!same(actual,binding)||!source.aliases.includes(actual.alias))throw new Error('course_binding_changed');
    }
    for(const alias of source.aliases){
      if(!same(current.bindings.filter(b=>b.alias===alias),source.bindings.filter(b=>b.alias===alias)))throw new Error('review_bindings_incomplete');
    }
    const fresh=await inspect(publicIo,source.aliases[0],manifest.allow_cue_order_review===true);
    if(fresh.status!=='ready_reviewed_caption'||fresh.source_revision!==source.source_revision||fresh.video_id!==source.video_id
      ||fresh.content_sha256!==source.content_sha256||fresh.chars!==source.chars||!same(fresh.provenance,source.provenance)
      ||!same(fresh.subtitle_metadata,source.subtitle_metadata))throw new Error('review_snapshot_changed');
    for(const alias of source.aliases.slice(1)){
      const other=await inspect(publicIo,alias,manifest.allow_cue_order_review===true);
      if(other.source_revision!==fresh.source_revision||other.content_sha256!==fresh.content_sha256||!same(other.provenance,fresh.provenance))throw new Error('review_alias_changed');
    }
    let registered=await io.rows('course_transcription_sources','id,video_id,source_revision,revision_basis,caption_sha256,enabled,duration_ms,audio_track_id,audio_bytes',{video_id:`eq.${source.video_id}`});
    if(registered.some(s=>s.source_revision!==source.source_revision))throw new Error('video_other_revision_already_registered');
    if(!registered.length){
      await io.write('course_transcription_sources',{id:randomUUID(),provider:'kinescope',video_id:fresh.video_id,source_revision:fresh.source_revision,
        revision_basis:'public_caption_snapshot',caption_sha256:fresh.provenance.raw_sha256,audio_track_id:null,audio_bytes:null,
        duration_ms:fresh.duration_ms,enabled:true,created_by:actor},'provider,video_id,source_revision');
      registered=await io.rows('course_transcription_sources','id,video_id,source_revision,revision_basis,caption_sha256,enabled,duration_ms,audio_track_id,audio_bytes',{video_id:`eq.${source.video_id}`});
    }
    const registeredSource=registered[0];
    if(registered.length!==1||registeredSource.source_revision!==fresh.source_revision||registeredSource.revision_basis!=='public_caption_snapshot'
      ||registeredSource.caption_sha256!==fresh.provenance.raw_sha256||registeredSource.enabled!==true||registeredSource.duration_ms!==fresh.duration_ms
      ||registeredSource.audio_track_id!==null||registeredSource.audio_bytes!==null)throw new Error('review_source_readback_failed');
    const id=registeredSource.id;
    for(const b of source.bindings)await io.write('course_transcription_bindings',{source_id:id,lesson_id:b.lesson_id,block_id:b.block_id,product_id:b.product_id,block_updated_at:b.block_updated_at},'source_id,block_id');
    const bindings=await io.rows('course_transcription_bindings','source_id,lesson_id,block_id,product_id,block_updated_at',{source_id:`eq.${id}`});
    if(bindings.length!==source.bindings.length||source.bindings.some(b=>!bindings.some(v=>v.block_id===b.block_id&&v.lesson_id===b.lesson_id&&v.product_id===b.product_id&&Date.parse(v.block_updated_at)===Date.parse(b.block_updated_at))))throw new Error('review_binding_readback_failed');
    const args={_source_id:id,_source_revision:fresh.source_revision,_text:fresh.text,_metadata:fresh.subtitle_metadata,_provenance:fresh.provenance};
    const saved=await io.rpc('course_transcription_import_reviewed_captions',args),replay=await io.rpc('course_transcription_import_reviewed_captions',args);
    const rows=await io.rows('course_transcripts','source_id,content_sha256,char_count,classification,quality_status,origin,caption_provenance',{source_id:`eq.${id}`});
    if(rows.length!==1||rows[0].content_sha256!==fresh.content_sha256||rows[0].char_count!==fresh.chars||rows[0].classification!=='paid_private'
      ||rows[0].quality_status!=='unreviewed'||rows[0].origin!=='provider_subtitles'||!sameCanonical(rows[0].caption_provenance,fresh.provenance)||replay.reused!==true)throw new Error('review_transcript_readback_failed');
    results.push({video_id:fresh.video_id,source_id:id,chars:fresh.chars,content_sha256:fresh.content_sha256,created:!saved.reused,replay_changes:0});
    await onProgress({mode:'reviewed_caption_execute',status:'running',stt_calls:0,results:[...results]});
  }
  return {mode:'reviewed_caption_execute',stt_calls:0,results};
}

function sameCanonical(a,b){
  if(!a||!b||Object.keys(a).length!==Object.keys(b).length)return false;
  return Object.keys(b).every(key=>a[key]===b[key]);
}
