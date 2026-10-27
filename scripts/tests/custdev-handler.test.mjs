import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleCustdev } from '../../supabase/functions/training-custdev/handler.ts';
import { needScores, emptyWording } from '../../supabase/functions/_shared/custdev-contract.ts';
import { fixture,id,a,b,admin,noAccess,lesson,block,blank } from './custdev-fixture.mjs';

const allowedTables=new Set(['training_lessons','lesson_blocks','training_custdev_workspaces','training_custdev_ai_runs','training_custdev_versions','user_lesson_progress','lesson_progress_state']);
const qi=s=>{if(!/^[a-z_][a-z_0-9]*$/.test(s))throw new Error('fixture identifier');return '"'+s+'"';};
function adapter(pg){
 const query=async(sql,args)=>{try{return {data:(await pg.query(sql,args)).rows,error:null};}catch(e){return {data:null,error:{message:e.message,code:e.code}};}};
 return {
  auth:{getUser:async token=>({data:{user:({owner:a,other:b,admin,noaccess:noAccess})[token]?{id:({owner:a,other:b,admin,noaccess:noAccess})[token]}:null},error:token==='expired'?new Error('expired'):null})},
  rpc:async(name,args)=>{assert.ok(['has_role_v2','user_has_training_lesson_access','custdev_save_workspace','custdev_reserve_ai_run'].includes(name));const entries=Object.entries(args);const r=await query(`SELECT public.${qi(name)}(${entries.map(([key],i)=>`${qi(key)}=>$${i+1}`).join(',')}) AS value`,entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v));return {data:r.data?.[0]?.value??null,error:r.error};},
  from(table){assert.ok(allowedTables.has(table));const filters=[],params=[];let columns='*',limit='',order='',offset='',updated=null;
   const add=(column,op,value)=>{params.push(value);filters.push(`${qi(column)} ${op} $${params.length}`);};
   const run=async(single)=>{let sql;if(updated){const updateEntries=Object.entries(updated),sets=updateEntries.map(([key],i)=>`${qi(key)}=$${params.length+i+1}`);sql=`UPDATE public.${qi(table)} SET ${sets.join(',')} ${filters.length?'WHERE '+filters.join(' AND '):''} RETURNING ${columns}`;const r=await query(sql,[...params,...updateEntries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v)]);return {data:single?r.data?.[0]??null:r.data,error:r.error};}sql=`SELECT ${columns} FROM public.${qi(table)} ${filters.length?'WHERE '+filters.join(' AND '):''}${order}${limit}${offset}`;const r=await query(sql,params);return {data:single?r.data?.[0]??null:r.data,error:r.error};};
   const chain={select(c='*'){columns=c==='*'?'*':c.split(',').map(qi).join(',');return chain;},eq(c,v){add(c,'=',v);return chain;},lt(c,v){add(c,'<',v);return chain;},in(c,values){params.push(values);filters.push(`${qi(c)}=ANY($${params.length}::uuid[])`);return chain;},order(c,options){order+=`${order?',':' ORDER BY '}${qi(c)} ${options?.ascending===false?'DESC':'ASC'}`;return chain;},limit(n){assert.ok(Number.isInteger(n));limit=` LIMIT ${n}`;return chain;},range(from,to){assert.ok(Number.isInteger(from)&&Number.isInteger(to));limit=` LIMIT ${to-from+1}`;offset=` OFFSET ${from}`;return chain;},update(v){updated=v;return chain;},maybeSingle:()=>run(true),single:()=>run(true),then:(resolve,reject)=>run(false).then(resolve,reject)};return chain;
  }
 };
}
async function setup(){const f=await fixture();await f.db.exec(`ALTER TABLE public.training_lessons ADD COLUMN module_id uuid,ADD COLUMN sort_order integer,ADD COLUMN title text DEFAULT 'Шаг 5'; UPDATE public.training_lessons SET module_id='${id(99)}',sort_order=5; ALTER TABLE public.lesson_blocks ADD COLUMN content jsonb; UPDATE public.lesson_blocks SET content='{}';`);const db=adapter(f.db),calls=[];const deps={db,callAi:async prompt=>{calls.push(prompt);return deps.output;},output:null};
 const request=(actor,action,extra={})=>f.as('service_role',a,async()=>{const r=await handleCustdev(new Request('http://fixture.local',{method:'POST',headers:actor?{authorization:`Bearer ${actor}`}:{},body:JSON.stringify({action,lessonId:lesson,blockId:block,...extra})}),deps);return {status:r.status,body:await r.json()};});return {...f,deps,calls,request};}

test('Edge authenticates JWT and access before private reads or AI; rejects forged owners',async()=>{const f=await setup();try{for(const actor of [null,'expired','unknown'])assert.equal((await f.request(actor,'load')).status,401);const denied=await f.request('noaccess','load');assert.equal(denied.status,403,JSON.stringify(denied.body));assert.equal((await f.request('owner','load',{ownerId:b})).status,403);assert.equal((await f.request('owner','review',{expectedRevision:0,status:'approved'})).status,403);assert.equal((await f.request('owner','ai',{expectedRevision:0,requestId:id(80),aiAction:'quotes',segmentId:'s1'})).status,400);assert.equal(f.calls.length,0);}finally{await f.db.close();}});

test('complete isolated learner-to-admin path, preview, replay, confirmation and failure preservation',async()=>{
 const f=await setup();try{
  let r=await f.request('owner','load');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.workspace,null);
  const state=structuredClone(blank);state.segments=[{id:'s1',title:'Торговля',description:'Магазины',decisionMaker:'Директор',reason:'Опыт',productTypeIds:[],questions:[{id:'q1',group:1,text:'Что мешает?',types:['active','former','prospect'],note:'',order:1}]}];state.interviews=[{id:'i1',segmentId:'s1',name:'Респондент',type:'active',category:null,portfolioRef:null,date:'',status:'completed',answers:[{id:'a1',questionId:'q1',snapshot:'Что мешает?',group:1,text:'Теряем время на документы.',status:'received',followups:[{id:'f1',question:'Что нужно?',answer:'Нужны сроки.'}]}]}];
  r=await f.request('owner','save',{expectedRevision:0,state});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.workspace.revision,1);
  f.deps.output={items:[{rationale:'Из ответа',source_answer_id:'a1',source_respondent_id:'i1',exact_quote:'Теряем время',category:'problem'}]};
  const requestId=id(100);r=await f.request('owner','ai',{expectedRevision:1,aiAction:'quotes',segmentId:'s1',requestId});assert.equal(r.status,200,JSON.stringify(r.body));const quoteRun=r.body.run;
  assert.equal((await f.request('owner','ai',{expectedRevision:1,aiAction:'quotes',segmentId:'s1',requestId})).body.replayed,true);assert.equal(f.calls.length,1);
  assert.deepEqual((await f.request('owner','load')).body.state.analyses,{});
  assert.equal((await f.request('owner','apply',{expectedRevision:1,runId:quoteRun.id,preserve:false})).status,400);
  r=await f.request('owner','apply',{expectedRevision:1,runId:quoteRun.id,preserve:true});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.state.analyses.s1.quotes.length,1);
  let current=r.body.state;const qid=current.analyses.s1.quotes[0].id;
  f.deps.output={items:[{need_label:'Сроки',primary_category:'problem',quote_ids:[qid],significance:{score:3,rationale:'Время'},purchase_impact:{score:4,rationale:'Сроки'},product_fit:{score:5,rationale:'Нет матрицы',linked_product_refs:[]}}]};
  r=await f.request('owner','ai',{expectedRevision:2,aiAction:'needs',segmentId:'s1',requestId:id(101)});assert.equal(r.status,200,JSON.stringify(r.body));const needsRun=r.body.run;
  r=await f.request('owner','apply',{expectedRevision:2,runId:needsRun.id,preserve:true});assert.equal(r.status,200,JSON.stringify(r.body));current=r.body.state;
  const need=current.analyses.s1.needs[0];assert.equal(need.aiOriginal.productFit,null);need.overrides={productFit:3};need.approvedValue={...needScores(current,'s1',need),sourceHash:r.body.hashes.s1};current.company.approvedText='Работаем с магазинами';current.positioning.s1={...emptyWording(),approvedText:'Помогаем магазинам со сроками',needIds:[need.id]};current.usps=[{id:'u1',segmentId:'s1',title:'Сроки',needId:need.id,problem:'Потери времени',result:'Документы в срок',mechanism:'Планирование',productRefs:[],evidence:'',userText:'Гипотеза',aiText:'',approvedText:'Гипотеза: планирование',status:'needs_evidence'}];
  r=await f.request('owner','save',{expectedRevision:3,state:current});assert.equal(r.status,200,JSON.stringify(r.body));current=r.body.state;
  f.deps.output={items:[{rationale:'Из ответа',source_answer_id:'a1',source_respondent_id:'i1',exact_quote:'Выдуманная цитата',category:'problem'}]};r=await f.request('owner','ai',{expectedRevision:4,aiAction:'quotes',segmentId:'s1',requestId:id(102)});assert.equal(r.status,502);assert.deepEqual((await f.request('owner','load')).body.state,current);
  assert.equal((await f.request('other','load')).body.workspace,null);
  r=await f.request('owner','submit',{expectedRevision:4,state:current});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.workspace.status,'submitted');assert.equal(r.body.workspace.revision,5);
  r=await f.request('admin','load',{ownerId:a});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.canEdit,false);assert.equal(r.body.versions.length,1);
  assert.equal((await f.request('admin','save',{ownerId:a,expectedRevision:5,state:current})).status,403);
  r=await f.request('admin','review',{ownerId:a,expectedRevision:5,status:'approved',notes:'Проверено'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.workspace.status,'approved');assert.deepEqual(r.body.state,current);
  r=await f.request('owner','load');assert.equal(r.body.versions.length,2);assert.equal(r.body.workspace.review_notes,'Проверено');assert.equal(r.body.runs.length,3);
  await f.db.query("INSERT INTO public.training_custdev_ai_runs(workspace_id,user_id,request_id,action,source_hash,workspace_revision,model_name,status,finished_at) SELECT $1,$2,gen_random_uuid(),'quotes','h',6,'fixture','failed',now() FROM generate_series(1,41)",[r.body.workspace.id,a]);
  r=await f.request('owner','load');assert.equal(r.body.runs.length,40);assert.equal(r.body.historyMore.runs,true);r=await f.request('owner','history',{runsOffset:40,versionsOffset:0});assert.equal(r.status,200);assert.equal(r.body.runs.length,4);assert.equal(r.body.historyMore.runs,false);
 }finally{await f.db.close();}
});
