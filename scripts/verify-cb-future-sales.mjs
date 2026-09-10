// Isolated PostgreSQL acceptance for the exact catalogue migration.
// Usage: node scripts/verify-cb-future-sales.mjs /path/to/pglite/dist/index.js
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
process.on('uncaughtException', error => { console.error(error.message); process.exit(1); });
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const sql = readFileSync(new URL('../supabase/migrations/20260910185222_cb_october_future_sales.sql', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/integrations/supabase/types.ts', import.meta.url), 'utf8');
const maps = name => [...sql.match(new RegExp(`INSERT INTO ${name} VALUES([\\s\\S]*?);`))[1].matchAll(/\('([^']+)','([^']+)'(?:,'([^']+)')?[^)]*\)/g)].map(m => m.slice(1));
const tariffs = maps('cb_tariff_map');
const offers = maps('cb_offer_map');
const rules = maps('cb_rule_map');
const product = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596';
const excluded = ['60aa7a27-5346-4ba0-9686-d297e14d49cf','9ce7a575-bbe4-45f1-8c4f-262b432127bf','83544104-b2c1-48c2-a0c9-015ceec012a1'];
const tables = ['tariffs','tariff_offers','access_rules','flows','site_pages','offer_addons','tariff_features','products_v2','training_modules'];
for (const table of tables) {
  const row = types.split(`      ${table}: {\n        Row: {\n`)[1].split('        }')[0];
  const columns = [...row.matchAll(/^          (\w+): (.+)$/gm)].map(([,name,type]) => {
    const sqlType = type.includes('Json') ? 'jsonb' : type.includes('boolean') ? 'boolean' : type.includes('number') ? 'numeric'
      : (/^(id|created_by|updated_by)$/.test(name) || (name.endsWith('_id') && !['public_id','getcourse_offer_id'].includes(name))) ? 'uuid'
      : /_at$/.test(name) || name.startsWith('visible_') ? 'timestamptz' : 'text';
    return `${name} ${sqlType}${name==='id'?' PRIMARY KEY DEFAULT gen_random_uuid()':''}`;
  });
  await db.exec(`CREATE TABLE ${table}(${columns.join(',')});`);
}
await db.exec(`CREATE UNIQUE INDEX tariff_codes ON tariffs(product_id,code); CREATE UNIQUE INDEX tariff_public_ids ON tariffs(public_id);
  CREATE UNIQUE INDEX flow_codes ON flows(product_id,code);
  CREATE SEQUENCE public_id_sequence;
  CREATE FUNCTION next_public_id(entity text) RETURNS text LANGUAGE sql AS 'SELECT ''T-TEST-'' || nextval(''public_id_sequence'')';`);
async function insert(table, record) {
  const keys=Object.keys(record);
  await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>typeof record[k]==='object' && record[k]!==null?JSON.stringify(record[k]):record[k]));
}
await insert('training_modules',{id:'4365e913-36f1-432e-ab16-748c3ca6826a',product_id:product,is_active:true,parent_module_id:null});
await insert('products_v2',{id:product,code:'prd_8649986b7c9e',landing_config:{price_suffix:'BYN/мес',tariffs_title:'Тарифы'}});
for (const [i,[oldId]] of tariffs.entries()) {
  await insert('tariffs',{id:oldId,product_id:product,code:`old-${i}`,public_id:`T-OLD-${i}`,name:['Бухгалтер','Главный бухгалтер','Бизнес-леди'][i],
    price_monthly:null,original_price:[1950,2450,3350][i],access_days:[180,240,300][i],is_active:true,is_public:true,
    meta:{card_config:{price_display:[1650,1950,2650][i],cta_text:'Оплатить'},untouched:'preserve'},document_params:{executor_id:'synthetic-executor'}});
}
for (const [i,[oldId,,tariffId]] of offers.entries()) {
  const t=tariffs.findIndex(x=>x[0]===tariffId);
  await insert('tariff_offers',{id:oldId,tariff_id:tariffId,offer_type:['bank_installment','pay_now','pay_now','invoice'][i%4],
    payment_method:['bank_transfer','internal_installment','full_payment','bank_transfer'][i%4],amount:[1650,1950,2650][t],
    is_active:true,is_primary:i%4===2,installment_count:i%4===1?2:null,installment_interval_days:i%4===1?30:null,
    auto_charge_offer_id:null,button_label:'Existing action',sort_order:i%4,meta:{crm_routing:{pipeline_id:123,pending_stage_id:456,success_stage_id:789,failed_stage_id:999},document_scenarios:{paid:'preserved'},document_defaults:{amount:[1650,1950,2650][t],unit_price:[1650,1950,2650][t],service_name:'Existing tariff service',amount_manual_override:false},slot_role:`button_${i%4+1}`,installment:{max_months:2,rounding_mode:'ceil_to_whole_byn'}}});
}
for (const [i,[parentId]] of offers.entries()) {
  for (let n=0;n<9;n++) await insert('offer_addons',{
    id:`00000000-0000-0000-${String(i+1).padStart(4,'0')}-${String(n+1).padStart(12,'0')}`,
    parent_offer_id:parentId,addon_product_id:`10000000-0000-0000-0000-${String(n+1).padStart(12,'0')}`,addon_tariff_id:`20000000-0000-0000-0000-${String(n+1).padStart(12,'0')}`,addon_offer_id:`30000000-0000-0000-0000-${String(n+1).padStart(12,'0')}`,
    access_delivery_mode:'manual',access_duration_days:30,pricing_mode:n<6?'offer_price':'percent_discount',discount_percent:n<6?null:10,
    is_required:false,is_default_selected:false,is_active:true,meta:{untouched:'preserve'},sort_order:n,
  });
}
const coreSeen=new Set();
for (const [oldId,,tariffId] of rules) {
  const core=!coreSeen.has(tariffId);coreSeen.add(tariffId);
  const modules=[...excluded,...Array.from({length:21},(_,i)=>`module-${i}`)];
  await insert('access_rules',{id:oldId,tariff_id:tariffId,product_id:product,grant_target_type:core?'training_content':'club',
    target_ref:core?'4365e913-36f1-432e-ab16-748c3ca6826a':'synthetic-bonus',target_label:'Existing grant',priority:10,is_active:true,
    duration_days:core?null:30,conditions:core?{access_mode:'partial',allowed_module_ids:modules}:{untouched:true},notes:'preserved'});
}
await insert('site_pages',{id:'a924f3c6-367e-4585-b467-b1d14861c9a7',slug:'cb20predzapis',status:'published',seo_settings:{description:'Preserve description'},
  blocks:[{id:'3f366661-bed4-4134-8938-ff2f92da79c6',type:'html',content:{code:'<h2>Старт потока: 01 августа 2026г.</h2><p>Формат: онлайн</p><div>Бесплатно <s>1200 BYN</s></div><style>.w1650{color:red}</style>'}}]});
let assertions=0;
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);assertions++;};
const snapshot=async table=>(await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
const original={tariffs:await snapshot('tariffs'),tariff_offers:await snapshot('tariff_offers'),access_rules:await snapshot('access_rules'),offer_addons:await snapshot('offer_addons')};
await db.exec(sql);
for (const [table,count] of [['tariffs',6],['tariff_offers',24],['access_rules',20],['flows',1],['site_pages',1],['offer_addons',216]]) equal((await snapshot(table)).length,count,`${table} delta`);
for(const table of ['tariff_offers','access_rules','offer_addons']) {
 const ids=new Set(original[table].map(x=>x.id));
 equal((await snapshot(table)).filter(x=>ids.has(x.id)),original[table],`${table} originals untouched`);
}
for (const [i,[oldId,newId]] of tariffs.entries()) {
 const old=(await db.query('SELECT * FROM tariffs WHERE id=$1',[oldId])).rows[0];
 const {is_public,updated_at,...unchanged}=old;
 const {is_public:wasPublic,updated_at:wasUpdated,...before}=original.tariffs.find(x=>x.id===oldId);
 equal(unchanged,before,'all historical terms preserved');equal(is_public,false);equal(old.is_active,true);
 const next=(await db.query('SELECT * FROM tariffs WHERE id=$1',[newId])).rows[0];
 equal(next.is_public,true);equal(Number(next.price_monthly),[1790,2190,2990][i]);
 equal(next.meta.course_access.months,[6,9,12][i]);equal(next.meta.course_access.end_date,'2026-12-10');
 equal(next.meta.card_config.installment_from_byn,[139,183,249][i]);equal(next.document_params,old.document_params);
 const amounts=(await db.query('SELECT amount FROM tariff_offers WHERE tariff_id=$1',[newId])).rows;
 equal(amounts.length,4);equal(amounts.map(x=>Number(x.amount)),Array(4).fill([1790,2190,2990][i]));
}
const newAccountantRule=(await db.query('SELECT conditions FROM access_rules WHERE id=$1',[rules[0][1]])).rows[0];
equal(newAccountantRule.conditions.allowed_module_ids.length,21);
equal(newAccountantRule.conditions.allowed_module_ids.some(x=>excluded.includes(x)),false);
equal((await db.query('SELECT count(*)::int n FROM access_rules WHERE duration_days=30')).rows[0].n,14,'seven bonus clones keep 30 days');
const page=(await snapshot('site_pages'))[0];
equal(page.blocks[0].content.code,'<h2>Старт потока: октябрь 2026</h2><p>Формат: онлайн</p><div>Бесплатно </div><style>.w1650{color:red}</style>');
equal(page.seo_settings.description,'Preserve description');
equal(page.seo_settings.title,'Ценный бухгалтер — стань профессионалом, который понимает логику учета, умеет работать с НПА и самостоятельно принимает решения | Катерина Горбова');
for(const [oldOffer,newOffer] of offers) {
  const oldRow=original.tariff_offers.find(o=>o.id===oldOffer);
  const newRow=(await db.query('SELECT * FROM tariff_offers WHERE id=$1',[newOffer])).rows[0];
  equal(newRow.meta.crm_routing,oldRow.meta.crm_routing,'exact CRM routing preserved');
  equal(newRow.meta.document_scenarios,oldRow.meta.document_scenarios,'document routing preserved');
  equal(newRow.meta.document_defaults,{...oldRow.meta.document_defaults,amount:Number(newRow.amount),unit_price:Number(newRow.amount)},'document sums match actual payment offer');
  const after=(await db.query('SELECT * FROM offer_addons WHERE parent_offer_id=$1 ORDER BY sort_order',[newOffer])).rows;
  const before=original.offer_addons.filter(x=>x.parent_offer_id===oldOffer).sort((a,b)=>a.sort_order-b.sort_order);
  equal(after.length,9);
  for(let n=0;n<9;n++) for(const field of ['addon_product_id','addon_tariff_id','addon_offer_id','pricing_mode','discount_percent','access_delivery_mode','access_duration_days','is_required','is_default_selected']) {
    equal(after[n][field],before[n][field],`preserved addon ${field}`);
  }
}
equal((await snapshot('products_v2'))[0].landing_config,{price_suffix:'BYN',tariffs_title:'Тарифы'});
const beforeRepeat=Object.fromEntries(await Promise.all(tables.map(async t=>[t,await snapshot(t)])));
await db.exec(sql);
for (const t of tables) equal(await snapshot(t),beforeRepeat[t],`idempotent ${t}`);
// A training moved to another product blocks even an otherwise complete generation.
await db.query('UPDATE training_modules SET product_id=$1', ['00000000-0000-0000-0000-000000000020']);
await assert.rejects(db.exec(sql),/cb21_product_training_binding_drift/);assertions++;
await db.exec('ROLLBACK');
await db.query('UPDATE training_modules SET product_id=$1',[product]);
// A partially removed generation must fail rather than duplicate or silently repair.
await db.query('DELETE FROM tariffs WHERE id=$1',[tariffs[0][1]]);
await assert.rejects(db.exec(sql),/partial_cb_catalogue_generation/);assertions++;
await db.exec('ROLLBACK');
await db.close();
console.log(`PASS: ${assertions} isolated PostgreSQL assertions; historical terms preserved; repeat is a no-op.`);
