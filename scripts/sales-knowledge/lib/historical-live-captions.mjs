import { randomUUID } from 'node:crypto';
import { COURSE_PRODUCT_IDS, inspectAlias, tokenAndOwner } from './course-provider-import.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/№/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const CONFERENCE_5_TITLE='цб 2 0 20 поток конференция 5';
const CONFERENCE_5_DATE='2026-09-13';
const list=value=>{
  for(let n=0;n<4;n++){
    if(Array.isArray(value))return value;
    if(!value||typeof value!=='object')break;
    value=value.data;
  }
  throw new Error('provider_live_videos_invalid');
};

export async function inspectEvent(io,actor,eventId){
  if(!uuid(eventId))throw new Error('historical_event_id_invalid');
  const token=await tokenAndOwner(io,actor);
  const events=await io.rows('live_events',
    'id,title,product_id,scheduled_at,live_started_at,webinar_completed_at,kinescope_live_event_id,kinescope_project_id,updated_at',
    {id:`eq.${eventId}`});
  if(events.length!==1)throw new Error('historical_event_missing');
  const event=events[0];
  const historicalNullProduct=event.product_id===null
    &&normalize(event.title)===CONFERENCE_5_TITLE
    &&typeof event.scheduled_at==='string'
    &&event.scheduled_at.slice(0,10)===CONFERENCE_5_DATE;
  if((event.product_id!==COURSE_PRODUCT_IDS[1]&&!historicalNullProduct)
    ||!uuid(event.kinescope_live_event_id)
    ||!event.kinescope_project_id||!event.updated_at)throw new Error('historical_event_scope_invalid');
  const videos=list(await io.liveVideos(event.kinescope_live_event_id,token));
  if(videos.length!==1||!uuid(videos[0]?.id))throw new Error('historical_event_video_ambiguous');
  const videoId=videos[0].id.toLowerCase();
  const response=await io.provider(`/videos/${videoId}`,token);
  const video=response?.data||response;
  if(video.id?.toLowerCase()!==videoId)throw new Error('historical_video_identity_changed');
  const projectId=video.project_id||video.project?.id;
  if(projectId!==event.kinescope_project_id)throw new Error('historical_video_project_mismatch');
  const eventTitle=normalize(event.title),videoTitle=normalize(video.name||video.title);
  if(!eventTitle||!videoTitle.startsWith(eventTitle))throw new Error('historical_video_title_mismatch');
  const began=Date.parse(event.live_started_at||event.scheduled_at),ended=Date.parse(event.webinar_completed_at);
  const created=Date.parse(video.created_at);
  if(!Number.isFinite(began)||!Number.isFinite(created)||created<began-3600000
    ||created>(Number.isFinite(ended)?ended+3600000:began+43200000))throw new Error('historical_video_date_mismatch');
  const tracksResponse=await io.provider(`/videos/${videoId}/subtitles?page=1&per_page=100`,token);
  const tracks=list(tracksResponse);
  if(tracks.length>=100)throw new Error('historical_subtitle_pagination_review');
  const ruTracks=tracks.filter(track=>track.language==='ru');
  if(ruTracks.length!==1||ruTracks[0].status!=='done')throw new Error('historical_russian_subtitles_ambiguous');
  const candidate=await inspectAlias(io,token,videoId,{revisionFallback:videos[0]});
  if(candidate.video_id.toLowerCase()!==videoId)throw new Error('historical_video_identity_changed');
  const sources=await io.rows('course_transcription_sources','id,source_revision,source_scope,enabled,duration_ms',
    {video_id:`eq.${videoId}`});
  if(sources.some(s=>s.source_revision!==candidate.source_revision||s.source_scope!=='historical_live_event'))
    throw new Error('historical_video_already_registered_elsewhere');
  const bindings=sources.length?await io.rows('course_transcription_bindings','source_id',
    {source_id:`in.(${sources.map(s=>s.id).join(',')})`}):[];
  if(bindings.length)throw new Error('historical_video_has_lesson_binding');
  const parsed=candidate.parsed;
  return {event:{id:event.id,product_id:COURSE_PRODUCT_IDS[1],provider_live_event_id:event.kinescope_live_event_id,
      provider_project_id:event.kinescope_project_id,event_updated_at:event.updated_at},
    source:{video_id:videoId,source_revision:candidate.source_revision,duration_ms:candidate.duration_ms,
      status:candidate.status,content_sha256:parsed?.content_sha256||null,
      subtitle_sha256:parsed?.metadata?.subtitle_sha256||null,chars:parsed?.chars||0,
      quality_flags:parsed?.quality_flags||[]},
    text:parsed?.text,metadata:parsed?.metadata};
}

export async function dryRunHistoricalEvent(io,actor,eventId){
  const {event,source}=await inspectEvent(io,actor,eventId);
  return {schema_version:1,mode:'historical_live_caption_dry_run',captured_at:new Date().toISOString(),
    event,source,ready:source.status==='ready_to_import'};
}

export async function importHistoricalEvent(io,actor,manifest){
  if(manifest?.schema_version!==1||manifest.mode!=='historical_live_caption_dry_run'
    ||manifest.ready!==true||!uuid(manifest.event?.id)||!uuid(manifest.source?.video_id))
    throw new Error('historical_manifest_invalid');
  const fresh=await inspectEvent(io,actor,manifest.event.id);
  if(fresh.source.status!=='ready_to_import'||!same(fresh.event,manifest.event)
    ||!same(fresh.source,manifest.source))throw new Error('historical_source_changed');
  let sources=await io.rows('course_transcription_sources','id,source_revision,source_scope,enabled,duration_ms',
    {video_id:`eq.${fresh.source.video_id}`});
  if(!sources.length){
    await io.write('course_transcription_sources',{id:randomUUID(),provider:'kinescope',
      video_id:fresh.source.video_id,source_revision:fresh.source.source_revision,
      source_scope:'historical_live_event',revision_basis:'provider_api',duration_ms:fresh.source.duration_ms,
      enabled:true,created_by:actor},'provider,video_id,source_revision');
    sources=await io.rows('course_transcription_sources','id,source_revision,source_scope,enabled,duration_ms',
      {video_id:`eq.${fresh.source.video_id}`});
  }
  if(sources.length!==1||sources[0].source_revision!==fresh.source.source_revision
    ||sources[0].source_scope!=='historical_live_event'||sources[0].enabled!==true
    ||sources[0].duration_ms!==fresh.source.duration_ms)throw new Error('historical_source_readback_failed');
  const sourceId=sources[0].id;
  await io.write('course_historical_event_bindings',{source_id:sourceId,live_event_id:fresh.event.id,
    product_id:fresh.event.product_id,provider_live_event_id:fresh.event.provider_live_event_id,
    provider_project_id:fresh.event.provider_project_id,event_updated_at:fresh.event.event_updated_at,
    created_by:actor},'source_id');
  const bindings=await io.rows('course_historical_event_bindings',
    'source_id,live_event_id,product_id,provider_live_event_id,provider_project_id,event_updated_at',
    {source_id:`eq.${sourceId}`});
  if(bindings.length!==1||bindings[0].live_event_id!==fresh.event.id||bindings[0].product_id!==fresh.event.product_id
    ||bindings[0].provider_live_event_id!==fresh.event.provider_live_event_id
    ||bindings[0].provider_project_id!==fresh.event.provider_project_id
    ||Date.parse(bindings[0].event_updated_at)!==Date.parse(fresh.event.event_updated_at))
    throw new Error('historical_binding_readback_failed');
  const args={_source_id:sourceId,_source_revision:fresh.source.source_revision,_text:fresh.text,_metadata:fresh.metadata};
  const saved=await io.rpc('course_transcription_import_subtitles',args);
  const replay=await io.rpc('course_transcription_import_subtitles',args);
  const transcripts=await io.rows('course_transcripts','source_id,content_sha256,char_count,classification,quality_status,origin',
    {source_id:`eq.${sourceId}`});
  if(transcripts.length!==1||transcripts[0].content_sha256!==fresh.source.content_sha256
    ||transcripts[0].char_count!==fresh.source.chars||transcripts[0].classification!=='paid_private'
    ||transcripts[0].quality_status!=='unreviewed'||transcripts[0].origin!=='provider_subtitles'
    ||replay.reused!==true)throw new Error('historical_transcript_readback_failed');
  return {mode:'historical_live_caption_execute',created:!saved.reused,replay_changes:0,stt_calls:0,
    source_count:1,transcript_count:1,lesson_bindings_created:0};
}
