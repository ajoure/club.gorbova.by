import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');
const db=new PGlite();const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),user=id(2),bot=id(3),profile=id(4),funnel=id(5),launch=id(6),a=id(7),b=id(8),c=id(9),ab=id(10),ac=id(11),ba=id(12),url=id(13);
await db.exec(readFileSync(new URL('./fixtures/telegram-funnel-base.sql',import.meta.url),'utf8'));

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
await role('authenticated',admin,()=>rpc('telegram_funnel_begin_launch',[launch,funnel,1,bot,{version:1,root:{id:'status',kind:'field',field:'status',operator:'eq',value:'active'}},false]));
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
await role('authenticated',admin,()=>rpc('telegram_funnel_begin_launch',[id(30),funnel,1,bot,{version:1,root:{id:'status',kind:'field',field:'status',operator:'eq',value:'active'}},true]));await assert.rejects(rpc('telegram_funnel_enroll',[id(30),[profile]]),/funnel_unresolved_delivery/);ok();
await role('authenticated',admin,()=>rpc('telegram_funnel_stop_launch',[launch]));assert.equal((await rpc('telegram_funnel_claim_send',[loop.delivery_id,[]])).state,'stopped');assert.equal((await rpc('telegram_funnel_claim_callback',[hashes[0],bot,100,100,500,'after-stop',5])).state,'stopped');ok();
await assert.rejects(rpc('telegram_funnel_validate_graph',[a,[{id:a,text:'Bad',buttons:[{id:ab,text:'Bad',kind:'next',target_block_id:id(99)}]}]]),/funnel_target_invalid/);await assert.rejects(rpc('telegram_funnel_validate_graph',[a,[{id:a,text:'Bad',buttons:[{id:ab,text:'Bad',kind:'url',url:'javascript:alert(1)'}]}]]),/funnel_url_invalid/);ok();
await rpc('telegram_funnel_validate_graph',[a,[...graph,...Array.from({length:9},(_,i)=>({id:id(100+i),text:'Extra',buttons:[{id:url,text:'URL',kind:'url',url:'https://example.invalid/'}]}))]]);ok();

const segment={version:1,root:{id:'s',kind:'field',field:'status',operator:'eq',value:'active'}};
const audience=await role('authenticated',admin,()=>rpc('telegram_funnel_audience',[segment,bot,0,50]));assert.equal(audience.total,1);assert.equal(audience.available_count,1);ok();
await role('authenticated',user,()=>assert.rejects(rpc('telegram_funnel_audience',[segment,bot,0,50]),/communication_manage_required/));await assert.rejects(rpc('telegram_funnel_audience_service',[{version:1,root:{id:'bad',kind:'arbitrary'}},bot,0,50]),/funnel_segment_kind_invalid/);await assert.rejects(rpc('telegram_funnel_audience_service',[segment,bot,0,null]),/funnel_page_invalid/);ok();
await role('authenticated',admin,()=>rpc('telegram_funnel_set_tags',[profile,['Irina audience','Irina audience']]));assert.equal((await rpc('telegram_funnel_profile_facts',[profile])).tags.length,1);assert.equal(await rpc('telegram_funnel_segment_matches',[profile,{id:'tag',kind:'tag',tag:'Irina audience',negate:false}]),true);ok();
const product=id(80),flow=id(81),orderId=id(82);
await db.query("INSERT INTO flows VALUES($1,'2024-09-01T09:00:00Z')",[flow]);
await db.query("INSERT INTO orders_v2(id,profile_id,user_id,product_id,tariff_id,flow_id,status,final_price,currency) VALUES($1,$2,$3,$4,$5,$6,'paid',250,'BYN')",[orderId,profile,user,product,id(83),flow]);
assert.equal((await rpc('telegram_funnel_profile_facts',[profile])).purchases.length,0);
await db.query("INSERT INTO payments_v2(order_id,status,amount,currency,transaction_type) VALUES($1,'succeeded',249,'BYN','payment')",[orderId]);assert.equal((await rpc('telegram_funnel_profile_facts',[profile])).purchases.length,0);
await db.query("INSERT INTO payments_v2(order_id,status,amount,currency,transaction_type) VALUES($1,'succeeded',1,'BYN','payment')",[orderId]);assert.equal((await rpc('telegram_funnel_profile_facts',[profile])).purchases.length,1);assert.equal((await rpc('telegram_funnel_profile_facts',[profile])).participations.length,0);ok();
await db.query("INSERT INTO subscriptions_v2(profile_id,user_id,product_id,tariff_id,flow_id,order_id,status,access_start_at,access_end_at) VALUES($1,$2,$3,$4,$5,$6,'expired','2024-09-01','2025-05-01')",[profile,user,product,id(83),flow,orderId]);
assert.equal(await rpc('telegram_funnel_segment_matches',[profile,{id:'year',kind:'year',product_id:product,year:2024,negate:false}]),true);
await db.query("INSERT INTO entitlements(profile_id,user_id,product_id,status) VALUES($1,$2,$3,'expired')",[profile,user,product]);assert.equal(await rpc('telegram_funnel_segment_matches',[profile,{id:'year',kind:'year',product_id:product,year:2023,negate:true}]),false);ok();
await db.query('UPDATE payments_v2 SET refunded_amount=1 WHERE order_id=$1',[orderId]);assert.equal((await rpc('telegram_funnel_profile_facts',[profile])).purchases.length,0);ok();
async function newEnrollment(n,blocks=graph,scheduled=null){
 const fid=id(n),lid=id(n+1);await role('authenticated',admin,()=>rpc('telegram_funnel_save',[fid,0,'Synthetic '+n,blocks[0].id,blocks,'active']));
 await role('authenticated',admin,()=>rpc('telegram_funnel_begin_launch',[lid,fid,1,bot,segment,false,scheduled]));
 const en=(await rpc('telegram_funnel_enroll',[lid,[profile]]))[0];return{...en,fid,lid};
}
const terminal=await newEnrollment(100,[{id:c,text:'Done',buttons:[]}],'2100-01-01T00:00:00Z');assert.equal((await rpc('telegram_funnel_claim_send',[terminal.delivery_id,[]])).state,'scheduled');
await db.query("UPDATE telegram_funnel_launches SET scheduled_for=now()-interval '1 second' WHERE id=$1",[terminal.lid]);const term=await rpc('telegram_funnel_claim_send',[terminal.delivery_id,[]]);await rpc('telegram_funnel_finish_send',[terminal.delivery_id,term.lease_id,'sent',700,null]);assert.equal(await scalar('SELECT status AS v FROM telegram_funnel_enrollments WHERE id=$1',[terminal.enrollment_id]),'completed');ok();
const link=await newEnrollment(110,[graph[2]]);const lc=await rpc('telegram_funnel_claim_send',[link.delivery_id,[]]);await rpc('telegram_funnel_prepare_links',[link.delivery_id,lc.lease_id,[{button_id:url,token_hash:'f'.repeat(64)}]]);
assert.equal((await rpc('telegram_funnel_track_link',['f'.repeat(64),false])).ok,false);await rpc('telegram_funnel_finish_send',[link.delivery_id,lc.lease_id,'sent',701,null]);await rpc('telegram_funnel_track_link',['f'.repeat(64),true]);await rpc('telegram_funnel_track_link',['f'.repeat(64),false]);await rpc('telegram_funnel_track_link',['f'.repeat(64),false]);
const report=await role('authenticated',admin,()=>rpc('telegram_funnel_report',[link.fid,null,null,0,50]));assert.equal(report.summary.url_clicked,2);assert.equal(report.button_stats[0].clicked,2);assert.equal(report.button_stats[0].unique_clicked,1);assert.equal(report.block_stats[0].received,1);const history=await role('authenticated',admin,()=>rpc('telegram_funnel_history',[link.enrollment_id,0,50]));assert.equal(history.deliveries[0].block.id,c);ok();
for(const [n,mode]of [[120,'sent'],[130,'unknown'],[140,'stopped']]){
 const en=await newEnrollment(n);const h1=String(n).padEnd(64,'a'),h2=String(n).padEnd(64,'b');
 const claim=await rpc('telegram_funnel_claim_send',[en.delivery_id,[{button_id:ab,token_hash:h1},{button_id:ac,token_hash:h2}]]);
 const args=[h1,bot,100,100,800+n,'early-'+n,n];assert.equal((await rpc('telegram_funnel_claim_callback',args)).state,'deferred');assert.equal((await rpc('telegram_funnel_claim_callback',args)).state,'deferred');
 if(mode==='stopped')await role('authenticated',admin,()=>rpc('telegram_funnel_stop_launch',[en.lid]));
 await rpc('telegram_funnel_finish_send',[en.delivery_id,claim.lease_id,mode==='unknown'?'unknown':'sent',mode==='unknown'?null:800+n,null]);
 const children=await rpc('telegram_funnel_reconcile_callbacks',[en.delivery_id]);assert.equal(children.length,mode==='sent'?1:0);assert.equal(await scalar('SELECT count(*)::int AS v FROM telegram_funnel_deliveries WHERE enrollment_id=$1',[en.enrollment_id]),mode==='sent'?2:1);
 if(mode==='stopped')assert.equal(await scalar('SELECT status AS v FROM telegram_funnel_enrollments WHERE id=$1',[en.enrollment_id]),'stopped');
 if(mode==='unknown')assert.equal((await rpc('telegram_funnel_claim_send',[en.delivery_id,[]])).state,'unknown');ok();
}

// NULL is an explicit filterable field state; it must not disappear from the base audience.
const ownProfile=id(200);await db.query('INSERT INTO profiles(id,user_id,telegram_user_id,telegram_link_bot_id,status)VALUES($1,$2,200,$3,NULL)',[ownProfile,admin,bot]);
const unset={version:1,root:{id:'unset',kind:'field',field:'status',operator:'is_not_set'}};
assert.equal((await role('authenticated',admin,()=>rpc('telegram_funnel_audience',[unset,bot,0,50]))).total,1);assert.equal((await role('authenticated',admin,()=>rpc('telegram_funnel_audience',[segment,bot,0,50]))).total,1);ok();
await role('authenticated',admin,()=>assert.rejects(rpc('telegram_funnel_set_tags',[profile,['x'.repeat(81)]]),/funnel_tags_invalid/));assert.equal(await scalar('SELECT count(*)::int AS v FROM audit_logs WHERE action=\'telegram_funnel.manual_tags.updated\''),1);ok();
// Test-on-self never derives identity from a client profile argument; draft graph is allowed.
const selfFunnel=id(210),selfLaunch=id(211);await role('authenticated',admin,()=>rpc('telegram_funnel_save',[selfFunnel,0,'Draft self',c,[{id:c,text:'Self terminal',buttons:[]}],'draft']));
const self=await role('authenticated',admin,()=>rpc('telegram_funnel_begin_self_test',[selfLaunch,selfFunnel,1,bot]));assert.equal(self.test_profile_id,ownProfile);await rpc('telegram_funnel_prepare_audience',[selfLaunch]);assert.deepEqual((await db.query('SELECT profile_id FROM telegram_funnel_enrollments WHERE launch_id=$1',[selfLaunch])).rows,[{profile_id:ownProfile}]);ok();
await db.exec(`CREATE OR REPLACE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 IN('${admin}'::uuid,'${user}'::uuid) $$;`);
await role('authenticated',user,()=>assert.rejects(rpc('telegram_funnel_begin_self_test',[selfLaunch,selfFunnel,1,bot]),/funnel_launch_id_conflict/));ok();

// A protected enrollment on an actual partial order proves participation, not full payment.
const partialProduct=id(240),partialOrder=id(241);
await db.query("INSERT INTO orders_v2(id,profile_id,user_id,product_id,status,final_price,currency,flow_id)VALUES($1,$2,$3,$4,'partial',300,'BYN',$5)",[partialOrder,profile,user,partialProduct,flow]);
await db.query("INSERT INTO subscriptions_v2(profile_id,user_id,product_id,order_id,flow_id,status,access_start_at,access_end_at)VALUES($1,$2,$3,$4,$5,'active','2024-01-01','2100-01-01')",[profile,user,partialProduct,partialOrder,flow]);
assert.equal(await rpc('telegram_funnel_segment_matches',[profile,{id:'part',kind:'product',relation:'attended',product_id:partialProduct,negate:false}]),true);assert.equal(await rpc('telegram_funnel_segment_matches',[profile,{id:'part',kind:'product',relation:'purchased',product_id:partialProduct,negate:false}]),false);ok();

// Existing contacts need no fabricated Auth account. Delivery still requires the selected bot dialog.
const legacy=id(250),noDialog=id(251),legacyF=id(252),legacyL=id(253);
await db.query('INSERT INTO profiles(id,user_id,telegram_user_id,telegram_link_bot_id)VALUES($1,NULL,250,NULL),($2,NULL,251,NULL)',[legacy,noDialog]);
await db.query("INSERT INTO telegram_messages(user_id,bot_id,telegram_user_id,transport,direction,status)VALUES($1,$2,250,'bot','incoming','received')",[user,bot]);
await role('authenticated',admin,()=>rpc('telegram_funnel_save',[legacyF,0,'Legacy contacts',c,[{id:c,text:'Legacy',buttons:[]}],'active']));
await role('authenticated',admin,()=>rpc('telegram_funnel_begin_launch',[legacyL,legacyF,1,bot,segment,false]));
const legacyEnroll=await rpc('telegram_funnel_enroll',[legacyL,[legacy,noDialog]]);const le=legacyEnroll.find(v=>v.delivery_id),ls=legacyEnroll.find(v=>!v.delivery_id);assert.ok(le);assert.ok(ls);
assert.equal((await db.query('SELECT user_id FROM telegram_funnel_enrollments WHERE id=$1',[le.enrollment_id])).rows[0].user_id,null);
assert.equal(await scalar('SELECT reason AS v FROM telegram_funnel_enrollments WHERE id=$1',[ls.enrollment_id]),'no_available_telegram_dialog');
assert.equal((await rpc('telegram_funnel_claim_send',[le.delivery_id,[]])).state,'claimed');ok();
// An Auth rebind does not retarget an old recipient or reuse its unconfirmed send.
const rebindF=id(254),rebindL=id(255);await role('authenticated',admin,()=>rpc('telegram_funnel_save',[rebindF,0,'Rebind guard',c,[{id:c,text:'Legacy',buttons:[]}],'active']));await role('authenticated',admin,()=>rpc('telegram_funnel_begin_launch',[rebindL,rebindF,1,bot,segment,false]));
const rebind=(await rpc('telegram_funnel_enroll',[rebindL,[legacy]]))[0];await db.query('UPDATE profiles SET user_id=$1 WHERE id=$2',[user,legacy]);assert.equal((await rpc('telegram_funnel_claim_send',[rebind.delivery_id,[]])).state,'recipient_binding_changed');ok();
await db.close();console.log(`Telegram funnel native SQL ${passes} PASS (PGlite concurrent calls serialized; true multi-session concurrency remains separate)`);
