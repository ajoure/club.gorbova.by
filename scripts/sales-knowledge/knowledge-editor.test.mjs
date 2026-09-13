import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
let db;
const id=Object.fromEntries(['owner','other','campaign','conversation','product','oldProduct','root','module','oldModule','lesson','oldLesson','block','oldBlock','source'].map(k=>[k,randomUUID()]));
const revision='a'.repeat(64),sourceHash='b'.repeat(64);
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const call=async(name,args)=> (await one(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).r;
const fact=()=>({id:'cb-topic',title:'Деньги организации',text:'В уроке рассматриваются наличные и безналичные расчёты, в том числе работа в 1С.',source_id:id.source,source_revision:revision,source_sha256:sourceHash,module_id:id.module,binding_block_id:id.block});
before(async()=>{
 db=new PGlite();await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${id.owner}'),('${id.other}');
 CREATE FUNCTION has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${id.owner}'::uuid$$;
 CREATE FUNCTION has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${id.owner}'::uuid$$;
 CREATE TABLE sales_campaigns(id uuid PRIMARY KEY,product_id uuid,mode text,knowledge_version text,knowledge jsonb);
 CREATE TABLE sales_conversations(id uuid PRIMARY KEY,campaign_id uuid,state text,human_hold boolean,revision integer,updated_at timestamptz);
 CREATE TABLE sales_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid,status text,reason text);
 CREATE TABLE sales_events(id uuid DEFAULT gen_random_uuid(),conversation_id uuid,event text,actor_id uuid,details jsonb);
 CREATE TABLE course_transcription_sources(id uuid PRIMARY KEY,provider text,video_id uuid,source_revision text,enabled boolean);
 CREATE TABLE course_transcripts(source_id uuid PRIMARY KEY,source_revision text,content_sha256 text,quality_status text,transcript_text text);
 CREATE TABLE course_caption_gap_audits(source_id uuid,source_revision text,status text);
 CREATE TABLE training_modules(id uuid PRIMARY KEY,product_id uuid,parent_module_id uuid,is_active boolean);
 CREATE TABLE training_lessons(id uuid PRIMARY KEY,module_id uuid);
 CREATE TABLE lesson_blocks(id uuid PRIMARY KEY,lesson_id uuid,updated_at timestamptz,content jsonb,block_type text);
 CREATE TABLE course_transcription_bindings(source_id uuid,block_id uuid,lesson_id uuid,product_id uuid,block_updated_at timestamptz);
 `);
 await db.exec(await readFile(new URL('../../supabase/migrations/20260912164349_b779cb99-19cf-4ef6-be5a-2753988c1791.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20260912175835_f1784ad8-aa21-4407-ac1c-72260894cf6f.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
test('migration preserves exact legacy normalized facts and fingerprint when short reply is absent',async()=>{
 await fixture();
 const original=await readFile(new URL('../../supabase/migrations/20260912164349_b779cb99-19cf-4ef6-be5a-2753988c1791.sql',import.meta.url),'utf8');
 const previous=original.slice(original.indexOf('CREATE FUNCTION public.sales_check_knowledge_facts'),original.indexOf('CREATE FUNCTION public.sales_replace_knowledge_facts')).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 await db.exec(previous);const before=await call('sales_check_knowledge_facts',[id.campaign,[fact()]]);
 await db.exec(await readFile(new URL('../../supabase/migrations/20260912175835_f1784ad8-aa21-4407-ac1c-72260894cf6f.sql',import.meta.url),'utf8'));
 const after=await call('sales_check_knowledge_facts',[id.campaign,[fact()]]);assert.deepEqual(after,before);
});
test('short reply is versioned independently without replacing knowledge; changed reply invalidates approval',async()=>{
 await fixture();const f={...fact(),reply_text:'Разберём движение денег и его связь с документами.'};
 const p=await replace([f]);assert.equal(p.valid,true);
 await assert.rejects(replace([{...f,reply_text:'Другая краткая реплика.'}],{apply:true,approved:p.facts_sha256}),/exact_editorial_approval_required/);
 await replace([f],{apply:true,approved:p.facts_sha256});const stored=(await snapshot()).facts[0];
 assert.equal(stored.text,f.text);assert.equal(stored.reply_text,f.reply_text);assert.match(stored.reply_text_sha256,/^[a-f0-9]{64}$/);
 assert.equal((await replace([stored],{apply:true,approved:p.facts_sha256})).noop,true);
});
test('short replies reject extra questions, links, controls, contacts, overflow and background use',async()=>{
 await fixture();for(const reply_text of [null,0,'','x'.repeat(201),'Вопрос?','Вопрос？','Вопрос؟','Две\nстроки','Пишите test@example.com','Ссылка https://example.com','Телефон +375 29 1234567','<b>Текст</b>']){
  const r=await replace([{...fact(),reply_text}]);assert.equal(r.valid,false,String(reply_text));assert.equal(r.errors[0].reason,'invalid_short_reply');
 }
 assert.equal((await replace([{...fact(),scope:'background',reply_text:'Короткая реплика.'}])).valid,false);
 assert.equal((await replace([{...fact(),reply_text:'Работа в 1С и темы ЦБ 2.0.'}])).valid,true);
});
async function fixture(){
 await db.exec('TRUNCATE sales_knowledge_versions,sales_events,sales_jobs,sales_conversations,sales_campaigns,course_transcription_bindings,lesson_blocks,training_lessons,training_modules,course_transcripts,course_transcription_sources,course_caption_gap_audits CASCADE');
 await db.query(`INSERT INTO sales_campaigns VALUES($1,$2,'off','legacy-v1',$3)`,[id.campaign,id.product,{root_module_id:id.root,release_mode:'owner_test',client_release_approved:false,facts:[]}]);
 await db.query(`INSERT INTO sales_conversations VALUES($1,$2,'HUMAN_HOLD',true,9,now())`,[id.conversation,id.campaign]);
 await db.query(`INSERT INTO course_transcription_sources VALUES($1,'kinescope',$2,$3,true)`,[id.source,randomUUID(),revision]);
 await db.query(`INSERT INTO course_transcripts VALUES($1,$2,$3,'unreviewed','PRIVATE PAID SOLUTIONS MUST NEVER BE READ')`,[id.source,revision,sourceHash]);
 await db.query(`INSERT INTO training_modules VALUES($1,$2,$3,false),($4,$5,NULL,true)`,[id.module,id.product,id.root,id.oldModule,id.oldProduct]);
 await db.query('INSERT INTO training_lessons VALUES($1,$2),($3,$4)',[id.lesson,id.module,id.oldLesson,id.oldModule]);
 for(const [block,lesson] of [[id.block,id.lesson],[id.oldBlock,id.oldLesson]]) await db.query(`INSERT INTO lesson_blocks VALUES($1,$2,'2026-09-12','{"url":"https://kinescope.io/synthetic-identical-video","provider":"kinescope"}','video')`,[block,lesson]);
 await db.query(`INSERT INTO course_transcription_bindings VALUES($1,$2,$3,$4,'2026-09-12')`,[id.source,id.oldBlock,id.oldLesson,id.oldProduct]);
}
const snapshot=()=>call('sales_knowledge_snapshot',[id.campaign,id.owner]);
async function replace(facts,{apply=false,approved=null,actor=id.owner,snap}={}){
 const s=snap??await snapshot();return call('sales_replace_knowledge_facts',[id.campaign,actor,facts,s.knowledge_version,s.facts_sha256,apply,approved]);
}
test('preview verifies same video across flows despite closed future module, and writes nothing',async()=>{
 await fixture();const before=await snapshot();const p=await replace([fact()]);assert.equal(p.valid,true);assert.equal(p.applied,false);assert.equal(p.added,1);
 assert.deepEqual(await snapshot(),before);assert.equal((await one('SELECT count(*)::int n FROM sales_events')).n,0);
 assert.ok(!JSON.stringify(p).includes('PRIVATE PAID'));assert.ok(!JSON.stringify(p).includes(fact().text));
});
test('exact approval publishes version, cancels jobs, holds conversation and preserves transcript review status',async()=>{
 await fixture();await db.query(`INSERT INTO sales_jobs(conversation_id,status) VALUES($1,'queued'),($1,'claimed')`,[id.conversation]);
 const p=await replace([fact()]);const done=await replace([fact()],{apply:true,approved:p.facts_sha256});assert.equal(done.applied,true);
 const s=await snapshot();assert.equal(s.facts.length,1);assert.equal(s.versions.length,2);assert.notEqual(s.knowledge_version,'legacy-v1');
 assert.equal((await one('SELECT quality_status FROM course_transcripts')).quality_status,'unreviewed');
 assert.deepEqual(await one('SELECT state,human_hold,revision FROM sales_conversations'),{state:'HUMAN_HOLD',human_hold:true,revision:10});
 assert.equal((await one("SELECT count(*)::int n FROM sales_jobs WHERE status='cancelled'")).n,2);
 const event=await one('SELECT details FROM sales_events');assert.ok(!JSON.stringify(event).includes(fact().text));
 const again=await replace(s.facts,{apply:true,approved:p.facts_sha256});assert.equal(again.noop,true);assert.equal(again.applied,false);
 assert.equal((await snapshot()).versions.length,2);
});
test('changed summary or stale session cannot reuse an earlier confirmation',async()=>{
 await fixture();const snap=await snapshot(),p=await replace([fact()]);
 await assert.rejects(replace([{...fact(),text:'Изменённое описание.'}],{apply:true,approved:p.facts_sha256}),/exact_editorial_approval_required/);
 await replace([fact()],{apply:true,approved:p.facts_sha256});
 await assert.rejects(replace([fact()],{snap}),/knowledge_changed/);
});
test('source/binding/video/quality changes fail closed without writes',async()=>{
 const changes=[
  "UPDATE course_transcription_sources SET enabled=false",
  "UPDATE course_transcripts SET quality_status='rejected'",
  "UPDATE course_transcripts SET content_sha256=repeat('c',64)",
  `UPDATE lesson_blocks SET updated_at='2026-09-13' WHERE id='${id.oldBlock}'`,
  `UPDATE lesson_blocks SET content='{"url":"https://kinescope.io/different"}' WHERE id='${id.block}'`,
  `UPDATE lesson_blocks SET lesson_id='${id.lesson}' WHERE id='${id.oldBlock}'`,
  `INSERT INTO course_caption_gap_audits VALUES('${id.source}','${revision}','review_required')`,
 ];
 for(const sql of changes){await fixture();await db.exec(sql);const p=await replace([fact()]);assert.equal(p.valid,false,sql);assert.equal((await snapshot()).versions.length,0);}
});
test('background summary retains source verification but cannot acquire a curriculum module',async()=>{
 await fixture();const p=await replace([{...fact(),scope:'background'}]);assert.equal(p.valid,true);
 await replace([{...fact(),scope:'background'}],{apply:true,approved:p.facts_sha256});const f=(await snapshot()).facts[0];assert.equal(f.scope,'background');assert.equal(f.module_id,undefined);assert.equal(f.binding_block_id,undefined);
});
test('invalid references, duplicate IDs, contact-like text and URLs are rejected; ordinary numbers work',async()=>{
 await fixture();for(const facts of [[fact(),fact()],[{...fact(),module_id:randomUUID()}],[{...fact(),source_id:'bad'}],[{...fact(),text:'Перейдите https://example.com'}],[{...fact(),text:'Пишите test@example.com'}],[{...fact(),text:'x'.repeat(601)}]]) assert.equal((await replace(facts)).valid,false);
 assert.equal((await replace([{...fact(),text:'ЦБ 2.0: темы курса, работа в 1С и этапы 21 потока.'}])).valid,true);
});
test('only owner through service entry can access versions or mutate facts; active and unknown dispatch block writes',async()=>{
 await fixture();await assert.rejects(replace([fact()],{actor:id.other}),/owner_required/);
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(db.exec('SELECT * FROM sales_knowledge_versions'),/permission denied/);await assert.rejects(call('sales_check_knowledge_facts',[id.campaign,[]]),/permission denied/);await db.exec('RESET ROLE');}
 await db.exec("UPDATE sales_campaigns SET mode='owner_test'");await assert.rejects(replace([fact()]),/disable_and_pause_required/);
 await db.exec("UPDATE sales_campaigns SET mode='off'");await db.query("INSERT INTO sales_jobs(conversation_id,status) VALUES($1,'unknown')",[id.conversation]);await assert.rejects(replace([fact()]),/delivery_unresolved/);
});
test('rollback creates a new verified version and keeps both previous snapshots',async()=>{
 await fixture();const first=await replace([fact()]);await replace([fact()],{apply:true,approved:first.facts_sha256});const old=await snapshot();
 const newer=[{...fact(),text:'Другое проверенное описание тем.'}],second=await replace(newer);await replace(newer,{apply:true,approved:second.facts_sha256});
 const rollback=await replace(old.facts);await replace(old.facts,{apply:true,approved:rollback.facts_sha256});
 const current=await snapshot();assert.deepEqual(current.facts,old.facts);assert.notEqual(current.knowledge_version,old.knowledge_version);assert.equal(current.versions.length,4);
});
