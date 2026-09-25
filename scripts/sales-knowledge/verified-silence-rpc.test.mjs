import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pcmParts,sha} from './lib/course-stt.mjs';
const actor='00000000-0000-4000-8000-000000000001',source='11111111-1111-4111-8111-111111111111',video='22222222-2222-4222-8222-222222222222',revision='a'.repeat(64);
let db;
before(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${actor}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION public.has_role_v2(_user_id uuid,_role_code text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT _user_id='${actor}'::uuid AND _role_code='super_admin'$$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
 CREATE TABLE training_lessons(id uuid PRIMARY KEY);CREATE TABLE lesson_blocks(id uuid PRIMARY KEY);CREATE TABLE products_v2(id uuid PRIMARY KEY);`);
 for(const name of ['20260911172902_90aeec8b-4b8d-4ff2-b180-19e2d6ad992a.sql','20260911184123_9c93b1c8-09c9-4f6a-9f80-d1490ed4f009.sql'])
  await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec("ALTER TABLE course_transcription_sources ADD COLUMN source_scope text NOT NULL DEFAULT 'course'");
 await db.exec(await readFile(new URL('../../supabase/migrations/20260925222034_cb21_verified_digital_silence.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());beforeEach(async()=>db.exec('TRUNCATE course_transcription_sources CASCADE'));
async function rpc(args,role='service_role'){
 await db.exec('SET ROLE '+role);try{return (await db.query('SELECT course_transcription_mark_verified_silence($1,$2,$3,$4,$5,$6) AS r',args)).rows[0].r;}finally{await db.exec('RESET ROLE');}
}
async function fixture(duration=12488416,index=0){
 await db.query("INSERT INTO course_transcription_sources(id,provider,video_id,source_revision,duration_ms,audio_track_id,audio_bytes,enabled,created_by) VALUES($1,'kinescope',$2,$3,$4,'track',10000,true,$5)",[source,video,revision,duration,actor]);
 const job=(await db.query('SELECT course_transcription_create_job($1,$2,$3) AS r',[source,actor,duration])).rows[0].r.job_id;
 await db.query("UPDATE course_transcription_parts SET status='ready',attempts=1,audio_sha256=$2,transcript_text='Проверенная речь' WHERE job_id=$1 AND part_index<>$3",[job,'b'.repeat(64),index]);
 const rows=(await db.query('SELECT * FROM course_transcription_parts WHERE job_id=$1 ORDER BY part_index',[job])).rows;
 const p=rows[index],wav=pcmParts(Buffer.alloc((p.end_ms-p.start_ms)*32),p.end_ms-p.start_ms).parts[0].wav,hash=sha(wav);
 const m={schema_version:1,mode:'long_course_stt_dry_run',source:{video_id:video,source_revision:revision,duration_ms:duration},parts:rows.map(p=>({part_index:p.part_index,start_ms:p.start_ms,end_ms:p.end_ms,bytes:44+(p.end_ms-p.start_ms)*32,audio_sha256:p.part_index===index?hash:p.audio_sha256,digital_silence:p.part_index===index}))};
 return {job,m,args:[job,index,actor,revision,hash,JSON.stringify(m)]};
}
test('139 parts finalize only after verified silence, replay and cached claim never consume an attempt',async()=>{
 const f=await fixture();await assert.rejects(db.query('SELECT course_transcription_finalize($1,$2)',[f.job,revision]),/incomplete_transcript/);
 const before=(await db.query('SELECT * FROM course_transcription_parts WHERE part_index>0 ORDER BY part_index')).rows;
 assert.equal((await rpc(f.args)).reused,false);assert.equal((await rpc(f.args)).reused,true);
 const p=(await db.query('SELECT * FROM course_transcription_parts WHERE part_index=0')).rows[0];assert.equal(p.attempts,0);assert.equal(p.silence_evidence.zero_samples,1440000);
 assert.equal((await db.query('SELECT course_transcription_claim_part($1,0,$2,$3) AS r',[f.job,f.args[4],revision])).rows[0].r.action,'cached');
 assert.equal((await db.query('SELECT course_transcription_finalize($1,$2) AS r',[f.job,revision])).rows[0].r.reused,false);
 assert.equal((await db.query('SELECT course_transcription_finalize($1,$2) AS r',[f.job,revision])).rows[0].r.reused,true);
 assert.equal((await rpc(f.args)).reused,true);
 assert.deepEqual((await db.query('SELECT * FROM course_transcription_parts WHERE part_index>0 ORDER BY part_index')).rows,before);
 const t=(await db.query('SELECT * FROM course_transcripts')).rows[0];assert.equal(t.classification,'paid_private');assert.equal(t.quality_status,'unreviewed');assert.match(t.transcript_text,/Редакционная отметка/);assert.equal(t.content_sha256,sha(t.transcript_text));
});
test('server canonical WAV matches JS for partial final window',async()=>{const f=await fixture(158416,1);assert.equal((await rpc(f.args)).evidence.zero_samples,68416*16);});
for(const role of ['anon','authenticated'])test('browser denied: '+role,async()=>{const f=await fixture();await assert.rejects(rpc(f.args,role),/permission denied/);});
for(const status of ['cancelled','review_required'])test('held job rejected: '+status,async()=>{const f=await fixture();await db.query('UPDATE course_transcription_jobs SET status=$1',[status]);await assert.rejects(rpc(f.args),/job_held/);});
test('uncertain and already attempted pending parts cannot be reclassified',async()=>{
 const f=await fixture();await db.exec("UPDATE course_transcription_parts SET status='uncertain',attempts=1 WHERE part_index=0");await assert.rejects(rpc(f.args),/silence_part_held/);
 await db.exec("UPDATE course_transcription_parts SET status='pending' WHERE part_index=0");await assert.rejects(rpc(f.args),/silence_part_held/);
});
test('nonzero hash, altered other ready hash and missing silence flag are rejected',async()=>{
 const f=await fixture();const bad=structuredClone(f.args);bad[4]='c'.repeat(64);const m=structuredClone(f.m);m.parts[0].audio_sha256=bad[4];bad[5]=JSON.stringify(m);await assert.rejects(rpc(bad),/digital_zero_not_proven/);
 m.parts[0]=f.m.parts[0];m.parts[1].audio_sha256='c'.repeat(64);bad[4]=f.args[4];bad[5]=JSON.stringify(m);await assert.rejects(rpc(bad),/silence_manifest_changed/);
 m.parts[1]=f.m.parts[1];m.parts[0]={...m.parts[0],digital_silence:false};bad[5]=JSON.stringify(m);await assert.rejects(rpc(bad),/silence_manifest_invalid/);
});
test('replay rejects changed manifest and CHECK prevents attaching evidence to paid STT part',async()=>{
 const f=await fixture(),result=await rpc(f.args),changed=[...f.args];changed[5]+=' ';await assert.rejects(rpc(changed),/silence_conflict/);
 await assert.rejects(db.query('UPDATE course_transcription_parts SET silence_evidence=$1 WHERE part_index=1',[result.evidence]),/course_parts_silence_evidence_check/);
});

test('publication adapter saves, reads back and finalizes through actual RPCs, then replays',async()=>{
 const {publishSilence}=await import('./lib/silence-publication.mjs');
 const {verifyDigitalSilence}=await import('./lib/verified-silence.mjs');
 const f=await fixture(),p=f.m.parts[0],wav=pcmParts(Buffer.alloc(90000*32),90000).parts[0].wav;
 const proof=verifyDigitalSilence(p,{...p,wav});
 const manifest={schema_version:1,mode:'verified_silence_publication_dry_run',source_id:source,job_id:f.job,source_revision:revision,capture_manifest_sha256:sha(f.args[5]),proofs:[proof],stt_calls:0};
 const prepared={manifest,captureManifest:f.args[5],original:f.m};
 const io={
  async rpc(name,a){
   if(name==='course_transcription_mark_verified_silence')return rpc([a._job_id,a._part_index,a._actor,a._source_revision,a._audio_sha256,a._long_manifest]);
   assert.equal(name,'course_transcription_finalize');return (await db.query('SELECT course_transcription_finalize($1,$2) AS r',[a._job_id,a._source_revision])).rows[0].r;
  },
  async rows(table,_select,filters){
   assert.ok(['course_transcription_parts','course_transcripts'].includes(table));
   let rows=(await db.query('SELECT * FROM '+table+(table==='course_transcription_parts'?' ORDER BY part_index':''))).rows;
   if(filters.part_index)rows=rows.filter(p=>p.part_index===Number(filters.part_index.slice(3)));return rows;
  }
 };
 assert.equal((await publishSilence(io,actor,manifest,prepared)).parts,139);
 assert.equal((await publishSilence(io,actor,manifest,prepared)).stt_calls,0);
 await assert.rejects(publishSilence(io,actor,{...manifest,source_revision:'c'.repeat(64)},prepared),/silence_approval_changed/);
});
