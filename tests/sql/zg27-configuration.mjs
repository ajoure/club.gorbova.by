import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
let migration = readFileSync(new URL('../../supabase/migrations/20261118210351_zg27_checkout_configuration.sql', import.meta.url),'utf8');
// Only frozen public HTML hash literals are adapted to small synthetic source.
// Every SQL statement, guard, update and transaction is the actual migration.
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/zg27-public-landing-baseline.json',import.meta.url),'utf8'));
const pages=fixtures.map(f=>f.page);
for(const f of fixtures){assert.equal(migration.split(f.baseline_md5).length-1,1);const synthetic=createHash('md5').update(f.page.blocks[0].content.code).digest('hex');migration=migration.replace(f.baseline_md5,synthetic);}
const product='e71c0dbb-baf2-4b6c-a950-bf0f728708af', first='d0fce8c6-473a-49a1-978f-1069d0f012bc', repeat='08059eb1-748a-4ad6-8283-e6f1efa2f40f';
const offers=[['2fd031d9-f94e-4dac-991a-4e11bc7d0bbb',first,1,1290],['1e3b02c3-3a67-4505-b399-5de565cff20c',first,2,1290],['834a032c-09ae-47a8-b75b-8a828dad3547',first,3,1290],['3a85b4bc-d479-4aa5-bf34-d66625610315',repeat,1,890],['8f03fa98-67a0-45a8-aeed-bebef555bf07',repeat,2,900],['f94cb0b9-b98d-4162-b0b6-ca17e3d5841a',repeat,3,900]];
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
for(const [id,t,n,a] of offers)await db.query('INSERT INTO tariff_offers VALUES($1,$2,true,\'pay_now\',$3,$4,$5,30,0,$6)',[id,t,n===1?'full_payment':'internal_installment',a,n===1?null:3,JSON.stringify({preserve:true,installment:{rounding_mode:'ceil_to_whole_byn'}})]);
for(const p of pages)await db.query('INSERT INTO site_pages VALUES($1,$2,$3,$4,$5)',[p.id,p.slug,p.status,p.product_id,JSON.stringify(p.blocks)]);
const snapshot=async()=>JSON.stringify((await db.query('SELECT * FROM site_pages ORDER BY id')).rows);
const before=await snapshot();
// Unexpected content must abort the entire transaction, preserving all business rows.
await db.query("UPDATE site_pages SET blocks=jsonb_set(blocks,'{0,content,code}',to_jsonb('changed'::text)) WHERE slug='zg27pervoe'");
await assert.rejects(db.exec(migration),/zg27_html_baseline_mismatch/);await db.exec('ROLLBACK');
assert.equal((await db.query('SELECT amount FROM tariff_offers WHERE id=$1',[offers[4][0]])).rows[0].amount,'900');
for(const p of pages)await db.query('UPDATE site_pages SET blocks=$1 WHERE id=$2',[JSON.stringify(p.blocks),p.id]);
assert.equal(await snapshot(),before);
await db.exec(migration);
const read=async()=>JSON.stringify((await db.query('SELECT * FROM site_pages ORDER BY id')).rows)+JSON.stringify((await db.query('SELECT * FROM tariff_offers ORDER BY id')).rows)+JSON.stringify((await db.query('SELECT * FROM access_rules ORDER BY id')).rows);
const installed=await read();await db.exec(migration);assert.equal(await read(),installed);
const ps=(await db.query('SELECT * FROM site_pages ORDER BY slug')).rows;
assert.equal(ps.filter(p=>p.product_id===product).length,1);assert.equal(ps.find(p=>p.slug==='zg27pervoe').product_id,product);
for(const p of ps){const bs=p.blocks;assert.equal(bs.at(-2).type,'zg27_checkout');assert.equal(bs.at(-1).type,'footer');assert.equal(bs.at(-2).content.product_id,product);assert.equal(bs.at(-2).content.page_slug,p.slug);assert.match(bs.at(-2).id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(bs.filter(b=>b.type==='zg27_checkout').length,1);const html=bs.find(b=>b.type==='html').content.code;assert.equal((html.match(/data-lovable-action="open-zg27-payment"/g)||[]).length,2);assert.equal((html.match(/href="mailto:/g)||[]).length,0);}
for(const [id,t,n]of offers){const o=(await db.query('SELECT * FROM tariff_offers WHERE id=$1',[id])).rows[0];assert.equal(Number(o.amount),t===first?1290:890);assert.equal(o.installment_count,n);assert.equal(o.installment_interval_days,30);assert.equal(o.first_payment_delay_days,0);assert.equal(o.meta.preserve,true);if(n>1)assert.equal(o.meta.installment.rounding_mode,'last_payment_remainder');}
for(const t of (await db.query('SELECT * FROM tariffs')).rows){assert.equal(t.meta.preserve,true);assert.equal(t.meta.course_access.end_exclusive,'2027-04-30T21:00:00.000Z');}
assert.equal((await db.query('SELECT count(*)::int n FROM access_rules')).rows[0].n,2);
assert.deepEqual((await db.query('SELECT * FROM orders_v2')).rows,[{id:1,meta:{historical:true}}]);
assert.equal((await db.query('SELECT expires_at::text e FROM entitlements')).rows[0].e,'2030-01-01 00:00:00+00');
if(process.env.ZG27_CONFIG_BLOCK_OUTPUT)writeFileSync(process.env.ZG27_CONFIG_BLOCK_OUTPUT,JSON.stringify(ps.map(p=>p.blocks.find(b=>b.type==='zg27_checkout'))));
await db.close();console.log('PASS: actual configuration migration, baseline rejection/rollback, exact six offers, two page CTA/association, preserved UNIQUE, two library rules, replay idempotency, historical rows unchanged');
