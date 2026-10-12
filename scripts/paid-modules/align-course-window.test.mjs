import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const course = '3e43fb28-8322-41bc-bfee-714731bdc630';
const targetIds = [id(100),id(101),id(102),id(103)];
const fixtureHash = createHash('md5').update(targetIds.sort().join(',')).digest('hex');
const originalSql = readFileSync(new URL('./align-course-window.sql', import.meta.url),'utf8');
const sql = originalSql.replace('711a94d56021ec95b9873f46a63cc572', fixtureHash);
assert.notEqual(sql,originalSql,'test must substitute its synthetic scope hash');

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE products_v2(id uuid PRIMARY KEY,code text);
    CREATE TABLE orders_v2(id uuid PRIMARY KEY,user_id uuid,product_id uuid,status text,is_deleted boolean,final_price numeric,paid_amount numeric,meta jsonb DEFAULT '{}');
    CREATE TABLE entitlements(id uuid PRIMARY KEY,user_id uuid,product_id uuid,order_id uuid,status text,expires_at timestamptz,updated_at timestamptz DEFAULT now(),meta jsonb DEFAULT '{}');
    CREATE TABLE payments_v2(id uuid PRIMARY KEY,order_id uuid,user_id uuid,status text,is_deleted boolean,amount numeric,refunded_amount numeric);
    CREATE TABLE order_groups(id uuid PRIMARY KEY,primary_order_id uuid,user_id uuid,status text);
    CREATE TABLE order_group_items(id uuid PRIMARY KEY,order_id uuid,product_id uuid,order_group_id uuid,role text);
    CREATE TABLE payment_refund_requests(order_group_item_id uuid,state text,access_action text);
    CREATE TABLE composable_refund_intents(order_group_item_id uuid,status text,access_action text);
    CREATE TABLE audit_logs(action text,actor_type text,actor_label text,entity_type text,entity_id uuid,target_user_id uuid,meta jsonb);
    INSERT INTO products_v2 VALUES('${course}','prd_7222cb3152c3');`);
  for(let user=0;user<2;user++) {
    await db.query("INSERT INTO orders_v2 VALUES($1,$2,$3,'paid',false,2000,2000,'{}')",[id(10+user),id(1+user),course]);
    await db.query("INSERT INTO payments_v2 VALUES($1,$2,$3,'succeeded',false,2600,0)",[id(20+user),id(10+user),id(1+user)]);
    await db.query("INSERT INTO order_groups VALUES($1,$2,$3,'paid')",[id(30+user),id(10+user),id(1+user)]);
    await db.query("INSERT INTO entitlements(id,user_id,product_id,order_id,status,expires_at) VALUES($1,$2,$3,$4,'active',now()+interval '300 days')",[id(40+user),id(1+user),course,id(10+user)]);
  }
  for(let n=0;n<5;n++) {
    const user=n<2?0:1;
    await db.query('INSERT INTO products_v2 VALUES($1,$2)',[id(50+n),n===3?'prd_08a84b2b7223':`cb_module_${n}`]);
    await db.query("INSERT INTO orders_v2 VALUES($1,$2,$3,'paid',false,300,300,$4)",[id(60+n),id(1+user),id(50+n),{group_child_order:true,group_primary_order_id:id(10+user),group_payment_id:id(20+user),order_group_id:id(30+user)}]);
    await db.query("INSERT INTO order_group_items VALUES($1,$2,$3,$4,'addon')",[id(70+n),id(60+n),id(50+n),id(30+user)]);
    await db.query("INSERT INTO entitlements(id,user_id,product_id,order_id,status,expires_at,meta) VALUES($1,$2,$3,$4,'active',now()+($5||' days')::interval,$6)",[id(100+n),id(1+user),id(50+n),id(60+n),n===4?'365':n===3?'180':'30',{granted_by:'primary_order_fulfillment',source:'historical_purchase_with_business',untouched:'retain'}]);
  }
  // Standalone, history-only and revoked records must stay byte-for-byte intact.
  await db.query("INSERT INTO entitlements(id,user_id,product_id,status,expires_at,meta) VALUES($1,$2,$3,'active',now()+interval '30 days','{\"source\":\"historical_purchase_with_business\"}'),($4,$2,$3,'revoked',now()+interval '30 days','{}')",[id(110),id(1),id(50),id(111)]);
  return db;
}
const snapshot = async db => (await db.query(`SELECT jsonb_build_object(
  'entitlements',(SELECT jsonb_agg(e ORDER BY id) FROM entitlements e),
  'orders',(SELECT jsonb_agg(o ORDER BY id) FROM orders_v2 o),
  'payments',(SELECT jsonb_agg(p ORDER BY id) FROM payments_v2 p)) state`)).rows[0].state;

test('exactly four periods align to their own course; money, manual/longer/history/revoked rights stay intact; replay is a no-op',async()=>{
  const db=await fixture();try{
    const before=await snapshot(db);await db.exec(sql);const after=await snapshot(db);
    assert.deepEqual(after.orders,before.orders);assert.deepEqual(after.payments,before.payments);
    for(const old of before.entitlements){
      const updated=after.entitlements.find(e=>e.id===old.id);
      if(!targetIds.includes(old.id)){assert.deepEqual(updated,old);continue;}
      const base=after.entitlements.find(e=>e.order_id===updated.meta.aligned_with_base_order_id);
      assert.equal(updated.expires_at,base.expires_at);assert.equal(updated.meta.previous_expires_at,old.expires_at);
      assert.equal(updated.meta.untouched,old.meta.untouched);
      assert.equal(updated.status,old.status);assert.equal(updated.order_id,old.order_id);
    }
    assert.equal((await db.query('SELECT count(*) n FROM audit_logs')).rows[0].n,4);
    await db.exec(sql);assert.deepEqual(await snapshot(db),after);
    assert.equal((await db.query('SELECT count(*) n FROM audit_logs')).rows[0].n,4);
  }finally{await db.close();}
});

test('unpaid/refunded/deleted/mismatched/manual/reduced/revoked/CB21 rows abort the complete batch with no audit writes',async()=>{
  const db=await fixture();try{
    const before=await snapshot(db);
    const invalid=[
      `UPDATE orders_v2 SET status='pending' WHERE id='${id(60)}'`,
      `UPDATE orders_v2 SET final_price=0 WHERE id='${id(60)}'`,
      `UPDATE orders_v2 SET user_id='${id(9)}' WHERE id='${id(60)}'`,
      `UPDATE orders_v2 SET is_deleted=true WHERE id='${id(10)}'`,
      `UPDATE payments_v2 SET refunded_amount=amount WHERE id='${id(20)}'`,
      `UPDATE payments_v2 SET user_id='${id(9)}' WHERE id='${id(20)}'`,
      `UPDATE order_groups SET user_id='${id(9)}' WHERE id='${id(30)}'`,
      `UPDATE order_group_items SET role='primary' WHERE id='${id(70)}'`,
      `UPDATE entitlements SET meta=meta||'{"manual_access_edit_last_at":"2026-10-01"}' WHERE id='${id(100)}'`,
      `UPDATE entitlements SET status='revoked' WHERE id='${id(100)}'`,
      `UPDATE entitlements SET status='revoked' WHERE id='${id(40)}'`,
      `UPDATE orders_v2 SET product_id='${id(21)}' WHERE id='${id(10)}'`,
      `INSERT INTO payment_refund_requests VALUES('${id(70)}','completed','reduce')`,
      `INSERT INTO composable_refund_intents VALUES('${id(70)}','allocated','revoke')`,
    ];
    for(const mutation of invalid){
      await db.exec('BEGIN');await db.exec(mutation);
      await assert.rejects(db.exec(sql),/candidate_set_changed/,mutation);await db.exec('ROLLBACK');
      assert.deepEqual(await snapshot(db),before,mutation);
      assert.equal((await db.query('SELECT count(*) n FROM audit_logs')).rows[0].n,0);
    }
    await assert.rejects(db.exec(sql.replace(fixtureHash,'00000000000000000000000000000000')),/candidate_set_changed/);
  }finally{await db.close();}
});

test('a concurrent update failure rolls back earlier changes and all snapshots; changed replay never reapplies',async()=>{
  const db=await fixture();try{
    const before=await snapshot(db);
    await db.exec(`CREATE FUNCTION reject_last_update() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id='${id(103)}'::uuid THEN RETURN NULL; END IF; RETURN NEW; END;$$;
      CREATE TRIGGER reject_last BEFORE UPDATE ON entitlements FOR EACH ROW EXECUTE FUNCTION reject_last_update();`);
    await assert.rejects(db.exec(sql),/concurrent_change/);assert.deepEqual(await snapshot(db),before);
    assert.equal((await db.query('SELECT count(*) n FROM audit_logs')).rows[0].n,0);
    await db.exec('DROP TRIGGER reject_last ON entitlements');await db.exec(sql);
    await db.exec(`UPDATE entitlements SET expires_at=expires_at+interval '1 day' WHERE id='${id(100)}'`);
    const drift=await snapshot(db);await assert.rejects(db.exec(sql),/replay_drift/);assert.deepEqual(await snapshot(db),drift);
  }finally{await db.close();}
});
