import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {sha} from './lib/course-stt.mjs';
let db;
const owner='00000000-0000-4000-8000-000000000001',staff='00000000-0000-4000-8000-000000000002';
const revision='a'.repeat(64),audio='b'.repeat(64),manifest='c'.repeat(64),raw='WEBVTT\n\n';
before(async()=>{
  db=new PGlite();await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}'),('${staff}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.has_role_v2(_user_id uuid,_role_code text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _user_id='${owner}'::uuid AND _role_code='super_admin' $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE public.training_lessons(id uuid PRIMARY KEY);CREATE TABLE public.lesson_blocks(id uuid PRIMARY KEY);CREATE TABLE public.products_v2(id uuid PRIMARY KEY);`);
  for(const name of ['20260911172902_90aeec8b-4b8d-4ff2-b180-19e2d6ad992a.sql','20260911184123_9c93b1c8-09c9-4f6a-9f80-d1490ed4f009.sql','20260911193829_course_caption_gap_audit.sql'])
    await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
});
after(async()=>await db?.close());
const one=async(sql,args=[]) =>(await db.query(sql,args)).rows[0];
async function rpc(name,args){await db.exec('SET ROLE service_role');try{return (await one(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS r`,args)).r;}finally{await db.exec('RESET ROLE');}}
const parts=[{part_index:0,gap_index:0,start_ms:200000,end_ms:290000,audio_sha256:audio},{part_index:1,gap_index:0,start_ms:290000,end_ms:331000,audio_sha256:audio}];
async function source(){const id=randomUUID();await db.query(`INSERT INTO course_transcription_sources(id,provider,video_id,source_revision,audio_track_id,duration_ms,audio_bytes,enabled,created_by)
 VALUES($1,'kinescope',$2,$3,'track',1000000,1000,true,$4)`,[id,randomUUID(),revision,owner]);return id;}
const create=(id,p=parts,actor=owner)=>rpc('course_gap_audit_create',[id,actor,revision,raw,sha(raw),manifest,JSON.stringify(p)]);
const claim=(id,i=0,h=audio)=>rpc('course_gap_claim',[id,i,h,manifest]);
const finish=(id,i,t,text='Результат распознавания',error=null)=>rpc('course_gap_finish',[id,i,t,text,error]);
test('gap audit preserves raw caption and exact sparse boundaries; creates no full jobs/transcripts',async()=>{
 const id=await source(),a=await create(id),again=await create(id);assert.equal(a.audit_id,again.audit_id);assert.equal(again.reused,true);
 assert.deepEqual(await one('SELECT raw_vtt,quality_status,classification FROM course_caption_gap_audits WHERE id=$1',[a.audit_id]),{raw_vtt:raw,quality_status:'unreviewed',classification:'paid_private'});
 assert.equal((await one('SELECT count(*)::int n FROM course_transcription_jobs')).n,0);assert.equal((await one('SELECT count(*)::int n FROM course_transcripts')).n,0);
 const altered=structuredClone(parts);altered[1].end_ms++;await assert.rejects(create(id,altered),/gap_manifest_conflict/);
});
test('invalid sparse windows, nulls, budget, actor and hash fail atomically',async()=>{
 const id=await source();await assert.rejects(create(id,parts,staff),/owner_required/);
 for(const change of [p=>p[0].start_ms=null,p=>p[0].end_ms=300001,p=>p[1].start_ms=280000,p=>p[1].part_index=0,p=>p[0].audio_sha256='invalid',p=>p[0].extra=1]){
   const p=structuredClone(parts);change(p);await assert.rejects(create(id,p));
 }
 await assert.rejects(create(id,Array.from({length:8},(_,i)=>({...parts[0],part_index:i,start_ms:i*90000,end_ms:(i+1)*90000}))),/gap_budget/);
 await assert.rejects(create(id,Array.from({length:7},(_,i)=>({...parts[0],part_index:i,start_ms:i*90000,end_ms:(i+1)*90000}))),/gap_budget/);
 await assert.rejects(rpc('course_gap_audit_create',[id,owner,revision,raw,'0'.repeat(64),manifest,JSON.stringify(parts)]),/caption_hash_mismatch/);
 assert.equal((await one('SELECT count(*)::int n FROM course_caption_gap_audits WHERE source_id=$1',[id])).n,0);
});
test('claim exactly once, complete evidence and exact finish replay; quality stays unreviewed',async()=>{
 const a=await create(await source());
 for(let i=0;i<2;i++){
   const c=await claim(a.audit_id,i);assert.equal(c.action,'transcribe');assert.equal((await claim(a.audit_id,i)).action,'hold');
   await assert.rejects(claim(a.audit_id,i,'d'.repeat(64)),/part_audio_changed/);
   await assert.rejects(finish(a.audit_id,i,randomUUID()),/claim_mismatch/);
   assert.equal((await finish(a.audit_id,i,c.claim_token)).status,'evidence');assert.equal((await finish(a.audit_id,i,c.claim_token)).reused,true);
   await assert.rejects(finish(a.audit_id,i,c.claim_token,'Изменение'),/evidence_conflict/);assert.equal((await claim(a.audit_id,i)).action,'cached');
 }
 assert.deepEqual(await one('SELECT status,quality_status FROM course_caption_gap_audits WHERE id=$1',[a.audit_id]),{status:'evidence',quality_status:'unreviewed'});
});
test('expired claims and late finish never resume or retry; empty ASR is uncertain, not silence',async()=>{
 for(const variant of ['claim_expired','finish_expired','empty','error']){
   const a=await create(await source()),c=await claim(a.audit_id);
   if(variant.includes('expired'))await db.query("UPDATE course_caption_gap_parts SET lease_until=now()-interval '1 minute' WHERE audit_id=$1 AND part_index=0",[a.audit_id]);
   if(variant==='claim_expired')assert.equal((await claim(a.audit_id)).status,'uncertain');
   const result=await finish(a.audit_id,0,c.claim_token,variant==='empty'?'':'Реплика',variant==='error'?'timeout':null);assert.equal(result.status,'uncertain');
   assert.equal((await claim(a.audit_id)).action,'hold');assert.equal((await claim(a.audit_id,1)).action,'hold');
   assert.equal((await one('SELECT attempts FROM course_caption_gap_parts WHERE audit_id=$1 AND part_index=0',[a.audit_id])).attempts,1);
   assert.equal((await one('SELECT status FROM course_caption_gap_audits WHERE id=$1',[a.audit_id])).status,'review_required');
 }
});
test('source drift disables new claims; evidence CHECK rejects nullable hashes',async()=>{
 const id=await source(),a=await create(id);await db.query('UPDATE course_transcription_sources SET enabled=false WHERE id=$1',[id]);
 await assert.rejects(claim(a.audit_id),/source_revision_changed/);
 await assert.rejects(db.query("UPDATE course_caption_gap_parts SET status='evidence' WHERE audit_id=$1",[a.audit_id]),/check constraint/);
});
test('RLS owner read only, staff zero rows, no browser/anonymous mutations or RPC; functions are invoker',async()=>{
 for(const table of ['course_caption_gap_audits','course_caption_gap_parts']){
   await db.exec(`SET ROLE authenticated;SET request.jwt.claim.sub='${owner}'`);assert.ok((await one(`SELECT count(*)::int n FROM ${table}`)).n>0);
   await assert.rejects(db.exec(`DELETE FROM ${table}`),/permission denied/);
   await db.exec(`SET request.jwt.claim.sub='${staff}'`);assert.equal((await one(`SELECT count(*)::int n FROM ${table}`)).n,0);
   await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(db.exec(`SELECT * FROM ${table}`),/permission denied/);await db.exec('RESET ROLE');
 }
 const routines=(await db.query("SELECT oid::regprocedure::text signature,prosecdef,has_function_privilege('authenticated',oid,'execute') browser,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service FROM pg_proc WHERE proname LIKE 'course_gap_%'")).rows;
 assert.equal(routines.length,3);for(const r of routines){assert.equal(r.prosecdef,false);assert.equal(r.browser,false);assert.equal(r.anon,false);assert.equal(r.service,true);}
});
