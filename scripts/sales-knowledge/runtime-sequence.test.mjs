import test from 'node:test';
import assert from 'node:assert/strict';
import {planDialogueReply, slotValues, DIALOGUE_QUESTIONS, hasExplicitTechnicalProblem} from '../../supabase/functions/_shared/sales-runtime/sequence.mjs';
const trigger='Хочу программу курса ЦБ';
const facts=[
 {id:'program',text:'ПОЛНАЯ ПРОГРАММА: 28 модулей',classification:'sales_safe',source:'catalog'},
 {id:'dates',text:'Даты потока',classification:'sales_safe',source:'catalog'},
 {id:'prices',text:'Действующие цены',classification:'sales_safe',source:'catalog'},
 {id:'topic_vat',reply_text:'По НДС разберём налоговую базу и объекты налогообложения.',text:'В теме НДС рассматриваются объекты налогообложения и налоговая база.',classification:'sales_safe',source:'source-hash',kind:'topic',module_id:'vat'},
 {id:'offer_wrong',text:'Не включает нужную тему',classification:'sales_safe',source:'catalog',kind:'offer',price:1,included_module_ids:['other']},
 {id:'offer_fit',text:'Подходящий тариф. Полная стоимость — 2000 BYN.',classification:'sales_safe',source:'catalog',kind:'offer',price:2000,included_module_ids:['vat']},
 {id:'offer_costly',text:'Дорогой тариф',classification:'sales_safe',source:'catalog',kind:'offer',price:3000,included_module_ids:['vat','other']},
];
test('topic pitches use reviewed short replies in qualification and direct questions, keeping detail in context',()=>{
 const c=setup();c.firstReply=false;c.stage='goals';c.lastQuestionId='goals';c.history.push({role:'customer',text:'Хочу разобраться в НДС.'});
 c.facts=[...facts,{...facts[3],id:'vat-practice',text:'Подробности учебного описания. '.repeat(20),reply_text:'Закрепим тему на практическом задании.'}];
 c.facts=c.facts.map(f=>f.id==='topic_vat'?{...f,text:'Длинное описание урока. '.repeat(20)}:f);
 const selected=['topic_vat','vat-practice'];
 const r=planDialogueReply(c,assess(c,{experience:'new',goal:'known'},{fact_ids:selected}));
 assert.equal(r.question_id,'format');assert.equal(r.new_question_count,1);assert.ok(r.text.length<=404);assert.doesNotMatch(r.text,/Подробности|Длинное|Благодарю/);
 assert.ok(c.facts.find(f=>f.id==='topic_vat').text.length>400);
 c.stage='payment';c.lastQuestionId='payment';
 const direct=planDialogueReply(c,assess(c,{experience:'new',goal:'known',format:'accepted',interest:'accepted'},{intent:'product_question',question_type:'topic',fact_ids:selected}));
 assert.equal(direct.question_id,'none');assert.doesNotMatch(direct.text,/Подробности|Длинное/);assert.ok(direct.text.length<=402);
});
test('missing, empty, instructional-question or excessive short reply never falls back to knowledge text',()=>{
 for(const reply_text of [undefined,'','Короткий вопрос?','Ссылка https://example.com','x'.repeat(201)]){
  const c=setup();c.firstReply=false;c.stage='goals';c.lastQuestionId='goals';c.history.push({role:'customer',text:'Хочу разобраться в НДС.'});
  c.facts=facts.map(f=>f.id==='topic_vat'?{...f,reply_text}:f);
  assert.deepEqual(planDialogueReply(c,assess(c,{experience:'new',goal:'known'},{fact_ids:['topic_vat']})),{action:'handoff',reason:'missing_short_topic_reply'});
 }
});
function setup() {return {history:[{role:'customer',text:trigger}],triggerPhrase:trigger,firstReply:true,stage:'qualification',lastQuestionId:null,facts,client:{verified_cb_purchase:false}};}
function assess(context, values={}, {intent='answer',question_type='none',fact_ids=[]}={}) {
 const index=context.history.length-1;
 return {intent,question_type,fact_ids,slots:Object.fromEntries(Object.keys(slotValues).map(k=>[k,{value:values[k]||'unknown',evidence:values[k]&&values[k]!=='unknown'?[index]:[]}]))};
}
function exchange(context, reply, incoming) {
 context.history.push({role:'seller',text:reply.text,question_id:reply.question_id},{role:'customer',text:incoming});
 context.firstReply=false;context.stage=reply.stage;context.lastQuestionId=reply.question_id;
}
test('technical checkout trouble always assigns the last message instead of creating another payment link',()=>{
 for (const text of ['Ссылка не открывается','При оплате ошибка 500','Не получается оплатить по ссылке','Кнопка рассрочки не работает']) {
  const c=setup();exchange(c,planDialogueReply(c,assess(c)),text);
  const result=planDialogueReply(c,assess(c,{experience:'new',goal:'known',format:'accepted',interest:'accepted'},{intent:'payment'}));
  assert.deepEqual(result,{action:'handoff',reason:'technical_problem'});
 }
});
test('AI recognizes screenshot-only or paraphrased technical problems and hands them off silently',()=>{
 const c=setup();exchange(c,planDialogueReply(c,assess(c)),'Вот скрин, дальше не пускает');
 assert.deepEqual(planDialogueReply(c,assess(c,{}, {intent:'technical'})),{action:'handoff',reason:'technical_problem'});
});
test('ordinary payment questions are not technical incidents',()=>{
 const c=setup();exchange(c,planDialogueReply(c,assess(c)),'Как оплатить курс?');
 assert.equal(planDialogueReply(c,assess(c,{}, {intent:'payment'})).action,'reply');
});
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


test('a goal interpreted as a product question must still carry a verified topic before asking about time',()=>{
 const c=setup();c.firstReply=false;c.lastQuestionId='goals';c.stage='goals';c.history.push({role:'customer',text:'Работаю бухгалтером, хочу лучше разобраться в НДС.'});
 const r=planDialogueReply(c,assess(c,{experience:'new',goal:'known'},{intent:'product_question',question_type:'topic',fact_ids:['topic_vat']}));
 assert.equal(r.question_id,'format');assert.deepEqual(r.fact_ids,['topic_vat']);
 const missing=planDialogueReply(c,assess(c,{experience:'new',goal:'known'},{intent:'product_question',question_type:'topic',fact_ids:[]}));
 assert.equal(missing.reason,'no_verified_match_for_goal');
});


test('a course question about accounting for a mistaken payment is not a website incident',()=>{
 const c=setup();c.history.push({role:'customer',text:'На курсе разбирается ошибка отражения оплаты в учете?'});
 assert.equal(hasExplicitTechnicalProblem(c),false);
 c.history.push({role:'customer',text:'У меня ошибка оплаты, не могу продолжить'});assert.equal(hasExplicitTechnicalProblem(c),true);
});


test('related product consultation uses only its own public facts after qualification',()=>{
 const c=setup();c.firstReply=false;c.stage='payment';c.history.push({role:'customer',text:'А что входит в клуб?'});c.lastQuestionId='payment';
 c.facts.push({id:'club_full',text:'Клуб: тариф FULL включает базу знаний.',source:'public-product:club',kind:'related_product',classification:'sales_safe'});
 const r=planDialogueReply(c,assess(c,{experience:'new',goal:'known',format:'accepted',interest:'accepted'},{intent:'product_question',question_type:'related_product',fact_ids:['club_full']}));
 assert.equal(r.action,'reply');assert.equal(r.question_id,'none');assert.match(r.text,/Клуб/);assert.doesNotMatch(r.text,/BYN/);
 assert.equal(planDialogueReply(c,assess(c,{experience:'new',goal:'known',format:'accepted',interest:'accepted'},{intent:'product_question',question_type:'related_product',fact_ids:['prices']})).action,'handoff');
});
