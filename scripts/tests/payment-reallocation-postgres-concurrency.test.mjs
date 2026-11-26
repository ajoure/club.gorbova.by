// Real PostgreSQL 17 sessions, synthetic fixture, isolated private Unix socket.
// No network, production credentials, existing cluster or customer data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const bin=process.env.PAYMENT_REALLOCATION_PG_BIN||'/opt/homebrew/opt/postgresql@17/bin';
const temp=mkdtempSync('/Users/fs/CodexWorkspace/Temp/payment-reallocation-pg17-');
const data=join(temp,'data'),socket=join(temp,'socket');mkdirSync(socket);
const run=(program,args)=>{const r=spawnSync(join(bin,program),args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
const args=['-h',socket,'-p','55437','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>run('psql',[...args,'-c',q]).trim();
function sqlAsync(q){return new Promise((ok,bad)=>{const p=spawn(join(bin,'psql'),[...args,'-c',q]);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('exit',c=>c===0?ok(out.trim()):bad(Error(err)));});}
function session(){const p=spawn(join(bin,'psql'),args);let stderr='';p.stderr.on('data',d=>stderr+=d);const lines=createInterface({input:p.stdout})[Symbol.asyncIterator]();return {async query(q){p.stdin.write(q+"\nselect 'STEP_DONE';\n");let out=[];for(;;){const l=await lines.next();if(l.done)throw Error(stderr);if(l.value==='STEP_DONE')return out.join('\n');out.push(l.value);}},async failing(q,expected){const done=new Promise(ok=>p.on('exit',ok));p.stdin.end(q+'\n');const code=await done;assert.notEqual(code,0);assert.match(stderr,new RegExp(expected));},close(){p.stdin.end('rollback;\n\\q\n');}};}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const club='11c9f1b8-0355-4753-bd74-40b42aa53616',bbb='85046734-2282-4ded-b0d3-8c66c8f5bc2b';
const source=readFileSync(join(root,'src/lib/payment-reallocation.sql.test.ts'),'utf8');
const templates=[...source.matchAll(/await db\.exec\(`([\s\S]*?)`\);/g)].slice(0,2);
const evaluate=t=>new Function('id','club','bbb','return `'+t+'`;')(id,club,bbb);
const fixture=evaluate(templates[1][1]);
const actor=`select set_config('test.actor','${id(99)}',false);`;
const hash=()=>sql(actor+`select admin_preview_payment_reallocation('${id(1)}','${id(3)}')->>'before_hash'`).split('\n').at(-1);
const commit=(h,request=id(30))=>actor+`select admin_commit_payment_reallocation('${request}','${id(1)}','${id(3)}','${h}','Customer requested correction')->>'replayed';`;
const fullGraph=()=>sql(`select jsonb_build_object(${['orders_v2','payments_v2','subscriptions_v2','provider_subscriptions','entitlements','entitlement_sources','access_grant_ledger','order_groups','order_group_items','payment_allocations','telegram_access_grants','telegram_access','payment_reallocations','audit_logs'].map(t=>`'${t}',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from ${t} x)`).join(',')})`);
test('isolated PostgreSQL 17 exact stale-reader interleavings',async t=>{
  assert.match(run('postgres',['--version']),/PostgreSQL\) 17\./);
  run('initdb',['-D',data,'-A','trust','--no-locale','--encoding=UTF8']);
  run('pg_ctl',['-D',data,'-l',join(temp,'server.log'),'-o',`-h '' -k '${socket}' -p 55437`,'-w','start']);
  try{
    sql(evaluate(templates[0][1]));sql(readFileSync(join(root,'supabase/migrations/20261126133000_contact_payment_reallocation.sql'),'utf8'));
    for(const [name,read,write,error] of [
      ['primary entitlement',`select * from entitlements where id='${id(13)}'`,`update entitlements set expires_at=s.expires_at,meta=s.meta,order_id=s.order_id from stale s where entitlements.id=s.id`,'reallocation_stale_entitlement_meta'],
      ['primary date-only',`select * from entitlements where id='${id(13)}'`,`update entitlements set expires_at=s.expires_at from stale s where entitlements.id=s.id`,'reallocation_stale_entitlement_window'],
      ['target order collision cleanup',`select * from entitlements where id='${id(14)}'`,`update entitlements set order_id=null from stale s where entitlements.id=s.id`,'reallocation_stale_entitlement_window'],
      ['bonus date-only',`select * from entitlements where id='${id(101)}'`,`update entitlements set expires_at=s.expires_at from stale s where entitlements.id=s.id`,'reallocation_stale_entitlement_window'],
      ['subscription date-only',`select * from subscriptions_v2 where id='${id(9)}'`,`update subscriptions_v2 set access_end_at=s.access_end_at from stale s where subscriptions_v2.id=s.id`,'reallocation_stale_subscription_window'],
      ['bonus entitlement',`select * from entitlements where id='${id(101)}'`,`update entitlements set expires_at=s.expires_at,meta=s.meta from stale s where entitlements.id=s.id`,'reallocation_stale_entitlement_meta'],
      ['bonus metadata only',`select * from entitlements where id='${id(101)}'`,`update entitlements set meta=s.meta from stale s where entitlements.id=s.id`,'reallocation_stale_entitlement_meta'],
      ['shared subscription',`select * from subscriptions_v2 where id='${id(9)}'`,`update subscriptions_v2 set access_end_at=s.access_end_at,meta=s.meta from stale s where subscriptions_v2.id=s.id`,'reallocation_stale_source_subscription'],
      ['order marker',`select * from orders_v2 where id='${id(4)}'`,`update orders_v2 set meta=s.meta from stale s where orders_v2.id=s.id`,'reallocation_stale_order_write'],
      ['Telegram grant',`select * from telegram_access_grants where id='${id(22)}'`,`update telegram_access_grants set club_id=s.club_id,end_at=s.end_at from stale s where telegram_access_grants.id=s.id`,'reallocation_stale_telegram_grant'],
      ['independent entitlement source',`select * from entitlements where id='${id(13)}'`,`insert into entitlement_sources(id,user_id,product_id,order_id) select '${id(802)}'::uuid,user_id,product_id,order_id from stale`,'reallocation_stale_entitlement_source'],
      ['successful grant ledger',`select * from access_grant_ledger where id='${id(301)}'`,`insert into access_grant_ledger select '${id(801)}'::uuid,user_id,source_order_id,reason_code,status,result,now() from stale`,'reallocation_stale_grant_ledger'],
      ['Telegram aggregate',`select * from telegram_access where id='${id(25)}'`,`update telegram_access set active_until=s.active_until from stale s where telegram_access.id=s.id`,'reallocation_stale_telegram_projection'],
    ]) await t.test(`stale ${name} read -> correction commit -> stale write refused`,async()=>{
      sql(fixture);const a=session();await a.query('begin;create temp table stale as '+read+';');
      sql(commit(hash()));const after=fullGraph();await a.failing(write+';commit;',error);
      assert.equal(fullGraph(),after,'stale write must leave every financial/access/audit row unchanged');
    });
    await t.test('a stale UPDATE dispatched before correction transaction commits sees the committed fence after row-lock wait',async()=>{
      sql(fixture);const a=session(),b=session();
      await a.query(`set application_name='reallocation_stale_wait';begin;create temp table stale as select * from entitlements where id='${id(101)}';`);
      await b.query('begin;'+commit(hash()));
      const pending=a.failing(`update entitlements set expires_at=s.expires_at,meta=s.meta from stale s where entitlements.id=s.id;commit;`,'reallocation_stale_entitlement_meta');
      // Session B still owns the entitlement row. A's UPDATE can only acquire
      // the corrected row after B commits; its statement snapshot is older.
      let waiting=false;const deadline=Date.now()+3000;
      while(Date.now()<deadline){if(await sqlAsync("select exists(select 1 from pg_stat_activity where application_name='reallocation_stale_wait' and wait_event_type='Lock')")==='t'){waiting=true;break;}}
      assert.equal(waiting,true,'prove the stale statement is waiting on B before its COMMIT');
      await b.query('commit;');b.close();await pending;
      assert.equal(sql(`select expires_at::date from entitlements where id='${id(101)}'`),'2029-12-10');
    });
    await t.test('two simultaneous exact requests credit once and audit once',async()=>{
      sql(fixture);const h=hash();const r=await Promise.all([sqlAsync(commit(h)),sqlAsync(commit(h))]);
      assert.deepEqual(r.map(v=>v.split('\n').at(-1)).sort(),['false','true']);
      assert.equal(sql('select count(*) from payment_reallocations'),'1');
      assert.equal(sql("select count(*) from audit_logs where action='payment.product_reallocated'"),'1');
      assert.equal(sql('select count(*)||\':\'||sum(amount) from payments_v2'),'2:500');
    });
    await t.test('final audit failure rolls back the full graph',async()=>{
      sql(fixture);const h=hash();sql("create or replace function synthetic_failure() returns trigger language plpgsql as $$begin raise exception 'injected_failure';end$$;create trigger synthetic_failure before insert on audit_logs for each row execute function synthetic_failure();");
      const before=fullGraph();await assert.rejects(sqlAsync(commit(h)),/injected_failure/);assert.equal(fullGraph(),before);
    });
    await t.test('fresh legitimate future Club payment extends primary, subscription and bonus',()=>{
      sql(fixture);sql(commit(hash()));
      sql(`insert into orders_v2(id,profile_id,user_id,product_id,status,currency,final_price,paid_amount) values('${id(50)}','${id(1)}','${id(2)}','${club}','paid','BYN',250,250);
        insert into payments_v2(id,order_id,profile_id,user_id,status,currency,amount,paid_at) values('${id(51)}','${id(50)}','${id(1)}','${id(2)}','succeeded','BYN',250,now());
        update subscriptions_v2 set access_end_at=access_end_at+interval '1 month',next_charge_at=next_charge_at+interval '1 month',meta=jsonb_set(meta,'{extended_by_orders}',meta->'extended_by_orders'||jsonb_build_array('${id(50)}')) where id='${id(9)}';
        update entitlements set expires_at=expires_at+interval '1 month',order_id='${id(50)}' where id='${id(13)}';
        update entitlements set expires_at=expires_at+interval '1 month',meta=meta||jsonb_build_object('source_order_id','${id(50)}') where id='${id(101)}';`);
      assert.equal(sql(`select expires_at::date from entitlements where id='${id(13)}'`),'2030-01-10');
      assert.equal(sql(`select expires_at::date from entitlements where id='${id(101)}'`),'2030-01-10');
    });
    writeFileSync(join(temp,'RESULT.json'),JSON.stringify({status:'PASS',postgres:run('postgres',['--version']).trim(),synthetic:true,production:false,tests:17},null,2));
    console.log('Private PostgreSQL evidence:',temp);
  }finally{run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
});
