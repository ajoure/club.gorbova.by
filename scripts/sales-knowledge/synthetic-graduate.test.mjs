import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticGraduateCatalogue} from '../../supabase/functions/_shared/sales-runtime/synthetic-graduate.mjs';
import {SEQUENCE_FIXTURES} from '../../supabase/functions/_shared/sales-runtime/sequence-fixtures.mjs';

const tariff={id:'alumni',name:'Бизнес-леди, ранее учились',is_public:false,is_active:true};
const offer={id:'current',tariff_id:tariff.id,amount:1495,is_active:true,offer_type:'pay_now',payment_method:'full_payment',meta:{purchase_eligibility:{kind:'prior_purchase'}}};
const rule={id:'full',tariff_id:tariff.id,is_active:true,grant_target_type:'training_content',target_ref:'course',conditions:{access_mode:'full'}};
const input=()=>({tariffs:[tariff],offers:[offer,{...offer,id:'legacy',amount:1325,meta:{...offer.meta,sales_legacy_only:true}}],rules:[rule],addons:[{parent_offer_id:offer.id,addon_offer_id:'addon-1',is_active:true,addon_offer:{is_active:true,amount:500},addon_product:{name:'Розничная торговля',is_active:true},pricing_mode:'percent_discount',discount_percent:50}],facts:[{kind:'topic',module_id:'vat'}],rootModuleId:'course',currency:'BYN'});

test('synthetic graduate uses the current configured eligible offer, not the legacy one',()=>{
 const c=syntheticGraduateCatalogue(input());
 assert.equal(c.fact.price,1495);
 assert.equal(c.fact.offer_id,offer.id);
 assert.deepEqual(c.fact.included_module_ids,['vat']);
 assert.deepEqual(c.options.map(o=>o.id),[offer.id]);
 assert.equal(c.addons.length,1);
 assert.equal(c.sampleAddon.addon_offer_id,'addon-1');
 assert.equal(SEQUENCE_FIXTURES.graduate_eligible.at(-1)[1],'checkout');
 assert.match(SEQUENCE_FIXTURES.graduate_eligible[1][0],/сколько/);
});

test('preview stops on missing or ambiguous private tariff, price or full access',()=>{
 for(const change of [
  x=>{x.offers[0].meta={};},
  x=>{x.offers.push({...offer,id:'duplicate'});},
  x=>{x.rules[0].conditions.access_mode='selected';},
  x=>{x.tariffs[0].is_public=true;},
  x=>{x.facts=[];},
  x=>{x.addons[0].discount_percent=0;},
 ]) {
  const x=input();change(x);assert.throws(()=>syntheticGraduateCatalogue(x));
 }
});
