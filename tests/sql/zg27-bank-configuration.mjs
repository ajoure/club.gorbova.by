import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const raw=readFileSync(new URL('../../supabase/migrations/20261119211122_zg27_bank_installment.sql',import.meta.url),'utf8');
const product='e71c0dbb-baf2-4b6c-a950-bf0f728708af',first='d0fce8c6-473a-49a1-978f-1069d0f012bc',repeat='08059eb1-748a-4ad6-8283-e6f1efa2f40f';
const code='<main><a class="button" href="#zg27-payment" data-lovable-action="open-zg27-payment">Join<span class="arrow" aria-hidden="true"></span></a><p class="caption">Internal 2/3 payments.</p><p>Keep</p><a class="button" href="#zg27-payment" data-lovable-action="open-zg27-payment">Join again</a><div class="row"><p class="caption">Internal 2/3 payments.</p></div></main>';
let sql=raw;
// Replace only the two frozen public HTML hashes with the synthetic equivalent.
const hashes=[...raw.matchAll(/'([a-f0-9]{32})'\)/g)].map(m=>m[1]);assert.equal(hashes.length,2);
for(const hash of hashes)sql=sql.replace(hash,createHash('md5').update(code).digest('hex'));
const guard=readFileSync(new URL('../../supabase/migrations/20260715204954_e793d3a4-03fe-4772-95cc-6e6d0c284e5e.sql',import.meta.url),'utf8');
const idx=readFileSync(new URL('../../supabase/migrations/20260715203616_212c990b-c303-48f5-9570-25ee19794a4d.sql',import.meta.url),'utf8').match(/CREATE UNIQUE INDEX tariff_offers_slot_role_per_tariff_uidx[\s\S]*?;/)[0];
async function fixture(){
 const db=new PGlite();await db.exec(`CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid,is_active boolean,meta jsonb);
 CREATE TABLE products_v2(id uuid PRIMARY KEY);INSERT INTO products_v2 VALUES('${product}');
 CREATE TABLE tariff_offers(id uuid PRIMARY KEY,tariff_id uuid,is_active boolean,offer_type text,payment_method text,amount numeric,button_label text,sort_order integer,meta jsonb);
 CREATE TABLE site_pages(id uuid PRIMARY KEY,slug text,status text,blocks jsonb);
 INSERT INTO tariffs VALUES('${first}','${product}',true,'{"course_access":{"end_exclusive":"2027-04-30T21:00:00.000Z"}}'),('${repeat}','${product}',true,'{"course_access":{"end_exclusive":"2027-04-30T21:00:00.000Z"}}');`);
 for(const [t,i] of [[first,0],[repeat,1]])for(let n=1;n<=3;n++)await db.query("INSERT INTO tariff_offers VALUES($1,$2,true,'pay_now','full_payment',$3,'Keep',0,$4)",[`00000000-0000-4000-8000-0000000000${i}${n}`,t,i?890:1290,{slot_role:`button_${n}`,site_button_variant:'primary'}]);
 for(const [id,slug]of [['d0da405e-0fab-4f52-bbc8-ed30b15317e9','zg27pervoe'],['164a1f0b-eb1e-4917-b2aa-73dbdbc21e6d','zg27povtor']])await db.query('INSERT INTO site_pages VALUES($1,$2,$3,$4)',[id,slug,'published',[{id:'before',type:'footer'},{id:'html',type:'html',content:{code}},{id:'after',type:'zg27_checkout'}]]);
 await db.exec(idx+guard);return db;
}
let passed=0;
{
 const db=await fixture();const before=(await db.query("SELECT jsonb_agg(to_jsonb(o) ORDER BY id) AS v FROM tariff_offers o")).rows[0].v;
 await db.exec(sql);await db.exec(sql);
 const rows=(await db.query("SELECT * FROM tariff_offers WHERE offer_type='bank_installment' ORDER BY amount")).rows;assert.deepEqual(rows.map(r=>Number(r.amount)),[890,1290]);assert.ok(rows.every(r=>r.payment_method==='full_payment'&&r.meta.bank_installment.rr_runtime.provider==='rr'));passed++;
 assert.deepEqual((await db.query("SELECT jsonb_agg(to_jsonb(o) ORDER BY id) AS v FROM tariff_offers o WHERE offer_type<>'bank_installment'")).rows[0].v,before);passed++;
 for(const p of (await db.query('SELECT blocks FROM site_pages')).rows){assert.equal(p.blocks[0].id,'before');assert.equal(p.blocks[2].id,'after');const html=p.blocks[1].content.code;assert.ok(html.includes('color:var(--accent)!important'));assert.ok(html.indexOf('Internal 2/3 payments.')<html.indexOf('open-zg27-bank'));assert.equal((html.match(/open-zg27-bank/g)||[]).length,2);assert.equal((html.match(/open-zg27-payment/g)||[]).length,2);assert.ok(html.includes('<p>Keep</p>'));}passed++;
 await db.close();
}
for(const kind of ['html_drift','slot_conflict','empty_six','missing_six']){
 const db=await fixture();if(kind==='html_drift')await db.exec("UPDATE site_pages SET blocks=jsonb_set(blocks,'{1,content,code}','\"changed\"')");else if(kind==='slot_conflict') await db.query("INSERT INTO tariff_offers VALUES('00000000-0000-4000-8000-000000000099',$1,true,'lead','full_payment',1,'Conflict',0,'{\"slot_role\":\"installment_bank\",\"site_button_variant\":\"lead\"}')",[first]);
 if(kind==='empty_six')await db.exec('DELETE FROM tariff_offers');
 if(kind==='missing_six')await db.exec("DELETE FROM tariff_offers WHERE id='00000000-0000-4000-8000-000000000001'");
 await assert.rejects(db.exec(sql),kind.endsWith('_six')?/zg27_bank_six_baseline_mismatch/:undefined);await db.exec('ROLLBACK');assert.equal((await db.query("SELECT count(*)::int n FROM tariff_offers WHERE offer_type='bank_installment'")).rows[0].n,0);if(kind.endsWith('_six'))for(const page of (await db.query('SELECT blocks FROM site_pages')).rows)assert.equal(page.blocks[1].content.code,code,'failed baseline must leave original CTA HTML unchanged');passed++;
 await db.close();
}
console.log(`ZG27 bank native SQL ${passed} PASS: actual slot guard/index, 2 offers, 4 CTA, replay, immutable six, drift/conflict rollback`);
