import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderHistoryBatch} from './render-batch.mjs';
const {PGlite}=await import(process.env.HISTORICAL_PGLITE_MODULE||'@electric-sql/pglite');
const profile='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002';
const moduleId='64d9f812-617c-41a8-b3dc-bb113156d6f3',courseId='7101ed3c-7839-4a74-ad95-aa0660369b22',tier='543940b1-99da-47f3-accc-671ad5b11afe';
function action(kind='module_only_standalone',cohort=17){
 const a={id:kind==='module_only_standalone'?'00000000-0000-4000-8000-000000000003':'00000000-0000-4000-8000-000000000004',profile_id:profile,user_id:user,
 product_id:kind==='module_only_standalone'?moduleId:courseId,tariff_id:kind==='module_only_standalone'?null:tier,flow_id:cohort===18?'2d635c0d-37d5-4600-a86f-5c34297f7aab':null,
 cohort,kind,refs:[`${cohort}:2`],history_only:true,owner_confirmed_paid:true,create_payment:false,grant_access:false};
 a.idempotency_key=`hist-cb17-18-20260911-v1:${cohort}:${profile}:${a.product_id}:${a.tariff_id||'module'}`;return a;
}
async function fixture(){
 const db=new PGlite();await db.exec(`CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,status text,merged_to_profile_id uuid);
 CREATE TABLE products_v2(id uuid PRIMARY KEY,name text,code text);CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid,name text);
 CREATE TABLE orders_v2(id uuid PRIMARY KEY,order_number text UNIQUE,profile_id uuid,user_id uuid,product_id uuid,tariff_id uuid,flow_id uuid,
 status text,is_deleted boolean,is_trial boolean,base_price numeric NOT NULL,final_price numeric NOT NULL,paid_amount numeric,currency text,provider text,reconcile_source text,
 deal_date timestamptz,pipeline_id uuid,pipeline_stage_id uuid,meta jsonb,purchase_snapshot jsonb);
 CREATE TABLE payments_v2(order_id uuid);CREATE TABLE subscriptions_v2(order_id uuid);CREATE TABLE entitlements(order_id uuid);CREATE TABLE entitlement_sources(order_id uuid);
 CREATE TABLE audit_logs(action text,actor_type text,actor_label text,meta jsonb);`);
 await db.query("INSERT INTO profiles VALUES($1,$2,'active',null)",[profile,user]);
 await db.query("INSERT INTO products_v2 VALUES($1,'Module','module'),($2,'Course','cb20')",[moduleId,courseId]);
 await db.query("INSERT INTO tariffs VALUES($1,$2,'Tier')",[tier,courseId]);return db;
}
test('history dry-run is empty; paid facts preserve refs and create no money/access; repeat is zero',async()=>{
 const db=await fixture();try{
  const actions=[action(),action('base_tariff_purchase',18)];await db.exec(renderHistoryBatch(actions,'dry-run'));
  assert.equal((await db.query('SELECT count(*)::int n FROM orders_v2')).rows[0].n,0);
  await db.exec(renderHistoryBatch(actions,'execute'));await db.exec(renderHistoryBatch(actions,'execute'));
  const rows=(await db.query('SELECT * FROM orders_v2 ORDER BY id')).rows;assert.equal(rows.length,2);
  for(const row of rows){assert.equal(row.status,'paid');assert.equal(Number(row.paid_amount),0);assert.equal(row.deal_date,null);assert.equal(row.meta.owner_confirmed_paid,true);assert.equal(row.provider,null);}
  assert.deepEqual(rows[0].purchase_snapshot.module_list_mapped,[moduleId]);assert.deepEqual(rows[1].meta.source_refs,['18:2']);
  for(const table of ['payments_v2','subscriptions_v2','entitlements','entitlement_sources'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,1);
 }finally{await db.close()}
});
test('mapped split-child covers module but not full course tariff',async()=>{
 const db=await fixture();try{
  await db.query(`INSERT INTO orders_v2(id,profile_id,user_id,product_id,tariff_id,status,base_price,final_price,purchase_snapshot)
  VALUES('00000000-0000-4000-8000-000000000010',$1,$2,$3,$4,'paid',0,0,$5)`,[profile,user,courseId,tier,{historical_purchase_type:'module_child_purchase',module_list_mapped:[moduleId]}]);
  await db.exec(renderHistoryBatch([action()],'execute'));assert.equal((await db.query('SELECT count(*)::int n FROM orders_v2')).rows[0].n,1);
  await db.exec(renderHistoryBatch([action('base_tariff_purchase')],'execute'));assert.equal((await db.query('SELECT count(*)::int n FROM orders_v2')).rows[0].n,2);
 }finally{await db.close()}
});
test('unexpected access trigger rolls back historical inserts as a batch',async()=>{
 const db=await fixture();try{
  await db.exec(`CREATE FUNCTION bad_grant() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO entitlements VALUES(NEW.id);RETURN NEW;END$$;
  CREATE TRIGGER bad AFTER INSERT ON orders_v2 FOR EACH ROW EXECUTE FUNCTION bad_grant();`);
  await assert.rejects(db.exec(renderHistoryBatch([action()],'execute')),/Unexpected historical payment\/access/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM orders_v2')).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int n FROM entitlements')).rows[0].n,0);
 }finally{await db.close()}
});
test('stale owner or partial changed coverage requires renewed review',async()=>{
 const db=await fixture();try{
  await db.exec(renderHistoryBatch([action()],'execute'));
  await assert.rejects(db.exec(renderHistoryBatch([action(),action('base_tariff_purchase')],'execute')),/Partial coverage changed/);await db.exec('ROLLBACK');
  await db.query('UPDATE profiles SET merged_to_profile_id=$1',[profile]);
  await assert.rejects(db.exec(renderHistoryBatch([action('base_tariff_purchase')],'execute')),/identity changed/);await db.exec('ROLLBACK');
 }finally{await db.close()}
});
test('renderer rejects untrusted identity keys and excludes extraneous SQL delimiter text',()=>{
 assert.throws(()=>renderHistoryBatch([{...action(),idempotency_key:"hist-cb17-18-20260911-v1:$history$"}],'execute'),/Wrong batch/);
 const sql=renderHistoryBatch([{...action(),unused:'$history$ DROP TABLE x;'}],'dry-run');assert.ok(!sql.includes('DROP TABLE'));
});
