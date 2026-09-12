import {knowledgeEditor} from '../../supabase/functions/_shared/sales-runtime/knowledge-editor.ts';
const check=(v:unknown)=>{if(!v)throw Error('assertion failed')};
function fixture(owner=true){
 const calls:any[]=[];
 const rows:Record<string,any[]>={
  tariffs:[],access_rules:[],course_caption_gap_audits:[],
  course_transcription_sources:[{id:'source',enabled:true,source_revision:'rev',provider:'kinescope'}],
  course_transcription_bindings:[{source_id:'source',block_id:'oldblock',lesson_id:'oldlesson',block_updated_at:'2026-09-12T00:00:00Z'}],
  course_transcripts:[{source_id:'source',source_revision:'rev',content_sha256:'sha',quality_status:'unreviewed',transcript_text:'SECRET FULL PAID SOLUTION'}],
  training_modules:[{id:'module',product_id:'product',parent_module_id:'root',is_active:false,title:'Деньги'},{id:'oldmodule',title:'Исторический модуль'}],
  training_lessons:[{id:'lesson',module_id:'module',title:'Урок',is_active:false},{id:'oldlesson',module_id:'oldmodule',title:'Лекция'}],
  lesson_blocks:[{id:'block',lesson_id:'lesson',block_type:'video',content:{url:'https://kinescope.io/private-reference',provider:'kinescope'},updated_at:'2026-09-12T00:00:00Z'},{id:'oldblock',lesson_id:'oldlesson',block_type:'video',content:{url:'https://kinescope.io/private-reference',provider:'kinescope'},updated_at:'2026-09-12T00:00:00Z'}],
 };
 const db:any={rpc(name:string,args:any){calls.push({rpc:name,args});return Promise.resolve({data:name==='has_role_v2'?owner:name==='sales_knowledge_snapshot'?{root_module_id:'root',product_id:'product',facts:[],versions:[]}:null,error:null})},from(table:string){
  const c:any={table,select:''};calls.push(c);const filters:((x:any)=>boolean)[]=[];let start=0,end=499;
  const q:any={select(s:string){c.select=s;return q},eq(k:string,v:any){filters.push(x=>x[k]===v);return q},in(k:string,vs:any[]){filters.push(x=>vs.includes(x[k]));return q},order(){return q},range(a:number,b:number){start=a;end=b;return q},then(a:any,b:any){return Promise.resolve({data:(rows[table]??[]).filter(r=>filters.every(f=>f(r))).slice(start,end+1),error:null}).then(a,b)}};return q;
 }};return {db,calls,rows};
}
Deno.test('owner catalogue exposes labels and exact cross-flow match without private transcript or video URL',async()=>{
 const {db,calls}=fixture();const result=await knowledgeEditor(db,{id:'campaign'},'owner',{action:'knowledge_status'});
 check(result.sources.length===1);check(result.sources[0].ready);check(result.sources[0].targets[0].block_id==='block');check(result.sources[0].targets[0].open_now===false);
 check(!JSON.stringify(result).includes('private-reference'));check(!JSON.stringify(result).includes('SECRET FULL PAID'));
 check(calls.every(c=>!c.select?.includes('transcript_text')));
});
Deno.test('canonical access rules include a closed future lesson and preview preserves actor and source revision',async()=>{
 const {db,calls,rows}=fixture();
 rows.tariffs=[{id:'tariff',product_id:'product',is_active:true,access_days:180}];
 rows.access_rules=[{id:'rule',product_id:'product',tariff_id:'tariff',is_active:true,grant_target_type:'training_content',target_ref:'root',conditions:{access_mode:'full'},priority:1}];
 rows.course_caption_gap_audits=[{id:'oldgap',source_id:'source',source_revision:'old-revision',status:'review_required'}];
 const result=await knowledgeEditor(db,{id:'campaign'},'owner',{action:'knowledge_status'});
 check(result.sources[0].ready);check(result.sources[0].targets[0].in_product);check(!result.sources[0].targets[0].open_now);
 const facts=[{id:'fact',module_id:'module',source_revision:'original-review-revision'}];
 await knowledgeEditor(db,{id:'campaign'},'owner',{action:'knowledge_preview',facts,expected_knowledge_version:'old',expected_facts_sha:'before'});
 const call=calls.find(c=>c.rpc==='sales_replace_knowledge_facts');
 check(call.args.p_actor==='owner');check(call.args.p_apply===false);check(call.args.p_facts[0].source_revision==='original-review-revision');
 rows.course_caption_gap_audits[0].source_revision='rev';
 const blocked=await knowledgeEditor(db,{id:'campaign'},'owner',{action:'knowledge_status'});check(!blocked.sources[0].ready);
});
Deno.test('non-owner cannot read catalogue or mutate, and uncovered modules are rejected before writer',async()=>{
 const denied=fixture(false);let threw=false;try{await knowledgeEditor(denied.db,{id:'campaign'},'other',{action:'knowledge_status'})}catch{threw=true}check(threw);check(denied.calls.length===1);
 const allowed=fixture();const result=await knowledgeEditor(allowed.db,{id:'campaign'},'owner',{action:'knowledge_apply',facts:[{id:'fact',module_id:'module'}]});
 check(!result.valid);check(result.errors[0].reason==='module_not_in_product');check(!allowed.calls.some(c=>c.rpc==='sales_replace_knowledge_facts'));
});
