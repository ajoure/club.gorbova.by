import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');
const db=new PGlite();const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),user=id(2),bot=id(3),profile=id(4),funnel=id(5),launch=id(6),a=id(7),b=id(8),c=id(9),ab=id(10),ac=id(11),ba=id(12),url=id(13);
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${admin}'),('${user}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${admin}'::uuid $$;
 CREATE FUNCTION public.has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
 CREATE TABLE public.telegram_bots(id uuid PRIMARY KEY,status text);INSERT INTO telegram_bots VALUES('${bot}','active');
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),telegram_user_id bigint,telegram_link_bot_id uuid,is_archived boolean DEFAULT false);
 INSERT INTO profiles VALUES('${profile}','${user}',100,'${bot}',false);
 CREATE TABLE public.telegram_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,bot_id uuid,telegram_user_id bigint,transport text);
 GRANT USAGE ON SCHEMA auth TO authenticated,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;`);
await db.exec(readFileSync(new URL('../../supabase/migrations/20261120100609_telegram_funnel_buttons.sql',import.meta.url),'utf8'));
let passes=0;const ok=()=>passes++;
const scalar=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.v;
async function role(name,actor,fn){await db.exec(`SET ROLE ${name}`);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor||'']);try{return await fn()}finally{await db.exec('RESET ROLE')}}
const rpc=(name,args=[])=>scalar(`SELECT to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) AS v`,args);
const graph=[{id:a,text:'Start',buttons:[{id:ab,text:'B',kind:'next',target_block_id:b},{id:ac,text:'C',kind:'next',target_block_id:c},{id:url,text:'URL',kind:'url',url:'https://example.invalid/'}]},
 {id:b,text:'B',buttons:[{id:ba,text:'Again A',kind:'next',target_block_id:a}]},
 {id:c,text:'C',buttons:[{id:url,text:'URL only',kind:'url',url:'https://example.invalid/'}]}];
await role('authenticated',user,async()=>{await assert.rejects(rpc('telegram_funnel_save',[funnel,0,'Denied',a,graph,'active']),/communication_manage_required/);assert.equal(await scalar('SELECT count(*)::int AS v FROM telegram_funnels'),0);});ok();
await role('authenticated',admin,()=>rpc('telegram_funnel_save',[funnel,0,'Synthetic funnel',a,graph,'active']));ok();
await role('authenticated',admin,async()=>{await assert.rejects(rpc('telegram_funnel_save',[funnel,null,'Bad',a,graph,'active']),/funnel_revision_required/);await assert.rejects(rpc('telegram_funnel_save',[funnel,0,'Stale',a,graph,'active']),/funnel_revision_changed/)});ok();
await role('authenticated',admin,()=>assert.rejects(rpc('telegram_funnel_claim_callback',['a'.repeat(64),bot,100,100,500,'forbidden',1]),/permission denied/));ok();
for(const name of ['telegram_funnel_claim_send','telegram_funnel_claim_callback'])assert.equal(await scalar("SELECT has_function_privilege('authenticated',p.oid,'EXECUTE') AS v FROM pg_proc p WHERE p.proname=$1",[name]),false);ok();
await role('authenticated',user,async()=>{assert.equal(await scalar('SELECT count(*)::int AS v FROM telegram_funnels'),0);await assert.rejects(db.exec('SELECT * FROM telegram_funnel_callback_tokens'),/permission denied/)});ok();
await role('authenticated',admin,()=>rpc('telegram_funnel_begin_launch',[launch,funnel,1,bot,{include:[{product_id:id(20),mode:'purchased'}]},false]));
const enrolled=await role('service_role',null,()=>rpc('telegram_funnel_enroll',[launch,[profile]]));const enrollment=enrolled[0].enrollment_id,start=enrolled[0].delivery_id;assert.ok(start);ok();
const duplicate=await role('service_role',null,()=>rpc('telegram_funnel_enroll',[launch,[profile]]));assert.equal(duplicate[0].enrollment_id,enrollment);ok();
const hashes=['a'.repeat(64),'b'.repeat(64)];const claim=await role('service_role',null,()=>rpc('telegram_funnel_claim_send',[start,[{button_id:ab,token_hash:hashes[0]},{button_id:ac,token_hash:hashes[1]}]]));assert.equal(claim.state,'claimed');assert.equal((await rpc('telegram_funnel_claim_send',[start,[]])).state,'sending');ok();
await rpc('telegram_funnel_finish_send',[start,claim.lease_id,'sent',500,null]);
for(const args of [[id(99),100,100,500],[bot,101,100,500],[bot,100,101,500],[bot,100,100,501]])assert.equal((await rpc('telegram_funnel_claim_callback',[hashes[0],...args,'mismatch',1])).state,'binding_mismatch');ok();
const click=await rpc('telegram_funnel_claim_callback',[hashes[0],bot,100,100,500,'callback-a',2]);assert.equal(click.state,'claimed');
const clicks=await Promise.all([rpc('telegram_funnel_claim_callback',[hashes[0],bot,100,100,500,'callback-a',2]),rpc('telegram_funnel_claim_callback',[hashes[0],bot,100,100,500,'callback-a',2])]);assert.ok(clicks.every(x=>x.state==='duplicate'));assert.equal(await scalar('SELECT count(*)::int AS v FROM telegram_funnel_deliveries WHERE enrollment_id=$1',[enrollment]),2);ok();
// Independent event identity is consumed before transition creation.
assert.equal((await rpc('telegram_funnel_claim_callback',[hashes[1],bot,100,100,500,'callback-a',99])).state,'duplicate');assert.equal((await rpc('telegram_funnel_claim_callback',[hashes[1],bot,100,100,500,'other-callback',2])).state,'duplicate');ok();
const branch=await rpc('telegram_funnel_claim_callback',[hashes[1],bot,100,100,500,'callback-c',3]);assert.equal(branch.state,'claimed');assert.equal(await scalar('SELECT block_id::text AS v FROM telegram_funnel_deliveries WHERE id=$1',[branch.delivery_id]),c);ok();
const bClaim=await rpc('telegram_funnel_claim_send',[click.delivery_id,[{button_id:ba,token_hash:'c'.repeat(64)}]]);await rpc('telegram_funnel_finish_send',[click.delivery_id,bClaim.lease_id,'sent',501,null]);const loop=await rpc('telegram_funnel_claim_callback',['c'.repeat(64),bot,100,100,501,'loop',4]);assert.equal(await scalar('SELECT block_id::text AS v FROM telegram_funnel_deliveries WHERE id=$1',[loop.delivery_id]),a);assert.notEqual(loop.delivery_id,start);ok();
const unknown=await rpc('telegram_funnel_claim_send',[branch.delivery_id,[]]);await rpc('telegram_funnel_finish_send',[branch.delivery_id,unknown.lease_id,'unknown',null,'transport_unknown']);assert.equal((await rpc('telegram_funnel_claim_send',[branch.delivery_id,[]])).state,'unknown');ok();
await role('authenticated',admin,()=>rpc('telegram_funnel_begin_launch',[id(30),funnel,1,bot,{},true]));await assert.rejects(rpc('telegram_funnel_enroll',[id(30),[profile]]),/funnel_unresolved_delivery/);ok();
await role('authenticated',admin,()=>rpc('telegram_funnel_stop_launch',[launch]));assert.equal((await rpc('telegram_funnel_claim_send',[loop.delivery_id,[]])).state,'stopped');assert.equal((await rpc('telegram_funnel_claim_callback',[hashes[0],bot,100,100,500,'after-stop',5])).state,'stopped');ok();
await assert.rejects(rpc('telegram_funnel_validate_graph',[a,[{id:a,text:'Bad',buttons:[{id:ab,text:'Bad',kind:'next',target_block_id:id(99)}]}]]),/funnel_target_invalid/);await assert.rejects(rpc('telegram_funnel_validate_graph',[a,[{id:a,text:'Bad',buttons:[{id:ab,text:'Bad',kind:'url',url:'javascript:alert(1)'}]}]]),/funnel_url_invalid/);ok();
await rpc('telegram_funnel_validate_graph',[a,[...graph,...Array.from({length:9},(_,i)=>({id:id(100+i),text:'Extra',buttons:[{id:url,text:'URL',kind:'url',url:'https://example.invalid/'}]}))]]);ok();
await db.close();console.log(`Telegram funnel native SQL ${passes} PASS (PGlite concurrent calls serialized; true multi-session concurrency remains separate)`);
