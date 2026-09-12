import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
let db;
const owner=randomUUID(), stranger=randomUUID(), bot=randomUUID(), connection=randomUUID(), product=randomUUID();
const one=async(s,a=[]) => (await db.query(s,a)).rows[0];
const rpc=async(name,args=[]) => (await one(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).r;
before(async()=>{
 db=new PGlite();await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${owner}'),('${stranger}');
 CREATE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${owner}'::uuid $$;
 CREATE FUNCTION public.has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${owner}'::uuid $$;
 CREATE TABLE telegram_bots(id uuid PRIMARY KEY,bot_id bigint); INSERT INTO telegram_bots VALUES('${bot}',12345);
 CREATE TABLE telegram_business_connections(id uuid PRIMARY KEY,bot_id uuid,can_reply boolean,is_enabled boolean,connection_id text DEFAULT 'business-id');
 INSERT INTO telegram_business_connections (id,bot_id,can_reply,is_enabled) VALUES('${connection}','${bot}',true,true);
 CREATE TABLE products_v2(id uuid PRIMARY KEY); INSERT INTO products_v2 VALUES('${product}');
 CREATE TABLE telegram_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transport text,user_id uuid,bot_id uuid,business_account_id uuid,direction text,message_text text,message_origin text,meta jsonb DEFAULT '{}',message_id bigint,telegram_user_id bigint DEFAULT 100,status text,is_read boolean,business_connection_id text DEFAULT 'business-id',created_at timestamptz DEFAULT clock_timestamp(),UNIQUE(bot_id,business_connection_id,telegram_user_id,message_id));
 CREATE TABLE notification_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,message_type text,idempotency_key text UNIQUE,source text,status text,meta jsonb,sent_at timestamptz,blocked_reason text);
 CREATE TABLE contact_center_message_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text,source_message_id uuid,assignee_user_id uuid,assigned_by_user_id uuid,note text,resolved_at timestamptz);
 CREATE UNIQUE INDEX ON contact_center_message_assignments(source_message_id) WHERE resolved_at IS NULL;
 CREATE TABLE ai_handoffs(id uuid DEFAULT gen_random_uuid(),bot_id uuid,telegram_user_id bigint,user_id uuid,assigned_to uuid,last_message_id bigint,status text,reason text,meta jsonb);
 `);
 await db.exec(await readFile(new URL('../../supabase/migrations/20260912063632_cb21_telegram_sales_runtime.sql',import.meta.url),'utf8'));
});
after(async()=>{await db.close()});
async function fixture(){
 await db.exec('DELETE FROM sales_events; DELETE FROM sales_jobs; DELETE FROM sales_conversations; DELETE FROM sales_campaigns; DELETE FROM contact_center_message_assignments; DELETE FROM ai_handoffs; DELETE FROM notification_outbox; DELETE FROM telegram_messages;');
 const p=(await one(`INSERT INTO sales_campaigns(code,bot_id,business_account_id,test_user_id,assignee_user_id,product_id,trigger_phrase,policy_version,knowledge_version,knowledge) VALUES('pilot',$1,$2,$3,$3,$4,'Хочу программу курса ЦБ','v1','k1','{"release_mode":"owner_test","facts":[{"id":"topic"}]}') RETURNING id`,[bot,connection,owner,product])).id;
 await rpc('sales_control',[p,'enable',owner]);return p;
}
async function msg(seq,text='Хочу программу курса ЦБ',extras={}){
 const e={transport:'business',user_id:owner,bot_id:bot,business_account_id:connection,direction:'incoming',message_origin:'client',message_id:seq,message_text:text,meta:{source:'telegram_business',raw:{date:Math.floor(Date.now()/1000)}},...extras};
 return (await one(`INSERT INTO telegram_messages(${Object.keys(e).join(',')}) VALUES(${Object.keys(e).map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,Object.values(e))).id;
}
const conversation=()=>one('SELECT * FROM sales_conversations');
async function due(){await db.exec("UPDATE sales_jobs SET due_at=now()-interval '1 second' WHERE status='queued'");return rpc('sales_claim_job');}

test('new phrase only; unrelated user, historical event, edited message and partial phrase do not activate',async()=>{
 const p=await fixture(); await msg(1,undefined,{user_id:stranger}); assert.equal((await conversation()).started,false);
 await msg(2,undefined,{created_at:'2020-01-01'});assert.equal((await conversation()).started,false);
 await msg(3,'Пожалуйста Хочу программу курса ЦБ');assert.equal((await conversation()).started,false);
 await msg(4,undefined,{meta:{edited:true}});assert.equal((await conversation()).started,false);
 await msg(5);assert.equal((await conversation()).started,true);
 assert.equal((await one('SELECT count(*)::int n FROM sales_jobs')).n,1);
});
test('delay survives restart; burst coalesces and resamples; stale claim cannot send',async()=>{
 await fixture();await msg(10);
 const j=await one('SELECT *,extract(epoch from due_at-created_at) delay FROM sales_jobs');assert.ok(j.delay>=59&&j.delay<=181);
 assert.equal(await rpc('sales_claim_job'),null);
 const claimed=await due();await msg(11,'И какие темы?');
 assert.equal(await rpc('sales_begin_send',[claimed.id,claimed.claim_token,{}]),false);
 assert.equal((await one("SELECT count(*)::int n FROM sales_jobs WHERE status='queued'")).n,1);
 assert.equal((await due()).inbound_seq,11);
});
test('one claim, one send; WAIT_CUSTOMER never schedules a follow-up; own echo does not pause',async()=>{
 await fixture();await msg(20);const j=await due();assert.equal(await rpc('sales_claim_job'),null);
 assert.equal(await rpc('sales_begin_send',[j.id,j.claim_token,{stage:'goals'}]),true);
 assert.equal(await rpc('sales_begin_send',[j.id,j.claim_token,{}]),false);
 await msg(21,'Ответ',{direction:'outgoing',message_origin:'bot_automation',meta:{sender_business_bot_id:12345}});
 assert.equal((await conversation()).human_hold,false);
 await rpc('sales_finish_send',[j.id,j.claim_token,21]);assert.equal((await conversation()).state,'WAIT_CUSTOMER');
 assert.equal(await rpc('sales_queue_reply',[(await conversation()).id]),null);
});
test('pause cancels delay; resume preserves stage and fresh unanswered inbound, no restart',async()=>{
 const p=await fixture();await msg(30);const c=await conversation();
 await db.exec("UPDATE sales_conversations SET stage='offer'");await rpc('sales_control',[p,'pause',owner]);await msg(31,'Есть вопрос');
 assert.equal(await due(),null);await rpc('sales_control',[p,'resume',owner]);assert.equal((await conversation()).stage,'offer');
 assert.equal((await due()).inbound_seq,31);assert.equal((await conversation()).started,true);
});
test('human reply during delay pauses; resume waits for customer after that reply',async()=>{
 const p=await fixture();await msg(40);await msg(41,'Ответ человека',{direction:'outgoing',message_origin:'owner_manual'});
 assert.equal((await conversation()).state,'HUMAN_HOLD');await rpc('sales_control',[p,'resume',owner]);
 assert.equal((await conversation()).state,'WAIT_CUSTOMER');assert.equal(await due(),null);
 await msg(42,'Спасибо, еще вопрос');assert.ok(await due());
});
test('unknown delivery never retries or resumes; late success cannot clear human hold',async()=>{
 const p=await fixture();await msg(50);const j=await due();await rpc('sales_begin_send',[j.id,j.claim_token,{}]);
 await rpc('sales_finish_send',[j.id,j.claim_token,null,'timeout']);assert.equal((await conversation()).state,'DELIVERY_UNKNOWN');
 await assert.rejects(rpc('sales_control',[p,'resume',owner]),/resume_blocked/);await msg(51,'Что с ответом?');assert.equal(await due(),null);
 await rpc('sales_finish_send',[j.id,j.claim_token,52]);assert.equal((await conversation()).human_hold,true);
});
test('handoff creates one exact assignment to Sergei, stays silent and cannot replay',async()=>{
 await fixture();const id=await msg(60);const j=await due();const a=await rpc('sales_handoff',[j.id,j.claim_token,'needs_human']);assert.ok(a);
 assert.equal(await rpc('sales_handoff',[j.id,j.claim_token,'needs_human']),null);
 const row=await one('SELECT * FROM contact_center_message_assignments');assert.equal(row.source_message_id,id);assert.equal(row.assignee_user_id,owner);
 assert.equal((await conversation()).state,'HUMAN_HOLD');assert.equal((await one('SELECT count(*)::int n FROM notification_outbox')).n,0);
});
test('policy change and edited history invalidate prepared answer',async()=>{
 await fixture();const id=await msg(70);const j=await due();await db.query('UPDATE telegram_messages SET message_text=$1 WHERE id=$2',['Измененный вопрос',id]);
 assert.equal(await rpc('sales_begin_send',[j.id,j.claim_token,{}]),false);assert.equal(await due(),null);
 await msg(71,'И еще');const k=await due();await db.exec("UPDATE sales_campaigns SET policy_version='v2'");
 assert.equal(await rpc('sales_begin_send',[k.id,k.claim_token,{}]),false);
});
test('RLS/grants deny raw tables and RPCs to browser/anonymous; operator identity cannot be arbitrary',async()=>{
 const p=await fixture();await assert.rejects(rpc('sales_control',[p,'enable',stranger]),/communication_manage_required/);
 for(const role of ['anon','authenticated']){
  await db.exec(`SET ROLE ${role}`);
  await assert.rejects(db.exec('SELECT * FROM sales_campaigns'),/permission denied/);
  await assert.rejects(db.exec('SELECT sales_claim_job()'),/permission denied/);
  await db.exec('RESET ROLE');
 }
});

test('new inbound during committed dispatch waits for acknowledgement, then queues exactly once',async()=>{
 await fixture();await msg(80);const j=await due();await rpc('sales_begin_send',[j.id,j.claim_token,{text:'Ответ',stage:'goals'}]);
 await msg(81,'А еще вопрос');assert.equal(await due(),null);
 await rpc('sales_finish_send',[j.id,j.claim_token,82]);const newer=await one("SELECT * FROM sales_jobs WHERE status='queued'");assert.equal(newer.inbound_seq,81);
 assert.equal((await conversation()).answered_seq,80);
});
test('expired generation becomes an exact-message handoff without a second model claim',async()=>{
 await fixture();const id=await msg(90);const j=await due();await db.query("UPDATE sales_jobs SET claimed_at=now()-interval '4 minutes' WHERE id=$1",[j.id]);
 assert.equal(await rpc('sales_claim_job'),null);assert.equal((await conversation()).state,'HUMAN_HOLD');
 assert.equal((await one('SELECT source_message_id FROM contact_center_message_assignments')).source_message_id,id);
});
test('changing random range enforces bounds and retains current scheduled due time',async()=>{
 const p=await fixture();await msg(100);const j=await one('SELECT due_at FROM sales_jobs');
 await assert.rejects(rpc('sales_control',[p,'delay',owner,0,180]),/check constraint/);
 await rpc('sales_control',[p,'delay',owner,120,240]);assert.deepEqual((await one('SELECT due_at FROM sales_jobs')).due_at,j.due_at);
 await msg(101,'Еще');const next=await one("SELECT extract(epoch from due_at-created_at) delay FROM sales_jobs WHERE status='queued'");assert.ok(next.delay>=119&&next.delay<=241);
});
test('silent handoff targets the approved owner even if this question already had an assignee',async()=>{
 await fixture();const id=await msg(110);await db.query("INSERT INTO contact_center_message_assignments(source,source_message_id,assignee_user_id,assigned_by_user_id) VALUES('telegram',$1,$2,$2)",[id,stranger]);
 const j=await due();await rpc('sales_handoff',[j.id,j.claim_token,'needs_human']);
 const row=await one('SELECT assignee_user_id FROM contact_center_message_assignments WHERE source_message_id=$1',[id]);assert.equal(row.assignee_user_id,owner);
});
