import {test} from 'node:test';import assert from 'node:assert/strict';import {buildDateRepair,sourceTimestamp,renderDateMigration} from './date-repair.mjs';
const {PGlite}=await import(process.env.HISTORICAL_PGLITE_MODULE||'@electric-sql/pglite');
const id='00000000-0000-4000-8000-000000000001',product='64d9f812-617c-41a8-b3dc-bb113156d6f3';
const payload=[{id,product_id:product,refs:['17:2'],deal_date:'2024-05-14T14:41:44+03:00',source_date_ref:'17:2',source_paid_at:'2024-05-15T10:47:35+03:00'}];
const source={spreadsheet_id:'1dw8ljnBwfyNn26INHdwxt7MdRGs7aX5qkby7V1wWUq8',timezone:'Europe/Moscow',date_column:'D',paid_column:'E',rows:[{ref:'17:2',created_at:'2024-05-14 14:41:44',paid_at:'2024-05-15 10:47:35',module_flags:[1]},{ref:'17:3',created_at:'2024-05-13 14:41:44',paid_at:null,module_flags:[]}]};
test('source date follows selected module row, never payment time or unselected earlier row; unknown dates remain unknown',()=>{
 const action={id,product_id:product,kind:'module_only_standalone',refs:['17:2','17:3']};
 assert.equal(buildDateRepair([action],source).items[0].deal_date,payload[0].deal_date);
 assert.equal(buildDateRepair([{...action,kind:'base_tariff_purchase'}],source).items[0].source_date_ref,'17:3');
 const empty={...source,rows:source.rows.map(r=>({...r,created_at:null,paid_at:null}))};assert.equal(buildDateRepair([action],empty).unknown.length,1);
 assert.throws(()=>sourceTimestamp('2024-02-31 10:00:00'));assert.throws(()=>sourceTimestamp('2025-01-01 00:00:00'));
});
async function fixture(){const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.role',true),'')$$;GRANT USAGE ON SCHEMA auth TO PUBLIC;GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
CREATE TABLE orders_v2(id uuid PRIMARY KEY,product_id uuid,reconcile_source text,meta jsonb,status text,is_deleted boolean,base_price numeric,final_price numeric,paid_amount numeric,created_at timestamptz,deal_date timestamptz,updated_at timestamptz,owner_ref uuid);
CREATE TABLE audit_logs(action text,actor_type text,actor_label text,meta jsonb);
CREATE TABLE payments_v2(order_id uuid);CREATE TABLE subscriptions_v2(order_id uuid);CREATE TABLE entitlements(order_id uuid);CREATE TABLE entitlement_sources(order_id uuid);CREATE TABLE access_grant_ledger(order_id uuid,source_order_id uuid);CREATE TABLE referral_balance_transactions(source_id uuid);`);
const hash=(await db.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h",[JSON.stringify(payload)])).rows[0].h;
await db.exec(renderDateMigration([hash]));await db.exec('CREATE TRIGGER month BEFORE INSERT OR UPDATE OF status,deal_date,meta ON orders_v2 FOR EACH ROW EXECUTE FUNCTION orders_v2_autofill_deal_month()');
await db.query(`INSERT INTO orders_v2 VALUES($1,$2,'owner_confirmed_historical',$3,'paid',false,0,0,0,'2026-09-11T13:20:00Z',null,'2026-09-11T13:20:00Z',$1)`,[id,product,JSON.stringify({history_only:true,historical_batch_id:'hist-cb17-18-20260911-v1',source_spreadsheet_id:source.spreadsheet_id,source_refs:['17:2'],source_purchase_date_unknown:true})]);await db.exec("SET request.jwt.claim.role='service_role'");return db;}
const rpc=(db,mode='dry-run',p=payload)=>db.query('SELECT admin_repair_historical_cb_dates($1,$2) result',[JSON.stringify(p),mode]).then(r=>r.rows[0].result);
test('fixed service-only RPC restores source date, preserves import/owner/money and month boundary, rolls back and replays',async()=>{const db=await fixture();try{
 const before=(await db.query('SELECT * FROM orders_v2')).rows[0];assert.equal((await rpc(db)).changes,1);assert.deepEqual((await db.query('SELECT * FROM orders_v2')).rows[0],before);
 assert.equal((await rpc(db,'rollback')).rolled_back,true);assert.deepEqual((await db.query('SELECT * FROM orders_v2')).rows[0],before);assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,0);
 assert.equal((await rpc(db,'execute')).changes,1);const after=(await db.query('SELECT * FROM orders_v2')).rows[0];assert.deepEqual({...after,deal_date:before.deal_date,meta:before.meta},before);assert.equal(after.deal_date.toISOString(),'2024-05-14T11:41:44.000Z');assert.equal(after.meta.deal_month,undefined);assert.equal(after.meta.source_purchase_date_unknown,false);assert.equal((await rpc(db,'execute')).changes,0);assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,1);
 await db.exec("SET ROLE authenticated;SET request.jwt.claim.role='authenticated'");await assert.rejects(rpc(db),/permission denied/);await db.exec('RESET ROLE');await assert.rejects(rpc(db),/Service role/);await db.exec("SET request.jwt.claim.role='service_role'");await assert.rejects(rpc(db,'execute',[{...payload[0],deal_date:'2025-01-01T00:00:00Z'}]),/Unapproved/);
}finally{await db.close()}});
test('source mismatch, existing real date and unexpected trigger side effects stop without changes',async()=>{const db=await fixture();try{
 await db.exec("UPDATE orders_v2 SET deal_date='2024-01-01T00:00:00Z'");await assert.rejects(rpc(db,'execute'),/existing purchase date/);await db.exec('UPDATE orders_v2 SET deal_date=null');
 await db.exec("UPDATE orders_v2 SET meta=meta||'{\"source_refs\":[\"17:3\"]}'");await assert.rejects(rpc(db,'execute'),/source or financial/);await db.exec("UPDATE orders_v2 SET meta=meta||'{\"source_refs\":[\"17:2\"]}'");
 await db.exec('CREATE FUNCTION bad_access() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO entitlements VALUES(NEW.id);RETURN NEW;END $$;CREATE TRIGGER bad AFTER UPDATE ON orders_v2 FOR EACH ROW EXECUTE FUNCTION bad_access()');
 await assert.rejects(rpc(db,'execute'),/money\/access/);assert.equal((await db.query('SELECT deal_date FROM orders_v2')).rows[0].deal_date,null);assert.equal((await db.query('SELECT count(*)::int n FROM entitlements')).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,0);
}finally{await db.close()}});
