import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../../supabase/functions/process-scheduled-broadcasts/index.ts',import.meta.url),'utf8');
const script=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const template={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic SMS',channels:['sms'],channel:'sms',status:'scheduled',send_mode:'scheduled',approval_status:'approved',next_run_at:'2026-01-01T00:00:00Z',metadata:{sms_text:'Synthetic fixture'},audience_filters:{include:[],exclude:[]},total_runs:0};
function fixture({enabled=true,approved=true,templates=[{...template}],events=[],sms={sent:1,failed:0,unknown:0,queued:0},smsError=false}={}){
 const calls=[],writes=[];let handler;
 const db={functions:{invoke:async(name,{body})=>{calls.push({name,body});if(name==='websms-send')return {data:body.dry_run?{sms_count:2}:sms,error:body.action==='broadcast'&&!body.dry_run&&smsError?{message:'lost response'}:null};return{data:{},error:null};}},rpc:async(name)=>{
  if(name==='verify_broadcast_dispatcher_cron_secret')return{data:true};
  if(name==='claim_broadcast_automation_deliveries')return{data:events};
  if(name==='compute_next_broadcast_run')return{data:'2027-01-01T00:00:00Z'};
  throw Error(`Unexpected RPC ${name}: SMS-only must not use email/TG audience`);
 },from(table){let op='select',payload,selected=false,single=false;const q={};for(const m of ['select','insert','update','eq','in','not','lte','limit','maybeSingle','single'])q[m]=(...args)=>{if(m==='insert'||m==='update'){op=m;payload=args[0];}if(m==='select')selected=true;if(m==='single'||m==='maybeSingle')single=true;return q;};q.then=(resolve,reject)=>Promise.resolve().then(()=>{
  if(op!=='select'){writes.push({table,op,payload});if(table==='broadcast_runs'&&op==='insert')return{data:{id:'22222222-2222-4222-8222-222222222222'},error:null};if(table==='broadcast_templates'&&selected)return{data:[{id:template.id}],error:null};return{data:null,error:null};}
  if(table==='broadcast_dispatcher_config')return{data:{enabled,production_approved:approved},error:null};
  if(table==='broadcast_templates')return{data:single?templates[0]:templates,error:null};
  throw Error(`Unexpected table ${table}`);
 }).then(resolve,reject);return q;}};
 vm.runInNewContext(script,{Deno:{serve:h=>handler=h,env:{get:k=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',BROADCAST_INTERNAL_SECRET:'fixture-internal'}[k])}},createClient:()=>db,drainFunnelQueue:async()=>calls.push({name:'funnel-drain'}),console:{log(){},warn(){},error(){}},Response,Headers,Date,crypto:webcrypto,hasQuestionnaireLinks:()=>false,additionalTelegramButtonFromMetadata:()=>null});
 return{calls,writes,run:async(body={},cron=true)=>handler(new Request('https://synthetic.invalid',{method:'POST',headers:cron?{'x-broadcast-cron-secret':'fixture-cron'}:{Authorization:'Bearer fixture-service'},body:JSON.stringify(body)}))};
}
test('SMS scheduled uses phone preview and stable run identity; no email resolver',async()=>{const f=fixture();assert.equal((await f.run()).status,200);const send=f.calls.filter(c=>c.name==='websms-send'&&c.body.action==='broadcast'&&!c.body.dry_run);assert.equal(send.length,1);assert.equal(send[0].body.request_id,'22222222-2222-4222-8222-222222222222');assert.equal(send[0].body.text,template.metadata.sms_text);const run=f.writes.find(w=>w.table==='broadcast_runs'&&w.op==='insert');assert.equal(run.payload.audience_count,2);assert.equal(run.payload.channel,'sms');});
test('SMS recurring uses the same transport and advances the existing recurrence',async()=>{const f=fixture({templates:[{...template,send_mode:'recurring',status:'recurring',recurrence_rule:{kind:'daily'}}]});await f.run();assert.equal(f.calls.filter(c=>c.name==='websms-send'&&c.body.action==='broadcast'&&!c.body.dry_run).length,1);assert.ok(f.writes.some(w=>w.table==='broadcast_templates'&&w.payload.next_run_at==='2027-01-01T00:00:00Z'));});
test('SMS event targets only the triggering user and preserves its identity',async()=>{const event={id:'33333333-3333-4333-8333-333333333333',template_id:template.id,user_id:'44444444-4444-4444-8444-444444444444',event_key:'fixture'};const f=fixture({templates:[{...template,status:'recurring'}],events:[event]});await f.run();const send=f.calls.find(c=>c.name==='websms-send'&&c.body.request_id===event.id);assert.ok(send);assert.deepEqual(Array.from(send.body.filters.direct_user_ids),[event.user_id]);});
test('Lost event SMS response stays unresolved, never reported sent or failed',async()=>{const event={id:'33333333-3333-4333-8333-333333333333',template_id:template.id,user_id:'44444444-4444-4444-8444-444444444444',event_key:'fixture'};const f=fixture({events:[event],smsError:true});await f.run();const result=f.writes.find(w=>w.table==='broadcast_automation_deliveries');assert.equal(result.payload.status,'processing');assert.equal(result.payload.error,'sms_delivery_unresolved_no_retry');});
test('Dry run never drains queues or invokes a paid SMS send',async()=>{const f=fixture();await f.run({dry_run:true});assert.ok(!f.calls.some(c=>c.name==='funnel-drain'||c.body?.action==='process_sms_queue'));assert.ok(!f.calls.some(c=>c.name==='websms-send'&&c.body.action==='broadcast'&&!c.body.dry_run));});
for(const gate of ['enabled','approved'])test(`Existing ${gate} gate prevents every SMS operation`,async()=>{const f=fixture({[gate]:false});await f.run();assert.equal(f.calls.length,0);});
