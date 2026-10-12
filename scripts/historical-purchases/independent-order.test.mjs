import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, canRead } from './source-window.test.mjs';

const migration = readFileSync(new URL('../../supabase/migrations/20261012063826_purchased_module_independent_source.sql', import.meta.url), 'utf8');
const user = '00000000-0000-4000-8000-000000000001';
const course = '7101ed3c-7839-4a74-ad95-aa0660369b22';
const order = '00000000-0000-4000-8000-000000000020';
const denied = { lessons: 0, blocks: 0, projections: 0, rpc: false };
const allowed = { lessons: 1, blocks: 1, projections: 1, rpc: true };

async function paidFixture() {
  const db = await fixture();
  await db.exec(`CREATE TABLE orders_v2(id uuid PRIMARY KEY,user_id uuid,product_id uuid,
    status text,is_deleted boolean,final_price numeric,paid_amount numeric,meta jsonb DEFAULT '{}');
    CREATE TABLE payments_v2(id uuid PRIMARY KEY,order_id uuid,status text,amount numeric,refunded_amount numeric);
    CREATE TABLE order_group_items(id uuid PRIMARY KEY,order_id uuid);
    CREATE TABLE payment_refund_requests(order_group_item_id uuid,state text,access_action text);
    CREATE TABLE composable_refund_intents(order_group_item_id uuid,status text,access_action text);
    ALTER TABLE entitlements ADD COLUMN order_id uuid;
    UPDATE subscriptions_v2 SET status='expired',access_end_at=now()-interval '1 hour';`);
  await db.query("INSERT INTO orders_v2(id,user_id,product_id,status,is_deleted,final_price,paid_amount) VALUES($1,$2,$3,'paid',false,250,250)", [order,user,course]);
  await db.query("UPDATE entitlements SET order_id=$1,meta=meta || '{\"granted_by\":\"primary_order_fulfillment\"}'::jsonb WHERE product_id=$2", [order,course]);
  // Reproduce the bug before applying the fix at all three reader boundaries.
  assert.deepEqual(await canRead(db), denied);
  await db.exec(migration);
  return db;
}

test('bound paid fulfillment survives stale Business metadata through entitlement, lesson and block RLS', async()=>{
  const db=await paidFixture();try {
    const snapshot=async()=> (await db.query(`SELECT jsonb_build_object(
      'rights',(SELECT jsonb_agg(e ORDER BY id) FROM entitlements e),
      'orders',(SELECT jsonb_agg(o ORDER BY id) FROM orders_v2 o),
      'subscriptions',(SELECT jsonb_agg(s ORDER BY id) FROM subscriptions_v2 s)) state`)).rows[0].state;
    const before=await snapshot();
    assert.deepEqual(await canRead(db),allowed);
    await db.exec(migration);
    assert.deepEqual(await canRead(db),allowed);
    assert.deepEqual(await snapshot(),before,'migration and reads never mutate rights or money');
    await db.exec("UPDATE entitlements SET expires_at=now() WHERE product_id='"+course+"'");
    // Expired rows can remain visible as history; lesson and block access must end.
    const expired=await canRead(db);
    assert.equal(expired.lessons,0);assert.equal(expired.blocks,0);assert.equal(expired.rpc,false);
  }finally{await db.close();}
});

test('history alone, free gifts, unpaid, refunded, deleted or mismatched orders cannot bypass Business expiry', async()=>{
  const db=await paidFixture();try {
    const invalid=[
      "UPDATE entitlements SET meta=jsonb_set(meta,'{granted_by}','\"rule_engine\"') WHERE product_id='"+course+"'",
      'UPDATE entitlements SET order_id=NULL',
      "UPDATE orders_v2 SET status='pending'",
      "UPDATE orders_v2 SET status='refunded'",
      'UPDATE orders_v2 SET is_deleted=true',
      'UPDATE orders_v2 SET final_price=0',
      'UPDATE orders_v2 SET paid_amount=0',
      "UPDATE orders_v2 SET user_id='00000000-0000-4000-8000-000000000099'",
      "UPDATE orders_v2 SET product_id='00000000-0000-4000-8000-000000000098'",
    ];
    for(const sql of invalid){
      await db.exec('BEGIN');await db.exec(sql);
      assert.deepEqual(await canRead(db),denied,sql);await db.exec('ROLLBACK');
    }
    await db.exec('DELETE FROM entitlements WHERE product_id=\''+course+'\'');
    assert.deepEqual(await canRead(db),denied,'a paid historical order never creates access');
  }finally{await db.close();}
});

test('revoke and cross-user access remain closed; the helper does not gain public execution', async()=>{
  const db=await paidFixture();try {
    await db.exec("UPDATE entitlements SET status='revoked' WHERE product_id='"+course+"'");
    assert.deepEqual(await canRead(db),denied);
    await db.exec("UPDATE entitlements SET status='active' WHERE product_id='"+course+"'");
    await db.query("SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false)");
    await db.exec('SET ROLE authenticated');
    assert.equal((await db.query('SELECT historical_business_source_is_current($1,$2,$3,null) ok',[user,course,{granted_by:'primary_order_fulfillment'}])).rows[0].ok,false);
    await db.exec('RESET ROLE');
    assert.equal((await db.query("SELECT has_function_privilege('authenticated','historical_business_source_is_current(uuid,uuid,jsonb,text)','EXECUTE') ok")).rows[0].ok,true);
  }finally{await db.close();}
});

test('group payment lineage denies full parent refunds, missing parents and revoked items while preserving unrelated partial refunds',async()=>{
  const db=await paidFixture();try{
    const parent='00000000-0000-4000-8000-000000000030';
    const payment='00000000-0000-4000-8000-000000000031';
    const item='00000000-0000-4000-8000-000000000032';
    await db.query("INSERT INTO orders_v2(id,user_id,product_id,status,is_deleted,final_price,paid_amount) VALUES($1,$2,$3,'paid',false,1925,1925)",[parent,user,course]);
    await db.query("INSERT INTO payments_v2 VALUES($1,$2,'succeeded',1925,0)",[payment,parent]);
    await db.query('INSERT INTO order_group_items VALUES($1,$2)',[item,order]);
    await db.query('UPDATE orders_v2 SET meta=$1 WHERE id=$2',[{group_child_order:true,group_primary_order_id:parent,group_payment_id:payment},order]);
    assert.deepEqual(await canRead(db),allowed);
    await db.exec("UPDATE payments_v2 SET status='partially_refunded',refunded_amount=100");
    await db.query("UPDATE orders_v2 SET status='partial_refund' WHERE id=$1",[parent]);
    assert.deepEqual(await canRead(db),allowed,'a partial refund of another item does not hide this module');
    for(const sql of [
      "UPDATE payments_v2 SET refunded_amount=amount",
      "UPDATE payments_v2 SET status='refunded'",
      "UPDATE orders_v2 SET is_deleted=true WHERE id='"+parent+"'",
      "DELETE FROM orders_v2 WHERE id='"+parent+"'",
      "UPDATE orders_v2 SET meta=meta-'group_primary_order_id' WHERE id='"+order+"'",
      "UPDATE orders_v2 SET meta=jsonb_set(meta,'{group_primary_order_id}','\"not-a-uuid\"') WHERE id='"+order+"'",
    ]){
      await db.exec('BEGIN');await db.exec(sql);assert.deepEqual(await canRead(db),denied,sql);await db.exec('ROLLBACK');
    }
    await db.query("INSERT INTO payment_refund_requests VALUES($1,'completed','keep')",[item]);
    assert.deepEqual(await canRead(db),allowed,'keep access decision is honored');
    await db.exec("UPDATE payment_refund_requests SET access_action='revoke'");
    assert.deepEqual(await canRead(db),denied);
    await db.exec("UPDATE payment_refund_requests SET state='failed'");
    assert.deepEqual(await canRead(db),allowed);
    await db.query("INSERT INTO composable_refund_intents VALUES($1,'allocated','revoke')",[item]);
    assert.deepEqual(await canRead(db),denied);
    await db.exec("UPDATE composable_refund_intents SET status='cancelled'");
    assert.deepEqual(await canRead(db),allowed);
  }finally{await db.close();}
});
