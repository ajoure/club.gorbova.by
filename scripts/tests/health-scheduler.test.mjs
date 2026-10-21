import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql=readFileSync(new URL('../../supabase/migrations/20261021084811_health_bounded_scan_scheduler.sql',import.meta.url),'utf8');
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE SCHEMA cron;
   CREATE ROLE health_scheduler_operator;
   GRANT USAGE ON SCHEMA cron TO health_scheduler_operator;
   CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
   INSERT INTO cron.job VALUES(29,'system-health-full-check-daily','0 5 * * *','opaque-existing-29',true),(28,'nightly-system-health-hourly','0 * * * *','opaque-existing-28',true);
   GRANT SELECT(jobid,jobname,schedule,active) ON cron.job TO health_scheduler_operator;
   CREATE TABLE cron.alter_calls(jobid bigint);
   CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL) RETURNS void
   LANGUAGE plpgsql SECURITY DEFINER SET search_path=cron AS $$ BEGIN
     IF command IS NOT NULL THEN RAISE EXCEPTION 'opaque configuration must remain untouched'; END IF;
     UPDATE cron.job SET schedule=$2 WHERE jobid=$1;
     INSERT INTO cron.alter_calls VALUES($1);
   END $$;
   REVOKE ALL ON FUNCTION cron.alter_job(bigint,text,text) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION cron.alter_job(bigint,text,text) TO health_scheduler_operator;`);
 return db;
}
const state=async db=>(await db.query('SELECT * FROM cron.job ORDER BY jobid')).rows;
const apply=async db=>{await db.exec('SET ROLE health_scheduler_operator');try{await db.exec(sql);}finally{await db.exec('RESET ROLE');}};

test('changes only cadence of existing29 and preserves opaque request configurations, hourly28 and rowcount',async()=>{
 const db=await fixture();try{
  const before=await state(db);await apply(db);const after=await state(db);
  assert.equal(after.length,2);
  assert.deepEqual(after,before.map(j=>({...j,schedule:j.jobid===29?'* * * * *':j.schedule})));
  assert.equal((await db.query('SELECT count(*) n FROM cron.alter_calls')).rows[0].n,1);
 }finally{await db.close();}
});
test('applies and replays without permission to read opaque request configuration or any protected storage',async()=>{
 const db=await fixture();try{
  await db.exec('SET ROLE health_scheduler_operator');
  await assert.rejects(db.query('SELECT command FROM cron.job'),e=>e.code==='42501');
  await db.exec('RESET ROLE');
  await apply(db);const once=await state(db);await apply(db);assert.deepEqual(await state(db),once);
  assert.equal((await db.query('SELECT count(*) n FROM cron.alter_calls')).rows[0].n,1);
 }finally{await db.close();}
});
test('exact nonsecret identity/schedule/active guards reject drift before any cadence change',async()=>{
 for(const mutation of [
  "DELETE FROM cron.job WHERE jobid=29", "UPDATE cron.job SET jobid=30 WHERE jobid=29",
  "UPDATE cron.job SET active=false WHERE jobid=29", "UPDATE cron.job SET active=false WHERE jobid=28",
  "UPDATE cron.job SET active=NULL WHERE jobid=29", "UPDATE cron.job SET active=NULL WHERE jobid=28",
  "UPDATE cron.job SET schedule=NULL WHERE jobid=28",
  "UPDATE cron.job SET schedule='*/5 * * * *' WHERE jobid=29", "UPDATE cron.job SET schedule='5 * * * *' WHERE jobid=28",
  "INSERT INTO cron.job VALUES(30,'system-health-full-check-continuation','* * * * *','opaque-other',true)"
 ]){
  const db=await fixture();try{await db.exec(mutation);const before=await state(db);await assert.rejects(apply(db),/health_cron_/);assert.deepEqual(await state(db),before);}finally{await db.close();}
 }
});
test('failed readback rolls back the entire schedule transaction',async()=>{
 const db=await fixture();try{
  await db.exec(`CREATE OR REPLACE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL) RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path=cron AS $$ UPDATE cron.job SET schedule='unexpected' WHERE jobid=$1 $$;`);
  const before=await state(db);await assert.rejects(apply(db),/health_cron_schedule_readback_failed/);assert.deepEqual(await state(db),before);
 }finally{await db.close();}
});
test('migration has no request/configuration reads, protected-object reference, HTTP or new recurring task',()=>{
 assert.doesNotMatch(sql,/\b(?:vault|decrypted_secrets|command|headers)\b|net\.http|cron\.schedule\(/i);
 assert.match(sql,/cron\.alter_job\(daily_job\.jobid,schedule:=/);
});
