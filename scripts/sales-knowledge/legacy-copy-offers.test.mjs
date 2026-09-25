import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const sql=await readFile(new URL('./cb21-legacy-copy-offers.sql',import.meta.url),'utf8');
const ids=['63939f2d-2980-466f-8cd9-c29c99efa800','9afbf9a0-4bb8-42bb-bc30-da6e983f5262','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0'];
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE sales_campaigns(id uuid DEFAULT gen_random_uuid(),code text,mode text,enabled_at timestamptz);
 CREATE TABLE sales_conversations(id uuid,campaign_id uuid);
 CREATE TABLE sales_jobs(conversation_id uuid,status text);
 CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid,is_active boolean,is_public boolean);
 CREATE TABLE tariff_offers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tariff_id uuid,amount numeric,is_active boolean,meta jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE audit_logs(actor_type text,action text,meta jsonb);
 CREATE TABLE existing_obligations(kind text,offer_id uuid,amount numeric);
 INSERT INTO sales_campaigns(code,mode) VALUES('cb21-owner-test','off');`);
 for(const [i,id] of ids.entries()){
  await db.query("INSERT INTO tariffs VALUES($1,'2b7bf6d4-ad8d-46ad-9399-7f96c307c596',true,false)",[id]);
  for(let j=0;j<5;j++)await db.query("INSERT INTO tariff_offers(tariff_id,amount,is_active,meta) VALUES($1,$2,$3,$4)",[id,j<4?[1950,1650,2650][i]:0,j<4,{slot_role:`button_${j}`,document_defaults:{preserve:true}}]);
 }
 await db.exec("INSERT INTO existing_obligations SELECT 'subscription',id,amount FROM tariff_offers WHERE is_active; INSERT INTO existing_obligations SELECT 'link',id,amount FROM tariff_offers WHERE is_active;");
 return db;
}
async function run(db,options={}){await db.query("SELECT set_config('cb21.legacy_copy_options',$1,false)",[JSON.stringify(options)]);return (await db.exec(sql)).flatMap(r=>r.rows??[]).find(r=>r.fingerprint);}
async function offers(db){return (await db.query('SELECT * FROM tariff_offers ORDER BY id')).rows;}
test('dry-run changes nothing; reviewed repair changes only legacy metadata and is idempotent',async()=>{
 const db=await fixture();try{
  const before=await offers(db),obligations=(await db.query('SELECT * FROM existing_obligations ORDER BY kind,offer_id')).rows;
  const plan=await run(db);assert.equal(plan.changed_rows,15);assert.deepEqual(await offers(db),before);
  await run(db,{apply:true,expected_fingerprint:plan.fingerprint});
  const after=await offers(db);
  assert.deepEqual(after.map(({updated_at,meta,...r})=>({...r,meta:{...meta,sales_legacy_only:undefined}})),before.map(({updated_at,meta,...r})=>({...r,meta:{...meta,sales_legacy_only:undefined}})));
  assert.ok(after.every(r=>r.meta.sales_legacy_only===true));
  assert.deepEqual((await db.query('SELECT * FROM existing_obligations ORDER BY kind,offer_id')).rows,obligations);
  assert.equal((await run(db)).changed_rows,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,1);
 }finally{await db.close();}
});
test('stale fingerprint, changed price, public tariff and active campaign stop before writes',async()=>{
 for(const [mutation,error] of [[null,/dry_run_fingerprint_changed/],["UPDATE tariff_offers SET amount=amount+1 WHERE is_active",/legacy_offer_terms_changed/],["UPDATE tariffs SET is_public=true",/legacy_tariff_scope_changed/],["UPDATE sales_campaigns SET mode='owner_test'",/campaign_must_be_off/]]){
  const db=await fixture();try{
   await run(db);if(mutation)await db.exec(mutation);
   const before=await offers(db);
   await assert.rejects(run(db,{apply:true,expected_fingerprint:'stale'}),error);
   await db.exec('ROLLBACK');assert.deepEqual(await offers(db),before);
   assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,0);
  }finally{await db.close();}
 }
});
