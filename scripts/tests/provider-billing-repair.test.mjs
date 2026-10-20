import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../../', import.meta.url);
const old = readFileSync(new URL('supabase/migrations/20260125141326_d06ffc29-75be-4730-8cd7-01c8f69e8c33.sql', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20261020202000_preserve_provider_billing_schedule.sql', root), 'utf8');
const repair = readFileSync(new URL('scripts/bepaid/correct-completed-provider-schedule.sql', root), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const end = new Date(Date.now() + 31 * 864e5).toISOString();
const next = new Date(Date.parse(end) - 864e5).toISOString();

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,product_id uuid,tariff_id uuid,order_id uuid,
    billing_type text,auto_renew boolean,status text,canceled_at timestamptz,cancel_at timestamptz,auto_renew_disabled_at timestamptz,
    access_start_at timestamptz,access_end_at timestamptz,next_charge_at timestamptz,meta jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE provider_subscriptions(id uuid PRIMARY KEY,provider text,state text,subscription_v2_id uuid,user_id uuid,
      provider_subscription_id text,next_charge_at timestamptz,meta jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE payment_reconcile_queue(id uuid PRIMARY KEY,status text,attempts integer,bepaid_uid text,
      processed_order_id uuid,matched_order_id uuid,amount numeric,currency text,updated_at timestamptz DEFAULT now());
    CREATE TABLE payments_v2(id uuid PRIMARY KEY,provider text,provider_payment_id text,status text,is_deleted boolean,
      amount numeric,refunded_amount numeric,order_id uuid,user_id uuid,profile_id uuid,currency text,meta jsonb);
    CREATE TABLE orders_v2(id uuid PRIMARY KEY,status text,is_deleted boolean,provider_payment_id text,user_id uuid,
      profile_id uuid,product_id uuid,tariff_id uuid,final_price numeric,currency text,meta jsonb);
    CREATE TABLE entitlements(user_id uuid,product_id uuid,status text,expires_at timestamptz);
    CREATE TABLE access_grant_ledger(source_order_id uuid);
    CREATE TABLE audit_logs(action text,actor_type text,actor_user_id uuid,actor_label text,meta jsonb);
    CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at:=clock_timestamp();RETURN NEW;END$$;
    CREATE TRIGGER touch BEFORE UPDATE ON subscriptions_v2 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`);
  await db.exec(old);
  await db.exec(migration);
  const product = '11c9f1b8-0355-4753-bd74-40b42aa53616';
  const receipt = { source_subscription_id:id(2),target_subscription_id:id(1),queue_id:id(4),payment_uid:'fixture-paid-uid',
    operator_user_id:id(10),billing_review_required:true,billing_policy:'preserve_local_auto_renew' };
  await db.query(`INSERT INTO subscriptions_v2(id,user_id,profile_id,product_id,tariff_id,billing_type,auto_renew,status,access_start_at,access_end_at,next_charge_at,meta)
    VALUES($1,$3,$4,$5,$6,'provider_managed',false,'active','2026-10-14T12:00:00Z',$7,$7,'{"bepaid_subscription_id":"fixture-provider"}'),
      ($2,$3,$4,$5,$6,'mit',false,'superseded','2026-09-14T12:00:00Z',$7,$7,'{}')`,[id(1),id(2),id(8),id(9),product,id(7),end]);
  await db.query('UPDATE subscriptions_v2 SET order_id=$1::uuid,meta=meta||jsonb_build_object(\'initial_order_id\',($1::uuid)::text) WHERE id=$2',[id(11),id(1)]);
  await db.query('UPDATE subscriptions_v2 SET order_id=$1 WHERE id=$2',[id(12),id(2)]);
  await db.query("INSERT INTO provider_subscriptions VALUES($1,'bepaid','active',$2,$3,'fixture-provider',$4,$5,now())",[id(3),id(1),id(8),next,{paid_continuation_repair:receipt}]);
  await db.query("INSERT INTO payment_reconcile_queue VALUES($1,'completed',7,'fixture-paid-uid',$2,$2,100,'BYN',now())",[id(4),id(6)]);
  await db.query("INSERT INTO payments_v2 VALUES($1,'bepaid','fixture-paid-uid','succeeded',false,100,0,$2,$3,$4,'BYN','{}')",[id(5),id(6),id(8),id(9)]);
  await db.query("INSERT INTO payments_v2 VALUES($1,'bepaid','fixture-prior-uid','succeeded',false,100,0,$2,$3,$4,'BYN','{}')",[id(13),id(11),id(8),id(9)]);
  await db.query("INSERT INTO orders_v2 VALUES($1,'paid',false,'fixture-paid-uid',$2,$3,$4,$5,100,'BYN','{\"suppress_notifications\":true}')",[id(6),id(8),id(9),product,id(7)]);
  await db.query("INSERT INTO orders_v2 VALUES($1,'paid',false,'fixture-prior-uid',$3,$4,$5,$6,100,'BYN','{}'),($2,'paid',false,'fixture-source-uid',$3,$4,$5,$6,100,'BYN','{}')",[id(11),id(12),id(8),id(9),product,id(7)]);
  await db.query("INSERT INTO entitlements VALUES($1,$2,'active',$3)",[id(8),product,end]);
  await db.query('INSERT INTO access_grant_ledger VALUES($1)',[id(6)]);
  await db.query("INSERT INTO audit_logs VALUES('bepaid.paid_continuation.relinked','user',$1,'payments-reconcile',$2),('bepaid.paid_continuation.billing_synced','user',$1,'payments-reconcile',$3)",
    [id(10),{queue_id:id(4),payment_uid:'fixture-paid-uid',target_subscription_id:id(1),source_subscription_id:id(2)},
      {queue_id:id(4),payment_uid:'fixture-paid-uid',target_subscription_id:id(1),preserved_auto_renew:false,billing_review_required:true}]);
  return db;
}
const snapshot = async db => (await db.query(`SELECT jsonb_build_object(
  'subscriptions',(SELECT jsonb_agg(s ORDER BY id) FROM subscriptions_v2 s),
  'provider',(SELECT jsonb_agg(p ORDER BY id) FROM provider_subscriptions p),
  'queue',(SELECT jsonb_agg(q ORDER BY id) FROM payment_reconcile_queue q),
  'payments',(SELECT jsonb_agg(p ORDER BY id) FROM payments_v2 p),
  'orders',(SELECT jsonb_agg(o ORDER BY id) FROM orders_v2 o),
  'entitlements',(SELECT jsonb_agg(e) FROM entitlements e),
  'ledger',(SELECT jsonb_agg(l) FROM access_grant_ledger l),
  'audit',(SELECT jsonb_agg(a ORDER BY action) FROM audit_logs a)) value`)).rows[0].value;
async function input(db) {
  const r = (await db.query(`SELECT t.updated_at target,s.updated_at source,ps.updated_at provider,q.updated_at queue,
    md5((to_jsonb(t)-'next_charge_at'-'updated_at')::text) hash FROM subscriptions_v2 t
    JOIN subscriptions_v2 s ON s.id=$2 JOIN provider_subscriptions ps ON ps.id=$3
    JOIN payment_reconcile_queue q ON q.id=$4 WHERE t.id=$1`,[id(1),id(2),id(3),id(4)])).rows[0];
  const iso = v => new Date(v).toISOString();
  // Preserve PostgreSQL microseconds rather than rounding updated_at in JS.
  const times = (await db.query(`SELECT t.updated_at::text target,s.updated_at::text source,ps.updated_at::text provider,q.updated_at::text queue
    FROM subscriptions_v2 t JOIN subscriptions_v2 s ON s.id=$2 JOIN provider_subscriptions ps ON ps.id=$3
    JOIN payment_reconcile_queue q ON q.id=$4 WHERE t.id=$1`,[id(1),id(2),id(3),id(4)])).rows[0];
  return { target_id:id(1),source_id:id(2),provider_row_id:id(3),queue_id:id(4),payment_uid:'fixture-paid-uid',previous_payment_uid:'fixture-prior-uid',
    target_updated_at:times.target,source_updated_at:times.source,provider_updated_at:times.provider,queue_updated_at:times.queue,
    protected_target_md5:r.hash,before_next_charge_at:end,verified_next_charge_at:next,verified_at:iso(new Date()) };
}
async function run(db, v) {
  const literal = `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  assert.equal(repair.split("'__REVIEWED_INPUT_JSON__'::jsonb").length, 2);
  return db.query(repair.replace("'__REVIEWED_INPUT_JSON__'::jsonb", literal));
}

test('exact completed correction changes one date + audit; existing payment/order/access/queue/receipt and false stay intact; replay0',async()=>{
  const db=await fixture();try{
    const before=await snapshot(db);assert.equal((await run(db,await input(db))).rows.length,1);const after=await snapshot(db);
    for(const key of ['provider','queue','payments','orders','entitlements','ledger'])assert.deepEqual(after[key],before[key],key);
    const {updated_at:unusedBefore,next_charge_at:unusedNext,...protectedBefore}=before.subscriptions[0];
    const {updated_at:unusedAfter,next_charge_at:newNext,...protectedAfter}=after.subscriptions[0];
    assert.deepEqual(protectedAfter,protectedBefore);assert.equal(Date.parse(newNext),Date.parse(next));
    assert.deepEqual(after.subscriptions[1],before.subscriptions[1]);assert.equal(after.audit.length,before.audit.length+1);
    assert.equal((await run(db,await input(db))).rows.length,0);assert.deepEqual(await snapshot(db),after);
  }finally{await db.close();}
});

test('changed CAS/receipt/link/UID/consent/access/refund/paid proof rejects without partial writes',async()=>{
  const db=await fixture();try{
    const v=await input(db);const baseline=await snapshot(db);
    for(const mutation of [
      `UPDATE subscriptions_v2 SET auto_renew=true WHERE id='${id(1)}'`,
      `UPDATE subscriptions_v2 SET canceled_at=now() WHERE id='${id(1)}'`,
      `UPDATE subscriptions_v2 SET next_charge_at=next_charge_at+interval '2 days' WHERE id='${id(1)}'`,
      `UPDATE subscriptions_v2 SET access_end_at=access_end_at+interval '1 day' WHERE id='${id(1)}'`,
      `UPDATE provider_subscriptions SET subscription_v2_id='${id(2)}'`,
      `UPDATE provider_subscriptions SET meta='{}'`,
      `UPDATE payment_reconcile_queue SET attempts=8`,
      `UPDATE payment_reconcile_queue SET bepaid_uid='different'`,
      `UPDATE payments_v2 SET refunded_amount=1`,
      `UPDATE orders_v2 SET meta='{\"do_not_grant_access\":true}' WHERE id='${id(11)}'`,
      `UPDATE orders_v2 SET meta='{\"refund_candidate\":true}'`,
      `UPDATE entitlements SET status='revoked'`,
      `DELETE FROM access_grant_ledger`,
      `DELETE FROM audit_logs WHERE action='bepaid.paid_continuation.billing_synced'`,
    ]){
      await db.exec('BEGIN');await db.exec(mutation);
      assert.equal((await run(db,v)).rows.length,0);await db.exec('ROLLBACK');
      assert.deepEqual(await snapshot(db),baseline,'failed repair rolls back the whole transaction');
    }
    const before=await snapshot(db);
    assert.equal((await run(db,{...v,verified_at:new Date(Date.now()-10*60e3).toISOString()})).rows.length,0);
    assert.equal((await run(db,{...v,extra:'no'})).rows.length,0);
    assert.equal((await run(db,{...v,target_updated_at:'2000-01-01T00:00Z'})).rows.length,0);
    assert.equal((await run(db,{...v,payment_uid:"'); DELETE FROM orders_v2; --"})).rows.length,0,'input is an escaped JSON value, never SQL');
    assert.deepEqual(await snapshot(db),before);
  }finally{await db.close();}
});

test('old trigger or zero-row concurrent update aborts date and audit together',async()=>{
  const db=await fixture();try{
    const v=await input(db);const before=await snapshot(db);
    await db.exec(old);await assert.rejects(run(db,v),/division by zero/);assert.deepEqual(await snapshot(db),before);
    await db.exec(migration);
    await db.exec(`CREATE FUNCTION reject_update() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$;
      CREATE TRIGGER reject_update BEFORE UPDATE ON subscriptions_v2 FOR EACH ROW EXECUTE FUNCTION reject_update();`);
    assert.equal((await run(db,v)).rows.length,0);assert.deepEqual(await snapshot(db),before);
  }finally{await db.close();}
});
