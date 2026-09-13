import {test} from 'node:test';import assert from 'node:assert/strict';
import {renderScopeRepair} from './render-scope-repair.mjs';
const{PGlite}=await import(process.env.HISTORICAL_PGLITE_MODULE||'@electric-sql/pglite');
const user='00000000-0000-4000-8000-000000000001',profile='00000000-0000-4000-8000-000000000002',ent='00000000-0000-4000-8000-000000000003',order='00000000-0000-4000-8000-000000000004',paid='00000000-0000-4000-8000-000000000005';
const items=[{entitlement_id:ent,order_id:order,user_id:user,profile_id:profile}];
async function fixture(){
 const db=new PGlite();await db.exec(`CREATE TABLE profiles(id uuid,user_id uuid,status text,merged_to_profile_id uuid);
 CREATE TABLE orders_v2(id uuid,user_id uuid,profile_id uuid,status text,is_deleted boolean,is_trial boolean,product_id uuid,tariff_id uuid,meta jsonb,purchase_snapshot jsonb);
 CREATE TABLE subscriptions_v2(user_id uuid,product_id uuid,tariff_id uuid,status text,is_trial boolean,access_start_at timestamptz,access_end_at timestamptz,order_id uuid);
 CREATE TABLE payments_v2(order_id uuid,status text,currency text,amount numeric,refunded_amount numeric);
 CREATE TABLE entitlements(id uuid,user_id uuid,product_id uuid,status text,expires_at timestamptz,meta jsonb);
 CREATE TABLE audit_logs(action text,actor_type text,actor_label text,target_user_id uuid,meta jsonb);`);
 await db.query("INSERT INTO profiles VALUES($1,$2,'active',null)",[profile,user]);
 await db.query(`INSERT INTO orders_v2 VALUES($1,$2,$3,'paid',false,false,'7101ed3c-7839-4a74-ad95-aa0660369b22','543940b1-99da-47f3-accc-671ad5b11afe',
 '{"historical_batch_id":"hist-cb17-18-20260911-v1","owner_confirmed_paid":true}','{"historical_purchase_type":"base_tariff_purchase"}'),
 ($4,$2,$3,'paid',false,false,'11c9f1b8-0355-4753-bd74-40b42aa53616','7c748940-dcad-4c7c-a92e-76a2344622d3','{}','{}')`,[order,user,profile,paid]);
 await db.query(`INSERT INTO subscriptions_v2 VALUES($1,'11c9f1b8-0355-4753-bd74-40b42aa53616','7c748940-dcad-4c7c-a92e-76a2344622d3','canceled',false,now()-interval '1 day',now()+interval '2 days',$2)`,[user,paid]);
 await db.query("INSERT INTO payments_v2 VALUES($1,'succeeded','BYN',250,0)",[paid]);
 await db.query(`INSERT INTO entitlements VALUES($1,$2,'7101ed3c-7839-4a74-ad95-aa0660369b22','active',now()+interval '2 days',
 '{"source_rule_id":"1b497fba-031a-4318-8d9f-2530f1bac116","scope_resolution_mode":"module_scope_only","business_subscription_id":"unchanged-source","historical_module_product_ids":["module"]}')`,[ent,user]);return db;
}
test('course scope follows paid history, preserves paid window/lineage and has zero replay',async()=>{
 const db=await fixture();try{
  const before=(await db.query('SELECT * FROM entitlements')).rows[0];await db.exec(renderScopeRepair(items,'dry-run'));await db.exec(renderScopeRepair(items,'rollback'));
  assert.deepEqual((await db.query('SELECT * FROM entitlements')).rows[0],before);
  await db.exec(renderScopeRepair(items,'execute'));await db.exec(renderScopeRepair(items,'execute'));
  const after=(await db.query('SELECT * FROM entitlements')).rows[0];assert.equal(after.meta.scope_resolution_mode,'full_tariff_scope');assert.equal(after.meta.business_subscription_id,'unchanged-source');
  assert.deepEqual({...after,meta:before.meta},before);assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,1);
 }finally{await db.close()}
});
test('a refund below 250 or expired Club blocks widening historical course scope',async()=>{
 for(const mutation of ["UPDATE payments_v2 SET refunded_amount=1","UPDATE subscriptions_v2 SET access_end_at=now()-interval '1 second'"]){
  const db=await fixture();try{await db.exec(mutation);await assert.rejects(db.exec(renderScopeRepair(items,'execute')),/No current paid Business/);await db.exec('ROLLBACK');
   assert.equal((await db.query('SELECT meta FROM entitlements')).rows[0].meta.scope_resolution_mode,'module_scope_only');
  }finally{await db.close()}
 }
});
test('foreign/manual lineage never gets overwritten by history repair',async()=>{
 const db=await fixture();try{await db.exec(`UPDATE entitlements SET meta=meta||'{"manual_override":true}'::jsonb`);await assert.rejects(db.exec(renderScopeRepair(items,'execute')),/lineage/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,0);
 }finally{await db.close()}
});
