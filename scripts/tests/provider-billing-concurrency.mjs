import assert from 'node:assert/strict';
import postgres from 'postgres';
import { seedFixture, snapshot, input, run, repair, id } from './provider-billing-fixture.mjs';

// Synthetic CI database only. Never connect this script to hosted/production data.
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'bepaid_schedule_test');
const client = name => postgres({ host:process.env.PGHOST, port:Number(process.env.PGPORT),
  user:process.env.PGUSER, password:process.env.PGPASSWORD, database:process.env.PGDATABASE,
  max:1, connection:{application_name:name}, onnotice:()=>{} });
const admin=client('bepaid-fixture-admin'),blocker=client('bepaid-flag-blocker'),waiter=client('bepaid-schedule-waiter');
const adapter = sql => ({ exec:s=>sql.unsafe(s), query:async(s,p)=>({rows:await sql.unsafe(s,p)}) });
const db=adapter(admin), waiting=adapter(waiter);
let inTransaction=false;
async function waitForLock() {
  for(let n=0;n<150;n++) {
    const rows=await admin`SELECT wait_event_type FROM pg_stat_activity WHERE application_name='bepaid-schedule-waiter' AND state='active'`;
    if(rows.some(r=>r.wait_event_type==='Lock'))return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('repair did not wait on the competing order row');
}
async function compete(orderId,field,value,source=repair) {
  const v=await input(db);
  await blocker.unsafe('BEGIN');inTransaction=true;
  await blocker.unsafe('UPDATE orders_v2 SET meta=jsonb_build_object($1::text,$2::text) WHERE id=$3::uuid',[field,value,orderId]);
  const pending=run(waiting,v,source);
  await waitForLock();
  await blocker.unsafe('COMMIT');inTransaction=false;
  return pending;
}
try {
  await seedFixture(db);
  for(const orderId of [id(11),id(12)]) for(const [field,value] of [
    ['refund_candidate','true'],['do_not_grant_access','true'],['grant_status','suppressed_post_cancel_charge'],
  ]) {
    const before=await snapshot(db);
    assert.equal((await compete(orderId,field,value)).rows.length,0,`${field} must be rechecked on the locked alias`);
    const after=await snapshot(db);
    for(const key of Object.keys(before).filter(k=>k!=='orders'))assert.deepEqual(after[key],before[key],key);
    await admin.unsafe("UPDATE orders_v2 SET meta='{}' WHERE id=$1::uuid",[orderId]);
  }
  // Negative control: the former snapshot subquery really permits the stale write.
  const direct=`     coalesce(parent_order.meta->>'do_not_grant_access','false')<>'false' OR
     coalesce(parent_order.meta->>'refund_candidate','false')<>'false' OR
     parent_order.meta->>'grant_status'='suppressed_post_cancel_charge' OR
     coalesce(source_order.meta->>'do_not_grant_access','false')<>'false' OR
     coalesce(source_order.meta->>'refund_candidate','false')<>'false' OR
     source_order.meta->>'grant_status'='suppressed_post_cancel_charge' OR`;
  const stale=`     EXISTS(SELECT 1 FROM public.orders_v2 h WHERE h.id IN(parent_order.id,source_order.id) AND
       (coalesce(h.meta->>'do_not_grant_access','false')<>'false' OR coalesce(h.meta->>'refund_candidate','false')<>'false'
        OR h.meta->>'grant_status'='suppressed_post_cancel_charge')) OR`;
  assert.equal(repair.split(direct).length,2);
  assert.equal((await compete(id(11),'refund_candidate','true',repair.replace(direct,stale))).rows.length,1,
    'negative control must reproduce the actual snapshot race');
  console.log('PASS: six two-session locked-order cases update0/audit0; stale snapshot negative control reproduced');
} finally {
  if(inTransaction)await blocker.unsafe('ROLLBACK');
  await Promise.all([admin,blocker,waiter].map(sql=>sql.end({timeout:1})));
}
