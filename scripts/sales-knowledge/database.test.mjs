import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
const owner='00000000-0000-4000-8000-000000000001';
const staff='00000000-0000-4000-8000-000000000002';
const revision='a'.repeat(64), audioHash='b'.repeat(64);
before(async()=>{
  db=new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${owner}'),('${staff}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.has_role_v2(_user_id uuid,_role_code text) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT _user_id='${owner}'::uuid AND _role_code='super_admin' $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE public.training_lessons(id uuid PRIMARY KEY);
    CREATE TABLE public.lesson_blocks(id uuid PRIMARY KEY);
    CREATE TABLE public.products_v2(id uuid PRIMARY KEY);
  `);
  await db.exec(await readFile(new URL('../../supabase/migrations/20260911152939_course_source_transcriptions.sql',import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});

const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
async function rpc(name,args){
  await db.exec('SET ROLE service_role');
  try{return (await one(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).result;}
  finally{await db.exec('RESET ROLE');}
}
async function source(enabled=true,duration=100000){
  const id=randomUUID();
  await db.query(`INSERT INTO course_transcription_sources(id,provider,video_id,source_revision,audio_track_id,duration_ms,audio_bytes,enabled,created_by)
    VALUES($1,'kinescope',$2,$3,'track', $4,1000,$5,$6)`,[id,randomUUID(),revision,duration,enabled,owner]);
  return id;
}
async function job(duration=100000){
  const id=await source(true,duration);
  return {source:id,...await rpc('course_transcription_create_job',[id,owner,duration])};
}
const claim=(id,index,hash=audioHash,rev=revision)=>rpc('course_transcription_claim_part',[id,index,hash,rev]);
const finish=(id,index,token,text='Пример текста урока',error=null)=>rpc('course_transcription_finish_part',[id,index,token,text,error]);

test('closed corpus: owner can read; staff cannot; anonymous and browser RPC/mutations denied',async()=>{
  await source();
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'`);
  assert.ok((await one('SELECT count(*)::int AS n FROM course_transcription_sources')).n>0);
  await db.exec(`SET request.jwt.claim.sub='${staff}'`);
  assert.equal((await one('SELECT count(*)::int AS n FROM course_transcription_sources')).n,0);
  await assert.rejects(db.query('SELECT course_transcription_create_job($1,$2,1000)',[randomUUID(),staff]),/permission denied/);
  await assert.rejects(db.exec('UPDATE course_transcription_sources SET enabled=true'),/permission denied/);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(db.exec('SELECT * FROM course_transcripts'),/permission denied/);
  await db.exec('RESET ROLE');
});

test('disabled sources, non-owner actor and changed duration do not create jobs',async()=>{
  const id=await source(false);
  await assert.rejects(rpc('course_transcription_create_job',[id,owner,100000]),/source_not_enabled/);
  const enabled=await source();
  await assert.rejects(rpc('course_transcription_create_job',[enabled,staff,100000]),/owner_required/);
  await assert.rejects(rpc('course_transcription_create_job',[enabled,owner,200000]),/duration_mismatch/);
  assert.equal((await one('SELECT count(*)::int AS n FROM course_transcription_jobs WHERE source_id=$1',[enabled])).n,0);
});

test('same source creates one job and exact 90-second windows including tail',async()=>{
  const j=await job();
  assert.equal((await rpc('course_transcription_create_job',[j.source,owner,100000])).job_id,j.job_id);
  const rows=(await db.query('SELECT part_index,start_ms::int,end_ms::int FROM course_transcription_parts WHERE job_id=$1 ORDER BY part_index',[j.job_id])).rows;
  assert.deepEqual(rows,[{part_index:0,start_ms:0,end_ms:90000},{part_index:1,start_ms:90000,end_ms:100000}]);
});

test('one claim per part; wrong source revision or changed audio cannot be charged',async()=>{
  const j=await job();
  await assert.rejects(claim(j.job_id,0,audioHash,'c'.repeat(64)),/source_revision_changed/);
  const a=await claim(j.job_id,0);
  assert.equal(a.action,'transcribe');
  assert.equal((await claim(j.job_id,0)).action,'hold');
  await assert.rejects(claim(j.job_id,0,'c'.repeat(64)),/part_audio_changed/);
  assert.equal((await one('SELECT attempts FROM course_transcription_parts WHERE job_id=$1 AND part_index=0',[j.job_id])).attempts,1);
});

test('lease expiry requires reconciliation and does not automatically buy another attempt',async()=>{
  const j=await job(); const c=await claim(j.job_id,0);
  await db.query("UPDATE course_transcription_parts SET lease_until=now()-interval '1 minute' WHERE job_id=$1",[j.job_id]);
  assert.equal((await claim(j.job_id,0)).status,'uncertain');
  assert.equal((await finish(j.job_id,0,c.claim_token)).held,true);
  assert.equal((await claim(j.job_id,1)).status,'review_required');
});

test('incomplete text cannot be finalized; complete assembly and replay have exact hash',async()=>{
  const j=await job();
  await assert.rejects(rpc('course_transcription_finalize',[j.job_id,revision]),/incomplete_transcript/);
  for(let i=0;i<2;i++){
    const c=await claim(j.job_id,i);
    await assert.rejects(finish(j.job_id,i,randomUUID()),/claim_mismatch/);
    await finish(j.job_id,i,c.claim_token,`Часть ${i}`);
    assert.equal((await claim(j.job_id,i)).action,'cached');
  }
  const done=await rpc('course_transcription_finalize',[j.job_id,revision]);
  const replay=await rpc('course_transcription_finalize',[j.job_id,revision]);
  assert.equal(done.reused,false);assert.equal(replay.reused,true);assert.equal(done.sha256,replay.sha256);
  const row=await one('SELECT transcript_text,quality_status,classification FROM course_transcripts WHERE source_id=$1',[j.source]);
  assert.deepEqual(row,{transcript_text:'Часть 0\n\nЧасть 1',quality_status:'unreviewed',classification:'paid_private'});
  await assert.rejects(rpc('course_transcription_create_job',[j.source,owner,100000]),/transcript_already_exists/);
});

test('provider error and empty result are held rather than retried',async()=>{
  const j=await job();const c=await claim(j.job_id,0);
  assert.equal((await finish(j.job_id,0,c.claim_token,'','upstream_uncertain')).status,'uncertain');
  assert.equal((await claim(j.job_id,0)).status,'review_required');
});

test('late acknowledgement cannot resume a cancelled job',async()=>{
  const j=await job();const c=await claim(j.job_id,0);
  await db.query("UPDATE course_transcription_jobs SET status='cancelled' WHERE id=$1",[j.job_id]);
  await finish(j.job_id,0,c.claim_token);
  assert.equal((await claim(j.job_id,1)).status,'cancelled');
  await assert.rejects(rpc('course_transcription_finalize',[j.job_id,revision]),/job_held/);
});

test('ready provider subtitles import once, stay private/unreviewed and block duplicate STT',async()=>{
  const id=await source();
  const metadata={language:'ru',cue_count:2,subtitle_sha256:'d'.repeat(64),first_ms:0,last_ms:100000,covered_ms:90000,max_gap_ms:10000};
  const args=[id,revision,'Готовый текст субтитров',metadata];
  const first=await rpc('course_transcription_import_subtitles',args);
  assert.equal(first.reused,false);assert.equal((await rpc('course_transcription_import_subtitles',args)).reused,true);
  await assert.rejects(rpc('course_transcription_create_job',[id,owner,100000]),/transcript_already_exists/);
  await assert.rejects(rpc('course_transcription_import_subtitles',[id,revision,'Другой текст',metadata]),/transcript_conflict/);
  const row=await one('SELECT origin,job_id,quality_status FROM course_transcripts WHERE source_id=$1',[id]);
  assert.deepEqual(row,{origin:'provider_subtitles',job_id:null,quality_status:'unreviewed'});
});

test('subtitle import cannot override an existing potentially billed STT job',async()=>{
  const j=await job();
  await assert.rejects(rpc('course_transcription_import_subtitles',[j.source,revision,'Текст',{language:'ru',cue_count:1,subtitle_sha256:'d'.repeat(64)}]),/stt_job_exists_reconcile_first/);
});
