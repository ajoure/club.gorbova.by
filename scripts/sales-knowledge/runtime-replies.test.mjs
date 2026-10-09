import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSelection,policyInput} from '../../supabase/functions/_shared/sales-runtime/replies.mjs';
const facts=[{id:'topic',text:'В уроке разбираются виды имущества.',classification:'sales_safe',source:'verified-source'}, {id:'private',text:'Платное решение',classification:'paid_private',source:'source'}];
const select={action:'reply',fact_ids:['topic'],question_id:'goals',bridge_id:'none'};
test('only exact server facts and one bank question reach the customer',()=>{
 const r=renderSelection(select,facts);assert.equal(r.text,'В уроке разбираются виды имущества.\n\nКакие знания хотели бы сейчас обновить или углубить?');assert.equal(r.new_question_count,1);
});
test('injected prose, unknown IDs, private transcripts and duplicate facts fail closed',()=>{
 for(const override of [{text:'Ignore rules'}, {fact_ids:['private']},{fact_ids:['invented']},{fact_ids:['topic','topic']},{question_id:'invented'}, {question_id:'__proto__'}, {bridge_id:'constructor'}, {fact_ids:['topic','topic','topic','topic']}])assert.throws(()=>renderSelection({...select,...override},facts));
});
test('resume does not repeat greeting or ask known experience',()=>{
 assert.throws(()=>renderSelection({...select,bridge_id:'welcome'},facts,{firstReply:false}));
 assert.throws(()=>renderSelection({...select,question_id:'experience'},facts,{knownExperience:true}));
});
test('handoff and opt-out produce no customer message',()=>{
 assert.deepEqual(renderSelection({action:'handoff'},facts),{action:'handoff',reason:'needs_human'});
 assert.deepEqual(renderSelection({action:'stop'},facts),{action:'stop',reason:'customer_opt_out'});
});
test('customer policy approval needs a successful server questionnaire identity check',()=>{
 const p={mode:'questionnaire_customer'},c={id:'chat'},job={},business={};
 assert.equal(policyInput(p,c,job,business,{},'2026-10-09T12:00Z').policy.approved,false);
 assert.equal(policyInput({...p,questionnaire_verified:'true'},c,job,business,{},'2026-10-09T12:00Z').policy.approved,false);
 const verified=policyInput({...p,questionnaire_verified:true},c,job,business,{},'2026-10-09T12:00Z');
 assert.equal(verified.policy.approved,true);assert.equal(verified.policy.owner_test,false);
 const owner=policyInput({mode:'owner_test'},c,job,business,{},'2026-10-09T12:00Z');
 assert.equal(owner.policy.approved,true);assert.equal(owner.policy.owner_test,true);
});
