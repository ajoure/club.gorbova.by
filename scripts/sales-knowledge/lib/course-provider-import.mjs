import { createHash,randomUUID } from 'node:crypto';
import { inspectSubtitles,providerRevision } from './subtitles.mjs';
import { kinescopeReference } from './inventory.mjs';

export const COURSE_PRODUCT_IDS=Object.freeze([
  '7101ed3c-7839-4a74-ad95-aa0660369b22', // ordinary first-stage course
  '3e43fb28-8322-41bc-bfee-714731bdc630', // flow 20, including its weekly calls
]);
const sha=s=>createHash('sha256').update(s).digest('hex');
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const eqIds=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());

export function safeSubtitleUrl(value){
  let u;try{u=new URL(value);}catch{throw new Error('subtitle_url_invalid');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||
    !(['kinescopecdn.net','kinescope.io'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))))throw new Error('subtitle_host_not_allowed');
  return u;
}

export function createManagedTransport({supabaseUrl,serviceKey,fetchImpl=fetch}){
  const origin=new URL(supabaseUrl);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)throw new Error('managed_origin_invalid');
  if(!serviceKey)throw new Error('managed_credentials_missing');
  async function jsonRequest(url,options,label){
    const r=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw new Error(`${label}_http_${r.status}`);
    if(r.status===204)return null;
    try{return await r.json();}catch{throw new Error(`${label}_json_invalid`);}
  }
  const headers={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'};
  return {
    async rows(table,select,filters={}){
      const all=[];
      for(let offset=0;offset<100000;offset+=500){
        const url=new URL(`/rest/v1/${table}`,origin);url.searchParams.set('select',select);
        url.searchParams.set('order',table==='course_transcripts'?'source_id.asc':table==='course_transcription_bindings'?'source_id.asc,block_id.asc':'id.asc');url.searchParams.set('limit','500');url.searchParams.set('offset',String(offset));
        Object.entries(filters).forEach(([k,v])=>url.searchParams.set(k,v));
        const rows=await jsonRequest(url,{headers},'database_read');
        if(!Array.isArray(rows))throw new Error('database_rows_invalid');
        all.push(...rows);if(rows.length<500)return all;
      }
      throw new Error('database_pagination_incomplete');
    },
    async write(table,data,conflict){
      const url=new URL(`/rest/v1/${table}`,origin);if(conflict)url.searchParams.set('on_conflict',conflict);
      return jsonRequest(url,{method:'POST',headers:{...headers,Prefer:`return=representation${conflict?',resolution=ignore-duplicates':''}`},body:JSON.stringify(data)},'database_write');
    },
    async rpc(name,args){return jsonRequest(new URL(`/rest/v1/rpc/${name}`,origin),{method:'POST',headers,body:JSON.stringify(args)},'database_rpc');},
    async provider(path,token){
      if(!/^\/videos\/[a-zA-Z0-9-]+(?:\/subtitles(?:\/[a-zA-Z0-9-]+)?)?(?:\?page=\d+&per_page=100)?$/.test(path))throw new Error('provider_path_invalid');
      return jsonRequest('https://api.kinescope.io/v1'+path,{headers:{Authorization:`Bearer ${token}`}},'provider');
    },
    async subtitle(url){
      let target=safeSubtitleUrl(url);
      for(let redirects=0;redirects<4;redirects++){
        const r=await fetchImpl(target,{redirect:'manual',signal:AbortSignal.timeout(60000)});
        if([301,302,303,307,308].includes(r.status)){target=safeSubtitleUrl(new URL(r.headers.get('location'),target).href);continue;}
        if(!r.ok)throw new Error(`subtitle_http_${r.status}`);
        const reader=r.body?.getReader();if(!reader)throw new Error('subtitle_empty_body');
        const decoder=new TextDecoder();let size=0,text='';
        try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;
          if(size>10000000)throw new Error('subtitle_too_large');text+=decoder.decode(part.value,{stream:true});}
          text+=decoder.decode();return text;
        }finally{await reader.cancel().catch(()=>{});}
      }
      throw new Error('subtitle_redirect_limit');
    },
  };
}

export async function readCourseBindings(io){
  const modules=await io.rows('training_modules','id,product_id,parent_module_id,is_active',{product_id:`in.(${COURSE_PRODUCT_IDS.join(',')})`});
  if(!modules.length)throw new Error('course_modules_missing');
  const lessons=await io.rows('training_lessons','id,module_id,product_id,is_active',{module_id:`in.(${modules.map(m=>m.id).join(',')})`});
  const direct=await io.rows('training_lessons','id,module_id,product_id,is_active',{product_id:`in.(${COURSE_PRODUCT_IDS.join(',')})`});
  if(direct.some(l=>!lessons.some(inScope=>inScope.id===l.id)))throw new Error('course_direct_binding_not_in_modules');
  const blocks=[];
  for(let start=0;start<lessons.length;start+=50){blocks.push(...await io.rows('lesson_blocks','id,lesson_id,parent_id,block_type,content,updated_at',
    {lesson_id:`in.(${lessons.slice(start,start+50).map(l=>l.id).join(',')})`}));}
  const seen=new Set(),bindings=[],unresolved=[];
  for(const b of blocks){
    if(seen.has(b.id))throw new Error('duplicate_block_snapshot');seen.add(b.id);
    if(!['video','video_unskippable'].includes(b.block_type)){
      if(/kinescope\.(?:io|com)/i.test(JSON.stringify(b.content)))throw new Error('embedded_video_requires_inventory_review');
      continue;
    }
    const lesson=lessons.find(l=>l.id===b.lesson_id),module=modules.find(m=>m.id===lesson?.module_id);
    if(!module||!COURSE_PRODUCT_IDS.includes(module.product_id)||lesson.product_id&&lesson.product_id!==module.product_id)throw new Error('course_binding_conflict');
    if(b.parent_id)throw new Error('nested_video_requires_inventory_review');
    const alias=kinescopeReference(b.content?.url);
    const row={block_id:b.id,lesson_id:lesson.id,module_id:module.id,product_id:module.product_id,
      block_updated_at:b.updated_at,lesson_active:lesson.is_active,module_active:module.is_active};
    if(!alias){unresolved.push({...row,reason:'unsupported_video_reference'});continue;}
    if(!b.updated_at)throw new Error('block_revision_missing');
    bindings.push({...row,alias});
  }
  return {bindings,unresolved,counts:{modules:modules.length,lessons:lessons.length,blocks:blocks.length,video_blocks:bindings.length+unresolved.length}};
}

async function tokenAndOwner(io,actor){
  if(!uuid(actor)||await io.rpc('has_role_v2',{_user_id:actor,_role_code:'super_admin'})!==true)throw new Error('owner_required');
  const integrations=await io.rows('integration_instances','id,config',{provider:'eq.kinescope',status:'eq.connected'});
  if(integrations.length!==1||typeof integrations[0].config?.api_token!=='string')throw new Error('kinescope_connection_ambiguous');
  return integrations[0].config.api_token;
}
const unwrap=x=>x?.data??x;
async function inspectAlias(io,token,alias){
  const video=unwrap(await io.provider('/videos/'+alias,token));
  const rev=providerRevision(video),duration=Math.round(video.duration*1000);
  const tracks=video.audio_tracks||[];
  const audio=tracks.find(x=>x.language==='ru')||(tracks.length===1?tracks[0]:null);
  const subtitles=[];
  for(let page=1;page<=20;page++){
    const response=await io.provider(`/videos/${video.id}/subtitles?page=${page}&per_page=100`,token);
    const rows=unwrap(response)||[];if(!Array.isArray(rows))throw new Error('subtitle_list_invalid');
    subtitles.push(...rows);if(rows.length<100)break;if(page===20)throw new Error('subtitle_pagination_incomplete');
  }
  const ru=subtitles.filter(s=>s.language==='ru'&&(!s.status||s.status==='done'));
  if(ru.length!==1)return {video_id:video.id,source_revision:rev,duration_ms:duration,status:ru.length?'multiple_ru_tracks':'missing_ru_subtitles'};
  const detail=unwrap(await io.provider(`/videos/${video.id}/subtitles/${ru[0].id}`,token));
  if(detail.language!=='ru'||detail.status&&detail.status!=='done')throw new Error('subtitle_not_ready');
  const parsed=inspectSubtitles(await io.subtitle(detail.url),duration,'ru');
  const warningsOnly=parsed.quality_flags.every(f=>f==='long_gap')&&parsed.metadata.uncovered_ms/duration<=0.1;
  return {video_id:video.id,source_revision:rev,duration_ms:duration,subtitle_id:detail.id,
    audio_track_id:audio?.id||null,audio_bytes:Number.isSafeInteger(audio?.file_size)&&audio.file_size>0?audio.file_size:null,
    status:!parsed.quality_flags.length?'ready_to_import':warningsOnly?'ready_with_warnings':'quality_review',parsed};
}

export async function dryRunCourse(io,actor,{aliases}={}){
  const token=await tokenAndOwner(io,actor),snapshot=await readCourseBindings(io);
  const all=[...new Set(snapshot.bindings.map(b=>b.alias))].sort();
  const chosen=aliases||all;if(chosen.some(a=>!all.includes(a)))throw new Error('alias_outside_course');
  const sources=[];
  for(const alias of chosen){
    try{
      const result=await inspectAlias(io,token,alias);const {parsed,...meta}=result;
      const duplicate=sources.find(s=>s.video_id===meta.video_id&&s.source_revision===meta.source_revision);
      const bindings=snapshot.bindings.filter(b=>b.alias===alias);
      if(duplicate){
        if(parsed&&duplicate.content_sha256!==parsed.content_sha256)throw new Error('subtitle_snapshot_changed');
        duplicate.aliases.push(alias);duplicate.bindings.push(...bindings);continue;
      }
      sources.push({...meta,aliases:[alias],bindings,
        ...(parsed?{content_sha256:parsed.content_sha256,chars:parsed.chars,subtitle_metadata:parsed.metadata,quality_flags:parsed.quality_flags}:{})});
    }catch(error){
      const code=error instanceof Error?error.message:'';
      if(code==='provider_http_404'){sources.push({aliases:[alias],status:'provider_not_found',bindings:snapshot.bindings.filter(b=>b.alias===alias)});continue;}
      throw error;
    }
  }
  // Detect curriculum edits during the metadata pass before declaring the
  // report complete. Provider URLs and extracted text never enter the report.
  const check=await readCourseBindings(io);
  if(JSON.stringify(check)!==JSON.stringify(snapshot))throw new Error('course_snapshot_changed');
  return {schema_version:1,mode:'dry_run',product_ids:COURSE_PRODUCT_IDS,captured_at:new Date().toISOString(),
    complete:!aliases,counts:snapshot.counts,unresolved:snapshot.unresolved,sources,
    totals:{source_count:sources.length,ready_to_import:sources.filter(s=>s.status==='ready_to_import').length,
      ready_with_warnings:sources.filter(s=>s.status==='ready_with_warnings').length,
      quality_review:sources.filter(s=>s.status==='quality_review').length,provider_not_found:sources.filter(s=>s.status==='provider_not_found').length}};
}

export async function importCourseBatch(io,actor,manifest,indices,{maxSources=3,maxChars=1000000,maxDurationMs=Infinity,onProgress=async()=>{}}={}){
  if(manifest?.schema_version!==1||manifest.mode!=='dry_run'||!eqIds(manifest.product_ids||[],COURSE_PRODUCT_IDS))throw new Error('manifest_scope_invalid');
  if(!Array.isArray(indices)||indices.length<1||indices.length>maxSources||new Set(indices).size!==indices.length)throw new Error('batch_size_invalid');
  const selected=indices.map(i=>manifest.sources?.[i]);
  const importable=s=>s&&['ready_to_import','ready_with_warnings'].includes(s.status);
  if(selected.some(s=>!importable(s)||!Number.isSafeInteger(s.chars)||s.chars<1)||selected.reduce((n,s)=>n+s.duration_ms,0)>maxDurationMs
    ||selected.reduce((n,s)=>n+s.chars,0)>maxChars)throw new Error('batch_not_ready_or_over_budget');
  const token=await tokenAndOwner(io,actor),current=await readCourseBindings(io),results=[];
  for(const source of selected){
    for(const binding of source.bindings){
      const actual=current.bindings.find(b=>b.block_id===binding.block_id);
      if(!actual||JSON.stringify(actual)!==JSON.stringify(binding))throw new Error('course_binding_changed');
    }
    if(!source.bindings.length||source.aliases.some(a=>!current.bindings.some(b=>b.alias===a)))throw new Error('source_outside_course');
    const fresh=await inspectAlias(io,token,source.aliases[0]);
    if(!importable(fresh)||fresh.status!==source.status||fresh.video_id!==source.video_id||fresh.source_revision!==source.source_revision
      ||fresh.parsed.content_sha256!==source.content_sha256||fresh.parsed.metadata.subtitle_sha256!==source.subtitle_metadata.subtitle_sha256)throw new Error('source_changed_since_dry_run');
    let existing=await io.rows('course_transcription_sources','id,enabled,duration_ms',{video_id:`eq.${source.video_id}`,source_revision:`eq.${source.source_revision}`});
    if(!existing.length){await io.write('course_transcription_sources',{id:randomUUID(),provider:'kinescope',video_id:fresh.video_id,
      source_revision:fresh.source_revision,audio_track_id:fresh.audio_track_id,audio_bytes:fresh.audio_bytes,duration_ms:fresh.duration_ms,
      enabled:true,created_by:actor},'provider,video_id,source_revision');
      existing=await io.rows('course_transcription_sources','id,enabled,duration_ms',{video_id:`eq.${source.video_id}`,source_revision:`eq.${source.source_revision}`});}
    if(existing.length!==1||existing[0].enabled!==true||existing[0].duration_ms!==fresh.duration_ms)throw new Error('source_register_readback_failed');
    const id=existing[0].id;
    for(const b of source.bindings){await io.write('course_transcription_bindings',{source_id:id,lesson_id:b.lesson_id,block_id:b.block_id,product_id:b.product_id,block_updated_at:b.block_updated_at},'source_id,block_id');}
    const linked=await io.rows('course_transcription_bindings','source_id,lesson_id,block_id,product_id,block_updated_at',{source_id:`eq.${id}`});
    if(source.bindings.some(b=>!linked.some(l=>l.block_id===b.block_id&&l.lesson_id===b.lesson_id&&l.product_id===b.product_id&&Date.parse(l.block_updated_at)===Date.parse(b.block_updated_at))))throw new Error('binding_readback_failed');
    const params={_source_id:id,_source_revision:fresh.source_revision,_text:fresh.parsed.text,_metadata:fresh.parsed.metadata};
    const saved=await io.rpc('course_transcription_import_subtitles',params);
    const replay=await io.rpc('course_transcription_import_subtitles',params);
    // No transcript content in reports, logs or the sales model.
    const rows=await io.rows('course_transcripts','source_id,content_sha256,char_count,classification,origin,quality_status',{source_id:`eq.${id}`});
    if(rows.length!==1||rows[0].content_sha256!==source.content_sha256||rows[0].char_count!==source.chars
      ||rows[0].classification!=='paid_private'||replay.reused!==true)throw new Error('transcript_readback_failed');
    results.push({source_id:id,video_id:source.video_id,chars:rows[0].char_count,sha256:rows[0].content_sha256,
      created:!saved.reused,replay_changes:0,quality_status:rows[0].quality_status});
    await onProgress({mode:'execute',status:'running',stt_calls:0,results:[...results]});
  }
  return {mode:'execute',stt_calls:0,results};
}

export const manifestSha256=sha;
