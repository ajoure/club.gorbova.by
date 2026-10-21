import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql=readFileSync(new URL('../../supabase/migrations/20261021084811_health_bounded_scan_scheduler.sql',import.meta.url),'utf8');
const fixtureSecret='local-fixture-existing-key-1234567890';
async function fixture(secondSecret=fixtureSecret){
 const db=new PGlite();
 await db.exec(`CREATE SCHEMA cron;CREATE SCHEMA vault;CREATE SCHEMA net;CREATE SCHEMA fixture;
   CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
   CREATE TABLE vault.secrets(id uuid DEFAULT gen_random_uuid(),name text,secret text);
   CREATE VIEW vault.decrypted_secrets AS SELECT id,name,secret decrypted_secret FROM vault.secrets;
   CREATE FUNCTION vault.create_secret(s text,n text,d text) RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets(name,secret) VALUES(n,s) RETURNING id $$;
   CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ UPDATE cron.job SET command=coalesce($3,cron.job.command),schedule=coalesce($2,cron.job.schedule) WHERE jobid=$1 $$;
   CREATE FUNCTION cron.schedule(n text,s text,c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES(n,s,c) ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command RETURNING jobid $$;
   CREATE TABLE public.system_health_reports(source text,report_json jsonb,created_at timestamptz DEFAULT now());
   CREATE TABLE fixture.requests(id bigint GENERATED ALWAYS AS IDENTITY,url text,headers jsonb,body jsonb);
   CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO fixture.requests(url,headers,body) VALUES(url,headers,body) RETURNING id $$;`);
 for(const [name,schedule,endpoint,secret,body] of [
  ['system-health-full-check-daily','0 5 * * *','system-health-full-check',fixtureSecret,"jsonb_build_object('source','cron')"],
  ['nightly-system-health-hourly','0 * * * *','nightly-system-health',secondSecret,"jsonb_build_object('source','cron-hourly','target_tz','Europe/London','target_hour',3)"]
 ]){
  const q="'"+secret.replaceAll("'","''")+"'";
  await db.query('INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3)',[name,schedule,`SELECT net.http_post(url := 'https://fixture.test/functions/v1/${endpoint}',headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',${q}),body := ${body});`]);
 }
 return db;
}
const state=async db=>({jobs:(await db.query('SELECT jobname,schedule,command,active FROM cron.job ORDER BY jobname')).rows,secrets:(await db.query('SELECT name,secret FROM vault.secrets')).rows,requests:(await db.query('SELECT * FROM fixture.requests')).rows});

test('atomically moves the same credential to Vault, preserves two jobs, and creates one idempotent conditional continuation',async()=>{
 const db=await fixture();try{
  const before=await state(db);await db.exec(sql);const once=await state(db);await db.exec(sql);const replay=await state(db);
  assert.deepEqual(replay,once);assert.equal(once.jobs.length,3);assert.equal(once.secrets.length,1);assert.equal(once.secrets[0].secret,fixtureSecret);
  assert.equal(once.requests.length,0);
  for(const old of before.jobs){const next=once.jobs.find(j=>j.jobname===old.jobname);assert.equal(next.schedule,old.schedule);assert.equal(next.active,old.active);assert(!next.command.includes(fixtureSecret));assert(next.command.includes('vault.decrypted_secrets'));}
  // Normal scheduled requests still authenticate with the same credential.
  for(const old of before.jobs)await db.exec(once.jobs.find(j=>j.jobname===old.jobname).command);
  for(const req of (await state(db)).requests)assert.equal(req.headers['x-cron-secret'],fixtureSecret);
 }finally{await db.close();}
});
test('continuation sends zero idle/stale/completed/manual requests and one bounded cron continuation for a fresh pending scan',async()=>{
 const db=await fixture();try{
  await db.exec(sql);const command=(await state(db)).jobs.find(j=>j.jobname==='system-health-full-check-continuation').command;
  await db.exec(command);assert.equal((await state(db)).requests.length,0);
  const put=async(source,age,complete,resume=null)=>{await db.exec('TRUNCATE system_health_reports');await db.query('INSERT INTO system_health_reports(source,report_json) VALUES($1,$2)',[source,{availability_scan:{release:'health-bounded-preflight-2026-10-21-v1',started_at:new Date(Date.now()-age).toISOString(),complete,resume_after:resume}}]);};
  for(const [source,age,complete,resume] of [['manual',100,false],['cron',20*60000,false],['cron',100,true],['cron',100,false,new Date(Date.now()+60000).toISOString()]]){
   await put(source,age,complete,resume);await db.exec(command);assert.equal((await state(db)).requests.length,0);
  }
  await put('cron',100,false);await db.exec(command);const requests=(await state(db)).requests;assert.equal(requests.length,1);assert.deepEqual(requests[0].body,{source:'cron',mode:'continue'});
 }finally{await db.close();}
});
test('mismatched secret, missing or altered job fail before Vault/job/request mutations',async()=>{
 for(const variant of ['different','missing','changed']){
  const db=await fixture(variant==='different'?'another-local-fixture-key-1234567890':fixtureSecret);try{
   if(variant==='missing')await db.exec("DELETE FROM cron.job WHERE jobname='system-health-full-check-daily'");
   if(variant==='changed')await db.exec("UPDATE cron.job SET schedule='* * * * *' WHERE jobname='system-health-full-check-daily'");
   const before=await state(db);await assert.rejects(db.exec(sql),/health_cron_/);assert.deepEqual(await state(db),before);
  }finally{await db.close();}
 }
});
