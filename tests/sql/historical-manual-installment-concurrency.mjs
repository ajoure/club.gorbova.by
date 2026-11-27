// Real PostgreSQL, two independent connections; a disposable localhost cluster.
// Never accepts a production URL or credentials. Run with the installed bin dir:
// PG_TEST_BIN=/path/to/postgresql/bin node tests/sql/historical-manual-installment-concurrency.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {bootstrap,ids,args,call,accessCall} from '../edge/historical-manual-fixture.mjs';
const bin=process.env.PG_TEST_BIN;
if(!bin)throw Error('PG_TEST_BIN must name an already installed PostgreSQL bin directory');
const dir=mkdtempSync(join(tmpdir(),'historical-manual-pg-'));
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;await new Promise(resolve=>server.close(resolve));
let started=false;let one,two;
try{
  execFileSync(join(bin,'initdb'),['-D',join(dir,'data'),'-A','trust','--no-locale'],{stdio:'pipe'});
  execFileSync(join(bin,'pg_ctl'),['-D',join(dir,'data'),'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${dir}`,'-w','start'],{stdio:'pipe'});started=true;
  const options={host:'127.0.0.1',port,database:'postgres',max:1,prepare:false,onnotice:()=>{},types:{preciseTime:{to:1184,from:[1184],serialize:x=>typeof x==='string'?x:x.toISOString(),parse:x=>x}}};
  one=postgres(options);two=postgres(options);
  await one.unsafe(bootstrap);await one.unsafe(readFileSync('supabase/migrations/20261126143000_historical_manual_installments.sql','utf8'));
  const p=(await one.unsafe(call,args()))[0].result;
  const confirmed=await Promise.all([one.unsafe(call,args(true,p.fingerprint)),two.unsafe(call,args(true,p.fingerprint))]);
  assert.equal(confirmed[0][0].result.agreement_id,confirmed[1][0].result.agreement_id);
  assert.deepEqual(confirmed.map(x=>x[0].result.reused).sort(),[false,true]);
  assert.equal((await one`SELECT count(*)::int n FROM audit_logs`)[0].n,1);
  assert.equal((await one`SELECT count(*)::int n FROM orders_v2`)[0].n,1);
  assert.equal((await one`SELECT count(*)::int n FROM payments_v2`)[0].n,1);
  const access=await Promise.all([one.unsafe(accessCall,[ids.actor,ids.order,ids.profile]),two.unsafe(accessCall,[ids.actor,ids.order,ids.profile])]);
  assert.deepEqual(access.map(x=>x[0].result.state).sort(),['claimed','unknown']);
  assert.equal((await one`SELECT count(*)::int n FROM historical_manual_access_dispatch`)[0].n,1);
  await assert.rejects(one`UPDATE historical_manual_installments SET total_byn=600`,/historical_manual_agreement_immutable/);
  const sub=(await one`INSERT INTO subscriptions_v2(order_id,user_id,product_id,tariff_id,status,auto_renew,access_start_at,access_end_at)
    VALUES(${ids.order},${ids.user},${ids.product},${ids.tariff},'active',false,now()-interval '2days',now()+interval '178days') RETURNING *`)[0];
  const oldAccess=JSON.stringify(sub);
  const order=(await one`SELECT updated_at::text stamp FROM orders_v2 WHERE id=${ids.order}`)[0];
  const subStamp=(await one`SELECT updated_at::text stamp FROM subscriptions_v2 WHERE id=${sub.id}`)[0];
  const receipts=await one`SELECT id,updated_at::text updated_at FROM payments_v2`;
  const quote={contract_version:1,agreement_model:'historical_manual_installment',original_order_id:ids.order,subscription_v2_id:sub.id,
    total_minor:50000,paid_minor:25000,remaining_minor:25000,schedule_minor:[25000],interval_days:21,payment_type:'one_time',
    fingerprint:'synthetic-current',preserves_purchase:true,changes_access:false};
  const authority=await one`SELECT a.id::text=o.meta->>'historical_manual_agreement_id' id_match,
    a.first_payment_id::text=o.meta->'installment'->>'first_payment_id' receipt_match,
    a.profile_id=o.profile_id profile_match,a.total_byn=(o.meta->'installment'->>'effective_total_byn')::numeric total_match
    FROM historical_manual_installments a JOIN orders_v2 o ON o.id=a.order_id`;
  assert.deepEqual(authority[0],{id_match:true,receipt_match:true,profile_match:true,total_match:true});
  const link=(await one.unsafe('SELECT create_existing_installment_payment_link_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) r',
    [ids.actor,ids.order,sub.id,order.stamp,subStamp.stamp,Array.from(receipts),[],quote,'a'.repeat(48),ids.request,'Confirmed remaining bank debt',false]))[0].r;
  await one`UPDATE payment_links SET meta=jsonb_set(meta,'{repayment,checkout_state}','"ready"') WHERE id=${link.payment_link_id}`;
  const settle="SELECT record_historical_manual_repayment_v1($1,'synthetic-final-uid',25000,'BYN',now()) r";
  const pair=await Promise.all([one.unsafe(settle,[link.payment_link_id]),two.unsafe(settle,[link.payment_link_id])]);
  assert.equal(pair[0][0].r.payment_id,pair[1][0].r.payment_id);
  assert.deepEqual(pair.map(x=>x[0].r.reused).sort(),[false,true]);
  assert.equal((await one`SELECT count(*)::int n FROM payments_v2`)[0].n,2);
  assert.equal((await one`SELECT count(*)::int n FROM audit_logs WHERE action='installment.historical_manual_repayment_recorded'`)[0].n,1);
  assert.equal(JSON.stringify((await one`SELECT * FROM subscriptions_v2 WHERE id=${sub.id}`)[0]),oldAccess);
  assert.deepEqual((await one`SELECT paid_amount::int paid,final_price::int total,status FROM orders_v2`)[0],{paid:500,total:500,status:'paid'});
  console.log('PASS: real PostgreSQL concurrent confirmation → one immutable agreement/audit; concurrent grant → one dispatch; concurrent receipt callback → one final payment/audit; original order and access preserved');
}finally{
  await Promise.all([one?.end(),two?.end()]);
  if(started)execFileSync(join(bin,'pg_ctl'),['-D',join(dir,'data'),'-w','stop'],{stdio:'pipe'});
  rmSync(dir,{recursive:true,force:true});
}
