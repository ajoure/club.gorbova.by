import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const sql=await readFile(new URL('./cb21-commercial-config.sql',import.meta.url),'utf8');
const types=await readFile(new URL('../../src/integrations/supabase/types.ts',import.meta.url),'utf8');
const p20='3e43fb28-8322-41bc-bfee-714731bdc630',p21='2b7bf6d4-ad8d-46ad-9399-7f96c307c596',root20='2e5cbc7b-bbaf-4384-b894-bbd98d7f524e',root21='4365e913-36f1-432e-ab16-748c3ca6826a';
async function fixture(){
 const db=new PGlite();
 for(const table of ['tariffs','tariff_offers','offer_addons','access_rules']) {
  const block=types.split(`      ${table}: {\n        Row: {\n`)[1].split('\n        }')[0];
  const columns=[...block.matchAll(/^          (\w+): ([^\n]+)/gm)].map(([,name,type])=>{
   const sqlType=name==='id'||name.endsWith('_id')&&!['public_id','getcourse_offer_id'].includes(name)?'uuid':name.endsWith('_at')?'timestamptz':type.includes('Json')?'jsonb':type.includes('boolean')?'boolean':type.includes('number')?'numeric':'text';
   const fallback=sqlType==='uuid'?'gen_random_uuid()':sqlType==='timestamptz'?'now()':sqlType==='jsonb'?"'{}'::jsonb":sqlType==='boolean'?'false':sqlType==='numeric'?'0':"''";
   const constraint=name==='id'?' PRIMARY KEY DEFAULT gen_random_uuid()':type.includes('null')?'':` NOT NULL DEFAULT ${fallback}`;
   return `${name} ${sqlType}${constraint}`;
  });
  await db.exec(`CREATE TABLE ${table}(${columns.join(',')})`);
 }
 await db.exec(`CREATE UNIQUE INDEX ON tariff_offers(tariff_id) WHERE is_primary=true AND offer_type='pay_now'; CREATE UNIQUE INDEX ON tariff_offers(tariff_id,((meta->>'slot_role'))) WHERE nullif(meta->>'slot_role','') IS NOT NULL; CREATE UNIQUE INDEX ON offer_addons(parent_offer_id,addon_offer_id);`);
 await db.exec(`CREATE TABLE sales_jobs(conversation_id uuid,status text); CREATE TABLE sales_conversations(id uuid,campaign_id uuid); CREATE TABLE audit_logs(actor_type text,action text,meta jsonb); CREATE TABLE sales_campaigns(code text,mode text,id uuid DEFAULT gen_random_uuid()); INSERT INTO sales_campaigns(code,mode) VALUES('cb21-owner-test','off'); CREATE TABLE training_modules(id uuid PRIMARY KEY,parent_module_id uuid,title text);`);
 const insert=async(table,row)=>db.query(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
 const pairs=[...sql.matchAll(/\('(accountant|chief|business|alumni|gift)','([^']+)','([^']+)',(\d+),(\d+|NULL),(\d+)\)/g)].map(([,role,source,target,price,old,days])=>({role,source,target,price:+price,old:old==='NULL'?null:+old,days:+days}));
 const sourceOffers=[...sql.split('INSERT INTO _cb21_offer_pairs VALUES\n')[1].split(';')[0].matchAll(/\('([^']+)',/g)].map(x=>x[1]);
 const destOffers=[...sql.split('INSERT INTO _cb21_offer_pairs VALUES\n')[1].split(';')[0].matchAll(/\('[^']+','([^']+)'\)/g)].map(x=>x[1]);
 const m20=[],m21=[];for(let i=0;i<28;i++){m20.push(randomUUID());m21.push(randomUUID());await insert('training_modules',{id:m20[i],parent_module_id:root20,title:i===0?`Конференции | 20 поток |`:`Модуль ${i}`});await insert('training_modules',{id:m21[i],parent_module_id:root21,title:i===0?`КОНФЕРЕНЦИИ | 21 поток |`:`Модуль ${i}`});}
 for(const [i,p] of pairs.entries()) {
  const sourcePrice=[1650,1950,2650,1325,0][i];
  for(const source of [true,false])await insert('tariffs',{id:source?p.source:p.target,product_id:source?p20:p21,name:p.role,code:randomUUID(),public_id:randomUUID(),is_active:true,is_public:i<3,access_days:p.days,price_monthly:source?null:i<3?p.price:null,original_price:source?null:p.old,meta:{card_config:{price_display:source?sourcePrice:p.price,old_price:source?2000:p.old},...(source?{}:{site_slot_key:p.role,course_access:{months:6}})}});
  for(let k=0;k<4;k++){
   const oi=i*4+k;const meta={slot_role:['button_1','button_2','button_3','button_5'][k],document_defaults:{amount:sourcePrice,unit_price:sourcePrice,service_period_from:'2026-08-01',service_period_to:'2027-02-28'},acquiring:{provider:'synthetic'}};
   const row={tariff_id:p.source,amount:i===4?1:sourcePrice,is_active:true,is_primary:k===0,button_label:['Карта','Счёт','Два платежа','Банк'][k],offer_type:k===1?'invoice':k===3?'bank_installment':'pay_now',payment_method:k===2?'internal_installment':'full_payment',installment_count:k===2?2:null,meta};
   await insert('tariff_offers',{...row,id:sourceOffers[oi]});
   if(i<3)await insert('tariff_offers',{...row,id:destOffers[oi],tariff_id:p.target,amount:p.price,meta:{...meta,document_defaults:{amount:p.price,unit_price:p.price}}});
  }
  const bonusCount=i===1?3:i===2?4:0;
  for(let k=0;k<=bonusCount;k++) {
   const target=randomUUID();for(const source of [true,false])await insert('access_rules',{id:randomUUID(),product_id:source?p20:p21,tariff_id:source?p.source:p.target,is_active:true,grant_target_type:k===0?'training_content':k===1?'club':'section_access',target_ref:k===0?source?root20:root21:target,conditions:k===0?{access_mode:i<2?'partial':'full',allowed_module_ids:i<2?(source?m20:m21).slice(0,i===0?source?24:21:26):[],allowed_lesson_ids:[]}: {rule_purpose:'bonus'},duration_days:k===0?null:30});
  }
 }
 for(const id of ['4d01edc1-6189-4017-ba43-922e7e9479ac','9687b2a8-585d-4770-9505-2a01030a093a','80780ddb-cafd-4427-ae8d-872853596120','e5b64e47-08d0-4ef5-8bed-2524d1ac8170'])await insert('tariff_offers',{id,tariff_id:pairs[3].target,amount:1325,is_active:true,meta:{slot_role:'old_'+id.slice(0,8)},button_label:'Старая ссылка'});
 for(let k=0;k<4;k++)for(let a=0;a<9;a++){
  const product=randomUUID(),tariff=randomUUID(),offer=randomUUID();
  for(const source of [true,false])await insert('offer_addons',{id:randomUUID(),parent_offer_id:source?sourceOffers[8+k]:destOffers[8+k],addon_product_id:product,addon_tariff_id:tariff,addon_offer_id:offer,is_active:true,pricing_mode:'percent_discount',discount_percent:50,is_required:false,is_default_selected:false,allow_repurchase_after_expiry:true,access_delivery_mode:source?'fixed_date':'manual',access_opens_at:source?'2026-09-30T21:00:00Z':null,meta:{},sort_order:a});
 }
 return {db,pairs};
}
const options={addon_opens_at:'2026-10-23T05:00:00Z',document_periods:Object.fromEntries(['accountant','chief','business','alumni','gift'].map(k=>[k,{from:'2026-10-23',to:'2026-12-10'}]))}; // Synthetic dates ONLY, not business approval.
async function run(db,opts={}){await db.query("SELECT set_config('cb21.sync_options',$1,false)",[JSON.stringify(opts)]);return db.exec(sql);}
async function snapshot(db){return (await db.query("SELECT jsonb_agg(to_jsonb(t) ORDER BY id) rows FROM tariffs t")).rows[0].rows;}
test('full sync dry run, exact fingerprint apply, existing financial terms and idempotent rerun',async()=>{
 const {db,pairs}=await fixture();try{
  const before=await snapshot(db);const dry=await run(db,options);assert.deepEqual(await snapshot(db),before);
  const plan=dry.flatMap(r=>r.rows??[]).find(r=>r.fingerprint);assert.ok(plan.fingerprint);assert.equal(plan.dates_supplied,true);
  await run(db,{...options,apply:true,expected_fingerprint:plan.fingerprint});
  const prices=(await db.query('SELECT meta FROM tariffs WHERE id=ANY($1::uuid[]) ORDER BY id',[pairs.slice(0,3).map(p=>p.target)])).rows.map(r=>r.meta.card_config.price_display).sort((a,b)=>a-b);assert.deepEqual(prices,[1790,2190,2990]);
  const course=(await db.query("SELECT conditions FROM access_rules WHERE tariff_id=$1 AND target_ref=$2",[pairs[0].target,root21])).rows[0];assert.equal(course.conditions.allowed_module_ids.length,24);
  const offers=(await db.query("SELECT amount,meta,installment_count FROM tariff_offers WHERE tariff_id=$1",[pairs[3].target])).rows;assert.equal(offers.filter(o=>o.meta.sales_generation==='cb21-alumni-v2').length,4);assert.ok(offers.filter(o=>o.meta.sales_generation==='cb21-alumni-v2').every(o=>Number(o.amount)===1495));assert.equal(offers.filter(o=>o.meta.sales_legacy_only&&Number(o.amount)===1325).length,4);
  assert.equal((await db.query('SELECT count(*)::int n FROM offer_addons')).rows[0].n,108); // 36 source + 72 target.
  const second=await run(db,options);assert.equal(second.flatMap(r=>r.rows??[]).find(r=>r.fingerprint).changed_rows,0);
 }finally{await db.close();}
});
test('wrong reviewed fingerprint or missing owner dates cannot apply',async()=>{
 const {db}=await fixture();try{
  const before=await snapshot(db);await assert.rejects(run(db,{...options,apply:true,expected_fingerprint:'wrong'}),/dry_run_fingerprint_changed/);await db.exec('ROLLBACK');assert.deepEqual(await snapshot(db),before);
  const dry=await run(db);const plan=dry.flatMap(r=>r.rows??[]).find(r=>r.fingerprint);
  await assert.rejects(run(db,{apply:true,expected_fingerprint:plan.fingerprint}),/owner_dates_required/);await db.exec('ROLLBACK');assert.deepEqual(await snapshot(db),before);
 }finally{await db.close();}
});

test('missing source-to-target module pair aborts before public writes',async()=>{
 const {db}=await fixture();try{const before=await snapshot(db);await db.exec("DELETE FROM training_modules WHERE id=(SELECT id FROM training_modules WHERE parent_module_id='4365e913-36f1-432e-ab16-748c3ca6826a' LIMIT 1)");await assert.rejects(run(db,options),/expected_28_module_pairs/);await db.exec('ROLLBACK');assert.deepEqual(await snapshot(db),before);}finally{await db.close();}
});

test('dry-run catches preserved primary-offer collision before any permanent write',async()=>{
 const {db,pairs}=await fixture();try{
  await db.query("UPDATE tariff_offers SET is_primary=true,offer_type='pay_now' WHERE id='4d01edc1-6189-4017-ba43-922e7e9479ac'");
  await assert.rejects(run(db,options),/primary_offer_collision/);await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n,0);
 }finally{await db.close();}
});
