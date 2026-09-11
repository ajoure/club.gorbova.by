import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Execute the production functions themselves without booting Deno. Only the database
// transport is replaced; selection, write branches and metadata guards remain real.
const shared = readFileSync(new URL('../../supabase/functions/_shared/product-access-grants.ts', import.meta.url), 'utf8');
const endpoint = readFileSync(new URL('../../supabase/functions/rules-retroapply/index.ts', import.meta.url), 'utf8');
const builderText = shared.slice(shared.indexOf('export function buildEnrichedMeta('), shared.indexOf('/** Treat entitlement lineage'));
const buildMeta = new Function(`${stripTypeScriptTypes(builderText.replace('export ', ''))}; return buildEnrichedMeta;`)();
const executeText = endpoint.slice(endpoint.indexOf('async function executeActions('));
const execute = new Function('NEVER_EXECUTE_CATEGORIES', 'EXTRA_ACCESS_DESTRUCTIVE',
  `${stripTypeScriptTypes(executeText)}; return executeActions;`)(new Set(['already_satisfied','condition_not_met']), new Set());
const rule = {id:'business-rule', tariff_id:'business', conditions:{condition_type:'prior_purchase',match_mode:'per_product'}};
const end = '2099-09-12T12:00:00Z';
function action(id='module', proof={match_type:'direct',order_id:'old-paid-order',historical_purchase_type:'module_only_standalone',historical_tariff_id:null,historical_module_product_ids:[id]}) {
  return {action_id:id,user_id:'buyer',profile_id:'profile',rule_id:rule.id,target_product_id:id,target_product_code:id,
    category:'missing_access',source_subscription_id:'current-club',planned_expires_at:end,
    prior_purchase_grant_meta:buildMeta({rule_id:rule.id,order_id:null,source_subscription_id:'current-club',
      source_entitlement_source_id:null,source_access_kind:'subscription',source_tariff_id:'business',
      source_access_end_at:end,source_window_rule:'align_with_source',prior_purchase:proof,target_product_id:id})};
}
function db(initial=[]) {
  const rows=structuredClone(initial), writes=[];
  return {rows,writes,from(table) {
    const filters={}; const query={select(){return this;},eq(k,v){filters[k]=v;return this;},limit(){return this;},
      async maybeSingle(){return {data:table==='products_v2'?{code:filters.id}:rows.find(r=>Object.entries(filters).every(([k,v])=>r[k]===v))||null,error:null};},
      update(patch){this.patch=patch;return this;},
      async insert(row){if(table==='entitlements'){rows.push({id:`ent-${rows.length}`,...structuredClone(row)});writes.push({type:'insert',row});}return {error:null};},
      then(resolve,reject){if(this.patch){const row=rows.find(r=>Object.entries(filters).every(([k,v])=>r[k]===v));if(row){Object.assign(row,structuredClone(this.patch));writes.push({type:'update',row});}}return Promise.resolve({error:null}).then(resolve,reject);}
    }; return query;
  }};
}
const opts=ids=>({selectedActionIds:ids,applyCategories:[],forceExecute:false,allowReduceAccess:false,
  allowRevokeOrExpire:false,allowManualOverride:false,reconcileMode:'nightly_safe',callerUserId:null});
const existing=(status,meta={})=>({id:'existing',user_id:'buyer',product_id:'module',profile_id:'profile',status,expires_at:'2020-01-01',meta});

test('new module and mapped child grants carry canonical purchase scope and current Club end',async()=>{
  const d=db(), first=action(), child=action('child',{match_type:'module_list_mapped',order_id:'child-order',historical_purchase_type:'module_only_standalone',historical_tariff_id:'historical',historical_module_product_ids:['child']});
  const r=await execute(d,[first,child],[rule],opts(['module','child']));assert.equal(r.created,2);
  for(const row of d.rows){assert.equal(row.meta.scope_resolution_mode,'module_scope_only');assert.equal(row.meta.business_subscription_id,'current-club');assert.equal(row.expires_at,end);assert.ok(row.meta.historical_module_product_ids.includes(row.product_id));assert.ok(row.meta.prior_purchase_order_id);}
});
test('expired same-rule access restores with historical metadata and keeps unrelated metadata',async()=>{
  const d=db([existing('expired',{source_rule_id:rule.id,source_type:'retroapply',business_subscription_id:'old-club',note:'preserve'})]);
  const r=await execute(d,[action()],[rule],opts(['module']));assert.equal(r.reactivated,1);assert.equal(d.rows[0].id,'existing');assert.equal(d.rows[0].meta.note,'preserve');assert.equal(d.rows[0].meta.scope_resolution_mode,'module_scope_only');assert.equal(d.rows[0].meta.business_subscription_id,'current-club');assert.equal(d.rows[0].expires_at,end);
});
test('missing or ambiguous purchase scope and invalid/ended window cannot grant',async()=>{
  for(const bad of [action('module',null),action('module',{match_type:'direct',order_id:'order',historical_purchase_type:null,historical_tariff_id:null,historical_module_product_ids:[]}),{...action(),planned_expires_at:'invalid'},{...action(),planned_expires_at:'2020-01-01'}]){
    const d=db(),r=await execute(d,[bad],[rule],opts(['module']));assert.equal(r.skipped_error,1);assert.equal(d.writes.length,0);
  }
});
test('full purchased course uses full tariff scope',async()=>{
  const a=action('course',{match_type:'direct',order_id:'course-order',historical_purchase_type:'base_tariff_purchase',historical_tariff_id:'buhgalter',historical_module_product_ids:[]});const d=db();await execute(d,[a],[rule],opts(['course']));assert.equal(d.rows[0].meta.scope_resolution_mode,'full_tariff_scope');assert.equal(d.rows[0].meta.historical_tariff_id,'buhgalter');
});
test('revoked, manual and foreign-rule entitlements stay unchanged',async()=>{
  for(const row of [existing('revoked'),existing('expired',{source_type:'manual'}),existing('expired',{source_rule_id:'other-rule',source_type:'rule_engine'})]){
    const d=db([row]),r=await execute(d,[action()],[rule],opts(['module']));assert.equal(r.skipped_error,1);assert.deepEqual(d.rows,[row]);assert.equal(d.writes.length,0);
  }
});
test('explicit selection affects only selected pairs; replay leaves active data unchanged',async()=>{
  const d=db(), actions=[action(),action('not-selected')];let r=await execute(d,actions,[rule],opts(['module']));assert.equal(r.created,1);assert.equal(r.not_selected,1);const snapshot=structuredClone(d.rows);r=await execute(d,actions,[rule],opts(['module']));assert.equal(r.created,0);assert.equal(r.skipped_idempotent,1);assert.deepEqual(d.rows,snapshot);
});
test('unconditional rules retain their previous grant behavior',async()=>{
  const a=action();delete a.prior_purchase_grant_meta;const d=db(),r=await execute(d,[a],[{...rule,conditions:{}}],opts(['module']));assert.equal(r.created,1);assert.equal(d.rows[0].meta.source_type,'retroapply');
});
