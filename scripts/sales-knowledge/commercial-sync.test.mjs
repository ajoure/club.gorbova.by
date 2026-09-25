import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const sql=await readFile(new URL('./cb21-commercial-config.sql',import.meta.url),'utf8');
const types=await readFile(new URL('../../src/integrations/supabase/types.ts',import.meta.url),'utf8');
const p20='3e43fb28-8322-41bc-bfee-714731bdc630',p21='2b7bf6d4-ad8d-46ad-9399-7f96c307c596',root20='2e5cbc7b-bbaf-4384-b894-bbd98d7f524e',root21='4365e913-36f1-432e-ab16-748c3ca6826a',flow21='b10e15c5-51c3-5df5-ba83-a42416da5902';
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
 await db.exec(`CREATE TABLE products_v2(id uuid PRIMARY KEY,is_active boolean NOT NULL); CREATE TABLE sales_jobs(conversation_id uuid,status text); CREATE TABLE sales_conversations(id uuid,campaign_id uuid); CREATE TABLE audit_logs(actor_type text,action text,meta jsonb); CREATE TABLE sales_campaigns(code text,mode text,id uuid DEFAULT gen_random_uuid()); INSERT INTO sales_campaigns(code,mode) VALUES('cb21-owner-test','off'); CREATE TABLE training_modules(id uuid PRIMARY KEY,product_id uuid,parent_module_id uuid,title text,is_active boolean NOT NULL); CREATE TABLE flows(id uuid PRIMARY KEY,product_id uuid,start_date date,end_date date);`);
 await db.exec(`INSERT INTO products_v2(id,is_active) VALUES('${p20}',true),('${p21}',true);`);
 await db.query("INSERT INTO flows(id,product_id,start_date,end_date) VALUES($1,$2,'2026-10-23','2026-12-10')",[flow21,p21]);
 const insert=async(table,row)=>db.query(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
 const pairs=[...sql.matchAll(/\('(accountant|chief|business|alumni|gift)','([^']+)','([^']+)',(\d+),(\d+|NULL),(\d+)\)/g)].map(([,role,source,target,price,old,days])=>({role,source,target,price:+price,old:old==='NULL'?null:+old,days:+days}));
 const sourceOffers=[...sql.split('INSERT INTO _cb21_offer_pairs VALUES\n')[1].split(';')[0].matchAll(/\('([^']+)',/g)].map(x=>x[1]);
 const destOffers=[...sql.split('INSERT INTO _cb21_offer_pairs VALUES\n')[1].split(';')[0].matchAll(/\('[^']+','([^']+)'\)/g)].map(x=>x[1]);
 const m20=[],m21=[];for(let i=0;i<28;i++){m20.push(randomUUID());m21.push(randomUUID());await insert('training_modules',{id:m20[i],product_id:p20,parent_module_id:root20,title:i===0?`Конференции | 20 поток |`:`Модуль ${i}`,is_active:true});await insert('training_modules',{id:m21[i],product_id:p21,parent_module_id:root21,title:i===0?`КОНФЕРЕНЦИИ | 21 поток |`:`Модуль ${i}`,is_active:true});}
 for(const [i,p] of pairs.entries()) {
  const sourcePrice=[1650,1950,2650,1325,0][i];
  for(const source of [true,false])await insert('tariffs',{id:source?p.source:p.target,product_id:source?p20:p21,name:p.role,code:randomUUID(),public_id:randomUUID(),is_active:true,is_public:i<3,access_days:p.days,price_monthly:source?null:i<3?p.price:null,original_price:source?null:p.old,meta:{card_config:{price_display:source?sourcePrice:p.price,old_price:source?2000:p.old},...(source?{}:{site_slot_key:p.role,course_access:{kind:'course_end_calendar_months',flow_id:flow21,end_date:'2026-12-10',months:[6,9,12,12,12][i],timezone:'Europe/Minsk'}})}});
  if(i>=3)await db.query("UPDATE tariffs SET meta=meta-'course_access' WHERE id=$1",[p.target]);
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
  const addonRoot=randomUUID();
  await insert('products_v2',{id:product,is_active:true});
  await insert('tariffs',{id:tariff,product_id:product,is_active:true});
  await insert('training_modules',{id:addonRoot,product_id:product,parent_module_id:null,title:`Платный модуль ${k}-${a}`,is_active:true});
  await insert('access_rules',{id:randomUUID(),product_id:product,tariff_id:null,is_active:true,grant_target_type:'training_content',target_ref:addonRoot,conditions:{access_mode:'full'},duration_days:null});
  await insert('tariff_offers',{id:offer,tariff_id:tariff,amount:400,is_active:true,is_primary:false,button_label:'Модуль',offer_type:'pay_now',meta:{slot_role:`addon_${a}`}});
  for(const source of [true,false])await insert('offer_addons',{id:randomUUID(),parent_offer_id:source?sourceOffers[8+k]:destOffers[8+k],addon_product_id:product,addon_tariff_id:tariff,addon_offer_id:offer,is_active:true,pricing_mode:'percent_discount',discount_percent:50,is_required:false,is_default_selected:false,allow_repurchase_after_expiry:true,access_delivery_mode:source?'fixed_date':'manual',access_opens_at:source?'2026-09-30T21:00:00Z':null,meta:{},sort_order:a});
 }
 return {db,pairs};
}
const options={addon_opens_at:'2026-12-09T21:00:00Z',course_start_date:'2026-10-23',course_end_date:'2026-12-10'}; // Synthetic schedule, mirrors the approved CB21 configuration.
async function run(db,opts={}){await db.query("SELECT set_config('cb21.sync_options',$1,false)",[JSON.stringify(opts)]);return db.exec(sql);}
async function snapshot(db){return (await db.query("SELECT jsonb_agg(to_jsonb(t) ORDER BY id) rows FROM tariffs t")).rows[0].rows;}
test('full sync dry run, exact fingerprint apply, existing financial terms and idempotent rerun',async()=>{
 const {db,pairs}=await fixture();try{
  const before=await snapshot(db);const dry=await run(db,options);assert.deepEqual(await snapshot(db),before);
  const plan=dry.flatMap(r=>r.rows??[]).find(r=>r.fingerprint);assert.ok(plan.fingerprint);assert.equal(plan.schedule_supplied,true);
  await run(db,{...options,apply:true,expected_fingerprint:plan.fingerprint});
  const prices=(await db.query('SELECT meta FROM tariffs WHERE id=ANY($1::uuid[]) ORDER BY id',[pairs.slice(0,3).map(p=>p.target)])).rows.map(r=>r.meta.card_config.price_display).sort((a,b)=>a-b);assert.deepEqual(prices,[1790,2190,2990]);
  const course=(await db.query("SELECT conditions FROM access_rules WHERE tariff_id=$1 AND target_ref=$2",[pairs[0].target,root21])).rows[0];assert.equal(course.conditions.allowed_module_ids.length,21);
  const synced=(await db.query('SELECT meta FROM tariffs WHERE id=ANY($1::uuid[]) ORDER BY access_days',[pairs.slice(0,3).map(p=>p.target)])).rows.map(r=>r.meta.course_access);assert.deepEqual(synced.map(x=>[x.kind,x.start_date,x.days,x.timezone]),[['course_start_duration_days','2026-10-23',180,'Europe/Minsk'],['course_start_duration_days','2026-10-23',240,'Europe/Minsk'],['course_start_duration_days','2026-10-23',300,'Europe/Minsk']]);
  const hiddenFlows=(await db.query('SELECT meta FROM tariffs WHERE id=ANY($1::uuid[])',[pairs.slice(3).map(p=>p.target)])).rows.map(r=>r.meta.course_access);assert.equal(hiddenFlows.length,2);assert.ok(hiddenFlows.every(x=>x.flow_id===flow21&&x.start_date==='2026-10-23'&&x.days===300));
  const documentPeriods=(await db.query("SELECT meta->'document_defaults' AS defaults FROM tariff_offers WHERE tariff_id=ANY($1::uuid[]) ORDER BY tariff_id,sort_order",[pairs.slice(0,3).map(p=>p.target)])).rows.map(r=>r.defaults);assert.deepEqual([...new Set(documentPeriods.map(x=>`${x.service_period_from}:${x.service_period_to}`))].sort(),['2026-10-23:2027-04-20','2026-10-23:2027-06-19','2026-10-23:2027-08-18']);
  const offers=(await db.query("SELECT amount,meta,installment_count FROM tariff_offers WHERE tariff_id=$1",[pairs[3].target])).rows;assert.equal(offers.filter(o=>o.meta.sales_generation==='cb21-alumni-v2').length,4);assert.ok(offers.filter(o=>o.meta.sales_generation==='cb21-alumni-v2').every(o=>Number(o.amount)===1495));assert.equal(offers.filter(o=>o.meta.sales_legacy_only&&Number(o.amount)===1325).length,4);
  assert.equal((await db.query('SELECT count(*)::int n FROM offer_addons')).rows[0].n,108); // 36 source + 72 target.
  const paidAddons=(await db.query('SELECT ad.parent_offer_id,ad.pricing_mode,ad.discount_percent,ad.is_required,ad.is_default_selected,ad.access_delivery_mode,ad.access_opens_at FROM offer_addons ad JOIN tariff_offers parent_offer ON parent_offer.id=ad.parent_offer_id WHERE parent_offer.tariff_id=ANY($1::uuid[])',[pairs.filter(p=>['business','alumni'].includes(p.role)).map(p=>p.target)])).rows;
  assert.equal(paidAddons.length,72);
  assert.ok(paidAddons.every(a=>a.pricing_mode==='percent_discount'&&Number(a.discount_percent)===50&&!a.is_required&&!a.is_default_selected&&a.access_delivery_mode==='fixed_date'&&Date.parse(a.access_opens_at)===Date.parse('2026-12-09T21:00:00Z')));
  assert.equal((await db.query('SELECT count(*)::int n FROM offer_addons ad JOIN tariff_offers parent_offer ON parent_offer.id=ad.parent_offer_id WHERE parent_offer.tariff_id=ANY($1::uuid[])',[pairs.filter(p=>['accountant','chief','gift'].includes(p.role)).map(p=>p.target)])).rows[0].n,0);
  const second=await run(db,options);assert.equal(second.flatMap(r=>r.rows??[]).find(r=>r.fingerprint).changed_rows,0);
 }finally{await db.close();}
});
test('wrong reviewed fingerprint or missing owner dates cannot apply',async()=>{
 const {db}=await fixture();try{
  const before=await snapshot(db);await assert.rejects(run(db,{...options,apply:true,expected_fingerprint:'wrong'}),/dry_run_fingerprint_changed/);await db.exec('ROLLBACK');assert.deepEqual(await snapshot(db),before);
  const dry=await run(db);const plan=dry.flatMap(r=>r.rows??[]).find(r=>r.fingerprint);
  await assert.rejects(run(db,{apply:true,expected_fingerprint:plan.fingerprint}),/course_dates_required/);await db.exec('ROLLBACK');assert.deepEqual(await snapshot(db),before);
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

test('new administrator source button requires refreshed mapping instead of silently incomplete sync',async()=>{
 const {db,pairs}=await fixture();try{
  await db.query("INSERT INTO tariff_offers(tariff_id,is_active,offer_type,is_primary,meta) VALUES($1,true,'pay_now',false,'{\"slot_role\":\"button_6\"}')",[pairs[0].source]);
  await assert.rejects(run(db,options),/source_offer_catalog_changed/);await db.exec('ROLLBACK');
 }finally{await db.close();}
});

test('a paid add-on cannot be copied when an administrator makes it automatic or free',async()=>{
 const {db,pairs}=await fixture();try{
  const parent=(await db.query("SELECT id FROM tariff_offers WHERE tariff_id=$1 ORDER BY id LIMIT 1",[pairs[2].source])).rows[0].id;
  await db.query("UPDATE offer_addons SET is_default_selected=true WHERE id=(SELECT id FROM offer_addons WHERE parent_offer_id=$1 LIMIT 1)",[parent]);
  await assert.rejects(run(db,options),/paid_addon_not_explicit/);await db.exec('ROLLBACK');
 }finally{await db.close();}
});

test('a paid add-on with its own full product access rule is a valid delivery configuration',async()=>{
 const {db}=await fixture();try{
  const addon=(await db.query("SELECT addon_product_id FROM offer_addons ad JOIN tariff_offers parent_offer ON parent_offer.id=ad.parent_offer_id WHERE parent_offer.tariff_id='767bb895-30fa-49c9-8f31-d0794590020a' LIMIT 1")).rows[0].addon_product_id;
  await db.query('DELETE FROM training_modules WHERE product_id=$1',[addon]);
  await db.query("DELETE FROM access_rules WHERE product_id=$1 AND tariff_id IS NULL AND grant_target_type='training_content'",[addon]);
  await db.query("INSERT INTO access_rules(product_id,tariff_id,is_active,grant_target_type,target_ref,conditions) VALUES($1,NULL,true,'product_access',$2,'{\"access_mode\":\"full\"}')",[addon,addon]);
  const result=await run(db,options);assert.ok(result.flatMap(r=>r.rows??[]).some(r=>r.fingerprint));await db.exec('ROLLBACK');
 }finally{await db.close();}
});

test('a verified CB20 add-on on Accountant is copied to the matching CB21 offer',async()=>{
 const {db,pairs}=await fixture();try{
  const accountant=pairs.find(pair=>pair.role==='accountant');const business=pairs.find(pair=>pair.role==='business');
  const sourceParent=(await db.query("SELECT id FROM tariff_offers WHERE tariff_id=$1 AND meta->>'slot_role'='button_1'",[accountant.source])).rows[0].id;
  const targetParent=(await db.query("SELECT id FROM tariff_offers WHERE tariff_id=$1 AND meta->>'slot_role'='button_1'",[accountant.target])).rows[0].id;
  const businessParent=(await db.query("SELECT id FROM tariff_offers WHERE tariff_id=$1 AND meta->>'slot_role'='button_1'",[business.source])).rows[0].id;
  const sourceAddon=(await db.query('SELECT * FROM offer_addons WHERE parent_offer_id=$1 LIMIT 1',[businessParent])).rows[0];
  await db.query(`INSERT INTO offer_addons(id,parent_offer_id,addon_product_id,addon_tariff_id,addon_offer_id,is_active,pricing_mode,discount_percent,is_required,is_default_selected,allow_repurchase_after_expiry,access_delivery_mode,access_opens_at,meta,sort_order)
    VALUES($1,$2,$3,$4,$5,true,'offer_price',NULL,false,false,true,'fixed_date',$6,'{}',$7)`,[randomUUID(),sourceParent,sourceAddon.addon_product_id,sourceAddon.addon_tariff_id,sourceAddon.addon_offer_id,sourceAddon.access_opens_at,sourceAddon.sort_order]);
  const dry=await run(db,options);const plan=dry.flatMap(r=>r.rows??[]).find(r=>r.fingerprint);assert.ok(plan.fingerprint);
  await run(db,{...options,apply:true,expected_fingerprint:plan.fingerprint});
  const copied=(await db.query('SELECT pricing_mode,discount_percent FROM offer_addons WHERE parent_offer_id=$1 AND addon_offer_id=$2 AND is_active',[targetParent,sourceAddon.addon_offer_id])).rows;
  assert.equal(copied.length,1);assert.equal(copied[0].pricing_mode,'offer_price');assert.equal(copied[0].discount_percent,null);
 }finally{await db.close();}
});

test('new source section access rules are included without a stale fixed count',async()=>{
 const {db,pairs}=await fixture();try{
  const pair=pairs.find(p=>p.role==='business');const targetRef=randomUUID();
  for(const source of [true,false])await db.query(
   "INSERT INTO access_rules(product_id,tariff_id,is_active,grant_target_type,target_ref,conditions) VALUES($1,$2,true,'section_access',$3,$4)",
   [source?p20:p21,source?pair.source:pair.target,targetRef,{rule_purpose:'ai_tools'}]);
  const dry=await run(db,options);
  assert.ok(dry.flatMap(r=>r.rows??[]).some(r=>r.fingerprint));
  await db.exec('ROLLBACK');
 }finally{await db.close();}
});

test('a previously disabled matching CB21 add-on is reactivated instead of duplicated',async()=>{
 const {db,pairs}=await fixture();try{
  const business=pairs.find(pair=>pair.role==='business');
  const targetAddon=(await db.query("SELECT ad.id FROM offer_addons ad JOIN tariff_offers parent_offer ON parent_offer.id=ad.parent_offer_id WHERE parent_offer.tariff_id=$1 AND parent_offer.meta->>'slot_role'='button_1' LIMIT 1",[business.target])).rows[0].id;
  await db.query('UPDATE offer_addons SET is_active=false WHERE id=$1',[targetAddon]);
  const dry=await run(db,options);const plan=dry.flatMap(r=>r.rows??[]).find(r=>r.fingerprint);assert.ok(plan.fingerprint);
  await run(db,{...options,apply:true,expected_fingerprint:plan.fingerprint});
  const restored=(await db.query('SELECT is_active FROM offer_addons WHERE id=$1',[targetAddon])).rows[0];
  assert.equal(restored.is_active,true);
  assert.equal((await db.query('SELECT count(*)::int n FROM offer_addons')).rows[0].n,108);
 }finally{await db.close();}
});

test('an incomplete CB20 paid add-on is excluded from the reviewed CB21 catalogue',async()=>{
 const {db,pairs}=await fixture();try{
  const addon=(await db.query("SELECT addon_product_id FROM offer_addons ad JOIN tariff_offers parent_offer ON parent_offer.id=ad.parent_offer_id WHERE parent_offer.tariff_id='767bb895-30fa-49c9-8f31-d0794590020a' LIMIT 1")).rows[0].addon_product_id;
  await db.query("DELETE FROM access_rules WHERE product_id=$1 AND tariff_id IS NULL AND grant_target_type='training_content'",[addon]);
  const dry=await run(db,options);const plan=dry.flatMap(r=>r.rows??[]).find(r=>r.fingerprint);assert.ok(plan.fingerprint);
  await run(db,{...options,apply:true,expected_fingerprint:plan.fingerprint});
  const targetTariffs=pairs.filter(pair=>['business','alumni'].includes(pair.role)).map(pair=>pair.target);
  const active=(await db.query('SELECT count(*)::int n FROM offer_addons ad JOIN tariff_offers parent_offer ON parent_offer.id=ad.parent_offer_id WHERE parent_offer.tariff_id=ANY($1::uuid[]) AND ad.is_active',[targetTariffs])).rows[0].n;
  assert.equal(active,70);
  const remaining=(await db.query('SELECT count(*)::int n FROM offer_addons ad JOIN tariff_offers parent_offer ON parent_offer.id=ad.parent_offer_id WHERE parent_offer.tariff_id=ANY($1::uuid[]) AND ad.addon_product_id=$2 AND ad.is_active',[targetTariffs,addon])).rows[0].n;
  assert.equal(remaining,0);
  const deactivated=(await db.query("SELECT count(*)::int n FROM offer_addons ad JOIN tariff_offers parent_offer ON parent_offer.id=ad.parent_offer_id WHERE parent_offer.tariff_id=$1 AND ad.addon_product_id=$2 AND NOT ad.is_active",[pairs.find(pair=>pair.role==='business').target,addon])).rows[0].n;
  assert.equal(deactivated,1);
 }finally{await db.close();}
});
