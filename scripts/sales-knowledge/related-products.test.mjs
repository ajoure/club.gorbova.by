import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRelatedProduct,relatedProductIds} from '../../supabase/functions/_shared/sales-runtime/related-products.mjs';
const id='11c9f1b8-0355-4753-bd74-40b42aa53616';
const snapshot=()=>({product:{id,name:'Клуб',currency:'BYN'},tariffs:[{id:'full',name:'FULL',is_public:true,current_price:150,period_label:'в месяц',access_days:30,
 features:[{text:'База знаний'},{text:'Личные видеоответы'}],access_summary:{benefits:[]},offers:[{id:'full-payment',amount:150,offer_type:'pay_now',payment_method:'full_payment'}]},
 {id:'private',is_public:false,name:'Внутренний',current_price:1,features:[{text:'НЕ ПОКАЗЫВАТЬ'}]}]});
test('scope uses editable IDs, deduplicates by validation and excludes main product',()=>{
 assert.deepEqual(relatedProductIds({consultation_product_ids:[id]},id),[]);
 assert.throws(()=>relatedProductIds({consultation_product_ids:[id,id]},''),/invalid/);
 assert.throws(()=>relatedProductIds({consultation_product_ids:['https://site']},''),/invalid/);
});
test('public catalog supplies live features and prices without private tariffs or lesson content',()=>{
 const data=snapshot();data.raw_transcript='SECRET LESSON';const facts=compileRelatedProduct(data,id);
 assert.equal(facts.length,2);assert.match(facts[0].text,/База знаний/);assert.match(facts[1].text,/150 BYN в месяц/);
 assert.doesNotMatch(JSON.stringify(facts),/НЕ ПОКАЗЫВАТЬ|SECRET LESSON/);
 data.tariffs[0].current_price=175;data.tariffs[0].offers[0].amount=175;
 assert.match(compileRelatedProduct(data,id)[1].text,/175 BYN/);
});
test('conflicting, restricted and absent offers never become a public price promise',()=>{
 for(const kind of ['mismatch','eligibility','missing']) {
  const data=snapshot();if(kind==='mismatch')data.tariffs[0].offers.push({id:'primary-other',is_primary:true,offer_type:'pay_now',payment_method:'installment',amount:200});
  if(kind==='eligibility')data.tariffs[0].offers[0].meta={purchase_eligibility:{kind:'prior_purchase'}};
  if(kind==='missing')data.tariffs[0].offers=[];
  assert.equal(compileRelatedProduct(data,id).length,1);
 }
 assert.throws(()=>compileRelatedProduct(snapshot(),'other'),/unavailable/);
});

test('live club null legacy price uses storefront primary offer and suffix without duplicate currency',()=>{
 const data=snapshot();const t=data.tariffs[0];t.current_price=null;t.original_price=999;t.period_label='BYN/мес';
 assert.match(compileRelatedProduct(data,id)[1].text,/150 BYN\/мес/);
 assert.doesNotMatch(compileRelatedProduct(data,id)[1].text,/BYN BYN|999/);
 t.current_price=999;t.meta={card_config:{price_suffix:'BYN за 30 дней'}};
 assert.match(compileRelatedProduct(data,id)[1].text,/150 BYN за 30 дней/);
 t.offers[0].is_active=false;assert.equal(compileRelatedProduct(data,id).length,1);
});
test('hidden, expired, future and invalid features are excluded at a fixed date',()=>{
 const data=snapshot();data.tariffs[0].features=[
 {text:'ALWAYS',visibility_mode:'always'},
 {text:'CURRENT',visibility_mode:'date_range',active_from:'2026-09-01',active_to:'2026-09-30'},
 {text:'EXPIRED',visibility_mode:'until_date',active_to:'2026-09-01'},
 {text:'FUTURE',visibility_mode:'date_range',active_from:'2026-10-01'},
 {text:'INVALID',visibility_mode:'until_date',active_to:'bad'},
 {text:'HIDDEN',visibility_mode:'hidden'}];
 const text=compileRelatedProduct(data,id,Date.parse('2026-09-12'))[0].text;
 assert.match(text,/ALWAYS/);assert.match(text,/CURRENT/);assert.doesNotMatch(text,/EXPIRED|FUTURE|INVALID|HIDDEN/);
});
