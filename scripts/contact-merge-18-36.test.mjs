import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPilot } from './render-contact-merge-18-36.mjs';
const { PGlite } = await import(process.env.CONTACT_MERGE_PGLITE_MODULE || '@electric-sql/pglite');
const master='303563e8-1837-4de9-a69a-8921a799b699', old='8cc39a42-6661-417d-b0c0-f1c24ccb6acf';
const login='64ccd4f9-ca69-4903-90b7-5a49df7fef07', order='c0133322-bf2b-4e5c-84b9-749ca550ccba';

async function fixture() {
  const db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),email text,status text,
      is_archived boolean,merged_to_profile_id uuid REFERENCES profiles(id),telegram_user_id text,duplicate_flag text);
    CREATE TABLE orders_v2(id uuid PRIMARY KEY,profile_id uuid REFERENCES profiles(id),user_id uuid,status text,
      is_deleted boolean,product_id uuid,tariff_id uuid,paid_amount numeric,base_price numeric,final_price numeric,
      currency text,purchase_snapshot jsonb,meta jsonb,updated_at timestamptz);
    CREATE TABLE payments_v2(id uuid PRIMARY KEY,order_id uuid,profile_id uuid,user_id uuid);
    CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY,order_id uuid,profile_id uuid,user_id uuid);
    CREATE TABLE entitlements(id uuid PRIMARY KEY,order_id uuid,profile_id uuid,user_id uuid);
    CREATE TABLE crm_pipeline_automation_rules(status text);
    CREATE TABLE merge_history(id uuid PRIMARY KEY,master_profile_id uuid REFERENCES profiles(id),
      merged_profile_id uuid REFERENCES profiles(id),merged_data jsonb);
    CREATE TABLE audit_logs(action text,actor_type text,actor_label text,target_user_id uuid,meta jsonb);`);
  await db.query('INSERT INTO auth.users VALUES ($1,$2)',[login,'buyer@example.invalid']);
  await db.query(`INSERT INTO profiles VALUES
    ($1,$3,'buyer@example.invalid','active',false,null,'linked','none'),
    ($2,null,' BUYER@example.invalid ','archived',true,null,null,'suspected')`,[master,old,login]);
  await db.query(`INSERT INTO orders_v2 VALUES ($1,$2,null,'paid',false,
    '7101ed3c-7839-4a74-ad95-aa0660369b22','543940b1-99da-47f3-accc-671ad5b11afe',
    0,123,123,'BYN',null,'{"historical":true}',now())`,[order,old]);
  return db;
}

test('pilot dry-run is read-only; execute moves one purchase and replay changes nothing',async()=>{
  const db=await fixture();
  try {
    const before=(await db.query('SELECT * FROM profiles WHERE id=$1',[master])).rows[0];
    const orderBefore=(await db.query('SELECT * FROM orders_v2')).rows[0];
    await db.exec(renderPilot('dry-run'));
    assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,0);
    assert.equal((await db.query('SELECT profile_id FROM orders_v2')).rows[0].profile_id,old);
    await db.exec(renderPilot('execute'));
    const moved=(await db.query('SELECT * FROM orders_v2')).rows[0];
    assert.equal(moved.profile_id,master); assert.equal(moved.user_id,login);
    assert.deepEqual({...moved,profile_id:old,user_id:null},orderBefore);
    assert.deepEqual((await db.query('SELECT * FROM profiles WHERE id=$1',[master])).rows[0],before);
    assert.equal((await db.query('SELECT merged_to_profile_id FROM profiles WHERE id=$1',[old])).rows[0].merged_to_profile_id,master);
    await db.exec(renderPilot('execute'));
    assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM payments_v2')).rows[0].n,0);
  } finally {await db.close();}
});

test('an unreviewed no-FK dependency blocks the entire pilot',async()=>{
  const db=await fixture();
  try {
    await db.exec('CREATE TABLE future_owned_table(id integer,contact_id uuid)');
    await db.query('INSERT INTO future_owned_table VALUES (1,$1)',[old]);
    await assert.rejects(db.exec(renderPilot('execute')),/Unreviewed pilot dependency/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT profile_id FROM orders_v2')).rows[0].profile_id,old);
    assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,0);
  } finally {await db.close();}
});

test('a monetary side effect rolls back order ownership and archive linkage together',async()=>{
  const db=await fixture();
  try {
    await db.exec(`CREATE FUNCTION unexpected_money_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.final_price:=999; RETURN NEW; END $$;
      CREATE TRIGGER unexpected_money BEFORE UPDATE ON orders_v2 FOR EACH ROW EXECUTE FUNCTION unexpected_money_change();`);
    await assert.rejects(db.exec(renderPilot('execute')),/changed fields beyond ownership/);
    await db.exec('ROLLBACK');
    const row=(await db.query('SELECT profile_id,final_price FROM orders_v2')).rows[0];
    assert.equal(row.profile_id,old); assert.equal(Number(row.final_price),123);
    assert.equal((await db.query('SELECT merged_to_profile_id FROM profiles WHERE id=$1',[old])).rows[0].merged_to_profile_id,null);
  } finally {await db.close();}
});

test('login mismatch fails before any ownership write',async()=>{
  const db=await fixture();
  try {
    await db.query('UPDATE auth.users SET email=$1',['different@example.invalid']);
    await assert.rejects(db.exec(renderPilot('execute')),/login identity mismatch/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT profile_id FROM orders_v2')).rows[0].profile_id,old);
  } finally {await db.close();}
});
