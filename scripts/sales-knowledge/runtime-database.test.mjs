import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
let db;
const fixtureSql=[];
let captureFixture=process.env.CB21_EXPORT_RUNTIME_FIXTURE==='1';
const sqlLiteral=v=>v===null?'NULL':typeof v==='number'?String(v):typeof v==='boolean'?String(v):"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
const defaultTestNow='2026-09-12T12:00:00Z';
let testNow=defaultTestNow;
const owner=randomUUID(), stranger=randomUUID(), bot=randomUUID(), connection=randomUUID(), product=randomUUID();
const one=async(s,a=[]) => (await db.query(s,a)).rows[0];
const rpc=async(name,args=[]) => (await one(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).r;
before(async()=>{
 db=new PGlite();
 if(captureFixture){
  const exec=db.exec.bind(db),query=db.query.bind(db);
  db.exec=async(sql,...args)=>{if(captureFixture)fixtureSql.push(sql);return exec(sql,...args)};
  db.query=async(sql,args=[])=>{if(captureFixture)fixtureSql.push(sql.replace(/\$(\d+)\b/g,(_,n)=>sqlLiteral(args[Number(n)-1]))+';');return query(sql,args)};
 }
 await db.exec(`
 -- These clocks exist only in the disposable offline database. Production
 -- migrations and the real Minsk delivery window remain unchanged.
 SELECT set_config('test.sales_now','${defaultTestNow}',false);
 CREATE OR REPLACE FUNCTION pg_catalog.clock_timestamp() RETURNS timestamptz
 LANGUAGE sql VOLATILE AS $$ SELECT current_setting('test.sales_now')::timestamptz $$;
 CREATE OR REPLACE FUNCTION pg_catalog.now() RETURNS timestamptz
 LANGUAGE sql STABLE AS $$ SELECT current_setting('test.sales_now')::timestamptz $$;
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${owner}'),('${stranger}');
 CREATE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${owner}'::uuid $$;
 CREATE FUNCTION public.has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${owner}'::uuid $$;
 CREATE TABLE telegram_bots(id uuid PRIMARY KEY,bot_id bigint); INSERT INTO telegram_bots VALUES('${bot}',12345);
 CREATE TABLE telegram_business_connections(id uuid PRIMARY KEY,bot_id uuid,can_reply boolean,is_enabled boolean,connection_id text DEFAULT 'business-id');
 INSERT INTO telegram_business_connections (id,bot_id,can_reply,is_enabled) VALUES('${connection}','${bot}',true,true);
 CREATE TABLE products_v2(id uuid PRIMARY KEY,is_active boolean DEFAULT true,status text DEFAULT 'active'); INSERT INTO products_v2 VALUES('${product}');
 CREATE TABLE telegram_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transport text,user_id uuid,bot_id uuid,business_account_id uuid,direction text,message_text text,message_origin text,meta jsonb DEFAULT '{}',message_id bigint,telegram_user_id bigint DEFAULT 100,status text,is_read boolean,business_connection_id text DEFAULT 'business-id',created_at timestamptz DEFAULT clock_timestamp(),UNIQUE(bot_id,business_connection_id,telegram_user_id,message_id));
 CREATE TABLE notification_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,message_type text,idempotency_key text UNIQUE,source text,status text,meta jsonb,sent_at timestamptz,blocked_reason text);
 CREATE TABLE contact_center_message_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text,source_message_id uuid,assignee_user_id uuid,assigned_by_user_id uuid,note text,resolved_at timestamptz);
 CREATE UNIQUE INDEX ON contact_center_message_assignments(source_message_id) WHERE resolved_at IS NULL;
 CREATE TABLE ai_handoffs(id uuid DEFAULT gen_random_uuid(),bot_id uuid,telegram_user_id bigint,user_id uuid,assigned_to uuid,last_message_id bigint,status text,reason text,meta jsonb);
 `);
 await db.exec(`CREATE TABLE live_events(id uuid PRIMARY KEY,room_state text,platform_status text,status text,webinar_completed_at timestamptz,event_type text,autoweb_config jsonb); CREATE TABLE live_event_sessions(id uuid DEFAULT gen_random_uuid(),live_event_id uuid,starts_at timestamptz,ends_at timestamptz,status text);`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20260912063632_cb21_telegram_sales_runtime.sql',import.meta.url),'utf8'));
 await db.exec(`CREATE TABLE profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid); INSERT INTO profiles(user_id) VALUES('${owner}');
 CREATE TABLE tariff_offers(id uuid PRIMARY KEY,meta jsonb DEFAULT '{}');
 CREATE TABLE orders_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,profile_id uuid,product_id uuid,status text,is_deleted boolean DEFAULT false,is_trial boolean DEFAULT false,final_price numeric,deal_date timestamptz,meta jsonb DEFAULT '{}',offer_id uuid,tariff_id text,created_at timestamptz DEFAULT now(),currency text DEFAULT 'BYN');
 CREATE TABLE payments_v2(id uuid DEFAULT gen_random_uuid(),order_id uuid,status text,amount numeric,is_deleted boolean DEFAULT false,refunded_amount numeric,transaction_type text,currency text DEFAULT 'BYN');`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20260912082931_cb21_dialogue_delivery_windows.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20260912083730_cb21_checkout_capabilities.sql',import.meta.url),'utf8'));
 for(const name of ['20260912103149_6c915c55-929b-42ba-9cc0-a8d2b4950c1b.sql','20260912103321_bdea673d-1fb3-4974-958c-72349e73c6e0.sql','20260912105739_sales_context_ai.sql','20260912112411_sales_consultation_products.sql','20260912112527_21624fbd-6791-42e7-95f8-6ded9de89bd7.sql'])
  await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20260930101631_cb21_conversation_delay.sql',import.meta.url),'utf8'));
 await db.exec(`CREATE TABLE course_transcription_sources(id uuid PRIMARY KEY,provider text,video_id uuid,source_revision text,enabled boolean);
 CREATE TABLE course_transcripts(source_id uuid PRIMARY KEY,source_revision text,content_sha256 text,quality_status text,transcript_text text);
 CREATE TABLE course_caption_gap_audits(source_id uuid,source_revision text,status text);
 CREATE TABLE training_modules(id uuid PRIMARY KEY,product_id uuid,parent_module_id uuid,is_active boolean);
 CREATE TABLE training_lessons(id uuid PRIMARY KEY,module_id uuid);
 CREATE TABLE lesson_blocks(id uuid PRIMARY KEY,lesson_id uuid,updated_at timestamptz,content jsonb,block_type text);
 CREATE TABLE course_transcription_bindings(source_id uuid,block_id uuid,lesson_id uuid,product_id uuid,block_updated_at timestamptz);`);
 for(const name of ['20260912164349_b779cb99-19cf-4ef6-be5a-2753988c1791.sql','20260912175835_f1784ad8-aa21-4407-ac1c-72260894cf6f.sql'])
  await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));

 await db.exec(`CREATE TABLE site_pages(id uuid PRIMARY KEY,status text,blocks jsonb);
 ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz DEFAULT now(),ADD COLUMN deleted_at timestamptz,ADD COLUMN banned_until timestamptz;
 ALTER TABLE profiles ADD COLUMN status text DEFAULT 'active',ADD COLUMN is_archived boolean DEFAULT false,
  ADD COLUMN merged_to_profile_id uuid,ADD COLUMN telegram_user_id bigint,ADD COLUMN telegram_link_bot_id uuid,
  ADD COLUMN telegram_link_status text DEFAULT 'active',ADD COLUMN telegram_linked_at timestamptz DEFAULT now();
 ALTER TABLE telegram_bots ADD COLUMN status text DEFAULT 'active',ADD COLUMN is_primary boolean DEFAULT true;
 CREATE TABLE telegram_access_audit(user_id uuid,telegram_user_id bigint,event_type text,meta jsonb,created_at timestamptz DEFAULT now());
 CREATE TABLE site_form_submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),profile_id uuid,page_id uuid,status text,source text,metadata jsonb);`);
 const atomic=await readFile(new URL('../../supabase/migrations/20261009055330_cb21_questionnaire_atomic_submission.sql',import.meta.url),'utf8');
 await db.exec(atomic.slice(0,atomic.indexOf('-- Questionnaire-first submission')));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261009120000_questionnaire_sales_identity.sql',import.meta.url),'utf8'));
 const legacy=randomUUID();
 await db.query(`INSERT INTO sales_campaigns(id,code,bot_id,business_account_id,test_user_id,assignee_user_id,product_id,trigger_phrase,policy_version,knowledge_version)
  VALUES($1,'upgrade-fixture',$2,$3,$4,$4,$5,'Legacy phrase','v1','k1')`,[legacy,bot,connection,owner,product]);
 await db.query("INSERT INTO sales_conversations(campaign_id,state,human_hold,stage,revision,answered_seq) VALUES($1,'HUMAN_HOLD',true,'offer',7,8)",[legacy]);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261009121000_sales_customer_conversations.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261009122000_sales_questionnaire_route.sql',import.meta.url),'utf8'));
 const upgraded=await one('SELECT * FROM sales_conversations WHERE campaign_id=$1',[legacy]);
 assert.equal(upgraded.user_id,owner);assert.equal(upgraded.state,'HUMAN_HOLD');assert.equal(upgraded.stage,'offer');
 assert.equal(Number(upgraded.revision),7);assert.equal(Number(upgraded.answered_seq),8);
 if(captureFixture){captureFixture=false;await writeFile('/tmp/cb21-sales-runtime-fixture.sql',fixtureSql.join('\n'));}
});
after(async()=>{await db.close()});
async function fixture(now=defaultTestNow){
 testNow=now;await db.query("SELECT set_config('test.sales_now',$1,false)",[testNow]);
 await db.exec('DELETE FROM sales_checkout_operations; DELETE FROM payments_v2; DELETE FROM orders_v2; DELETE FROM live_event_sessions; DELETE FROM live_events; DELETE FROM sales_events; DELETE FROM sales_jobs; DELETE FROM sales_conversations; DELETE FROM sales_campaigns; DELETE FROM contact_center_message_assignments; DELETE FROM ai_handoffs; DELETE FROM notification_outbox; DELETE FROM telegram_messages;');
 await db.exec(`DELETE FROM site_form_submissions; DELETE FROM telegram_access_audit; DELETE FROM site_pages; DELETE FROM profiles WHERE user_id<>'${owner}';`);
 const p=(await one(`INSERT INTO sales_campaigns(code,bot_id,business_account_id,test_user_id,assignee_user_id,product_id,trigger_phrase,policy_version,knowledge_version,knowledge) VALUES('pilot',$1,$2,$3,$3,$4,'Хочу программу курса ЦБ','v1','k1','{"release_mode":"owner_test","facts":[{"id":"topic"}]}') RETURNING id`,[bot,connection,owner,product])).id;
 await rpc('sales_control',[p,'enable',owner]);return p;
}
async function msg(seq,text='Хочу программу курса ЦБ',extras={}){
 const e={transport:'business',user_id:owner,bot_id:bot,business_account_id:connection,direction:'incoming',message_origin:'client',message_id:seq,message_text:text,meta:{source:'telegram_business',raw:{date:Math.floor(Date.parse(testNow)/1000)}},...extras};
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
test('first reply uses opening delay and later customer turns use configured conversational delay',async()=>{
 const p=await fixture();
 await db.exec("UPDATE sales_campaigns SET code='cb21-owner-test'");
 await rpc('sales_control',[p,'delay',owner,60,60]);
 await rpc('sales_configure_followup_delay',[p,owner,10,15]);
 await msg(105);
 const first=await one("SELECT extract(epoch from due_at-created_at) delay FROM sales_jobs WHERE status='queued'");
 assert.ok(first.delay>=59&&first.delay<=61);
 const sent=await due();
 await rpc('sales_begin_send',[sent.id,sent.claim_token,{text:'Первый вопрос',stage:'experience',question_id:'experience'}]);
 await rpc('sales_finish_send',[sent.id,sent.claim_token,106]);
 await msg(107,'Впервые');
 const followup=await one("SELECT extract(epoch from due_at-created_at) delay FROM sales_jobs WHERE status='queued'");
 assert.ok(followup.delay>=9&&followup.delay<=16);
 await assert.rejects(rpc('sales_configure_followup_delay',[p,stranger,10,15]),/owner_required/);
 await assert.rejects(rpc('sales_configure_followup_delay',[p,owner,0,15]),/invalid_followup_delay/);
});
test('silent handoff targets the approved owner even if this question already had an assignee',async()=>{
 await fixture();const id=await msg(110);await db.query("INSERT INTO contact_center_message_assignments(source,source_message_id,assignee_user_id,assigned_by_user_id) VALUES('telegram',$1,$2,$2)",[id,stranger]);
 const j=await due();await rpc('sales_handoff',[j.id,j.claim_token,'needs_human']);
 const row=await one('SELECT assignee_user_id FROM contact_center_message_assignments WHERE source_message_id=$1',[id]);assert.equal(row.assignee_user_id,owner);
});
test('v2 rearm preserves sent history and outbox, is idempotent, and waits for a fresh activation',async()=>{
 const p=await fixture();await db.exec("UPDATE sales_campaigns SET code='cb21-owner-test',policy_version='cb21-v1'");
 await msg(120);const j=await due();await rpc('sales_begin_send',[j.id,j.claim_token,{text:'Отклоненная программа',stage:'consultation',question_id:'none'}]);
 await rpc('sales_finish_send',[j.id,j.claim_token,121]);await rpc('sales_control',[p,'pause',owner]);
 const savedJob=await one('SELECT * FROM sales_jobs');const savedOutbox=await one('SELECT * FROM notification_outbox');
 const rearm=await readFile(new URL('./rearm-cb21-owner-test-v2.sql',import.meta.url),'utf8');
 await db.exec(rearm);await db.exec(rearm);
 assert.deepEqual(await one('SELECT * FROM sales_jobs'),savedJob);assert.deepEqual(await one('SELECT * FROM notification_outbox'),savedOutbox);
 assert.equal((await conversation()).started,false);assert.equal((await conversation()).stage,'qualification');assert.equal((await conversation()).state,'HUMAN_HOLD');
 assert.equal((await one("SELECT count(*)::int n FROM sales_events WHERE event='policy_rearmed'")).n,1);
 await rpc('sales_control',[p,'enable',owner]);await rpc('sales_control',[p,'resume',owner]);assert.equal(await due(),null);assert.equal((await conversation()).state,'OFF');
 await msg(122);assert.equal((await conversation()).started,true);assert.equal((await due()).policy_version,'cb21-v2');
 await assert.rejects(db.exec(rearm),/precondition_failed/);
});
test('v2 rearm fails closed if the expected sent test is absent',async()=>{
 await fixture();await db.exec("UPDATE sales_campaigns SET code='cb21-owner-test',policy_version='cb21-v1'");
 const rearm=await readFile(new URL('./rearm-cb21-owner-test-v2.sql',import.meta.url),'utf8');
 await assert.rejects(db.exec(rearm),/precondition_failed/);assert.equal((await one('SELECT policy_version FROM sales_campaigns')).policy_version,'cb21-v1');
});

test('v2 first reply respects Minsk 08:00 and 23:00 boundaries independently of the runner clock',async()=>{
 for(const [time,allowed] of [['04:59:00',false],['05:00:00',true],['19:59:00',true],['20:00:00',false]]){
  await fixture(`2026-09-12T${time}Z`);
  await db.exec("UPDATE sales_campaigns SET policy_version='cb21-v2'");await msg(199);
  assert.equal(Boolean(await due()),allowed,time);
  if(!allowed) assert.equal((await one('SELECT reason FROM sales_jobs')).reason,'outside_business_hours');
 }
});

test('broadcast gates claim, survives end, delays again, and checks a newly started event before dispatch',async()=>{
 await fixture();await db.exec("UPDATE sales_campaigns SET policy_version='cb21-v2'");await msg(200);
 const ev=randomUUID();await db.query("INSERT INTO live_events(id,room_state,platform_status,status) VALUES($1,'live','live','live')",[ev]);
 assert.equal(await due(),null);assert.equal((await one("SELECT reason FROM sales_jobs")).reason,'event_active');
 await db.exec("UPDATE live_events SET room_state='completed',platform_status='ended',status='ended',webinar_completed_at=now()");
 assert.equal(await due(),null);assert.equal((await one("SELECT reason FROM sales_jobs")).reason,'event_ended_delay');
 const j=await due();assert.ok(j);
 await db.exec("UPDATE live_events SET room_state='live',platform_status='live',status='live',webinar_completed_at=NULL");
 assert.equal(await rpc('sales_begin_send',[j.id,j.claim_token,{}]),false);
 assert.equal((await one('SELECT count(*)::int n FROM notification_outbox')).n,0);
 assert.equal((await one('SELECT status FROM sales_jobs')).status,'queued');
});
test('recorded playback is blocked through the player duration; missing duration and inconsistent end hold',async()=>{
 await fixture();const e=randomUUID();await db.query("INSERT INTO live_events(id,event_type,autoweb_config) VALUES($1,'recorded_webinar',$2)",[e,{video:{duration_seconds:7200}}]);
 await db.query("INSERT INTO live_event_sessions(live_event_id,starts_at,ends_at,status) VALUES($1,'2026-09-12T10:00:00Z','2026-09-12T12:00:00Z','ended')",[e]);
 assert.equal(await rpc('sales_broadcast_state',['2026-09-12T11:59:00Z']),'active');
 assert.equal(await rpc('sales_broadcast_state',['2026-09-12T12:01:00Z']),'clear');
 await db.exec("UPDATE live_events SET autoweb_config='{}'");assert.equal(await rpc('sales_broadcast_state',['2026-09-12T11:59:00Z']),'unknown');
 await db.exec("UPDATE live_events SET autoweb_config='{\"video\":{\"duration_seconds\":10800}}'");assert.equal(await rpc('sales_broadcast_state',['2026-09-12T12:30:00Z']),'unknown');
});
test('one reminder after a question; ordinary WAIT is unchanged; pause and customer response cancel reminder',async()=>{
 const p=await fixture();await db.exec("UPDATE sales_campaigns SET policy_version='cb21-v2'");await msg(210);const j=await due();
 await rpc('sales_begin_send',[j.id,j.claim_token,{text:'Вопрос?',question_id:'goals',stage:'goals'}]);await rpc('sales_finish_send',[j.id,j.claim_token,211]);
 assert.equal((await one("SELECT count(*)::int n FROM sales_jobs WHERE kind='reminder'")).n,1);
 assert.equal(await rpc('sales_queue_reminder',[(await conversation()).id]),null);
 assert.equal(await rpc('sales_queue_reply',[(await conversation()).id]),null);
 await rpc('sales_control',[p,'pause',owner]);assert.equal((await one("SELECT status FROM sales_jobs WHERE kind='reminder'")).status,'cancelled');
 await msg(212,'Работаю с НДС');await rpc('sales_control',[p,'resume',owner]);
 assert.equal((await due()).kind,'reply');
});
test('reminder time remains in Minsk business hours and before inbound deadline, not outgoing deadline',async()=>{
 assert.equal((await rpc('sales_reminder_due',['2026-09-12T05:00Z','2026-09-12T05:02Z','2026-09-12T05:02Z',.5])).toISOString(),'2026-09-12T19:59:00.000Z');
 assert.equal((await rpc('sales_reminder_due',['2026-09-12T20:01Z','2026-09-12T20:03Z','2026-09-12T20:03Z',.5])).toISOString(),'2026-09-13T14:01:00.000Z');
 assert.equal(await rpc('sales_reminder_due',['2026-09-12T05:00Z','2026-09-13T04:00Z','2026-09-13T04:00Z',.5]),null);
});

test('checkout capability binds recipient, exact body, endpoint, active revision and one use',async()=>{
 const p=await fixture();await db.exec("UPDATE sales_campaigns SET policy_version='cb21-v2',knowledge=knowledge||'{\"checkout_enabled\":true}'");await msg(220);const j=await due();const c=await conversation();
 const body={user_id:owner,responsible_user_id:owner,amount:179000};const hash='a'.repeat(64);
 await db.query("INSERT INTO sales_checkout_operations(job_id,conversation_id,quote_fingerprint,endpoint,token_hash,request_body) VALUES($1,$2,'quote','admin-create-public-link',$3,$4)",[j.id,c.id,hash,body]);
 assert.equal(await rpc('sales_consume_checkout_capability',[hash,'public-rr-installment-initiate',body]),null);
 assert.equal(await rpc('sales_consume_checkout_capability',[hash,'admin-create-public-link',{...body,amount:100}]),null);
 assert.equal(await rpc('sales_consume_checkout_capability',[hash,'admin-create-public-link',body]),owner);
 assert.equal(await rpc('sales_consume_checkout_capability',[hash,'admin-create-public-link',body]),null);
});
test('pause revokes an unused checkout capability and browser roles cannot access operations',async()=>{
 const p=await fixture();await db.exec("UPDATE sales_campaigns SET policy_version='cb21-v2',knowledge=knowledge||'{\"checkout_enabled\":true}'");await msg(230);const j=await due();const c=await conversation();const body={user_id:owner,responsible_user_id:owner};
 await db.query("INSERT INTO sales_checkout_operations(job_id,conversation_id,quote_fingerprint,endpoint,token_hash,request_body) VALUES($1,$2,'quote','admin-create-public-link',$3,$4)",[j.id,c.id,'b'.repeat(64),body]);
 await rpc('sales_control',[p,'pause',owner]);assert.equal(await rpc('sales_consume_checkout_capability',['b'.repeat(64),'admin-create-public-link',body]),null);
 for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);await assert.rejects(db.exec('SELECT * FROM sales_checkout_operations'),/permission denied/);await assert.rejects(rpc('sales_offer_eligibility',[owner,product]),/permission denied/);await db.exec('RESET ROLE');}
});
test('alumni evidence excludes gifts, unrelated purchases and refunds; distinguishes imported paid order',async()=>{
 await fixture();await db.query("INSERT INTO tariff_offers(id,meta) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET meta=excluded.meta",[product,{purchase_eligibility:{kind:'prior_purchase',sources:[{product_id:'3e43fb28-8322-41bc-bfee-714731bdc630',excluded_tariff_ids:['04e6c302-f1ff-4d7d-a588-d30681e7a450']},{product_id:'7101ed3c-7839-4a74-ad95-aa0660369b22',purchased_from:'2024-01-01',allow_paid_import:true}]}}]);const o=(await one("INSERT INTO orders_v2(user_id,product_id,status,final_price) VALUES($1,'3e43fb28-8322-41bc-bfee-714731bdc630','paid',2650) RETURNING id",[owner])).id;
 assert.equal((await rpc('sales_offer_eligibility',[owner,product])).eligible,false);
 await db.query("INSERT INTO payments_v2(order_id,status,amount) VALUES($1,'succeeded',2650)",[o]);assert.equal((await rpc('sales_offer_eligibility',[owner,product])).proof,'provider');
 await db.exec('UPDATE payments_v2 SET refunded_amount=100');assert.equal((await rpc('sales_offer_eligibility',[owner,product])).eligible,false);
 await db.exec("DELETE FROM payments_v2; UPDATE orders_v2 SET product_id='7101ed3c-7839-4a74-ad95-aa0660369b22',deal_date='2024-05-14',meta='{\"gc_deal_id\":\"synthetic\",\"import_source\":\"getcourse\"}'");
 assert.equal((await rpc('sales_offer_eligibility',[owner,product])).proof,'getcourse_paid_import');
 await db.exec("UPDATE orders_v2 SET deal_date='2023-01-01'");assert.equal((await rpc('sales_offer_eligibility',[owner,product])).eligible,false);
 await db.exec('UPDATE orders_v2 SET final_price=0');assert.equal((await rpc('sales_offer_eligibility',[owner,product])).eligible,false);
});
test('administrator edits to offer eligibility take effect immediately, with no hardcoded course IDs',async()=>{
 await fixture();const source=randomUUID(),gift=randomUUID(),offer=randomUUID();
 const rule={kind:'prior_purchase',sources:[{product_id:source,purchased_from:'2025-01-01',excluded_tariff_ids:[gift]}]};
 await db.query('INSERT INTO tariff_offers(id,meta) VALUES($1,$2)',[offer,{purchase_eligibility:rule}]);
 const order=(await one("INSERT INTO orders_v2(user_id,product_id,tariff_id,status,final_price,deal_date) VALUES($1,$2,$3,'paid',100,'2025-06-01') RETURNING id",[owner,source,gift])).id;
 await db.query("INSERT INTO payments_v2(order_id,status,amount,currency) VALUES($1,'succeeded',100,'USD')",[order]);
 assert.equal((await rpc('sales_offer_eligibility',[owner,offer])).eligible,false);
 rule.sources[0].excluded_tariff_ids=[];
 await db.query('UPDATE tariff_offers SET meta=$2 WHERE id=$1',[offer,{purchase_eligibility:rule}]);
 assert.equal((await rpc('sales_offer_eligibility',[owner,offer])).eligible,false); // Different currency is not proof.
 await db.exec("UPDATE payments_v2 SET currency='BYN'");
 assert.equal((await rpc('sales_offer_eligibility',[owner,offer])).eligible,true);
 rule.sources[0].purchased_from='2026-01-01';
 await db.query('UPDATE tariff_offers SET meta=$2 WHERE id=$1',[offer,{purchase_eligibility:rule}]);
 assert.equal((await rpc('sales_offer_eligibility',[owner,offer])).eligible,false);
 await db.query('UPDATE tariff_offers SET meta=$2 WHERE id=$1',[offer,{purchase_eligibility:{kind:'unsupported',sources:rule.sources}}]);
 assert.equal((await rpc('sales_offer_eligibility',[owner,offer])).eligible,false);
});
test('invoice document capability authorizes only the created order and exact generation body once',async()=>{
 const p=await fixture();await db.exec("UPDATE sales_campaigns SET policy_version='cb21-v2',knowledge=knowledge||'{\"checkout_enabled\":true}'");await msg(240);const j=await due();const c=await conversation();const offer=randomUUID();const hash='c'.repeat(64),body={target_user_id:owner,responsible_user_id:owner,offer_id:offer};
 const op=(await one("INSERT INTO sales_checkout_operations(job_id,conversation_id,quote_fingerprint,endpoint,token_hash,request_body) VALUES($1,$2,'invoice','admin-invoice-checkout-issue',$3,$4) RETURNING id",[j.id,c.id,hash,body])).id;
 await rpc('sales_consume_checkout_capability',[hash,'admin-invoice-checkout-issue',body]);
 const o=(await one("INSERT INTO orders_v2(user_id,product_id,offer_id,status,final_price,meta) VALUES($1,$2,$3,'pending',1790,$4) RETURNING id",[owner,product,offer,{sales_checkout_operation_id:op,checkout_kind:'invoice',awaits_payment:true}])).id;
 const gen={order_id:o,mode:'generate',pre_payment_invoice:true};
 assert.equal(await rpc('sales_authorize_invoice_document',[hash,{...gen,admin_force:true}]),null);
 assert.equal(await rpc('sales_authorize_invoice_document',[hash,gen]),owner);
 assert.equal(await rpc('sales_authorize_invoice_document',[hash,gen]),null);
});

test('pause after invoice order creation still revokes document generation',async()=>{
 const p=await fixture();await db.exec("UPDATE sales_campaigns SET policy_version='cb21-v2',knowledge=knowledge||'{\"checkout_enabled\":true}'");await msg(250);const j=await due();const c=await conversation();const offer=randomUUID();const hash='d'.repeat(64),body={target_user_id:owner,responsible_user_id:owner,offer_id:offer};
 const op=(await one("INSERT INTO sales_checkout_operations(job_id,conversation_id,quote_fingerprint,endpoint,token_hash,request_body) VALUES($1,$2,'invoice','admin-invoice-checkout-issue',$3,$4) RETURNING id",[j.id,c.id,hash,body])).id;
 await rpc('sales_consume_checkout_capability',[hash,'admin-invoice-checkout-issue',body]);
 const o=(await one("INSERT INTO orders_v2(user_id,product_id,offer_id,status,final_price,meta) VALUES($1,$2,$3,'pending',1790,$4) RETURNING id",[owner,product,offer,{sales_checkout_operation_id:op,checkout_kind:'invoice',awaits_payment:true}])).id;
 await rpc('sales_control',[p,'pause',owner]);assert.equal(await rpc('sales_authorize_invoice_document',[hash,{order_id:o,mode:'generate',pre_payment_invoice:true}]),null);
});


test('technical incident assigns the latest incoming once, pauses and does not create another checkout',async()=>{
 await fixture();await msg(499);await msg(500,'Пытаюсь оплатить');const id=await msg(501,'Ссылка на оплату не открывается, ошибка 404');const j=await due();
 const assignment=await rpc('sales_handoff',[j.id,j.claim_token,'technical_problem']);assert.ok(assignment);
 assert.equal(await rpc('sales_handoff',[j.id,j.claim_token,'technical_problem']),null);
 const a=await one('SELECT * FROM contact_center_message_assignments');assert.equal(a.source_message_id,id);assert.equal(a.assignee_user_id,owner);
 assert.equal((await conversation()).human_hold,true);assert.equal((await conversation()).reason,'technical_problem');
 assert.equal((await one('SELECT count(*)::int n FROM sales_checkout_operations')).n,0);assert.equal(await due(),null);
});
test('AI settings require owner, OFF and hold, exact previous config; invalid or null options fail',async()=>{
 const p=await fixture();const original=(await one('SELECT ai_config FROM sales_campaigns')).ai_config;const config={...original,model:'google/gemini-3.8-flash'};
 await assert.rejects(rpc('sales_configure_ai',[p,stranger,config,original]),/owner_required/);
 await assert.rejects(rpc('sales_configure_ai',[p,owner,config,original]),/disable_and_pause_required/);
 await rpc('sales_control',[p,'disable',owner]);
 for(const bad of [{...config,max_tokens:null},{...config,model:null},{...config,max_tokens:3000.5},{...config,url:'https:\/\/attacker.example'}])
  await assert.rejects(rpc('sales_configure_ai',[p,owner,bad,original]),/invalid_ai_config/);
 assert.equal(await rpc('sales_configure_ai',[p,owner,config,original]),true);
 await assert.rejects(rpc('sales_configure_ai',[p,owner,config,original]),/configuration_changed/);
 assert.equal((await one('SELECT mode FROM sales_campaigns')).mode,'off');assert.equal((await conversation()).human_hold,true);
 assert.equal((await one("SELECT has_table_privilege('authenticated','sales_media_observations','SELECT') allowed")).allowed,false);
 assert.equal((await one("SELECT has_function_privilege('authenticated','sales_configure_ai(uuid,uuid,jsonb,jsonb)','EXECUTE') allowed")).allowed,false);
});
test('media preprocessing releases claim and resumes without sending; stale token and pause cannot requeue',async()=>{
 const p=await fixture();await msg(510);const j=await due();
 assert.equal(await rpc('sales_defer_context',[j.id,j.claim_token,'media_processing_pending']),true);
 const next=await one('SELECT * FROM sales_jobs');assert.equal(next.status,'queued');assert.equal(next.claim_token,null);assert.equal(next.context_attempts,1);
 assert.equal(await rpc('sales_begin_send',[j.id,j.claim_token,{}]),false);
 const j2=await due();await rpc('sales_control',[p,'pause',owner]);
 assert.equal(await rpc('sales_defer_context',[j2.id,j2.claim_token,'media_processing_pending']),false);assert.equal(await due(),null);
});


test('media-only replacement invalidates a prepared reply even when caption stays the same',async()=>{
 await fixture();const id=await msg(520);const j=await due();
 await db.query("UPDATE telegram_messages SET meta=meta||'{\"file_id\":\"replacement\",\"file_type\":\"photo\"}'::jsonb WHERE id=$1",[id]);
 assert.equal(await rpc('sales_begin_send',[j.id,j.claim_token,{}]),false);
 assert.equal((await conversation()).human_hold,true);assert.equal((await conversation()).reason,'media_edited');
});


test('consultation catalog configuration uses existing campaign knowledge and owner gate',async()=>{
 const p=await fixture();await rpc('sales_control',[p,'disable',owner]);
 await assert.rejects(rpc('sales_configure_knowledge_products',[p,stranger,[product],[]]),/owner_required/);
 await assert.rejects(rpc('sales_configure_knowledge_products',[p,owner,[product,product],[]]),/invalid_consultation_products/);
 await assert.rejects(rpc('sales_configure_knowledge_products',[p,owner,[null],[]]),/consultation_product_unavailable/);
 await assert.rejects(rpc('sales_configure_knowledge_products',[p,owner,[randomUUID()],[]]),/consultation_product_unavailable/);
 assert.equal(await rpc('sales_configure_knowledge_products',[p,owner,[product],[]]),true);
 const row=await one('SELECT mode,knowledge FROM sales_campaigns');assert.equal(row.mode,'off');assert.deepEqual(row.knowledge.consultation_product_ids,[product]);assert.equal(row.knowledge.facts.length,1);
 await assert.rejects(rpc('sales_configure_knowledge_products',[p,owner,[],[]]),/knowledge_configuration_changed/);
 assert.equal((await one("SELECT has_function_privilege('authenticated','sales_configure_knowledge_products(uuid,uuid,jsonb,jsonb)','EXECUTE') allowed")).allowed,false);
});


test('failed unnumbered CRM send cannot replace the Telegram history boundary',async()=>{
 await fixture();await msg(600);await msg(null,'failed draft',{direction:'outgoing',status:'failed',message_origin:'crm_operator'});
 assert.equal((await one('SELECT message_id FROM telegram_messages ORDER BY message_id DESC LIMIT 1')).message_id,null);
 const boundary=await one('SELECT message_id FROM telegram_messages WHERE message_id IS NOT NULL ORDER BY message_id DESC NULLS LAST LIMIT 1');assert.equal(boundary.message_id,600);
 const rows=(await db.query('SELECT message_id FROM telegram_messages WHERE message_id<=$1 ORDER BY message_id',[boundary.message_id])).rows;
 assert.deepEqual(rows.map(r=>r.message_id),[600]);
});

async function customerFixture() {
 await fixture();const page=randomUUID(),block=randomUUID(),bob=randomUUID();
 await db.query('INSERT INTO auth.users(id) VALUES($1)',[bob]);
 await db.query("INSERT INTO site_pages VALUES($1,'published',$2)",[page,[{id:block,type:'form',content:{auth_mode:true,questionnaire_first:true}}]]);
 const phrase='Я заполнила анкету, готова получить бонус🔥';
 const p=(await one(`INSERT INTO sales_campaigns(code,bot_id,business_account_id,test_user_id,assignee_user_id,product_id,
  mode,trigger_phrase,policy_version,knowledge_version,knowledge,enabled_at,source_page_id,source_block_id)
  VALUES('customers',$1,$2,null,$3,$4,'questionnaire_customer',$5,'cb21-v2','k1',$6,now(),$7,$8) RETURNING id`,
  [bot,connection,owner,product,phrase,{release_mode:'questionnaire_customer',client_release_approved:true,checkout_enabled:true,facts:[{id:'topic'}]},page,block])).id;
 const users=[{id:stranger,tg:1001},{id:bob,tg:1002}];
 for(const user of users) {
  const profile=(await one('INSERT INTO profiles(user_id,telegram_user_id,telegram_link_bot_id) VALUES($1,$2,$3) RETURNING id',[user.id,user.tg,bot])).id;
  await db.query("INSERT INTO telegram_access_audit VALUES($1,$2,'telegram_link_confirmed',$3,now())",[user.id,user.tg,{bot_id:bot}]);
  await db.query("INSERT INTO site_form_submissions(profile_id,page_id,status,source,metadata) VALUES($1,$2,'processed','site_form_auth',$3)",
   [profile,page,{questionnaire_first:true,block_id:block,user_id:user.id}]);
 }
 const send=(user,seq,text=phrase,extra={})=>msg(seq,text,{user_id:user.id,telegram_user_id:user.tg,...extra});
 const chat=user=>one('SELECT * FROM sales_conversations WHERE campaign_id=$1 AND user_id=$2',[p,user.id]);
 return {p,page,block,phrase,users,send,chat};
}

test('two questionnaire customers have separate states, queues, outbox recipients and pause controls',async()=>{
 const f=await customerFixture();const [alice,bob]=f.users;
 await f.send(alice,701);await f.send(bob,702);
 const ca=await f.chat(alice),cb=await f.chat(bob);assert.notEqual(ca.id,cb.id);
 assert.equal(ca.started,true);assert.equal(cb.started,true);
 const originalDue=(await db.query('SELECT id,due_at FROM sales_jobs ORDER BY id')).rows;
 await rpc('sales_configure_followup_delay',[f.p,owner,3,7]);
 assert.deepEqual((await db.query('SELECT id,due_at FROM sales_jobs ORDER BY id')).rows,originalDue);
 await rpc('sales_control_conversation',[f.p,alice.id,'pause',owner]);
 assert.equal((await f.chat(alice)).state,'HUMAN_HOLD');assert.equal((await f.chat(bob)).state,'READY');
 const job=await due();assert.equal(job.conversation_id,cb.id);
 assert.equal(await rpc('sales_begin_send',[job.id,job.claim_token,{stage:'goals',text:'Synthetic reply',question_id:'none'}]),true);
 assert.equal((await one('SELECT user_id FROM notification_outbox')).user_id,bob.id);
 await rpc('sales_finish_send',[job.id,job.claim_token,703]);
 assert.equal((await one("SELECT user_id FROM telegram_messages WHERE message_origin='bot_automation'")).user_id,bob.id);
 assert.equal((await f.chat(bob)).state,'WAIT_CUSTOMER');assert.equal((await f.chat(alice)).state,'HUMAN_HOLD');
 await assert.rejects(rpc('sales_control',[f.p,'resume',owner]),/conversation_user_required/);
});

test('missing questionnaire, support link, wrong Telegram ID and historical webhook do not start customer sales',async()=>{
 const f=await customerFixture(),alice=f.users[0];
 for(const change of [
  'DELETE FROM site_form_submissions',
  'DELETE FROM telegram_access_audit',
  "UPDATE profiles SET status='blocked'",
  "UPDATE auth.users SET banned_until=now()+interval '1 day'",
  "UPDATE site_pages SET blocks=jsonb_set(blocks,'{0,content,questionnaire_first}','false')",
 ]) {
  await db.exec('BEGIN');try {await db.exec(change);await f.send(alice,710);assert.equal(await f.chat(alice),undefined);}finally{await db.exec('ROLLBACK')}
 }
 await f.send(alice,711,f.phrase,{telegram_user_id:9999});assert.equal(await f.chat(alice),undefined);
 await f.send(alice,712,f.phrase,{meta:{source:'telegram_business',raw:{date:1}}});assert.equal(await f.chat(alice),undefined);
 await f.send(alice,713,'Просто здравствуйте');assert.equal(await f.chat(alice),undefined);
 await f.send(alice,714);assert.equal((await f.chat(alice)).started,true);
});

test('revoking questionnaire identity after claim prevents dispatch and checkout capability consumption',async()=>{
 const f=await customerFixture(),alice=f.users[0];await f.send(alice,720);const job=await due();
 const c=await f.chat(alice),body={user_id:alice.id,responsible_user_id:owner,amount:179000},hash='c'.repeat(64);
 await db.query("INSERT INTO sales_checkout_operations(job_id,conversation_id,quote_fingerprint,endpoint,token_hash,request_body) VALUES($1,$2,'customer-quote','admin-create-public-link',$3,$4)",[job.id,c.id,hash,body]);
 await db.query('UPDATE profiles SET is_archived=true WHERE user_id=$1',[alice.id]);
 assert.equal(await rpc('sales_begin_send',[job.id,job.claim_token,{}]),false);
 assert.equal(await rpc('sales_consume_checkout_capability',[hash,'admin-create-public-link',body]),null);
 assert.equal((await one('SELECT count(*)::int n FROM notification_outbox')).n,0);
});

test('customer capability checks the conversation recipient, even when an operation contains another valid user',async()=>{
 const f=await customerFixture(),[alice,bob]=f.users;await f.send(alice,730);const job=await due(),c=await f.chat(alice);
 const wrong={user_id:bob.id,responsible_user_id:owner,amount:179000},hash='d'.repeat(64);
 await db.query("INSERT INTO sales_checkout_operations(job_id,conversation_id,quote_fingerprint,endpoint,token_hash,request_body) VALUES($1,$2,'recipient-quote','admin-create-public-link',$3,$4)",[job.id,c.id,hash,wrong]);
 assert.equal(await rpc('sales_consume_checkout_capability',[hash,'admin-create-public-link',wrong]),null);
 const correct={...wrong,user_id:alice.id};await db.query('UPDATE sales_checkout_operations SET request_body=$1 WHERE token_hash=$2',[correct,hash]);
 assert.equal(await rpc('sales_consume_checkout_capability',[hash,'admin-create-public-link',correct]),owner);
 assert.equal(await rpc('sales_consume_checkout_capability',[hash,'admin-create-public-link',correct]),null);
});

test('manual customer reply preserves human hold even while the support binding is unavailable',async()=>{
 const f=await customerFixture(),alice=f.users[0];await f.send(alice,735);
 await db.query('DELETE FROM telegram_access_audit WHERE user_id=$1',[alice.id]);
 await f.send(alice,736,'Ответ сотрудника',{direction:'outgoing',message_origin:'crm_operator'});
 assert.equal((await f.chat(alice)).state,'HUMAN_HOLD');
 assert.equal((await one("SELECT count(*)::int n FROM sales_jobs WHERE status='cancelled' AND reason='manual_reply'")).n,1);
 await assert.rejects(rpc('sales_control_conversation',[f.p,alice.id,'resume',owner]),/questionnaire_identity_required/);
});

test('customer invoice document cannot authorize another client order, and exact authorization is single-use',async()=>{
 const f=await customerFixture(),[alice,bob]=f.users;await f.send(alice,737);const j=await due(),c=await f.chat(alice);
 const offer=randomUUID(),hash='e'.repeat(64),body={target_user_id:alice.id,responsible_user_id:owner,offer_id:offer};
 const op=(await one("INSERT INTO sales_checkout_operations(job_id,conversation_id,quote_fingerprint,endpoint,token_hash,request_body) VALUES($1,$2,'customer-invoice','admin-invoice-checkout-issue',$3,$4) RETURNING id",[j.id,c.id,hash,body])).id;
 assert.equal(await rpc('sales_consume_checkout_capability',[hash,'admin-invoice-checkout-issue',body]),owner);
 const order=(await one("INSERT INTO orders_v2(user_id,product_id,offer_id,status,final_price,meta) VALUES($1,$2,$3,'pending',1790,$4) RETURNING id",[bob.id,product,offer,{sales_checkout_operation_id:op,checkout_kind:'invoice',awaits_payment:true}])).id;
 const generate={order_id:order,mode:'generate',pre_payment_invoice:true};
 assert.equal(await rpc('sales_authorize_invoice_document',[hash,generate]),null);
 await db.query('UPDATE orders_v2 SET user_id=$1 WHERE id=$2',[alice.id,order]);
 assert.equal(await rpc('sales_authorize_invoice_document',[hash,generate]),owner);
 assert.equal(await rpc('sales_authorize_invoice_document',[hash,generate]),null);
});

test('customer handoff assigns the exact sender to the owner without pausing another customer',async()=>{
 const f=await customerFixture(),[alice,bob]=f.users;await f.send(alice,738);const j=await due();await f.send(bob,739);
 const assignment=await rpc('sales_handoff',[j.id,j.claim_token,'technical_problem']);assert.ok(assignment);
 const handoff=await one('SELECT * FROM ai_handoffs');assert.equal(handoff.user_id,alice.id);assert.equal(handoff.telegram_user_id,alice.tg);
 assert.equal((await f.chat(alice)).state,'HUMAN_HOLD');assert.equal((await f.chat(bob)).state,'READY');
 assert.equal((await one('SELECT count(*)::int n FROM notification_outbox')).n,0);
});

test('campaign configuration invalidates every customer revision and job, and notices unresolved delivery in either chat',async()=>{
 const f=await customerFixture();for(let i=0;i<f.users.length;i++)await f.send(f.users[i],740+i);
 await rpc('sales_control',[f.p,'disable',owner]);
 const config=(await one('SELECT ai_config FROM sales_campaigns WHERE id=$1',[f.p])).ai_config;
 await db.exec("UPDATE sales_jobs SET status='claimed'");
 const before=(await db.query('SELECT id,revision FROM sales_conversations WHERE campaign_id=$1 ORDER BY id',[f.p])).rows;
 assert.equal(await rpc('sales_configure_ai',[f.p,owner,{...config,max_tokens:9000},config]),true);
 const after=(await db.query('SELECT id,revision FROM sales_conversations WHERE campaign_id=$1 ORDER BY id',[f.p])).rows;
 assert.deepEqual(after.map((c,i)=>Number(c.revision)-Number(before[i].revision)),[1,1]);
 assert.equal((await one("SELECT count(*)::int n FROM sales_jobs WHERE status='cancelled' AND reason='ai_configuration_changed'")).n,2);
 await db.exec("UPDATE sales_jobs SET status='claimed'");
 assert.equal(await rpc('sales_configure_knowledge_products',[f.p,owner,[],[]]),true);
 assert.equal((await one("SELECT count(*)::int n FROM sales_jobs WHERE status='cancelled' AND reason='knowledge_configuration_changed'")).n,2);
 await db.query("UPDATE sales_jobs SET status='unknown' WHERE conversation_id=$1",[(await f.chat(f.users[1])).id]);
 await assert.rejects(rpc('sales_configure_ai',[f.p,owner,config,{...config,max_tokens:9000}]),/disable_and_pause_required/);
 await assert.rejects(rpc('sales_replace_knowledge_facts',[f.p,owner,[],'k1','unused',false,null]),/delivery_unresolved/);
});

test('customer campaign cannot enable against a disabled questionnaire and new RPCs remain service-only',async()=>{
 const f=await customerFixture();await rpc('sales_control',[f.p,'disable',owner]);
 await db.exec("UPDATE site_pages SET blocks=jsonb_set(blocks,'{0,content,questionnaire_first}','false')");
 await assert.rejects(rpc('sales_control',[f.p,'enable',owner]),/questionnaire_not_ready/);
 for(const name of ['sales_conversation_enabled(uuid,uuid)','sales_control_conversation(uuid,uuid,text,uuid)','sales_replace_knowledge_facts(uuid,uuid,jsonb,text,text,boolean,text)']) {
  for(const role of ['anon','authenticated','service_role']) {
   assert.equal((await one('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,name])).allowed,role==='service_role');
  }
 }
});

test('administrator configures a separate OFF customer route idempotently without changing the live owner test',async()=>{
 const base=await fixture(),page=randomUUID(),block=randomUUID(),phrase='Настроенная менеджером кодовая фраза';
 await db.query("INSERT INTO site_pages VALUES($1,'published',$2)",[page,[{id:block,type:'form',content:{auth_mode:true,questionnaire_first:false}}]]);
 const before=await one('SELECT * FROM sales_campaigns WHERE id=$1',[base]);
 const first=await rpc('sales_configure_questionnaire_campaign',[base,owner,page,block,phrase,null,'k1']);
 assert.equal(await rpc('sales_configure_questionnaire_campaign',[base,owner,page,block,phrase,null,'k1']),first);
 const customer=await one('SELECT * FROM sales_campaigns WHERE id=$1',[first]);
 assert.equal(customer.mode,'off');assert.equal(customer.test_user_id,null);assert.equal(customer.knowledge.client_release_approved,false);
 assert.equal(customer.product_id,before.product_id);assert.deepEqual(customer.ai_config,before.ai_config);
 assert.deepEqual(await one('SELECT * FROM sales_campaigns WHERE id=$1',[base]),before);
 assert.equal((await one('SELECT count(*)::int n FROM sales_conversations WHERE campaign_id=$1',[first])).n,0);
 const route={id:first,page_id:page,block_id:block,trigger_phrase:phrase};
 assert.equal(await rpc('sales_configure_questionnaire_campaign',[base,owner,page,block,'Новая управляемая кодовая фраза',route,'k1']),first);
 await assert.rejects(rpc('sales_configure_questionnaire_campaign',[base,owner,page,block,phrase,route,'k1']),/configuration_changed/);
 await assert.rejects(rpc('sales_configure_questionnaire_campaign',[base,stranger,page,block,phrase,null,'k1']),/owner_required/);
 assert.equal(await rpc('sales_campaign_configuration_ready',[first]),true);
});

test('route change requires an exact snapshot and stopped campaign; opted-out customers do not block safe configuration',async()=>{
 const f=await customerFixture(),alice=f.users[0],route={id:f.p,page_id:f.page,block_id:f.block,trigger_phrase:f.phrase};
 await f.send(alice,760);
 await assert.rejects(rpc('sales_configure_questionnaire_campaign',[f.p,owner,f.page,f.block,'Другая фраза запуска',route,'k1']),/disable_and_pause_required/);
 await rpc('sales_control',[f.p,'disable',owner]);
 await db.query("UPDATE sales_conversations SET state='STOPPED' WHERE campaign_id=$1",[f.p]);
 assert.equal(await rpc('sales_campaign_configuration_ready',[f.p]),true);
 assert.equal(await rpc('sales_configure_questionnaire_campaign',[f.p,owner,f.page,f.block,'Другая фраза запуска',route,'k1']),f.p);
 assert.equal((await f.chat(alice)).state,'STOPPED');assert.equal((await f.chat(alice)).started,false);
 assert.equal((await one('SELECT mode FROM sales_campaigns WHERE id=$1',[f.p])).mode,'off');
 const functionName='sales_configure_questionnaire_campaign(uuid,uuid,uuid,uuid,text,jsonb,text)';
 assert.equal((await one("SELECT has_function_privilege('authenticated',$1,'EXECUTE') allowed",[functionName])).allowed,false);
});


test('customer activation validates actual course sources, grants no access, and keeps the owner campaign intact',async()=>{
 const f=await customerFixture();await rpc('sales_control',[f.p,'disable',owner]);
 const source=randomUUID(),root=randomUUID(),module=randomUUID(),lesson=randomUUID(),block=randomUUID();
 const revision='a'.repeat(64),hash='b'.repeat(64);
 await db.query("INSERT INTO course_transcription_sources VALUES($1,'kinescope',$2,$3,true)",[source,randomUUID(),revision]);
 await db.query("INSERT INTO course_transcripts VALUES($1,$2,$3,'unreviewed','PRIVATE TRANSCRIPT')",[source,revision,hash]);
 await db.query('INSERT INTO training_modules VALUES($1,$2,$3,false)',[module,product,root]);
 await db.query('INSERT INTO training_lessons VALUES($1,$2)',[lesson,module]);
 await db.query(`INSERT INTO lesson_blocks VALUES($1,$2,now(),'{"url":"https://kinescope.io/synthetic-customer-source","provider":"kinescope"}','video')`,[block,lesson]);
 await db.query('INSERT INTO course_transcription_bindings VALUES($1,$2,$3,$4,now())',[source,block,lesson,product]);
 const fact={id:'customer-topic',title:'Темы курса',text:'В курсе рассматривается работа с документами в 1С.',source_id:source,source_revision:revision,source_sha256:hash,module_id:module,binding_block_id:block};
 await db.query("UPDATE sales_campaigns SET knowledge=knowledge||$2::jsonb WHERE id=$1",[f.p,{root_module_id:root,facts:[fact],client_release_approved:false}]);
 const ownerBefore=await one('SELECT * FROM sales_campaigns WHERE test_user_id=$1',[owner]);
 assert.equal((await rpc('sales_check_knowledge_facts',[f.p,[fact]])).valid,true);
 await db.query('UPDATE course_transcription_sources SET enabled=false WHERE id=$1',[source]);
 await assert.rejects(rpc('sales_control',[f.p,'enable',owner]),/knowledge_not_ready/);
 assert.equal((await one('SELECT mode FROM sales_campaigns WHERE id=$1',[f.p])).mode,'off');
 await db.query('UPDATE course_transcription_sources SET enabled=true WHERE id=$1',[source]);
 await rpc('sales_control',[f.p,'enable',owner]);
 const active=await one('SELECT * FROM sales_campaigns WHERE id=$1',[f.p]);
 assert.equal(active.mode,'questionnaire_customer');assert.equal(active.knowledge.client_release_approved,true);
 assert.deepEqual(await one('SELECT * FROM sales_campaigns WHERE test_user_id=$1',[owner]),ownerBefore);
 assert.equal((await one('SELECT count(*)::int n FROM notification_outbox')).n,0);
 assert.equal((await one('SELECT count(*)::int n FROM orders_v2')).n,0);
 await f.send(f.users[0],770);assert.equal((await f.chat(f.users[0])).started,true);
});
