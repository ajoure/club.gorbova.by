import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
let migration = readFileSync(new URL('../../supabase/migrations/20261118210351_zg27_checkout_configuration.sql', import.meta.url),'utf8');
// Reconstruct the actual pre-fix SQL without depending on a shallow checkout's git history.
// The digest was captured from git HEAD before this release patch; any drift fails closed.
const slotRepairGuard = " -- Legacy repeat/full omitted its slot. Repair only that known empty slot;\n -- retain the existing dynamic-slot trigger and every other button mapping.\n IF EXISTS(SELECT 1 FROM public.tariff_offers WHERE id='3a85b4bc-d479-4aa5-bf34-d66625610315'::uuid\n   AND (coalesce(meta->>'slot_role','') NOT IN('','button_1') OR meta->>'site_button_variant' IS DISTINCT FROM 'primary'))\n   OR EXISTS(SELECT 1 FROM public.tariff_offers WHERE tariff_id=repeat_tariff\n     AND id<>'3a85b4bc-d479-4aa5-bf34-d66625610315'::uuid AND meta->>'slot_role'='button_1')\n THEN RAISE EXCEPTION 'zg27_repeat_full_slot_baseline_mismatch'; END IF;\n";
const slotRepairMerge = "\n ||CASE WHEN o.id='3a85b4bc-d479-4aa5-bf34-d66625610315'::uuid THEN jsonb_build_object('slot_role','button_1') ELSE '{}'::jsonb END\n ";
assert.equal(migration.split(slotRepairGuard).length-1,1);
assert.equal(migration.split(slotRepairMerge).length-1,1);
let originalMigration=migration.replace(slotRepairGuard,'').replace(slotRepairMerge,'');
assert.equal(createHash('sha256').update(originalMigration).digest('hex'),"d641c9b580405039eeab3bf6322880ff8a63b7f0a85eba2e0ced70b4b4f8b2c1");
const scenarios=[];
// Only frozen public HTML hash literals are adapted to small synthetic source.
// Every SQL statement, guard, update and transaction is the actual migration.
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/zg27-public-landing-baseline.json',import.meta.url),'utf8'));
const pages=fixtures.map(f=>f.page);
for(const f of fixtures){assert.equal(migration.split(f.baseline_md5).length-1,1);const synthetic=createHash('md5').update(f.page.blocks[0].content.code).digest('hex');migration=migration.replace(f.baseline_md5,synthetic);originalMigration=originalMigration.replace(f.baseline_md5,synthetic);}
const product='e71c0dbb-baf2-4b6c-a950-bf0f728708af', first='d0fce8c6-473a-49a1-978f-1069d0f012bc', repeat='08059eb1-748a-4ad6-8283-e6f1efa2f40f';
const offers=[['2fd031d9-f94e-4dac-991a-4e11bc7d0bbb',first,1,1290],['1e3b02c3-3a67-4505-b399-5de565cff20c',first,2,1290],['834a032c-09ae-47a8-b75b-8a828dad3547',first,3,1290],['3a85b4bc-d479-4aa5-bf34-d66625610315',repeat,1,890],['8f03fa98-67a0-45a8-aeed-bebef555bf07',repeat,2,900],['f94cb0b9-b98d-4162-b0b6-ca17e3d5841a',repeat,3,900]];
// Exact observed slot/variant metadata, including the legacy repeat/full omission.
const slots=['button_1','button_5','button_6',null,'button_2','button_3'];
const variants=['primary','outline','installment','primary','outline','installment'];
const baselineMeta=offers.map(([, ,n],i)=>({site_button_variant:variants[i],...(slots[i]?{slot_role:slots[i]}:{}),
 ...(n>1?{installment:{first_payment_delay_days:0,interval_days:30,max_charge_attempts:3,max_months:3,rounding_mode:'ceil_to_whole_byn'}}:{})}));
const slotStep1=readFileSync(new URL('../../supabase/migrations/20260715203616_212c990b-c303-48f5-9570-25ee19794a4d.sql',import.meta.url),'utf8');
const indexDDL=slotStep1.match(/CREATE UNIQUE INDEX tariff_offers_slot_role_per_tariff_uidx[\s\S]*?;/)?.[0];
assert.ok(indexDDL,'actual partial slot UNIQUE index source is required');
const slotGuardSQL=readFileSync(new URL('../../supabase/migrations/20260715204954_e793d3a4-03fe-4772-95cc-6e6d0c284e5e.sql',import.meta.url),'utf8');
async function createFixture(){
const db=new PGlite();
await db.exec(`SET TIME ZONE 'UTC'; CREATE TABLE products_v2(id uuid PRIMARY KEY,is_active boolean,status text);
 CREATE TABLE training_modules(id uuid PRIMARY KEY,product_id uuid,parent_module_id uuid,slug text);
 CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid,is_active boolean,meta jsonb);
 CREATE TABLE tariff_offers(id uuid PRIMARY KEY,tariff_id uuid,is_active boolean,offer_type text,payment_method text,amount numeric,installment_count int,installment_interval_days int,first_payment_delay_days int,meta jsonb);
 CREATE TABLE site_pages(id uuid PRIMARY KEY,slug text UNIQUE,status text,product_id uuid,blocks jsonb);
 CREATE UNIQUE INDEX idx_site_pages_product_id_unique ON site_pages(product_id) WHERE product_id IS NOT NULL;
 CREATE TABLE access_rules(id uuid PRIMARY KEY,product_id uuid,tariff_id uuid,grant_target_type text,target_ref text,conditions jsonb,is_active boolean);
 CREATE UNIQUE INDEX tc ON access_rules(product_id,tariff_id,grant_target_type,target_ref);
 CREATE TABLE orders_v2(id int,meta jsonb); CREATE TABLE entitlements(id int,expires_at timestamptz);
 INSERT INTO orders_v2 VALUES(1,'{"historical":true}'); INSERT INTO entitlements VALUES(1,'2030-01-01');`);
await db.query('INSERT INTO products_v2 VALUES($1,true,\'active\')',[product]);
await db.query('INSERT INTO training_modules VALUES($1,$2,null,\'zakroj-god-2027\')',['2ee0cb2a-ab85-47b1-85e0-5c3f30242046',product]);
for(const t of [first,repeat])await db.query('INSERT INTO tariffs VALUES($1,$2,true,\'{"preserve":true}\')',[t,product]);
for(const [i,[id,t,n,a]] of offers.entries())await db.query('INSERT INTO tariff_offers VALUES($1,$2,true,\'pay_now\',$3,$4,$5,30,0,$6)',[id,t,n===1?'full_payment':'internal_installment',a,n===1?null:3,JSON.stringify(baselineMeta[i])]);
for(const p of pages)await db.query('INSERT INTO site_pages VALUES($1,$2,$3,$4,$5)',[p.id,p.slug,p.status,p.product_id,JSON.stringify(p.blocks)]);
// Install guard AFTER legacy fixture creation, matching the deployed legacy state.
await db.exec(indexDDL);await db.exec(slotGuardSQL);
return db;
}
const db=await createFixture();
const allTables=['products_v2','training_modules','tariffs','tariff_offers','site_pages','access_rules','orders_v2','entitlements'];
const fullSnapshot=async(target=db)=>JSON.stringify(await Promise.all(allTables.map(async table=>
 [table,(await target.query(`SELECT * FROM ${table} ORDER BY id`)).rows])));
const initialState=await fullSnapshot();
await assert.rejects(db.exec(originalMigration),error=>error.code==='23514'&&/meta.slot_role is required/.test(error.message));
await db.exec('ROLLBACK');assert.equal(await fullSnapshot(),initialState);scenarios.push('original trigger rejection and complete rollback');
const snapshot=async()=>JSON.stringify((await db.query('SELECT * FROM site_pages ORDER BY id')).rows);
const before=await snapshot();
// Unexpected content must abort the entire transaction, preserving all business rows.
await db.query("UPDATE site_pages SET blocks=jsonb_set(blocks,'{0,content,code}',to_jsonb('changed'::text)) WHERE slug='zg27pervoe'");
const changedHtmlState=await fullSnapshot();
await assert.rejects(db.exec(migration),/zg27_html_baseline_mismatch/);await db.exec('ROLLBACK');assert.equal(await fullSnapshot(),changedHtmlState);scenarios.push('HTML guard complete rollback');
assert.equal((await db.query('SELECT amount FROM tariff_offers WHERE id=$1',[offers[4][0]])).rows[0].amount,'900');
for(const p of pages)await db.query('UPDATE site_pages SET blocks=$1 WHERE id=$2',[JSON.stringify(p.blocks),p.id]);
assert.equal(await snapshot(),before);
await db.exec(migration);
const read=async()=>JSON.stringify((await db.query('SELECT * FROM site_pages ORDER BY id')).rows)+JSON.stringify((await db.query('SELECT * FROM tariff_offers ORDER BY id')).rows)+JSON.stringify((await db.query('SELECT * FROM access_rules ORDER BY id')).rows);
const installed=await read();await db.exec(migration);assert.equal(await read(),installed);scenarios.push('patched migration replay idempotency');
const ps=(await db.query('SELECT * FROM site_pages ORDER BY slug')).rows;
assert.equal(ps.filter(p=>p.product_id===product).length,1);assert.equal(ps.find(p=>p.slug==='zg27pervoe').product_id,product);
for(const p of ps){const bs=p.blocks;assert.equal(bs.at(-2).type,'zg27_checkout');assert.equal(bs.at(-1).type,'footer');assert.equal(bs.at(-2).content.product_id,product);assert.equal(bs.at(-2).content.page_slug,p.slug);assert.match(bs.at(-2).id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(bs.filter(b=>b.type==='zg27_checkout').length,1);const html=bs.find(b=>b.type==='html').content.code;assert.equal((html.match(/data-lovable-action="open-zg27-payment"/g)||[]).length,2);assert.equal((html.match(/href="mailto:/g)||[]).length,0);}
for(const [i,[id,t,n]]of offers.entries()){const o=(await db.query('SELECT * FROM tariff_offers WHERE id=$1',[id])).rows[0];assert.equal(Number(o.amount),t===first?1290:890);assert.equal(o.installment_count,n);assert.equal(o.installment_interval_days,30);assert.equal(o.first_payment_delay_days,0);assert.equal(o.meta.site_button_variant,variants[i]);assert.equal(o.meta.slot_role,slots[i]??'button_1');if(n>1){assert.equal(o.meta.installment.rounding_mode,'last_payment_remainder');assert.equal(o.meta.installment.max_charge_attempts,3);}}
for(const t of (await db.query('SELECT * FROM tariffs')).rows){assert.equal(t.meta.preserve,true);assert.equal(t.meta.course_access.end_exclusive,'2027-04-30T21:00:00.000Z');}
assert.equal((await db.query('SELECT count(*)::int n FROM access_rules')).rows[0].n,2);
assert.deepEqual((await db.query('SELECT * FROM orders_v2')).rows,[{id:1,meta:{historical:true}}]);
assert.equal((await db.query('SELECT expires_at::text e FROM entitlements')).rows[0].e,'2030-01-01 00:00:00+00');
scenarios.push('patched exact configuration and five existing slot/variant mappings preserved');
const guardedState=await fullSnapshot();
await assert.rejects(db.query("UPDATE tariff_offers SET meta=meta||'{\"slot_role\":\"button_1\"}'::jsonb WHERE id=$1",[offers[4][0]]),error=>error.code==='23505');
assert.equal(await fullSnapshot(),guardedState);scenarios.push('actual partial UNIQUE index rejects duplicate');
for(const [name,id,patch] of [
 ['unexpected repeat full slot',offers[3][0],{slot_role:'button_9'}],
 ['repeat slot already owned by another offer',offers[4][0],{slot_role:'button_1'}],
 ['unexpected repeat full variant',offers[3][0],{slot_role:'button_1',site_button_variant:'outline'}],
]){
 const negative=await createFixture();
 try{
  await negative.query('UPDATE tariff_offers SET meta=meta||$1::jsonb WHERE id=$2',[JSON.stringify(patch),id]);
  const negativeBefore=await fullSnapshot(negative);
  await assert.rejects(negative.exec(migration),/zg27_repeat_full_slot_baseline_mismatch/);await negative.exec('ROLLBACK');
  assert.equal(await fullSnapshot(negative),negativeBefore);scenarios.push(name+' fails closed with complete rollback');
 }finally{await negative.close()}
}
if(process.env.ZG27_CONFIG_BLOCK_OUTPUT)writeFileSync(process.env.ZG27_CONFIG_BLOCK_OUTPUT,JSON.stringify(ps.map(p=>p.blocks.find(b=>b.type==='zg27_checkout'))));
await db.close();for(const scenario of scenarios)console.log('PASS:',scenario);console.log(`PASS: ${scenarios.length} scenarios; real slot trigger/index, exact six offers, two page CTA/association, two library rules, historical rows unchanged`);
