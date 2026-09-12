import test from 'node:test';
import assert from 'node:assert/strict';
import {planDialogueReply, slotValues, DIALOGUE_QUESTIONS} from '../../supabase/functions/_shared/sales-runtime/sequence.mjs';
const trigger='Хочу программу курса ЦБ';
const facts=[
 {id:'program',text:'ПОЛНАЯ ПРОГРАММА: 28 модулей',classification:'sales_safe',source:'catalog'},
 {id:'dates',text:'Даты потока',classification:'sales_safe',source:'catalog'},
 {id:'prices',text:'Действующие цены',classification:'sales_safe',source:'catalog'},
 {id:'topic_vat',text:'В теме НДС рассматриваются объекты налогообложения и налоговая база.',classification:'sales_safe',source:'source-hash',kind:'topic',module_id:'vat'},
 {id:'offer_wrong',text:'Не включает нужную тему',classification:'sales_safe',source:'catalog',kind:'offer',price:1,included_module_ids:['other']},
 {id:'offer_fit',text:'Подходящий тариф. Полная стоимость — 2000 BYN.',classification:'sales_safe',source:'catalog',kind:'offer',price:2000,included_module_ids:['vat']},
 {id:'offer_costly',text:'Дорогой тариф',classification:'sales_safe',source:'catalog',kind:'offer',price:3000,included_module_ids:['vat','other']},
];
function setup() {return {history:[{role:'customer',text:trigger}],triggerPhrase:trigger,firstReply:true,stage:'qualification',lastQuestionId:null,facts,client:{verified_cb_purchase:false}};}
function assess(context, values={}, {intent='answer',question_type='none',fact_ids=[]}={}) {
 const index=context.history.length-1;
 return {intent,question_type,fact_ids,slots:Object.fromEntries(Object.keys(slotValues).map(k=>[k,{value:values[k]||'unknown',evidence:values[k]&&values[k]!=='unknown'?[index]:[]}]))};
}
function exchange(context, reply, incoming) {
 context.history.push({role:'seller',text:reply.text,question_id:reply.question_id},{role:'customer',text:incoming});
 context.firstReply=false;context.stage=reply.stage;context.lastQuestionId=reply.question_id;
}
test('the exact incident: activation cannot deliver program, dates or price even if classifier requests them',()=>{
 const c=setup();
 for(const phrase of [trigger,'  ХОЧУ   программу курса цб  ']) {
  c.history[0].text=phrase;
  const r=planDialogueReply(c,assess(c,{}, {intent:'product_question',question_type:'program',fact_ids:['program','dates']}));
  assert.equal(r.text,'Добрый день!\n\nПодскажите, вы уже учились на курсе ЦБ или рассматриваете участие впервые?');
  assert.equal(r.new_question_count,1);assert.deepEqual(r.fact_ids,[]);assert.equal(r.stage,'experience');
 }
});
test('new customer: activation -> experience -> goal -> relevant topic -> readiness -> offer -> checkout selection',()=>{
 const c=setup();let r=planDialogueReply(c,assess(c));
 exchange(c,r,'Впервые.');
 r=planDialogueReply(c,assess(c,{experience:'new'}));assert.equal(r.question_id,'goals');assert.deepEqual(r.fact_ids,[]);
 exchange(c,r,'Хочу разобраться в НДС.');
 r=planDialogueReply(c,assess(c,{experience:'new',goal:'known'},{fact_ids:['topic_vat']}));assert.equal(r.question_id,'format');assert.deepEqual(r.fact_ids,['topic_vat']);assert.doesNotMatch(r.text,/ПОЛНАЯ|Даты|BYN/);
 exchange(c,r,'Да, время на обучение выделю.');
 r=planDialogueReply(c,assess(c,{experience:'new',goal:'known',format:'accepted'},{fact_ids:['topic_vat']}));assert.equal(r.question_id,'interest');assert.deepEqual(r.fact_ids,[]);
 exchange(c,r,'Да, хочу рассмотреть участие.');
 r=planDialogueReply(c,assess(c,{experience:'new',goal:'known',format:'accepted',interest:'accepted'},{fact_ids:['topic_vat']}));assert.equal(r.question_id,'payment');assert.deepEqual(r.fact_ids,['offer_fit']);assert.doesNotMatch(r.text,/Не включает|Дорогой/);
 exchange(c,r,'Хочу в рассрочку, пришлите ссылку.');
 r=planDialogueReply(c,assess(c,{experience:'new',goal:'known',format:'accepted',interest:'accepted'}, {intent:'payment'}));assert.equal(r.action,'checkout');assert.equal(r.text,undefined);
});
test('graduate: feedback then unknown year then current goal; no re-selling stale discounts',()=>{
 const c=setup();let r=planDialogueReply(c,assess(c));exchange(c,r,'Уже училась у вас.');
 r=planDialogueReply(c,assess(c,{experience:'graduate'}));assert.equal(r.question_id,'feedback');
 exchange(c,r,'Да, курс был полезен.');r=planDialogueReply(c,assess(c,{experience:'graduate',feedback:'known'}));assert.equal(r.text,DIALOGUE_QUESTIONS.year);
 exchange(c,r,'Училась в 2023 году.');r=planDialogueReply(c,assess(c,{experience:'graduate',feedback:'known',year:'known'}));assert.equal(r.question_id,'goals');assert.doesNotMatch(r.text,/скидк|50%|раз больше/);
});
test('known history is used on activation: no question whose answer is already present',()=>{
 const c=setup();c.history.unshift({role:'customer',text:'Училась в 2023 году. Очень полезно, сейчас хочу изучить НДС.'});
 const a=assess(c,{experience:'graduate',feedback:'known',year:'known',goal:'known'});
 for(const s of Object.values(a.slots))if(s.value!=='unknown')s.evidence=[0];
 const r=planDialogueReply(c,a);assert.equal(r.question_id,'format');assert.deepEqual(r.fact_ids,[]);
});
test('purchase alone asks whether they managed to study, never claims completion or personal memory',()=>{
 const c=setup();c.client.verified_cb_purchase=true;
 const r=planDialogueReply(c,assess(c));assert.equal(r.question_id,'participation');assert.doesNotMatch(r.text,/помню|уже учились/);
});
test('unfinished, self taught, employee and trial are different branches',()=>{
 for(const [experience, expected] of [['unfinished','barrier'],['self_taught','confidence'],['employee','employee_goals'],['trial','goals']]) {
  const c=setup();exchange(c,planDialogueReply(c,assess(c)),'Мой опыт');
  const r=planDialogueReply(c,assess(c,{experience}));assert.equal(r.question_id,expected);assert.deepEqual(r.fact_ids,[]);
 }
});
test('a separate explicit program/price question cannot bypass qualification',()=>{
 for(const [text,type,id] of [['Пришлите полную программу отдельно','program','program'],['Сколько стоит?','price','prices']]) {
  const c=setup();exchange(c,planDialogueReply(c,assess(c)),text);
  const r=planDialogueReply(c,assess(c,{}, {intent:'product_question',question_type:type,fact_ids:[id]}));
  assert.equal(r.action,'reply');assert.deepEqual(r.fact_ids,[]);assert.equal(r.question_id,'experience');assert.equal(r.stage,'experience');
 }
});
test('classifier cannot turn an experience answer into a catalog dump or skip to payment',()=>{
 const c=setup();exchange(c,planDialogueReply(c,assess(c)),'Первый раз');
 const r=planDialogueReply(c,assess(c,{experience:'new'},{fact_ids:['program','prices']}));assert.equal(r.question_id,'goals');assert.deepEqual(r.fact_ids,[]);
});
test('missing source evidence, seller statements and the codeword are not customer qualification',()=>{
 const c=setup();c.history.push({role:'seller',text:'Вы наверняка уже опытный бухгалтер'});
 for(const evidence of [[],[0],[1],[99],[-1]]) {
  const a=assess(c,{experience:'graduate'});a.slots.experience.evidence=evidence;
  assert.throws(()=>planDialogueReply(c,a));
 }
});
test('unsupported fit and repeated unanswered question hand off silently instead of inventing or looping',()=>{
 const c=setup();exchange(c,planDialogueReply(c,assess(c)),'Непонятно');
 assert.equal(planDialogueReply(c,assess(c)).action,'handoff');
 assert.equal(planDialogueReply(c,assess(c,{experience:'new',goal:'known'})).action,'handoff');
});
test('a short yes preserves the earlier matched topics for tariff selection',()=>{
 const c=setup();c.firstReply=false;c.history.push({role:'customer',text:'Да, хочу рассмотреть участие'});c.stage='interest';c.lastQuestionId='interest';c.relevantFactIds=['topic_vat'];
 const r=planDialogueReply(c,assess(c,{experience:'new',goal:'known',format:'accepted',interest:'accepted'}));assert.deepEqual(r.fact_ids,['offer_fit']);assert.equal(r.question_id,'payment');
});
test('instruction, human request, refusal and automation disclosure preserve guardrails',()=>{
 const c=setup();exchange(c,planDialogueReply(c,assess(c)),'Другой вопрос');
 for(const intent of ['instruction','human','stop']) {
  const r=planDialogueReply(c,assess(c,{}, {intent}));assert.equal(r.action,intent==='stop'?'stop':'handoff');assert.equal(r.text,undefined);
 }
 const r=planDialogueReply(c,assess(c,{}, {intent:'product_question',question_type:'automation'}));assert.match(r.text,/автоматически/);
});
