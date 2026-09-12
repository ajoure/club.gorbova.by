import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedEvidenceHistory,assessmentTrace,readAssessment,slotValues} from '../../supabase/functions/_shared/sales-runtime/sequence.mjs';
const triggerPhrase='Хочу программу курса ЦБ';
const context={triggerPhrase,facts:[],history:[
 {role:'customer',text:triggerPhrase}, {role:'seller',text:'Вы учились?'},
 {role:'customer',text:'Впервые',evidence_index:99}, {role:'seller',text:'Какая задача?'},
 {role:'customer',text:'Хочу разобраться с НДС'}, {role:'seller',text:'Есть время?'},
 {role:'customer',text:'Да, смогу выделить время'}]};
const assessment=()=>({intent:'answer',question_type:'none',slots:Object.fromEntries(Object.keys(slotValues).map(k=>[k,{value:'unknown',evidence:[]}])),fact_ids:[]});
test('model receives original full-history indices, excluding seller and activation evidence',()=>{
 const payload=indexedEvidenceHistory(context);
 assert.deepEqual(payload.customer_evidence_indices,[2,4,6]);
 assert.deepEqual(payload.history.map(m=>m.evidence_index),[null,null,2,null,4,null,6]);
 assert.equal(context.history[2].evidence_index,99);
 assert.equal(payload.history.length,context.history.length);
 assert.equal(payload.history[5].text,'Есть время?');
});
test('explicit evidence never weakens rejection of seller or trigger citations',()=>{
 for(const index of [0,1,5,99]){
  const a=assessment();a.slots.format={value:'accepted',evidence:[index]};
  assert.throws(()=>readAssessment(a,context),/invalid_customer_evidence/);
 }
 const a=assessment();a.slots.format={value:'accepted',evidence:[6]};
 assert.equal(readAssessment(a,context).slots.format,'accepted');
});
test('failed synthetic assessment retains bad indices without generated prose or unknown facts',()=>{
 const a=assessment();a.intent='PRIVATE PROSE';a.slots.format={value:'accepted',evidence:[5,'PRIVATE PROSE']};a.slots.goal={value:'PRIVATE PROSE',evidence:[]};a.fact_ids=['PRIVATE PROSE'];
 const trace=assessmentTrace(a,context);
 assert.deepEqual(trace.slots.format,{value:'accepted',evidence:[5,'invalid']});
 assert.equal(trace.intent,'invalid');assert.equal(trace.slots.goal.value,'invalid');
 assert.doesNotMatch(JSON.stringify(trace),/PRIVATE PROSE|Впервые|НДС/);
});
