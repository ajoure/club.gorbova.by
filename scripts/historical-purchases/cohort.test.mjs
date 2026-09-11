import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSourceCohort, resolveHistoricalTariff } from './cohort.mjs';
import { planMissingHistory, hasPaidBusinessWindow } from './plan.mjs';

const catalog = JSON.parse(readFileSync(new URL('../../docs/operations/2026-09-11-historical-purchases-catalog.json', import.meta.url)));
function fixture() {
  const rows = [];
  for (const [cohort, end] of [[17, 88], [18, 55]]) {
    for (let n = 2; n <= end; n++) rows.push({ref: `${cohort}:${n}`,
      email_sha256: (cohort * 1000 + n).toString(16).padStart(64, '0'), phone_sha256: null,
      title: `ЦЕННЫЙ БУХГАЛТЕР 2.0${cohort === 18 ? ' 18 поток' : ''} тариф Для своих 2`, module_flags: [7]});
  }
  for (const [a,b] of [[14,53],[15,39],[17,54]]) rows.find(r=>r.ref===`18:${b}`).email_sha256=rows.find(r=>r.ref===`18:${a}`).email_sha256;
  return { source_spreadsheet_id: '1dw8ljnBwfyNn26INHdwxt7MdRGs7aX5qkby7V1wWUq8', confirmed_paid_by_owner: true, rows };
}

test('owner-confirmed aliases resolve without using module names as tariff evidence', () => {
  assert.equal(resolveHistoricalTariff('ЦЕННЫЙ БУХГАЛТЕР 2.0 тариф 3,Вид деятельности: Учет у ИП', catalog), catalog.tariffs['Бизнес-леди']);
  assert.equal(resolveHistoricalTariff('ЦЕННЫЙ БУХГАЛТЕР 2.0 тариф "Для своих 2"', catalog), catalog.tariffs['Главный бухгалтер']);
  assert.throws(()=>resolveHistoricalTariff('ЦЕННЫЙ БУХГАЛТЕР 2.0 тариф VIP',catalog));
});

test('only flags select modules, known duplicates union flags, and source refs survive', () => {
  const source = fixture();
  source.rows.find(r=>r.ref==='17:7').title += ',Вид деятельности: Производство';
  source.rows.find(r=>r.ref==='18:53').module_flags = [0];
  const rows = buildSourceCohort(source,catalog);
  assert.equal(rows.length,138);
  assert.deepEqual(rows.find(r=>r.refs.includes('17:7')).module_product_ids,[catalog.module_product_ids_in_sheet_column_order[7]]);
  const duplicate = rows.find(r=>r.refs.includes('18:14'));
  assert.deepEqual(duplicate.refs,['18:14','18:53']);
  assert.equal(duplicate.module_product_ids.length,2);
});

test('blank/module-only titles never invent a full course purchase or a new flow', () => {
  const source = fixture();
  source.rows.find(r=>r.ref==='17:87').title='';
  source.rows.find(r=>r.ref==='17:86').title='Вид деятельности: Производство';
  const rows=buildSourceCohort(source,catalog);
  assert.equal(rows.find(r=>r.refs.includes('17:87')).product_id,null);
  assert.equal(rows.find(r=>r.refs.includes('17:86')).tariff_id,null);
  assert.equal(rows.find(r=>r.refs.includes('17:2')).flow_id,null);
  assert.equal(rows.find(r=>r.refs.includes('18:2')).flow_id,catalog.flow_18_id);
});

test('source drift and changed duplicate identities fail closed', () => {
  const source=fixture();
  source.rows.find(r=>r.ref==='18:53').phone_sha256='a'.repeat(64);
  assert.throws(()=>buildSourceCohort(source,catalog),/duplicate group changed/);
  source.rows.pop();
  assert.throws(()=>buildSourceCohort(source,catalog),/row count changed/);
});

function inventoryFixture(source) {
  return buildSourceCohort(source,catalog).map((r,i)=>({refs:r.refs,profile_id:`profile-${i}`,user_id:null,
    match_status:'matched_email',profile_archived:false,profile_merged_to:null,phone_points_to_other_profile:false,
    module_list_requested_SOURCE_JSON_not_db:r.module_product_ids,existing_module_coverage_db:[],
    missing_historical_fact:r.module_product_ids,existing_paid_root_orders_db:[],club_business_subscriptions:[]}));
}

test('existing snapshot facts are not reinserted; proposal IDs are stable and never grant access', () => {
  const source=fixture(), inventory=inventoryFixture(source);
  inventory[0].existing_module_coverage_db=[catalog.module_product_ids_in_sheet_column_order[7]];
  inventory[0].missing_historical_fact=[];
  inventory[0].existing_paid_root_orders_db=[{profile_id:inventory[0].profile_id,tariff_id:catalog.tariffs['Главный бухгалтер'],hist_type:'base_tariff_purchase'}];
  const a=planMissingHistory(source,inventory,catalog), b=planMissingHistory(source,inventory,catalog);
  assert.deepEqual(a,b);
  assert.equal(a.actions.some(x=>x.refs.includes('17:2')),false);
  assert.ok(a.actions.every(x=>x.history_only&&x.create_payment===false&&x.grant_access===false));
});

test('a split-child with a parent tariff is not a full course purchase',()=>{
  const source=fixture(),inventory=inventoryFixture(source),row=inventory[0];
  row.existing_paid_root_orders_db=[{profile_id:row.profile_id,tariff_id:catalog.tariffs['Главный бухгалтер'],hist_type:'module_child_purchase'}];
  const plan=planMissingHistory(source,inventory,catalog);
  assert.ok(plan.actions.some(a=>a.refs.includes('17:2')&&a.kind==='base_tariff_purchase'));
});

test('identity conflicts remain excluded until the specific source row is confirmed', () => {
  const source=fixture(), inventory=inventoryFixture(source);
  inventory[0].phone_points_to_other_profile=true;
  inventory[1].match_status='ambiguous_email'; inventory[1].profile_id=null;
  const blocked=planMissingHistory(source,inventory,catalog);
  assert.equal(blocked.review.length,2);
  const approved=planMissingHistory(source,inventory,catalog,{email_priority_refs:['17:2']});
  assert.equal(approved.review.length,1);
  assert.ok(approved.actions.some(x=>x.refs.includes('17:2')));
  assert.equal(approved.actions.some(x=>x.refs.includes('17:3')),false);
});

test('active club status alone or a gift does not qualify as a paid Business source', () => {
  const source=fixture(), inventory=inventoryFixture(source), row=inventory[0];
  row.user_id='account-1';
  const paid={subscription_id:'subscription-1',source_order_id:'order-1',status:'active',access_end_at:'2026-10-01T00:00:00Z',
    order_status:'paid',order_deleted:false,order_is_trial:false,order_tariff_is_business:true,order_flags:{},verified_paid_250:true};
  row.club_business_subscriptions=[{...paid,verified_paid_250:false}];
  assert.equal(planMissingHistory(source,inventory,catalog).eligible_business_candidates.length,0);
  row.club_business_subscriptions=[{...paid,order_flags:{gift:'true'}}];
  assert.equal(planMissingHistory(source,inventory,catalog).eligible_business_candidates.length,0);
  row.club_business_subscriptions=[paid];
  assert.equal(planMissingHistory(source,inventory,catalog,{},'2026-09-11T10:00:00Z').eligible_business_candidates.length,1);
});

test('the paid window ends exactly at expiry; canceled rebilling preserves only the remaining paid term', () => {
  const paid = { status:'canceled', access_end_at:'2026-09-11T10:00:00Z', verified_paid_250:true,
    order_status:'paid', order_deleted:false, order_is_trial:false, order_tariff_is_business:true, order_flags:{} };
  assert.equal(hasPaidBusinessWindow(paid,'2026-09-11T09:59:59Z'),true);
  assert.equal(hasPaidBusinessWindow(paid,'2026-09-11T10:00:00Z'),false);
  assert.equal(hasPaidBusinessWindow({...paid,status:'expired'},'2026-09-11T09:00:00Z'),false);
  assert.equal(hasPaidBusinessWindow({...paid,access_end_at:null},'2026-09-11T09:00:00Z'),false);
  assert.equal(hasPaidBusinessWindow({...paid,order_flags:{gift:true}},'2026-09-11T09:00:00Z'),false);
  assert.equal(hasPaidBusinessWindow({...paid,order_flags:{test:1}},'2026-09-11T09:00:00Z'),false);
});
