import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const guardSource=await readFile(new URL('../../supabase/functions/_shared/broadcast-guards.ts',import.meta.url),'utf8');
const guards=await import(`data:text/javascript;base64,${Buffer.from(transpile(guardSource)).toString('base64')}`);
const load=async(path,names,deps={})=>new Function(...Object.keys(deps),transpile((await readFile(new URL(path,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,''))+';return {'+names+'};')(...Object.values(deps));
const {evaluateWebinarBroadcastGuards}=await load('../../supabase/functions/broadcast-audience-preview/webinarRegistration.ts','evaluateWebinarBroadcastGuards',{evaluateBroadcastGuards:guards.evaluateBroadcastGuards});
const {validateSmsAudienceFilters}=await load('../../supabase/functions/_shared/sms-audience.ts','validateSmsAudienceFilters');
const source=await readFile(new URL('../../supabase/functions/websms-send/index.ts',import.meta.url),'utf8');
const code=transpile(source.replace(/^import .*;\n/gm,''));
const id='00000000-0000-4000-8000-000000000001';
function fixture({staff=true,employee=false,valid=true}={}){
 let handler,selected=0,provider=0,drained=0;const updates=[];
 const db={rpc:async(name,args)=>{
  if(name==='has_admin_section_access')return {data:staff};
  if(name==='has_role_v2')return {data:args._role_code==='employee'?employee:staff};
  if(name==='sms_broadcast_audience_count'){selected++;return {data:2};}
  if(name==='sms_broadcast_enqueue')return {data:{existing:true,dispatch_id:id}};
  throw Error('Unexpected RPC '+name);
 },from:(table)=>{if(table==='sms_messages')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{id,status:'sent',external_id:'21'}})})}),update:value=>{updates.push(value);return {eq:()=>({eq:()=>({eq:async()=>({error:null})})})};}};throw Error('Unexpected table '+table);}};
 const user={auth:{getUser:async()=>valid?{data:{user:{id}}}:{error:{code:'invalid'}}}};
 const createClient=(_url,key)=>key==='service'?db:user;
 const functions={createClient,evaluateWebinarBroadcastGuards,validateSmsAudienceFilters,auditBlockedAttempt:async()=>{},normalizeSmsPhone:()=>null,smsConfiguration:async()=>({token:'synthetic'}),sendSmsByTransport:async()=>{provider++;throw Error('Unexpected send');},drainSmsBroadcastQueue:async()=>{drained++;return{};},smsDispatchSummary:async()=>({sent:0,queued:0,unknown:1,sms_ids:[id]}),checkSmsDelivery:async()=>{provider++;return'delivered';},resolveSmsAudience:async()=>{selected++;return[{profile_id:'p1'},{profile_id:'p2'}];},Deno:{env:{get:key=>({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',BROADCAST_INTERNAL_SECRET:'synthetic-internal'}[key])},serve:value=>{handler=value;}}};
 new Function(...Object.keys(functions),code)(...Object.values(functions));
 return {updates,get selected(){return selected;},get provider(){return provider;},get drained(){return drained;},call:(body,headers={Authorization:'Bearer synthetic'})=>handler(new Request('https://example.invalid/websms-send',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}))};
}
let passes=0;
let f=fixture();let r=await f.call({action:'broadcast',dry_run:true,filters:{}});assert.equal(r.status,200);assert.equal((await r.json()).sms_count,2);assert.equal(f.provider,0);passes++;
f=fixture({staff:false});r=await f.call({action:'broadcast',dry_run:true,filters:{}});assert.equal(r.status,403);assert.equal(f.selected,0);passes++;
f=fixture({employee:true,staff:false});r=await f.call({action:'broadcast',dry_run:true,filters:{}});assert.equal(r.status,403);passes++;
f=fixture();r=await f.call({action:'broadcast',request_id:id,text:'Synthetic message',filters:{}});assert.equal(r.status,400);assert.equal((await r.json()).error,'broadcast_blocked_empty_audience_filters');assert.equal(f.provider,0);passes++;
f=fixture();r=await f.call({action:'broadcast',dry_run:true,filters:{direct_user_ids:[id]}});assert.equal(r.status,400);assert.equal(f.selected,0);passes++;
f=fixture();r=await f.call({action:'process_sms_queue'});assert.equal(r.status,403);assert.equal(f.drained,0);passes++;
f=fixture();r=await f.call({action:'broadcast',request_id:id,text:'Synthetic message',filters:{include:[{mode:'purchased',product_id:id}]}});assert.equal(r.status,200);assert.equal((await r.json()).unknown,1);assert.equal(f.drained,0);assert.equal(f.provider,0);passes++;
f=fixture();r=await f.call({action:'status',sms_id:id});assert.equal(r.status,200);assert.equal((await r.json()).status,'delivered');assert.equal(f.provider,1);assert.equal(f.updates[0].status,'delivered');passes++;
for(const filters of [{exclude:[{mode:'typo'}]},{exclude:[{unknown:true}]},{exclude:[{mode:'purchased',tariff_ids:[null]}]},{bot_ids:[id]}]){f=fixture();r=await f.call({action:'broadcast',request_id:id,text:'Synthetic message',filters});assert.equal(r.status,400);assert.equal(f.provider,0);passes++;}
f=fixture();r=await f.call({action:'broadcast',request_id:id,text:'Synthetic message',filters:{webinar_registration:{page_id:id,block_id:id}}});assert.equal(r.status,200);assert.equal(f.drained,0);passes++;
console.log('SMS real handler auth/preview/guards/idempotency/status: '+passes+' PASS');
