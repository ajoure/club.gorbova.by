import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{renderManagedHistoryMigration}from'./managed-rpc.mjs';
const{PGlite}=await import(process.env.HISTORICAL_PGLITE_MODULE||'@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,moduleId='64d9f812-617c-41a8-b3dc-bb113156d6f3',course='7101ed3c-7839-4a74-ad95-aa0660369b22',tier='543940b1-99da-47f3-accc-671ad5b11afe';
const action={id:id(3),profile_id:id(1),user_id:id(2),product_id:moduleId,tariff_id:null,flow_id:null,cohort:17,kind:'module_only_standalone',refs:['17:2'],history_only:true,owner_confirmed_paid:true,create_payment:false,grant_access:false,idempotency_key:`hist-cb17-18-20260911-v1:17:${id(1)}:${moduleId}:module`};
const courseAction={...action,id:id(4),product_id:course,tariff_id:tier,kind:'base_tariff_purchase',idempotency_key:`hist-cb17-18-20260911-v1:17:${id(1)}:${course}:${tier}`},payload=[action,courseAction],scope=[{entitlement_id:id(5),order_id:id(4),user_id:id(2),profile_id:id(1)}];
async function fixture(){const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.role',true),'')$$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,status text,merged_to_profile_id uuid);
CREATE TABLE products_v2(id uuid,name text,code text);CREATE TABLE tariffs(id uuid,product_id uuid,name text);
CREATE TABLE orders_v2(id uuid PRIMARY KEY,order_number text UNIQUE,profile_id uuid,user_id uuid,product_id uuid,tariff_id uuid,flow_id uuid,status text,is_deleted boolean,is_trial boolean,base_price numeric,final_price numeric,paid_amount numeric,currency text,provider text,reconcile_source text,created_at timestamptz DEFAULT now(),deal_date timestamptz,pipeline_id uuid,pipeline_stage_id uuid,meta jsonb,purchase_snapshot jsonb);
CREATE TABLE payments_v2(order_id uuid,status text,currency text,amount numeric,refunded_amount numeric);
CREATE TABLE subscriptions_v2(order_id uuid,user_id uuid,product_id uuid,tariff_id uuid,status text,is_trial boolean,access_start_at timestamptz,access_end_at timestamptz);
CREATE TABLE entitlements(id uuid,order_id uuid,user_id uuid,product_id uuid,status text,expires_at timestamptz,meta jsonb);
CREATE TABLE entitlement_sources(order_id uuid);CREATE TABLE access_grant_ledger(order_id uuid,source_order_id uuid);CREATE TABLE referral_balance_transactions(source_id uuid);
CREATE TABLE audit_logs(action text,actor_type text,actor_label text,target_user_id uuid,meta jsonb);`);
await db.exec(readFileSync(new URL('../../supabase/migrations/20260911142000_historical_unknown_purchase_month.sql',import.meta.url),'utf8'));
await db.exec('CREATE TRIGGER month BEFORE INSERT OR UPDATE OF status,deal_date,meta ON orders_v2 FOR EACH ROW EXECUTE FUNCTION orders_v2_autofill_deal_month()');
await db.query("INSERT INTO profiles VALUES($1,$2,'active',null)",[id(1),id(2)]);await db.query("INSERT INTO products_v2 VALUES($1,'Module','module'),($2,'Course','cb20');",[moduleId,course]);await db.query("INSERT INTO tariffs VALUES($1,$2,'Tier')",[tier,course]);
const hash=async p=>(await db.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h",[JSON.stringify(p)])).rows[0].h;
await db.exec(renderManagedHistoryMigration([await hash(payload)],await hash(scope)));await db.exec("SET request.jwt.claim.role='service_role'");return db}
const rpc=(db,p=payload,mode='dry-run',name='admin_import_historical_cb_17_18')=>db.query(`SELECT public.${name}($1::jsonb,$2) result`,[JSON.stringify(p),mode]).then(r=>r.rows[0].result);
test('only service role may invoke fixed operations; changed or additional payload is rejected',async()=>{const db=await fixture();try{
 await db.exec("SET ROLE authenticated; SET request.jwt.claim.role='authenticated'");await assert.rejects(rpc(db),/permission denied/);await db.exec('RESET ROLE');await assert.rejects(rpc(db),/Service role required/);await db.exec("SET request.jwt.claim.role='service_role';SET ROLE service_role");
 assert.equal((await rpc(db)).missing,2);await assert.rejects(rpc(db,[{...action,profile_id:id(99)},courseAction],'execute'),/owner-approved/);await assert.rejects(rpc(db,[...payload,action],'execute'),/owner-approved/);await assert.rejects(rpc(db,payload,'unknown'),/supported operation/);
}finally{await db.close()}});
test('managed rollback leaves zero rows; exact replay inserts no duplicates, money, or month/access',async()=>{const db=await fixture();try{
 const dry=await rpc(db);assert.equal(dry.missing,2);const rollback=await rpc(db,payload,'rollback');assert.equal(rollback.rolled_back,true);assert.equal(rollback.inserted,2);assert.equal((await db.query('SELECT count(*)::int n FROM orders_v2')).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,0);
 assert.equal((await rpc(db,payload,'execute')).inserted,2);assert.equal((await rpc(db,payload,'execute')).inserted,0);const rows=(await db.query('SELECT * FROM orders_v2')).rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.meta.deal_month===undefined&&Number(r.paid_amount)===0));
 for(const table of ['payments_v2','subscriptions_v2','entitlements','entitlement_sources'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
}finally{await db.close()}});
test('unexpected trigger access rolls the entire managed request back',async()=>{const db=await fixture();try{
 await db.exec(`CREATE FUNCTION bad_grant() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO entitlements(order_id) VALUES(NEW.id);RETURN NEW;END$$;CREATE TRIGGER bad AFTER INSERT ON orders_v2 FOR EACH ROW EXECUTE FUNCTION bad_grant()`);
 await assert.rejects(rpc(db,payload,'execute'),/Unexpected historical payment\/access/);for(const t of ['orders_v2','entitlements','audit_logs'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n,0);
}finally{await db.close()}});
test('scope RPC preserves windows, rolls back rehearsal, and refuses to enlarge access without paid Club',async()=>{const db=await fixture();try{
 await rpc(db,payload,'execute');await db.query(`INSERT INTO orders_v2(id,user_id,profile_id,product_id,tariff_id,status,is_deleted,is_trial,meta) VALUES($1,$2,$3,'11c9f1b8-0355-4753-bd74-40b42aa53616','7c748940-dcad-4c7c-a92e-76a2344622d3','paid',false,false,'{}')`,[id(6),id(2),id(1)]);
 await db.query(`INSERT INTO subscriptions_v2 VALUES($1,$2,'11c9f1b8-0355-4753-bd74-40b42aa53616','7c748940-dcad-4c7c-a92e-76a2344622d3','active',false,now()-interval '1 day',now()+interval '1 day')`,[id(6),id(2)]);
 await db.query(`INSERT INTO entitlements(id,user_id,product_id,status,expires_at,meta) VALUES($1,$2,$3,'active',now()+interval '1 day','{"source_rule_id":"1b497fba-031a-4318-8d9f-2530f1bac116","scope_resolution_mode":"module_scope_only"}')`,[id(5),id(2),course]);
 const call=mode=>rpc(db,scope,mode,'admin_repair_historical_cb_scope');await assert.rejects(call('execute'),/No current paid Business/);await db.query("INSERT INTO payments_v2 VALUES($1,'succeeded','BYN',250,0)",[id(6)]);
 const before=(await db.query('SELECT * FROM entitlements')).rows[0];assert.equal((await call('rollback')).rolled_back,true);assert.deepEqual((await db.query('SELECT * FROM entitlements')).rows[0],before);assert.equal((await call('execute')).changed,1);assert.equal((await call('execute')).changed,0);
 const after=(await db.query('SELECT * FROM entitlements')).rows[0];assert.deepEqual({...after,meta:before.meta},before);assert.equal(after.meta.scope_resolution_mode,'full_tariff_scope');
}finally{await db.close()}});
