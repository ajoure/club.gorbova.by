import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const migration=await readFile(new URL('../../supabase/migrations/20261020131240_club_cb2_bonus_access.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [buyer,nonbuyer,admin,manual,profile,order,clubSub,courseSub,root,child,other,lesson,otherLesson]=[1,2,3,4,5,6,7,8,9,10,11,12,13].map(id);
const cb2='87a8870f-d426-419a-9f15-faa76c3f2be3',club='11c9f1b8-0355-4753-bd74-40b42aa53616',business='7c748940-dcad-4c7c-a92e-76a2344622d3',ideology='b018e9be-53ce-4840-8034-e09f8e319080';
async function fixture(){
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
    CREATE FUNCTION public.has_role_v2(u uuid,r text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT u='${admin}' AND r='admin'$$;
    CREATE FUNCTION public.has_permission(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
    CREATE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
    CREATE TABLE profiles(id uuid,user_id uuid);
    CREATE TABLE orders_v2(id uuid,user_id uuid,profile_id uuid,product_id uuid,tariff_id uuid,status text,is_deleted boolean,is_trial boolean,meta jsonb,created_at timestamptz);
    ALTER TABLE orders_v2 ADD COLUMN base_price numeric DEFAULT 0, ADD COLUMN final_price numeric DEFAULT 0,
      ADD COLUMN paid_amount numeric DEFAULT 0, ADD COLUMN discount numeric DEFAULT 0, ADD COLUMN currency text DEFAULT 'BYN',
      ADD COLUMN reconcile_source text DEFAULT 'getcourse_historical', ADD COLUMN updated_at timestamptz;
    CREATE TABLE audit_logs(actor_type text,actor_label text,action text,entity_type text,entity_id text,meta jsonb);
    CREATE TABLE payments_v2(order_id uuid,status text,amount numeric,refunded_amount numeric);
    CREATE TABLE subscriptions_v2(id uuid,user_id uuid,product_id uuid,tariff_id uuid,status text,is_trial boolean,access_start_at timestamptz,access_end_at timestamptz);
    ALTER TABLE subscriptions_v2 ADD COLUMN order_id uuid;
    CREATE TABLE entitlement_sources(id uuid,user_id uuid,product_id uuid,tariff_id uuid,order_id uuid,source_type text,status text,starts_at timestamptz,expires_at timestamptz,meta jsonb);
    CREATE TABLE entitlements(id uuid,user_id uuid,product_id uuid,order_id uuid,status text,expires_at timestamptz,meta jsonb);
    CREATE TABLE access_rules(id uuid,product_id uuid,tariff_id uuid,is_active boolean,grant_target_type text,duration_days int,conditions jsonb);
    CREATE TABLE training_modules(id uuid,parent_module_id uuid,product_id uuid);
    CREATE TABLE training_lessons(id uuid,module_id uuid);
    CREATE TABLE lesson_blocks(id uuid,lesson_id uuid);
    CREATE TABLE lesson_attachments(id uuid,lesson_id uuid);
    CREATE FUNCTION public.user_has_training_lesson_access(_user_id uuid,_lesson_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT true$$;
    INSERT INTO profiles VALUES('${profile}','${buyer}');
    INSERT INTO orders_v2(id,user_id,profile_id,product_id,tariff_id,status,is_deleted,is_trial,meta,created_at) VALUES('${order}','${buyer}','${profile}','${cb2}','${id(20)}','paid',false,false,'{}',now()-interval '1 year');
    INSERT INTO subscriptions_v2(id,user_id,product_id,tariff_id,status,is_trial,access_start_at,access_end_at) VALUES('${clubSub}','${buyer}','${club}','${business}','active',false,now()-interval '1 day',now()+interval '3 days'),
      ('${id(21)}','${nonbuyer}','${club}','${business}','active',false,now()-interval '1 day',now()+interval '3 days');
    INSERT INTO entitlements VALUES('${id(22)}','${buyer}','${cb2}',null,'active',now()+interval '10 days','{"granted_by":"rule_engine_product_access"}'),
      ('${id(23)}','${nonbuyer}','${cb2}',null,'active',now()+interval '10 days','{"granted_by":"rule_engine_product_access"}');
    INSERT INTO access_rules VALUES('${id(24)}','${club}','${business}',true,'product_access',null,'{"condition_type":"prior_purchase","match_mode":"per_product","target_product_ids":["${cb2}"]}'),
      ('${id(25)}','${club}','${ideology}',true,'product_access',null,'{"condition_type":"prior_purchase","match_mode":"per_product","target_product_ids":["${cb2}"]}');
    INSERT INTO training_modules VALUES('${root}',null,'${cb2}'),('${child}','${root}',null),('${other}',null,'${id(26)}');
    INSERT INTO training_lessons VALUES('${lesson}','${child}'),('${otherLesson}','${other}');
    INSERT INTO lesson_blocks VALUES('${id(27)}','${lesson}');
    INSERT INTO lesson_attachments VALUES('${id(28)}','${lesson}');
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon,authenticated;`);
  for(const table of ['training_modules','training_lessons','lesson_blocks','lesson_attachments','entitlements']){
    await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY legacy_open ON ${table} FOR SELECT TO anon,authenticated USING(true);`);
  }
  await db.exec(migration);
  return db;
}
async function asUser(db,u,action,role='authenticated'){
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[u||'',role]);
  await db.exec(`SET ROLE ${role}`);try{return await action();}finally{await db.exec('RESET ROLE');}
}
const window=(db,u)=>db.query('SELECT public.get_cb2_access_window($1) w',[u]).then(r=>r.rows[0].w);
const counts=(db,u)=>asUser(db,u,async()=> (await db.query(`SELECT
  (SELECT count(*)::int FROM training_modules WHERE id IN ('${root}','${child}')) modules,
  (SELECT count(*)::int FROM training_lessons WHERE id='${lesson}') lessons,
  (SELECT count(*)::int FROM lesson_blocks) blocks,(SELECT count(*)::int FROM lesson_attachments) attachments,
  public.user_has_training_lesson_access($1,$2) rpc`,[u,lesson])).rows[0]);
const yes={modules:2,lessons:1,blocks:1,attachments:1,rpc:true},no={modules:0,lessons:0,blocks:0,attachments:0,rpc:false};

test('buyer gets the actual Club window; stale aggregate never extends it',async()=>{
 const db=await fixture();try{
  assert.deepEqual(await counts(db,buyer),yes);assert.deepEqual(await counts(db,nonbuyer),no);
  const w=await asUser(db,buyer,()=>window(db,buyer));assert.equal(w.source_kind,'club_bonus');assert.equal(w.has_prior_purchase,true);
  assert.equal(new Date(w.effective_end_at).getTime(),new Date((await db.query('SELECT access_end_at d FROM subscriptions_v2 WHERE id=$1',[clubSub])).rows[0].d).getTime());
  await db.exec(`UPDATE subscriptions_v2 SET access_end_at=now()-interval '1 second'`);
  assert.deepEqual(await counts(db,buyer),no);
  assert.equal((await asUser(db,buyer,()=>window(db,buyer))).has_access,false);
 }finally{await db.close();}
});
test('both qualifying tariffs, cancellation with paid time, and canonical finite bonus sources work',async()=>{
 const db=await fixture();try{
  for(const tariff of [business,ideology])for(const status of ['active','past_due','canceled']){
   await db.query('UPDATE subscriptions_v2 SET tariff_id=$1,status=$2 WHERE user_id=$3',[tariff,status,buyer]);assert.deepEqual(await counts(db,buyer),yes);
  }
  await db.query('UPDATE subscriptions_v2 SET tariff_id=$1 WHERE user_id=$2',[id(90),buyer]);assert.deepEqual(await counts(db,buyer),no);
  await db.query(`INSERT INTO entitlement_sources VALUES($1,$2,$3,$4,null,'bonus','active',now()-interval '1 day',now()+interval '1 day','{"origin":"upsert_club_bonus_entitlement_source"}')`,[id(31),buyer,club,business]);assert.deepEqual(await counts(db,buyer),yes);
 }finally{await db.close();}
});
test('independent current purchase and explicit manual access survive Club expiry',async()=>{
 const db=await fixture();try{
  await db.exec(`UPDATE subscriptions_v2 SET access_end_at=now()-interval '1 day';
    INSERT INTO subscriptions_v2(id,user_id,product_id,tariff_id,status,is_trial,access_start_at,access_end_at) VALUES('${courseSub}','${buyer}','${cb2}',null,'canceled',false,now()-interval '1 day',now()+interval '1 day');
    INSERT INTO entitlements VALUES('${id(40)}','${manual}','${cb2}',null,'active',null,'{"source_type":"manual"}');`);
  assert.deepEqual(await counts(db,buyer),yes);assert.deepEqual(await counts(db,manual),yes);
  const w=await asUser(db,manual,()=>window(db,manual));assert.equal(w.effective_end_at,null);assert.equal(w.source_kind,'manual');assert.equal(w.has_prior_purchase,false);
 }finally{await db.close();}
});
test('gift/test/referral/deleted/refunded/rejected evidence cannot create a Club bonus',async()=>{
 const db=await fixture();try{
  for(const meta of [{financial_kind:'gift'},{financial_kind:'test'},{financial_kind:'referral_redemption'},{is_test:true},{is_gift:true},{prior_purchase_verification:'rejected'}]){
   await db.query('UPDATE orders_v2 SET meta=$1',[meta]);assert.deepEqual(await counts(db,buyer),no);
  }
  await db.exec(`UPDATE orders_v2 SET meta='{}',is_deleted=true`);assert.deepEqual(await counts(db,buyer),no);
  await db.exec(`UPDATE orders_v2 SET is_deleted=false; INSERT INTO payments_v2 VALUES('${order}','refunded',100,100)`);assert.deepEqual(await counts(db,buyer),no);
 }finally{await db.close();}
});
test('legacy profile-owned and zero-priced historical paid facts are not discarded',async()=>{
 const db=await fixture();try{
  await db.exec(`UPDATE orders_v2 SET user_id=null,meta='{"financial_kind":"historical_import","provenance_needs_review":true}'`);
  assert.deepEqual(await counts(db,buyer),yes);assert.deepEqual(await counts(db,nonbuyer),no);
 }finally{await db.close();}
});
test('foreign RPC, anonymous access and private implementation calls are denied; admin and other products survive',async()=>{
 const db=await fixture();try{
  await assert.rejects(asUser(db,nonbuyer,()=>window(db,buyer)),/access_window_forbidden/);
  await assert.rejects(asUser(db,'',()=>window(db,buyer),'anon'),/permission denied/);
  await assert.rejects(asUser(db,buyer,()=>db.query('SELECT * FROM private.cb2_purchase_proof($1)',[buyer])),/permission denied/);
  assert.deepEqual(await counts(db,admin),yes);
  const n=await asUser(db,nonbuyer,()=>db.query('SELECT count(*)::int n FROM training_lessons WHERE id=$1',[otherLesson]));assert.equal(n.rows[0].n,1);
  const anon=await asUser(db,'',()=>db.query('SELECT count(*)::int n FROM training_lessons WHERE id=$1',[lesson]),'anon');assert.equal(anon.rows[0].n,0);
 }finally{await db.close();}
});
test('migration is repeatable without wrapping itself or mutating commercial facts',async()=>{
 const db=await fixture();try{
  const before=(await db.query('SELECT json_agg(o) value FROM orders_v2 o')).rows[0].value;
  await db.exec(migration);assert.deepEqual(await counts(db,buyer),yes);assert.deepEqual(await counts(db,nonbuyer),no);
  assert.deepEqual((await db.query('SELECT json_agg(o) value FROM orders_v2 o')).rows[0].value,before);
 }finally{await db.close();}
});

const repairSource={currency:'BYN',source_document_id:'synthetic-source',source_row:7,
  identity_confirmed_by_owner:true,full_payment_confirmed_by_owner:true,recorded_first_payment:50};
const repair=(db,execute=false,source=repairSource,total=100)=>db.query(
  'SELECT public.repair_cb2_historical_order($1,$2,$3,$4,$5) result',
  [order,total,source,'synthetic-owner-confirmation',execute]).then(r=>r.rows[0].result);
test('historical repair: dry-run, one atomic correction, provenance, no invented transactions, idempotency',async()=>{
 const db=await fixture();try{
  const before=(await db.query('SELECT * FROM orders_v2')).rows[0];
  assert.equal((await asUser(db,'',()=>repair(db),'service_role')).changed,1);
  assert.deepEqual((await db.query('SELECT * FROM orders_v2')).rows[0],before);
  const result=await asUser(db,'',()=>repair(db,true),'service_role');
  assert.deepEqual(result,{dry_run:false,changed:1,already_applied:false,payments_created:0,subscriptions_created:0,grants_changed:0});
  const after=(await db.query('SELECT * FROM orders_v2')).rows[0];
  for(const key of ['status','product_id','tariff_id','user_id','profile_id','created_at'])assert.deepEqual(after[key],before[key]);
  assert.equal(Number(after.base_price),100);assert.equal(Number(after.final_price),100);assert.equal(Number(after.paid_amount),100);
  assert.equal(after.meta.historical_provenance.financial_transactions_created,false);
  assert.equal((await db.query('SELECT count(*)::int n FROM payments_v2')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,1);
  assert.equal((await asUser(db,'',()=>repair(db,true),'service_role')).changed,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,1);
 }finally{await db.close();}
});
test('historical repair denies unconfirmed, changed baseline and non-service callers',async()=>{
 const db=await fixture();try{
  await assert.rejects(asUser(db,buyer,()=>repair(db,true)),/permission denied/);
  await assert.rejects(repair(db,true,{...repairSource,full_payment_confirmed_by_owner:false}),/confirmation_required/);
  await assert.rejects(repair(db,true,repairSource,NaN),/confirmation_required/);
  await db.exec('UPDATE orders_v2 SET paid_amount=1');
  await assert.rejects(repair(db,true),/baseline_mismatch/);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,0);
 }finally{await db.close();}
});
