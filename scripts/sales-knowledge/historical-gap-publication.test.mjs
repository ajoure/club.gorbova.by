import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {sha} from './lib/course-stt.mjs';

const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const source='00000000-0000-4000-8000-000000000003';
const audit='00000000-0000-4000-8000-000000000004';
const raw='WEBVTT\n\n00:03:03.360 --> 01:00:00.000\nПродолжение конференции.\n';

test('historical reviewed publication is service-only, private and idempotent',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES ('${owner}'),('${other}');
      CREATE FUNCTION public.has_role_v2(_user_id uuid,_role_code text) RETURNS boolean
        LANGUAGE sql STABLE AS $$ SELECT _user_id='${owner}'::uuid AND _role_code='super_admin' $$;
      CREATE TABLE public.course_transcription_sources(id uuid PRIMARY KEY,enabled boolean,
        source_scope text,source_revision text,revision_basis text,duration_ms bigint);
      CREATE TABLE public.course_historical_event_bindings(source_id uuid PRIMARY KEY);
      CREATE TABLE public.course_transcription_bindings(source_id uuid);
      CREATE TABLE public.course_transcription_jobs(source_id uuid);
      CREATE TABLE public.course_caption_gap_audits(id uuid PRIMARY KEY,source_id uuid,requested_by uuid,
        status text,expected_parts integer,classification text,quality_status text,
        source_revision text,caption_sha256 text,raw_vtt text);
      CREATE TABLE public.course_caption_gap_parts(audit_id uuid,part_index integer,gap_index integer,
        start_ms bigint,end_ms bigint,attempts integer,status text,asr_text text,text_sha256 text,
        audio_sha256 text,error_code text);
      CREATE TABLE public.course_gap_reviews(audit_id uuid PRIMARY KEY,reviewed_by uuid,
        manifest_sha256 text,decisions jsonb,transcript_sha256 text);
      CREATE TABLE public.course_transcripts(source_id uuid PRIMARY KEY,origin text,
        source_revision text,transcript_text text,content_sha256 text,char_count integer,
        duration_ms bigint,subtitle_metadata jsonb,caption_provenance jsonb,
        classification text DEFAULT 'paid_private',quality_status text DEFAULT 'unreviewed');`);
    const migration=new URL('../../supabase/migrations/20260925193000_cb20_historical_gap_publication.sql',import.meta.url);
    await db.exec(await readFile(migration,'utf8'));
    const heldMigration=new URL('../../supabase/migrations/20260925223000_cb20_historical_held_microfragment_review.sql',import.meta.url);
    await db.exec(await readFile(heldMigration,'utf8'));
    const revision='a'.repeat(64),evidence='Начало конференции',text='Проверенная речь.\nПродолжение конференции.';
    await db.query(`INSERT INTO course_transcription_sources VALUES($1,true,'historical_live_event',$2,'provider_api',3600000)`,[source,revision]);
    await db.query('INSERT INTO course_historical_event_bindings VALUES($1)',[source]);
    await db.query(`INSERT INTO course_caption_gap_audits VALUES($1,$2,$3,'evidence',3,'paid_private','unreviewed',$4,$5,$6)`,
      [audit,source,owner,revision,sha(raw),raw]);
    const decisions=[];
    for(let i=0;i<3;i++){
      const audioSha=String(i+1).repeat(64);
      await db.query(`INSERT INTO course_caption_gap_parts VALUES($1,$2,0,$3,$4,1,'evidence',$5,$6,$7,null)`,
        [audit,i,i*90000,i===2?183360:(i+1)*90000,evidence,sha(evidence),audioSha]);
      decisions.push({part_index:i,kind:'speech',text:'Проверенная речь.',
        evidence_sha256:sha(evidence),audio_sha256:audioSha,reviewer_id:owner,
        note:'Сверено с исходным аудио'});
    }
    const metadata={language:'ru',subtitle_sha256:sha(raw),gap_review_status:'reviewed',
      reviewed_gap_parts:3,reviewer_id:owner,review_decisions_sha256:'b'.repeat(64)};
    const call=(actor=owner)=>db.query('SELECT public.course_historical_gap_publish_reviewed($1,$2,$3,$4,$5,$6) result',
      [audit,actor,'c'.repeat(64),JSON.stringify(decisions),text,JSON.stringify(metadata)]);
    await assert.rejects(call(other),/historical_review_owner_required/);
    const first=(await call()).rows[0].result;assert.equal(first.reused,false);
    const second=(await call()).rows[0].result;assert.equal(second.reused,true);
    assert.equal((await db.query('SELECT count(*)::int n FROM course_transcripts')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM course_transcription_bindings')).rows[0].n,0);
    await db.query('DELETE FROM course_gap_reviews WHERE audit_id=$1',[audit]);
    await db.query('DELETE FROM course_transcripts WHERE source_id=$1',[source]);
    await db.query("UPDATE course_caption_gap_audits SET status='review_required' WHERE id=$1",[audit]);
    await db.query("UPDATE course_caption_gap_parts SET status='uncertain',error_code='asr_outcome_uncertain',asr_text='·',text_sha256=$2 WHERE audit_id=$1 AND part_index=2",[audit,sha('·')]);
    decisions[2]={...decisions[2],kind:'non_speech',text:null,evidence_sha256:sha('·'),
      note:'Неразборчивый короткий звук перед первым субтитром'};
    const heldCall=()=>db.query('SELECT public.course_historical_gap_publish_reviewed($1,$2,$3,$4,$5,$6) result',
      [audit,owner,'c'.repeat(64),JSON.stringify(decisions),text,JSON.stringify(metadata)]);
    const wrong={...decisions[2],kind:'speech',text:'Придуманная реплика'};
    decisions[2]=wrong;
    await assert.rejects(heldCall(),/historical_review_decision_invalid/);
    decisions[2]={...wrong,kind:'non_speech',text:null};
    assert.equal((await heldCall()).rows[0].result.reused,false);
    assert.equal((await heldCall()).rows[0].result.reused,true);
    assert.equal((await db.query("SELECT status FROM course_caption_gap_parts WHERE audit_id=$1 AND part_index=2",[audit])).rows[0].status,'uncertain');
    await db.query("UPDATE course_transcription_sources SET source_scope='course' WHERE id=$1",[source]);
    await assert.rejects(call(),/historical_review_source_changed/);
    await db.exec(`SET ROLE authenticated`);
    await assert.rejects(call(),/permission denied/);
  }finally{await db.close();}
});
