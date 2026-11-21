import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';

// Destructive synthetic fixture: never accept a production or default database.
assert.equal(process.env.TELEGRAM_FUNNEL_NATIVE_TEST,'1');
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'telegram_funnel_native_test');
assert.ok(Number(process.env.PGPORT)>0);
const quote=x=>`'${String(x).replaceAll("'","''")}'`;
const json=x=>`${quote(JSON.stringify(x))}::jsonb`;
const admin=randomUUID(),user=randomUUID(),bot=randomUUID(),profile=randomUUID();
const everyone={version:1,root:{id:'active-profile',kind:'field',field:'status',operator:'eq',value:'active'}};
const service=sql=>`SET ROLE service_role; ${sql}`;
const asAdmin=sql=>`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(admin)},false); ${sql}`;
const rpc=(name,args)=>`SELECT to_jsonb(public.${name}(${args.join(',')})) AS result`;
function session(sql,name='funnel-fixture',hold=false){
 const child=spawn(process.env.PSQL_BIN||'psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});
 let out='',err='',readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 child.stdout.on('data',b=>{out+=b;if(out.includes('FENCE_READY'))readyResolve();});
 child.stderr.on('data',b=>err+=b);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{if(code!==0){const e=Error(`psql ${name}: ${err}`);readyReject(e);reject(e);}else resolve(out);});});
 // Handle rejected ready for ordinary non-held sessions too.
 ready.catch(()=>{});done.catch(()=>{});
 const prefix="SET statement_timeout='12s'; SET lock_timeout='10s';\n";
 if(hold)child.stdin.write(prefix+`BEGIN; ${sql}; SELECT 'FENCE_READY';\n`);
 else child.stdin.end(prefix+sql+';\n');
 return {done,ready,commit:()=>child.stdin.end('COMMIT;\n'),rollback:()=>child.stdin.end('ROLLBACK;\n')};
}
const run=sql=>session(sql).done;
const result=text=>{
 const line=text.split('\n').find(x=>x.startsWith('{')||x.startsWith('['));
 assert.ok(line,'a non-void RPC must return its JSON result');
 return JSON.parse(line);
};
const call=async(name,args,adminCall=false)=>{
 const output=await run((adminCall?asAdmin:service)(rpc(name,args)));
 // Stop has a SQL void contract, unlike the state-bearing claim/finish RPCs.
 return name==='telegram_funnel_stop_launch'?null:result(output);
};
async function blocked(name){
 for(let n=0;n<150;n++){
  if((await run(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${quote(name)} AND wait_event_type='Lock'`)).trim()==='1')return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail(`${name} did not wait on a real PostgreSQL lock`);
}
async function race(firstSql,secondSql,label,adminCall=false){
 const wrap=adminCall?asAdmin:service;
 const first=session(wrap(firstSql),`${label}-first`,true);
 await first.ready;
 const second=session(wrap(secondSql),`${label}-second`);
 try{await blocked(`${label}-second`);}finally{first.commit();}
 return [result(await first.done),result(await second.done)];
}
await run(`DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
 END $$;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES(${quote(admin)}),(${quote(user)});
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1=${quote(admin)}::uuid $$;
 CREATE FUNCTION public.has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
 CREATE TABLE telegram_bots(id uuid PRIMARY KEY,status text); INSERT INTO telegram_bots VALUES(${quote(bot)},'active');
 CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),telegram_user_id bigint UNIQUE,telegram_link_bot_id uuid,is_archived boolean DEFAULT false,
 full_name text,country text,city text,source text,status text DEFAULT 'active',marketing_consent boolean,was_club_member boolean,merged_to_profile_id uuid,telegram_link_status text DEFAULT 'active');
 INSERT INTO profiles(id,user_id,telegram_user_id,telegram_link_bot_id) VALUES(${quote(profile)},${quote(user)},100,${quote(bot)});
 CREATE TABLE telegram_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,bot_id uuid,telegram_user_id bigint,transport text,direction text DEFAULT 'incoming',status text DEFAULT 'received');
 CREATE TABLE flows(id uuid PRIMARY KEY,start_date timestamptz);
 CREATE TABLE orders_v2(id uuid PRIMARY KEY,profile_id uuid,user_id uuid,product_id uuid,tariff_id uuid,flow_id uuid,status text,is_deleted boolean,is_trial boolean,
 meta jsonb,purchase_snapshot jsonb,final_price numeric,currency text,reconcile_source text,deal_date timestamptz);
 CREATE TABLE payments_v2(id uuid PRIMARY KEY,order_id uuid,is_deleted boolean,status text,transaction_type text,currency text,amount numeric,refunded_amount numeric);
 CREATE TABLE entitlements(id uuid PRIMARY KEY,profile_id uuid,user_id uuid,product_id uuid,order_id uuid,status text,expires_at timestamptz,meta jsonb);
 CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY,profile_id uuid,user_id uuid,product_id uuid,tariff_id uuid,flow_id uuid,order_id uuid,status text,
 access_start_at timestamptz,access_end_at timestamptz,is_trial boolean,meta jsonb);
 GRANT USAGE ON SCHEMA auth TO authenticated,service_role; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role`);
const migration=await readFile(new URL('../../supabase/migrations/20261120100609_telegram_funnel_buttons.sql',import.meta.url),'utf8');
await run(migration);
const audienceMigration=await readFile(new URL('../../supabase/migrations/20261120135114_telegram_funnel_bulk_audience.sql',import.meta.url),'utf8');
await run(audienceMigration);
const finishMigration=await readFile(new URL('../../supabase/migrations/20261121120000_telegram_funnel_finish_button.sql',import.meta.url),'utf8');
await run(finishMigration);
const imageTextMigration=await readFile(new URL('../../supabase/migrations/20261121180000_telegram_funnel_long_image_text.sql',import.meta.url),'utf8');
await run(imageTextMigration);
let passes=0;
async function fixture(scheduledAt=null,finish=false){
 const funnel=randomUUID(),launch=randomUUID(),a=randomUUID(),b=randomUUID(),c=randomUUID(),ab=randomUUID(),ac=randomUUID();
 const graph=[{id:a,text:'Synthetic start',buttons:[{id:ab,text:'B',kind:'next',target_block_id:b},finish?{id:ac,text:'End',kind:'finish',tag:'Synthetic finished'}:{id:ac,text:'C',kind:'next',target_block_id:c}]},
  ...[b,c].map(id=>({id,text:'Synthetic end',buttons:[{id:randomUUID(),text:'URL',kind:'url',url:'https://example.invalid/'}]}))];
 await call('telegram_funnel_save',[quote(funnel),'0',quote('Concurrency fixture'),quote(a),json(graph),quote('active')],true);
 await call('telegram_funnel_begin_launch',[quote(launch),quote(funnel),'1',quote(bot),json(everyone),'false',scheduledAt?quote(scheduledAt):'NULL'],true);
 const [enrolled]=await call('telegram_funnel_enroll',[quote(launch),`ARRAY[${quote(profile)}]::uuid[]`]);
 // begin_launch atomically materializes recipients. An explicit replay of
 // enroll must preserve that one original start delivery rather than add one.
 const startRows=JSON.parse(await run(`SELECT coalesce(jsonb_agg(d.id),'[]') FROM telegram_funnel_deliveries d JOIN telegram_funnel_enrollments e ON e.id=d.enrollment_id WHERE e.launch_id=${quote(launch)} AND e.profile_id=${quote(profile)} AND d.transition_key='start'`));
 assert.equal(startRows.length,1);
 const hashes=[randomUUID(),randomUUID()].map(x=>createHash('sha256').update(x).digest('hex'));
 const tokens=[{button_id:ab,token_hash:hashes[0]},{button_id:ac,token_hash:hashes[1]}];
 return {funnel,launch,...enrolled,delivery_id:startRows[0],tokens,hashes,a,b,c,graph};
}
// The second session must block while the first session holds the enrollment row.
let f=await fixture();
let args=[quote(f.delivery_id),json(f.tokens)];
let [one,two]=await race(rpc('telegram_funnel_claim_send',args),rpc('telegram_funnel_claim_send',args),'send-claim');
assert.equal(one.state,'claimed');assert.equal(two.state,'sending');passes++;
await call('telegram_funnel_finish_send',[quote(f.delivery_id),quote(one.lease_id),quote('sent'),'500','NULL']);
const click=(hash,cb,update)=>rpc('telegram_funnel_claim_callback',[quote(hash),quote(bot),'100','100','500',quote(cb),String(update)]);
[one,two]=await race(click(f.hashes[0],'same-click',1),click(f.hashes[0],'same-click',1),'same-callback');
assert.equal(one.state,'claimed');assert.equal(two.state,'duplicate');assert.equal(one.delivery_id,two.delivery_id);
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_deliveries WHERE enrollment_id=${quote(f.enrollment_id)}`)).trim(),'2');passes++;
// Two different buttons from the same source message remain independently usable.
f=await fixture();let claimed=await call('telegram_funnel_claim_send',[quote(f.delivery_id),json(f.tokens)]);
await call('telegram_funnel_finish_send',[quote(f.delivery_id),quote(claimed.lease_id),quote('sent'),'500','NULL']);
[one,two]=await race(click(f.hashes[0],'branch-b',2),click(f.hashes[1],'branch-c',3),'two-branches');
assert.equal(one.state,'claimed');assert.equal(two.state,'claimed');assert.notEqual(one.delivery_id,two.delivery_id);
assert.equal((await run(`SELECT count(DISTINCT block_id) FROM telegram_funnel_deliveries WHERE source_delivery_id=${quote(f.delivery_id)}`)).trim(),'2');passes++;
// A scheduled launch materializes its immutable audience now, but a concurrent
// dispatcher cannot claim any send before the due time.
f=await fixture('2100-01-01T00:00:00Z');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_launches WHERE id=${quote(f.launch)} AND prepared_at IS NOT NULL`)).trim(),'1');
args=[quote(f.delivery_id),json(f.tokens)];
[one,two]=await race(rpc('telegram_funnel_claim_send',args),rpc('telegram_funnel_claim_send',args),'before-due');
assert.equal(one.state,'scheduled');assert.equal(two.state,'scheduled');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_callback_tokens WHERE source_delivery_id=${quote(f.delivery_id)}`)).trim(),'0');
await run(`UPDATE telegram_funnel_launches SET scheduled_for=now()-interval '1 second' WHERE id=${quote(f.launch)}`);
const activate=launch=>`SELECT jsonb_build_object('activated',public.telegram_funnel_activate_due(${quote(launch)}))`;
[one,two]=await race(activate(f.launch),activate(f.launch),'due-activation');
assert.equal(one.activated,1);assert.equal(two.activated,0);
[one,two]=await race(rpc('telegram_funnel_claim_send',args),rpc('telegram_funnel_claim_send',args),'after-due');
assert.equal(one.state,'claimed');assert.equal(two.state,'sending');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_deliveries WHERE enrollment_id=${quote(f.enrollment_id)}`)).trim(),'1');passes++;
// A restart scheduled for the future must not revoke today's live buttons.
// Lifecycle replacement happens once when due, under two competing dispatchers.
f=await fixture();claimed=await call('telegram_funnel_claim_send',[quote(f.delivery_id),json(f.tokens)]);
await call('telegram_funnel_finish_send',[quote(f.delivery_id),quote(claimed.lease_id),quote('sent'),'800','NULL']);
const futureRestart=randomUUID();
await call('telegram_funnel_begin_launch',[quote(futureRestart),quote(f.funnel),'1',quote(bot),json(everyone),'true',quote('2100-01-01T00:00:00Z')],true);
assert.equal((await run(`SELECT status FROM telegram_funnel_enrollments WHERE id=${quote(f.enrollment_id)}`)).trim(),'active');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_callback_tokens WHERE enrollment_id=${quote(f.enrollment_id)} AND revoked_at IS NULL`)).trim(),'2');
const oldClick=await call('telegram_funnel_claim_callback',[quote(f.hashes[0]),quote(bot),'100','100','800',quote('before-future-restart'),'80']);
assert.equal(oldClick.state,'claimed');
assert.deepEqual(result(await run(service(activate(futureRestart)))),{activated:0});
await run(`UPDATE telegram_funnel_launches SET scheduled_for=now()-interval '1 second' WHERE id=${quote(futureRestart)}`);
[one,two]=await race(activate(futureRestart),activate(futureRestart),'restart-activation');
assert.equal(one.activated,1);assert.equal(two.activated,0);
assert.equal((await run(`SELECT status FROM telegram_funnel_enrollments WHERE id=${quote(f.enrollment_id)}`)).trim(),'stopped');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_callback_tokens WHERE enrollment_id=${quote(f.enrollment_id)} AND revoked_at IS NULL`)).trim(),'0');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_enrollments WHERE launch_id=${quote(futureRestart)} AND status='active'`)).trim(),'1');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_deliveries d JOIN telegram_funnel_enrollments e ON e.id=d.enrollment_id WHERE e.launch_id=${quote(futureRestart)} AND d.transition_key='start'`)).trim(),'1');passes++;
// A click received after Telegram accepts the send but before its receipt is
// persisted must survive. It is deferred, then resolved once across two sessions.
f=await fixture();claimed=await call('telegram_funnel_claim_send',[quote(f.delivery_id),json(f.tokens)]);
const earlyArgs=[quote(f.hashes[0]),quote(bot),'100','100','502',quote('early-callback'),'4'];
assert.equal((await call('telegram_funnel_claim_callback',earlyArgs)).state,'deferred');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_callback_receipts WHERE token_hash=${quote(f.hashes[0])} AND state='pending'`)).trim(),'1');
[one,two]=await race(rpc('telegram_funnel_finish_send',[quote(f.delivery_id),quote(claimed.lease_id),quote('sent'),'502','NULL']),rpc('telegram_funnel_claim_callback',earlyArgs),'early-receipt');
assert.equal(one.state,'sent');assert.equal(two.state,'claimed');
await call('telegram_funnel_reconcile_callbacks',[quote(f.delivery_id)]);
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_deliveries WHERE source_delivery_id=${quote(f.delivery_id)}`)).trim(),'1');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_callback_receipts WHERE token_hash=${quote(f.hashes[0])} AND state='resolved'`)).trim(),'1');passes++;
// An unconfirmed network result cannot be converted into an automatic resend
// by concurrent clicks or repeated claims of the original send.
f=await fixture();claimed=await call('telegram_funnel_claim_send',[quote(f.delivery_id),json(f.tokens)]);
await call('telegram_funnel_finish_send',[quote(f.delivery_id),quote(claimed.lease_id),quote('unknown'),'NULL',quote('transport_unknown')]);
[one,two]=await race(click(f.hashes[0],'unknown-callback',5),click(f.hashes[0],'unknown-callback',5),'unknown-receipt');
assert.equal(one.state,'deferred');assert.equal(two.state,'deferred');
assert.equal((await call('telegram_funnel_claim_send',[quote(f.delivery_id),json(f.tokens)])).state,'unknown');
assert.deepEqual(await call('telegram_funnel_reconcile_callbacks',[quote(f.delivery_id)]),[]);
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_deliveries WHERE source_delivery_id=${quote(f.delivery_id)}`)).trim(),'0');passes++;
// Stop fences future claims; it does not fabricate cancellation of an in-flight send.
f=await fixture();claimed=await call('telegram_funnel_claim_send',[quote(f.delivery_id),json(f.tokens)]);
assert.equal((await call('telegram_funnel_claim_callback',[quote(f.hashes[0]),quote(bot),'100','100','501',quote('stopped-early-callback'),'6'])).state,'deferred');
await call('telegram_funnel_stop_launch',[quote(f.launch)],true);
const late=await call('telegram_funnel_finish_send',[quote(f.delivery_id),quote(claimed.lease_id),quote('sent'),'501','NULL']);
assert.equal(late.state,'sent');
assert.deepEqual(await call('telegram_funnel_reconcile_callbacks',[quote(f.delivery_id)]),[]);
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_deliveries WHERE source_delivery_id=${quote(f.delivery_id)}`)).trim(),'0');
assert.equal((await run(`SELECT status FROM telegram_funnel_enrollments WHERE id=${quote(f.enrollment_id)}`)).trim(),'stopped');
assert.equal((await call('telegram_funnel_claim_send',[quote(f.delivery_id),json(f.tokens)])).state,'stopped');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_callback_tokens WHERE enrollment_id=${quote(f.enrollment_id)} AND revoked_at IS NULL`)).trim(),'0');passes++;
// Separate launches racing to enroll the same person share the advisory/active-run guard.
f=await fixture();await call('telegram_funnel_stop_launch',[quote(f.launch)],true);
const launchA=randomUUID(),launchB=randomUUID();
[one,two]=await race(rpc('telegram_funnel_begin_launch',[quote(launchA),quote(f.funnel),'1',quote(bot),json(everyone),'false']),rpc('telegram_funnel_begin_launch',[quote(launchB),quote(f.funnel),'1',quote(bot),json(everyone),'false']),'active-run',true);
assert.equal(one.id,launchA);assert.equal(two.id,launchB);
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_enrollments WHERE funnel_id=${quote(f.funnel)} AND status='active'`)).trim(),'1');passes++;
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_deliveries d JOIN telegram_funnel_enrollments e ON e.id=d.enrollment_id WHERE e.launch_id IN(${quote(launchA)},${quote(launchB)}) AND d.transition_key='start'`)).trim(),'1');
// Stopping a definition means stopping all of its launches, as the UI states.
await call('telegram_funnel_save',[quote(f.funnel),'1',quote('Stopped concurrency fixture'),quote(f.a),json(f.graph),quote('stopped')],true);
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_launches WHERE funnel_id=${quote(f.funnel)} AND status='active'`)).trim(),'0');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_enrollments WHERE funnel_id=${quote(f.funnel)} AND status='active'`)).trim(),'0');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_deliveries d JOIN telegram_funnel_enrollments e ON e.id=d.enrollment_id WHERE e.funnel_id=${quote(f.funnel)} AND d.status='queued'`)).trim(),'0');passes++;
// A finish press racing a next press on the same message: the run ends exactly once and no queued step survives.
f=await fixture(null,true);claimed=await call('telegram_funnel_claim_send',[quote(f.delivery_id),json(f.tokens)]);
await call('telegram_funnel_finish_send',[quote(f.delivery_id),quote(claimed.lease_id),quote('sent'),'500','NULL']);
[one,two]=await race(click(f.hashes[1],'finish-press',90),click(f.hashes[0],'next-press',91),'finish-vs-next');
assert.equal(one.state,'finished');assert.ok(['stopped','claimed'].includes(two.state));
assert.equal((await run(`SELECT status||':'||reason FROM telegram_funnel_enrollments WHERE id=${quote(f.enrollment_id)}`)).trim(),'completed:finished_by_button');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_deliveries WHERE enrollment_id=${quote(f.enrollment_id)} AND status='queued'`)).trim(),'0');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_events WHERE enrollment_id=${quote(f.enrollment_id)} AND kind='finished'`)).trim(),'1');
assert.equal((await run(`SELECT count(*) FROM telegram_funnel_profile_tags WHERE profile_id=${quote(profile)} AND tag='Synthetic finished'`)).trim(),'1');passes++;
console.log(`Telegram funnel REAL PostgreSQL two-session concurrency: ${passes} PASS; migration SHA256 ${createHash('sha256').update(migration).digest('hex')}; audience migration SHA256 ${createHash('sha256').update(audienceMigration).digest('hex')}; finish migration SHA256 ${createHash('sha256').update(finishMigration).digest('hex')}`);
