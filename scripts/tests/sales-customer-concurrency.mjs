import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';

// This destructive synthetic fixture may only run in a disposable local database.
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'sales_runtime_test');
const options={host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),database:'sales_runtime_test',username:process.env.PGUSER,password:process.env.PGPASSWORD,max:1,onnotice:()=>{}};
const sql=postgres(options),workerA=postgres(options),workerB=postgres(options);
try {
 const fixture=(await readFile('/tmp/cb21-sales-runtime-fixture.sql','utf8')).replace(/CREATE ROLE (anon|authenticated|service_role)( BYPASSRLS)?;/g,(_,name,extra='')=>`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${name}') THEN CREATE ROLE ${name}${extra}; END IF; END $$;`);
 await sql.unsafe(fixture).simple();
 const [template]=await sql`SELECT * FROM sales_campaigns WHERE code='upgrade-fixture'`;
 const page=randomUUID(),block=randomUUID(),campaign=randomUUID(),phrase='Synthetic questionnaire customer phrase';
 await sql`INSERT INTO site_pages VALUES(${page},'published',${sql.json([{id:block,type:'form',content:{auth_mode:true,questionnaire_first:true}}])})`;
 await sql`INSERT INTO sales_campaigns(id,code,bot_id,business_account_id,test_user_id,assignee_user_id,product_id,mode,trigger_phrase,policy_version,knowledge_version,knowledge,enabled_at,source_page_id,source_block_id)
 VALUES(${campaign},'concurrent-customers',${template.bot_id},${template.business_account_id},NULL,${template.test_user_id},${template.product_id},'questionnaire_customer',${phrase},'v1','k1',${sql.json({release_mode:'questionnaire_customer',client_release_approved:true,facts:[{id:'synthetic'}]})},now(),${page},${block})`;
 const clients=[{id:randomUUID(),tg:7001},{id:randomUUID(),tg:7002}];
 for(const [i,client] of clients.entries()) {
  await sql`INSERT INTO auth.users(id) VALUES(${client.id})`;
  const [profile]=await sql`INSERT INTO profiles(user_id,telegram_user_id,telegram_link_bot_id) VALUES(${client.id},${client.tg},${template.bot_id}) RETURNING id`;
  await sql`INSERT INTO telegram_access_audit VALUES(${client.id},${client.tg},'telegram_link_confirmed',${sql.json({bot_id:template.bot_id})},now())`;
  await sql`INSERT INTO site_form_submissions(profile_id,page_id,status,source,metadata) VALUES(${profile.id},${page},'processed','site_form_auth',${sql.json({questionnaire_first:true,block_id:block,user_id:client.id})})`;
  await sql`INSERT INTO telegram_messages(transport,user_id,bot_id,business_account_id,direction,message_origin,message_id,message_text,telegram_user_id,meta)
   VALUES('business',${client.id},${template.bot_id},${template.business_account_id},'incoming','client',${900+i},${phrase},${client.tg},${sql.json({source:'telegram_business',raw:{date:1789214400}})})`;
 }
 await sql`UPDATE sales_jobs SET due_at=now()-interval '1 second' WHERE status='queued'`;
 let releaseClaim,claimedSignal;const claimed=new Promise(resolve=>claimedSignal=resolve),release=new Promise(resolve=>releaseClaim=resolve);
 const first=workerA.begin(async tx=>{const [row]=await tx`SELECT sales_claim_job() job`;claimedSignal(row.job);await release;return row.job;});
 const jobA=await claimed;assert.ok(jobA);
 const [other]=await workerB`SELECT sales_claim_job() job`;assert.ok(other.job);
 assert.notEqual(jobA.id,other.job.id);assert.notEqual(jobA.conversation_id,other.job.conversation_id);
 releaseClaim();await first;
 const duplicates=await Promise.all([workerA`SELECT sales_begin_send(${jobA.id},${jobA.claim_token},'{}') sent`,workerB`SELECT sales_begin_send(${jobA.id},${jobA.claim_token},'{}') sent`]);
 assert.equal(duplicates.filter(rows=>rows[0].sent).length,1);
 const [outbox]=await sql`SELECT user_id FROM notification_outbox`;
 const [recipient]=await sql`SELECT user_id FROM sales_conversations WHERE id=${jobA.conversation_id}`;
 assert.equal(outbox.user_id,recipient.user_id);
 await sql`SELECT sales_finish_send(${jobA.id},${jobA.claim_token},1000)`;
 // Disable must wait for the other conversation's row lock, not mutate only one chat.
 let unlock,lockedSignal;const locked=new Promise(resolve=>lockedSignal=resolve),hold=new Promise(resolve=>unlock=resolve);
 const locking=workerA.begin(async tx=>{await tx`SELECT id FROM sales_conversations WHERE id=${other.job.conversation_id} FOR UPDATE`;lockedSignal();await hold;});
 await locked;
 const [{pid}]=await workerB`SELECT pg_backend_pid() pid`;
 const disable=workerB`SELECT sales_control(${campaign},'disable',${template.test_user_id}) disabled`.execute();
 let waits=false;
 for(let i=0;i<100;i++){const [activity]=await sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;if(activity?.wait_event_type==='Lock'){waits=true;break}await new Promise(resolve=>setTimeout(resolve,20));}
 unlock();await locking;await disable;assert.ok(waits,'disable must lock all customer conversations');
 const [counts]=await sql`SELECT count(*)::int total,count(*) FILTER(WHERE human_hold)::int held FROM sales_conversations WHERE campaign_id=${campaign}`;
 assert.deepEqual(counts,{total:2,held:2});
 assert.equal((await sql`SELECT sales_begin_send(${other.job.id},${other.job.claim_token},'{}') sent`)[0].sent,false);
 assert.equal((await sql`SELECT count(*)::int n FROM notification_outbox`)[0].n,1);
 console.log('PASS: parallel workers claim different customers; duplicate dispatch has one exact recipient; disable locks and holds both chats.');
} finally {await Promise.all([sql.end({timeout:1}),workerA.end({timeout:1}),workerB.end({timeout:1})]);}
