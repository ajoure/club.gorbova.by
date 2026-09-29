import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const base = new URL('../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('scripts/training/cb21-oct31-schedule.json', base), 'utf8'));
const migration = await readFile(new URL('supabase/migrations/20260929105637_cb21_oct31_module_schedule.sql', base), 'utf8');
const release = await readFile(new URL('supabase/migrations/20260929061010_cb21_learning_release_gate.sql', base), 'utf8');
const product = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596', root = '4365e913-36f1-432e-ab16-748c3ca6826a';
const flow = 'b10e15c5-51c3-5df5-ba83-a42416da5902', sourceProduct = '3e43fb28-8322-41bc-bfee-714731bdc630';
const sourceRoot = '2e5cbc7b-bbaf-4384-b894-bbd98d7f524e', sourceFlow = 'c9901a13-a909-4b22-b631-3f6cf962aec9';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const buyer=id(1), oldBuyer=id(2), expired=id(3), tariff=id(4);
await db.exec(`
 CREATE SCHEMA auth; CREATE SCHEMA private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
 CREATE FUNCTION public.has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.has_permission(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE training_modules(id uuid PRIMARY KEY,parent_module_id uuid,product_id uuid,title text,sort_order int,is_active boolean,published_at timestamptz);
 CREATE TABLE training_lessons(id uuid PRIMARY KEY,module_id uuid,title text,sort_order int,is_active boolean,published_at timestamptz,require_previous boolean DEFAULT false,content text DEFAULT 'unchanged');
 CREATE TABLE flows(id uuid PRIMARY KEY,product_id uuid,start_date date,end_date date,is_active boolean,meta jsonb,updated_at timestamptz);
 CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid);
 CREATE TABLE tariff_offers(id uuid PRIMARY KEY,tariff_id uuid,is_active boolean,meta jsonb);
 CREATE TABLE offer_addons(id uuid PRIMARY KEY,parent_offer_id uuid,is_active boolean,access_delivery_mode text,access_opens_at timestamptz);
 CREATE TABLE orders_v2(id uuid PRIMARY KEY,status text,amount numeric);
 CREATE TABLE order_group_items(id uuid PRIMARY KEY,order_id uuid,order_group_id uuid,role text,product_id uuid,item_snapshot jsonb);
 CREATE TABLE scheduled_product_access(id uuid PRIMARY KEY,order_group_id uuid,status text,access_delivery_mode text,opens_at timestamptz,updated_at timestamptz);
 CREATE TABLE audit_logs(action text,actor_type text CHECK(actor_type IN ('user','system','service')),actor_user_id uuid,entity_type text,entity_id text,meta jsonb);
 CREATE TABLE entitlement_sources(user_id uuid,product_id uuid,tariff_id uuid,status text,starts_at timestamptz,expires_at timestamptz);
 CREATE TABLE subscriptions_v2(user_id uuid,product_id uuid,tariff_id uuid,status text,access_start_at timestamptz,access_end_at timestamptz);
 CREATE TABLE entitlements(user_id uuid,product_id uuid,status text,expires_at timestamptz,meta jsonb);
 CREATE TABLE access_rules(product_id uuid,tariff_id uuid,is_active boolean,grant_target_type text,target_ref text,conditions jsonb);
 CREATE TABLE module_access(module_id uuid,tariff_id uuid);
 CREATE TABLE lesson_progress(user_id uuid,lesson_id uuid);
 CREATE TABLE lesson_progress_state(user_id uuid,lesson_id uuid);
 CREATE TABLE user_lesson_progress(user_id uuid,lesson_id uuid);
 INSERT INTO flows VALUES('${sourceFlow}','${sourceProduct}','2026-08-01','2026-10-15',true,'{}',now()),
 ('${flow}','${product}','2026-11-01','2026-12-10',true,'{"learning_gate":{"root_module_id":"${root}","addon_delay_days":45,"addon_mode":"scheduled","timezone":"Europe/Minsk"}}',now());
 INSERT INTO training_modules VALUES('${sourceRoot}',null,'${sourceProduct}','CB20',0,true,null),
 ('${root}',null,'${product}','CB21',0,true,'2026-10-31T21:00Z'),
 ('${id(9)}','${root}','${product}','Pretraining',0,true,null);
 INSERT INTO training_lessons(id,module_id,title,is_active) VALUES('${id(10)}','${id(9)}','Pretraining lesson',true);
 INSERT INTO tariffs VALUES('${tariff}','${product}');
 INSERT INTO tariff_offers VALUES('${id(11)}','${tariff}',true,'{}'),('${id(12)}','${tariff}',true,'{"sales_legacy_only":true}');
 INSERT INTO entitlement_sources VALUES('${buyer}','${product}','${tariff}','active','2026-09-01','2027-06-30'),
 ('${oldBuyer}','${sourceProduct}','${tariff}','active','2026-09-01','2027-06-30'),
 ('${expired}','${product}','${tariff}','active','2026-09-01','2026-10-30');
 INSERT INTO access_rules VALUES('${product}','${tariff}',true,'training_content','${root}','{"access_mode":"full"}');
`);
for (const m of manifest.modules) {
  await db.query('INSERT INTO training_modules VALUES($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14)',
    [m.src,sourceRoot,sourceProduct,m.src_title,m.src_sort,true,m.src_pub,m.dst,root,product,m.dst_title,m.dst_sort,m.dst_active,m.dst_pub]);
}
for (const l of manifest.lessons) {
  const m=manifest.modules.find(m=>m.src===l.m);
  await db.query('INSERT INTO training_lessons(id,module_id,title,sort_order,is_active,published_at) VALUES($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)',
    [l.src,l.m,l.src_title,l.src_sort,l.src_active,l.src_pub,l.dst,m.dst,l.dst_title,l.dst_sort,l.dst_active,l.dst_pub]);
}
for(let n=0;n<236;n++) await db.query('INSERT INTO offer_addons VALUES($1,$2,true,$3,$4)',
  [id(100+n),id(n<128?11:12),n<128?'fixed_date':'manual',n<128?'2026-12-15T21:00Z':null]);
for(let n=0;n<8;n++) {
  await db.query('INSERT INTO orders_v2 VALUES($1,$2,123)',[id(400+n),n===7?'paid':n===6?'draft':'pending']);
  await db.query('INSERT INTO order_group_items VALUES($1,null,$2,\'primary\',$3,\'{}\'),($4,$5,$2,\'addon\',$6,$7)',
    [id(500+n),id(600+n),product,id(700+n),id(400+n),sourceProduct,JSON.stringify({access_delivery_mode:'fixed_date',access_opens_at:'2026-12-15T21:00:00+00:00',price:123})]);
}
for(let n=0;n<4;n++) await db.query("INSERT INTO scheduled_product_access VALUES($1,$2,'scheduled','fixed_date','2026-09-30T21:00Z',now())",[id(800+n),id(900+n)]);
// Exercise the deployed trigger and lesson gate, not a reimplementation of release logic.
const definition = name => release.match(new RegExp('CREATE OR REPLACE FUNCTION '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\$fn\\$;'))[0];
await db.exec(definition('private.sync_cb21_learning_release').replace("ELSE 'admin' END","ELSE 'user' END"));
await db.exec("CREATE TRIGGER sync_cb21_learning_release AFTER UPDATE OF start_date,meta ON flows FOR EACH ROW EXECUTE FUNCTION private.sync_cb21_learning_release();");
await db.exec(definition('private.cb21_has_purchase'));
await db.exec(definition('private.cb21_lesson_lock_reason'));
const scalar=async(sql,args=[]) => (await db.query(sql,args)).rows[0].value;
const snapshot=async()=>scalar(`SELECT jsonb_build_object(
 'modules',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM training_modules m),
 'lessons',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM training_lessons l),
 'flows',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM flows f),
 'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM audit_logs a)) value`);
const rejectWithoutWrite=async(error)=>{
 const before=await snapshot();
 await assert.rejects(db.exec(migration),error);
 await db.exec('ROLLBACK');
 assert.deepEqual(await snapshot(),before);
};
// Corrupted source, changed target and newly added lessons all fail before modifying access.
await db.query("UPDATE training_lessons SET published_at=published_at+interval '1 day' WHERE id=$1",[manifest.lessons[0].src]);
await rejectWithoutWrite(/source_drift/);
await db.query('UPDATE training_lessons SET published_at=$1 WHERE id=$2',[manifest.lessons[0].src_pub,manifest.lessons[0].src]);
await db.query("UPDATE training_lessons SET title='different material' WHERE id=$1",[manifest.lessons[0].dst]);
await rejectWithoutWrite(/target_drift/);
await db.query('UPDATE training_lessons SET title=$1 WHERE id=$2',[manifest.lessons[0].dst_title,manifest.lessons[0].dst]);
await db.query("INSERT INTO training_lessons(id,module_id,title,is_active) VALUES($1,$2,'extra',true)",[id(999),manifest.modules[0].dst]);
await rejectWithoutWrite(/target_drift/);
await db.query('DELETE FROM training_lessons WHERE id=$1',[id(999)]);
const paidBefore=await scalar("SELECT item_snapshot value FROM order_group_items WHERE order_id=$1",[id(407)]);
const sourceBefore=await scalar("SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) value FROM training_lessons l JOIN training_modules m ON m.id=l.module_id WHERE m.product_id=$1",[sourceProduct]);
await db.exec(migration);
assert.equal(await scalar('SELECT start_date::text value FROM flows WHERE id=$1',[flow]),'2026-10-31');
assert.equal(await scalar('SELECT end_date::text value FROM flows WHERE id=$1',[flow]),'2026-12-10');
assert.equal(await scalar("SELECT count(*)::int value FROM offer_addons WHERE access_opens_at='2026-12-14T21:00Z'"),128);
assert.equal(await scalar("SELECT count(*)::int value FROM offer_addons WHERE access_opens_at IS NULL AND access_delivery_mode='manual'"),108);
assert.equal(await scalar("SELECT count(*)::int value FROM order_group_items WHERE role='addon' AND item_snapshot->>'access_opens_at'='2026-12-14T21:00:00+00:00'"),7);
assert.deepEqual(await scalar("SELECT item_snapshot value FROM order_group_items WHERE order_id=$1",[id(407)]),paidBefore);
assert.deepEqual(await scalar("SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) value FROM training_lessons l JOIN training_modules m ON m.id=l.module_id WHERE m.product_id=$1",[sourceProduct]),sourceBefore);
assert.equal(await scalar("SELECT count(*)::int value FROM scheduled_product_access WHERE opens_at='2026-09-30T21:00Z'"),4);
const first=manifest.lessons.find(l=>l.m===manifest.modules[0].src);
const reason=(u,l,t)=>scalar('SELECT private.cb21_lesson_lock_reason($1,$2,$3) value',[u,l,t]);
assert.equal(await reason(buyer,first.dst,'2026-10-30T20:59:59Z'),'before_start');
assert.equal(await reason(buyer,first.dst,'2026-10-31T04:59:59Z'),'unpublished');
assert.equal(await reason(buyer,first.dst,'2026-10-31T05:00:00Z'),null);
assert.equal(await reason(oldBuyer,first.dst,'2026-10-31T05:00:00Z'),'no_access');
assert.equal(await reason(expired,first.dst,'2026-10-31T05:00:00Z'),'no_access');
const noDate=manifest.lessons.find(l=>l.src_pub===null);
assert.equal(await reason(buyer,noDate.dst,'2026-11-02T04:59:59Z'),'unpublished');
assert.equal(await reason(buyer,noDate.dst,'2026-11-02T05:00:00Z'),null);
const inactive=manifest.lessons.find(l=>!l.dst_active);
assert.equal(await reason(buyer,inactive.dst,'2027-01-01T12:00Z'),'unpublished');
// Every active scheduled lesson remains inaccessible one second early and opens at its exact CB20 offset.
for(const l of manifest.lessons.filter(l=>l.dst_active&&l.dst_new_pub)) {
 const before=new Date(Date.parse(l.dst_new_pub)-1000).toISOString();
 assert.notEqual(await reason(buyer,l.dst,before),null);
 assert.equal(await reason(buyer,l.dst,l.dst_new_pub),null);
}
const after=await snapshot();
await db.exec(migration);
assert.deepEqual(await snapshot(),after,'rerun must be a no-op, including audit');
assert.equal(await scalar("SELECT count(*)::int value FROM audit_logs WHERE action='cb21.module_schedule_copied'"),1);
await db.close();
console.log('CB21 Oct31 schedule: 26/78 mapping, rollback on drift, all lesson boundaries, NULL/inactive exceptions, CB20/paid isolation, trigger updates and idempotent rerun PASS');
