import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {sha} from './lib/course-stt.mjs';

const owner='00000000-0000-4000-8000-000000000001';
const source='00000000-0000-4000-8000-000000000002';
const audit='00000000-0000-4000-8000-000000000003';
const manifest='a'.repeat(64),revision='b'.repeat(64),audio=['c'.repeat(64),'d'.repeat(64)];
const held='·········';

test('historical silence RPC preserves held ASR, records proof and resumes without STT retry',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES('${owner}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION public.has_role_v2(_id uuid,_role text) RETURNS boolean
        LANGUAGE sql STABLE AS $$ SELECT _id='${owner}'::uuid AND _role='super_admin' $$;
      GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
      CREATE TABLE public.course_transcription_sources(id uuid PRIMARY KEY,enabled boolean,
        source_scope text,source_revision text);
      CREATE TABLE public.course_historical_event_bindings(source_id uuid PRIMARY KEY);
      CREATE TABLE public.course_transcription_bindings(source_id uuid);
      CREATE TABLE public.course_caption_gap_audits(id uuid PRIMARY KEY,source_id uuid,
        requested_by uuid,expected_parts integer,classification text,quality_status text,
        manifest_sha256 text,source_revision text,status text);
      CREATE TABLE public.course_caption_gap_parts(audit_id uuid,part_index integer,
        gap_index integer,audio_sha256 text,start_ms bigint,end_ms bigint,status text,
        attempts integer,error_code text,asr_text text,text_sha256 text,updated_at timestamptz,
        PRIMARY KEY(audit_id,part_index));
      CREATE TABLE public.course_gap_reviews(audit_id uuid,decisions jsonb);
      GRANT ALL ON course_transcription_sources,course_historical_event_bindings,
        course_transcription_bindings,course_caption_gap_audits,course_caption_gap_parts,course_gap_reviews
        TO service_role;`);
    const migration=await readFile(new URL('../../supabase/migrations/20260925210000_cb20_historical_digital_silence.sql',import.meta.url),'utf8');
    await db.exec(migration);
    await db.query(`INSERT INTO course_transcription_sources VALUES($1,true,'historical_live_event',$2)`,[source,revision]);
    await db.query(`INSERT INTO course_historical_event_bindings VALUES($1)`,[source]);
    await db.query(`INSERT INTO course_caption_gap_audits VALUES($1,$2,$3,3,'paid_private','unreviewed',$4,$5,'review_required')`,[audit,source,owner,manifest,revision]);
    await db.query(`INSERT INTO course_caption_gap_parts VALUES
      ($1,0,0,$2,0,90000,'uncertain',1,'asr_outcome_uncertain',$3,$4,now()),
      ($1,1,0,$5,90000,180000,'pending',0,null,null,null,now()),
      ($1,2,0,$6,180000,183360,'pending',0,null,null,null,now())`,
    [audit,audio[0],held,sha(held),audio[1],'e'.repeat(64)]);
    const call=async(i,{actor=owner,hash=audio[i],bytes=2880000}={})=>{
      await db.exec('SET ROLE service_role');
      try{return (await db.query(`SELECT public.course_historical_gap_accept_digital_silence($1,$2,$3,$4,$5,$6) result`,
        [audit,actor,i,manifest,hash,bytes])).rows[0].result;}
      finally{await db.exec('RESET ROLE');}
    };
    await assert.rejects(call(0,{actor:'00000000-0000-4000-8000-000000000009'}),/historical_silence_audit_changed/);
    await assert.rejects(call(0,{hash:'e'.repeat(64)}),/historical_silence_audio_changed/);
    await assert.rejects(call(0,{bytes:2879998}),/historical_silence_audio_changed/);
    assert.deepEqual(await call(0),{status:'evidence',reused:false});
    assert.deepEqual(await call(0),{status:'evidence',reused:true});
    assert.deepEqual(await call(1),{status:'evidence',reused:false});
    assert.deepEqual(await call(1),{status:'evidence',reused:true});
    const rows=(await db.query('SELECT part_index,status,attempts,asr_text FROM course_caption_gap_parts ORDER BY part_index')).rows;
    assert.equal(rows[0].asr_text,held);assert.equal(rows[0].attempts,1);
    assert.equal(rows[1].asr_text,'[цифровая тишина]');assert.equal(rows[1].attempts,1);
    assert.equal(rows[2].status,'pending');assert.equal(rows[2].attempts,0);
    assert.equal((await db.query('SELECT status FROM course_caption_gap_audits')).rows[0].status,'pending');
    assert.equal((await db.query('SELECT count(*)::integer n FROM course_historical_gap_silence_proofs')).rows[0].n,2);
    await db.exec('SET ROLE service_role');
    try{
      await assert.rejects(db.query(`INSERT INTO course_gap_reviews VALUES($1,$2)`,
        [audit,JSON.stringify([{kind:'speech',text:'Речь'},{kind:'non_speech',text:null}])]),
      /historical_silence_review_required/);
      await db.query(`INSERT INTO course_gap_reviews VALUES($1,$2)`,
        [audit,JSON.stringify([{kind:'non_speech',text:null},{kind:'non_speech',text:null}])]);
    }finally{await db.exec('RESET ROLE');}
    await db.exec('SET ROLE service_role');
    try{await assert.rejects(db.query(`SELECT public.course_historical_gap_accept_digital_silence($1,$2,2,$3,$4,$5)`,
      [audit,owner,manifest,'e'.repeat(64),2880000]),/historical_silence_part_invalid/);}
    finally{await db.exec('RESET ROLE');}
    await db.exec(`DELETE FROM course_historical_gap_silence_proofs;
      UPDATE course_caption_gap_parts SET status='pending',attempts=0,
        asr_text=null,text_sha256=null,error_code=null WHERE part_index IN (0,1);`);
    assert.deepEqual(await call(0),{status:'evidence',reused:false});
    assert.deepEqual(await call(1),{status:'evidence',reused:false});
    assert.equal((await db.query('SELECT count(*)::integer n FROM course_historical_gap_silence_proofs')).rows[0].n,2);
  }finally{await db.close();}
});
