import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { seedFixture, snapshot, input, run, id, end, next } from './provider-billing-fixture.mjs';
const root = new URL('../../', import.meta.url);
const old = readFileSync(new URL('supabase/migrations/20260125141326_d06ffc29-75be-4730-8cd7-01c8f69e8c33.sql', root),'utf8');
const migration = readFileSync(new URL('supabase/migrations/20261020202000_preserve_provider_billing_schedule.sql', root),'utf8');
const fixture = () => seedFixture(new PGlite());

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
