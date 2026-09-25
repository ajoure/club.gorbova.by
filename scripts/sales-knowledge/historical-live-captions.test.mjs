import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {COURSE_PRODUCT_IDS} from './lib/course-provider-import.mjs';
import {dryRunHistoricalEvent,importHistoricalEvent} from './lib/historical-live-captions.mjs';

const owner='00000000-0000-4000-8000-000000000001';
const outsider='00000000-0000-4000-8000-000000000002';
const eventId='00000000-0000-4000-8000-000000000003';
const liveId='00000000-0000-4000-8000-000000000004';
const videoId='00000000-0000-4000-8000-000000000005';
const sha=value=>createHash('sha256').update(value).digest('hex');
const vtt='WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nДобрый день, сегодня разбираем практические вопросы бухгалтерского учета.\n\n00:01:00.000 --> 00:02:00.000\nПосмотрим на документы и обсудим вопросы участников конференции.\n\n00:02:00.000 --> 00:03:00.000\nПродолжаем обсуждение и отвечаем на вопросы бухгалтеров.\n';

function fixture(){
  const sources=[],historical=[],transcripts=[],lesson=[];let writes=0,stt=0;
  const event={id:eventId,title:'Конференция 5',product_id:COURSE_PRODUCT_IDS[1],
    scheduled_at:'2026-09-13T07:20:00Z',live_started_at:'2026-09-13T07:26:00Z',
    webinar_completed_at:'2026-09-13T12:18:00Z',kinescope_live_event_id:liveId,
    kinescope_project_id:'project-one',updated_at:'2026-09-13T12:19:00Z'};
  const video={id:videoId,title:'Конференция 5 13 сентября',project_id:'project-one',
    created_at:'2026-09-13T12:14:00Z',updated_at:'2026-09-13T12:15:00Z',version:1,duration:180};
  const io={
    async rows(table,fields,filter={}){
      if(table==='integration_instances')return [{id:'i',config:{api_token:'synthetic'}}];
      if(table==='live_events')return [event];
      if(table==='course_transcription_sources')return sources.filter(s=>!filter.video_id||filter.video_id===`eq.${s.video_id}`);
      if(table==='course_transcription_bindings')return lesson;
      if(table==='course_historical_event_bindings')return historical;
      if(table==='course_transcripts')return transcripts;
      throw new Error(`unexpected_table_${table}`);
    },
    async rpc(name,args){
      if(name==='has_role_v2')return args._user_id===owner;
      if(name==='course_transcription_import_subtitles'){
        const existing=transcripts[0];if(existing)return {reused:true};
        transcripts.push({source_id:args._source_id,content_sha256:sha(args._text),
          char_count:[...args._text].length,classification:'paid_private',quality_status:'unreviewed',
          origin:'provider_subtitles'});return {reused:false};
      }
      throw new Error(`unexpected_rpc_${name}`);
    },
    async liveVideos(){return {data:[{id:videoId}]};},
    async provider(path){
      if(path===`/videos/${videoId}`)return {data:video};
      if(path===`/videos/${videoId}/subtitles?page=1&per_page=100`)return {data:[{id:'sub',language:'ru',status:'done'}]};
      if(path===`/videos/${videoId}/subtitles/sub`)return {data:{id:'sub',language:'ru',status:'done',url:'https://kinescopecdn.net/sub.vtt'}};
      throw new Error(`unexpected_provider_${path}`);
    },
    async subtitle(){return vtt;},
    async write(table,row){writes++;
      if(table==='course_transcription_sources'){sources.push(row);return [row];}
      if(table==='course_historical_event_bindings'){
        if(!historical.some(binding=>binding.source_id===row.source_id))historical.push(row);
        return [row];
      }
      throw new Error(`unexpected_write_${table}`);
    }
  };
  return {io,sources,historical,transcripts,lesson,event,video,stats:()=>({writes,stt})};
}

test('historical captions remain private, unbound to lessons and replay without duplicate',async()=>{
  const f=fixture(),manifest=await dryRunHistoricalEvent(f.io,owner,eventId);
  assert.equal(manifest.ready,true);assert.equal(f.stats().writes,0);
  const first=await importHistoricalEvent(f.io,owner,manifest);
  assert.equal(first.created,true);assert.equal(first.stt_calls,0);
  assert.equal(f.sources.length,1);assert.equal(f.historical.length,1);
  assert.equal(f.transcripts.length,1);assert.equal(f.lesson.length,0);
  const second=await importHistoricalEvent(f.io,owner,manifest);
  assert.equal(second.created,false);assert.equal(f.sources.length,1);
});

test('historical import fails closed on wrong actor, changed event or video identity',async()=>{
  const f=fixture();
  await assert.rejects(dryRunHistoricalEvent(f.io,outsider,eventId),/owner_required/);
  const manifest=await dryRunHistoricalEvent(f.io,owner,eventId);
  f.event.kinescope_project_id='another-project';
  await assert.rejects(importHistoricalEvent(f.io,owner,manifest),/project_mismatch/);
  assert.equal(f.stats().writes,0);
});

test('changed captions and multiple provider recordings stop before writes',async()=>{
  const f=fixture(),manifest=await dryRunHistoricalEvent(f.io,owner,eventId);
  f.io.subtitle=async()=>vtt.replace('Продолжаем обсуждение','Завершаем обсуждение');
  await assert.rejects(importHistoricalEvent(f.io,owner,manifest),/historical_source_changed/);
  assert.equal(f.stats().writes,0);
  f.io.liveVideos=async()=>({data:[{id:videoId},{id:'00000000-0000-4000-8000-000000000007'}]});
  await assert.rejects(dryRunHistoricalEvent(f.io,owner,eventId),/historical_event_video_ambiguous/);
});

test('only the dated CB20 Conference 5 may use an event with no product',async()=>{
  const f=fixture();
  f.event.product_id=null;
  f.event.title='Цб 2.0 20 поток Конференция 5';
  f.video.title='Цб 2.0 20 поток Конференция 5 13 сентября';
  const manifest=await dryRunHistoricalEvent(f.io,owner,eventId);
  assert.equal(manifest.ready,true);
  assert.equal(manifest.event.product_id,COURSE_PRODUCT_IDS[1]);
  await importHistoricalEvent(f.io,owner,manifest);
  assert.equal(f.historical.length,1);

  const other=fixture();other.event.product_id=null;
  other.event.title='Другой эфир Конференция 5';
  await assert.rejects(dryRunHistoricalEvent(other.io,owner,eventId),/historical_event_scope_invalid/);
  assert.equal(other.stats().writes,0);
});

test('historical recording uses matching v2 revision date when v1 omits it',async()=>{
  const f=fixture();
  f.video.updated_at=null;
  f.io.liveVideos=async()=>({data:[{id:videoId,version:1,duration:180,
    updated_at:'2026-09-13T12:15:00Z'}]});
  const manifest=await dryRunHistoricalEvent(f.io,owner,eventId);
  assert.equal(manifest.ready,true);
  assert.equal(f.stats().writes,0);
  f.io.liveVideos=async()=>({data:[{id:videoId,version:2,duration:180,
    updated_at:'2026-09-13T12:15:00Z'}]});
  await assert.rejects(importHistoricalEvent(f.io,owner,manifest),/provider_revision_fallback_mismatch/);
  assert.equal(f.stats().writes,0);
});

test('historical binding schema blocks course lessons and browser writes',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES ('${owner}'),('${outsider}');`);
    await db.exec(`CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION public.has_role_v2(_user_id uuid,_role_code text) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT _user_id='${owner}'::uuid AND _role_code='super_admin' $$;
      GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
      CREATE TABLE public.training_lessons(id uuid PRIMARY KEY);
      CREATE TABLE public.lesson_blocks(id uuid PRIMARY KEY);
      CREATE TABLE public.products_v2(id uuid PRIMARY KEY);
      CREATE TABLE public.live_events(id uuid PRIMARY KEY,title text,scheduled_at timestamptz,product_id uuid,kinescope_live_event_id text,
        kinescope_project_id text,updated_at timestamptz);`);
    const base=new URL('../../supabase/migrations/',import.meta.url);
    await db.exec(await readFile(new URL('20260911172902_90aeec8b-4b8d-4ff2-b180-19e2d6ad992a.sql',base),'utf8'));
    await db.exec(await readFile(new URL('20260911184123_9c93b1c8-09c9-4f6a-9f80-d1490ed4f009.sql',base),'utf8'));
    await db.exec(await readFile(new URL('20260925141617_cb20_historical_live_caption_bindings.sql',base),'utf8'));
    await db.exec(await readFile(new URL('20260925145323_6a819f7c-46a8-47a2-b24b-bbbb04391398.sql',base),'utf8'));
    await db.query('INSERT INTO products_v2(id) VALUES($1)',[COURSE_PRODUCT_IDS[1]]);
    await db.query('INSERT INTO live_events(id,product_id,kinescope_live_event_id,kinescope_project_id,updated_at) VALUES($1,$2,$3,$4,$5)',
      [eventId,COURSE_PRODUCT_IDS[1],liveId,'project-one','2026-09-13T12:19:00Z']);
    const source='00000000-0000-4000-8000-000000000006';
    await db.query(`INSERT INTO course_transcription_sources(id,provider,video_id,source_revision,duration_ms,enabled,created_by,source_scope)
      VALUES($1,'kinescope',$2,$3,180000,true,$4,'historical_live_event')`,[source,videoId,'a'.repeat(64),owner]);
    await db.query(`INSERT INTO course_historical_event_bindings(source_id,live_event_id,product_id,
      provider_live_event_id,provider_project_id,event_updated_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [source,eventId,COURSE_PRODUCT_IDS[1],liveId,'project-one','2026-09-13T12:19:00Z',owner]);
    await db.query('INSERT INTO training_lessons VALUES($1)',[eventId]);
    await db.query('INSERT INTO lesson_blocks VALUES($1)',[liveId]);
    await assert.rejects(db.query(`INSERT INTO course_transcription_bindings(source_id,lesson_id,block_id,product_id,block_updated_at)
      VALUES($1,$2,$3,$4,now())`,[source,eventId,liveId,COURSE_PRODUCT_IDS[1]]),/historical_source_not_course_lesson/);
    await assert.rejects(db.query("UPDATE course_transcription_sources SET source_scope='course' WHERE id=$1",[source]),
      /source_scope_immutable/);
    const nullEvent='00000000-0000-4000-8000-000000000008',nullSource='00000000-0000-4000-8000-000000000009';
    await db.query(`INSERT INTO live_events(id,title,scheduled_at,product_id,kinescope_live_event_id,
      kinescope_project_id,updated_at) VALUES($1,'Цб 2.0 20 поток Конференция 5','2026-09-13T07:00:00Z',NULL,$2,'project-one','2026-09-13T12:19:00Z')`,
      [nullEvent,liveId]);
    await db.query(`INSERT INTO course_transcription_sources(id,provider,video_id,source_revision,duration_ms,enabled,created_by,source_scope)
      VALUES($1,'kinescope',$2,$3,180000,true,$4,'historical_live_event')`,
      [nullSource,'00000000-0000-4000-8000-000000000010','b'.repeat(64),owner]);
    await db.query(`INSERT INTO course_historical_event_bindings(source_id,live_event_id,product_id,
      provider_live_event_id,provider_project_id,event_updated_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [nullSource,nullEvent,COURSE_PRODUCT_IDS[1],liveId,'project-one','2026-09-13T12:19:00Z',owner]);
    const wrongEvent='00000000-0000-4000-8000-000000000011',wrongSource='00000000-0000-4000-8000-000000000012';
    await db.query(`INSERT INTO live_events(id,title,scheduled_at,product_id,kinescope_live_event_id,
      kinescope_project_id,updated_at) VALUES($1,'Другая конференция','2026-09-13T07:00:00Z',NULL,$2,'project-one','2026-09-13T12:19:00Z')`,
      [wrongEvent,liveId]);
    await db.query(`INSERT INTO course_transcription_sources(id,provider,video_id,source_revision,duration_ms,enabled,created_by,source_scope)
      VALUES($1,'kinescope',$2,$3,180000,true,$4,'historical_live_event')`,
      [wrongSource,'00000000-0000-4000-8000-000000000013','c'.repeat(64),owner]);
    await assert.rejects(db.query(`INSERT INTO course_historical_event_bindings(source_id,live_event_id,product_id,
      provider_live_event_id,provider_project_id,event_updated_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [wrongSource,wrongEvent,COURSE_PRODUCT_IDS[1],liveId,'project-one','2026-09-13T12:19:00Z',owner]),
      /historical_event_binding_invalid/);
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${outsider}'`);
    assert.equal((await db.query('SELECT * FROM course_historical_event_bindings')).rows.length,0);
    await assert.rejects(db.query('DELETE FROM course_historical_event_bindings WHERE source_id=$1',[source]),/permission denied/);
    await db.exec(`SET request.jwt.claim.sub='${owner}'`);
    assert.equal((await db.query('SELECT * FROM course_historical_event_bindings')).rows.length,2);
  }finally{await db.close();}
});
