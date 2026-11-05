import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../..',import.meta.url));
const sha=process.argv.find(arg=>arg.startsWith('--source-ref='))?.slice('--source-ref='.length);
const coreOnly=process.argv.includes('--core-only');
const evidence={source_sha:sha??'working-tree',method:'Actual full TS entry modules, stripped by built-in Node TS transformer; Deno.serve callback captured in VM; Supabase/auth/fetch and unrelated imports mocked. No reaction algorithm copied.',network_dispatches:0,source_files:{},cases:[]};
function source(path) {
 const s=sha?execFileSync('git',['show',sha+':'+path],{cwd:repo,encoding:'utf8'}):readFileSync(new URL('../../'+path,import.meta.url),'utf8');
 evidence.source_files[path]={sha256:createHash('sha256').update(s).digest('hex'),git_blob:sha?execFileSync('git',['rev-parse',sha+':'+path],{cwd:repo,encoding:'utf8'}).trim():null,bytes:Buffer.byteLength(s)};
 return s;
}
const webhookPath='supabase/functions/telegram-webhook/index.ts';
const adminPath='supabase/functions/telegram-admin-chat/index.ts';
const scopePath='supabase/functions/telegram-admin-chat/supportScope.ts';
const originals=new Map([webhookPath,adminPath,scopePath].map(p=>[p,source(p)]));
function dbMock(seed,options={}) {
 const state=structuredClone(seed);
 const calls=[];
 const unexpected=[];
 class Query {
  constructor(table){this.table=table;this.ops=[];this.action='read';this.value=null;}
  select(v,options){this.ops.push(['select',v]);this.selectOptions=options;return this;}
  eq(k,v){this.ops.push(['eq',k,v]);return this;}
  is(k,v){this.ops.push(['is',k,v]);return this;}
  in(k,v){this.ops.push(['in',k,v]);return this;}
  order(k,v){this.ops.push(['order',k,v]);return this;}
  limit(v){this.ops.push(['limit',v]);return this;}
  range(a,b){this.ops.push(['range',a,b]);return this;}
  maybeSingle(){this.singleResult=true;return this.execute();}
  single(){this.singleResult=true;return this.execute();}
  upsert(value,options){this.action='upsert';this.value=value;this.options=options;return this;}
  delete(){this.action='delete';return this;}
  then(a,b){return this.execute().then(a,b);}
  async execute(){
   if(!(this.table in state)){unexpected.push(this.table);throw Error('Unexpected mock DB table: '+this.table);}
   calls.push({table:this.table,action:this.action,ops:structuredClone(this.ops),value:structuredClone(this.value)});
   if(options.queryError?.table===this.table && (!options.queryError.action || options.queryError.action===this.action))return{data:null,error:{message:'Synthetic database failure'}};
   const matches=row=>this.ops.every(([op,key,v])=>op==='eq'||op==='is'?row[key]===v:op==='in'?v.includes(row[key]):true);
   let rows=state[this.table].filter(matches);
   const totalCount=rows.length;
   const orders=this.ops.filter(([op])=>op==='order');
   rows.sort((a,b)=>{for(const[,k,opt]of orders){if(a[k]!==b[k])return(a[k]<b[k]?-1:1)*(opt?.ascending===false?-1:1);}return 0;});
   for(const [op,n,end] of this.ops){if(op==='limit')rows=rows.slice(0,n);if(op==='range')rows=rows.slice(n,end+1);}
   if(this.action==='upsert'){
    assert.equal(this.table,'telegram_message_reactions','only synthetic reaction writes allowed');
    const values=Array.isArray(this.value)?this.value:[this.value];
    for(const v of values) {
     const old=state[this.table].find(r=>r.message_id===v.message_id&&r.user_id===v.user_id&&r.emoji===v.emoji);
     if(old)Object.assign(old,v); else state[this.table].push(structuredClone(v));
    }
    return {data:null,error:null};
   }
   if(this.action==='delete'){
    assert.equal(this.table,'telegram_message_reactions','only synthetic reaction deletes allowed');
    state[this.table]=state[this.table].filter(r=>!matches(r));
    return {data:null,error:null};
   }
   if(this.singleResult&&rows.length>1)return{data:null,error:{message:'multiple mocked rows'}};
   if(options.serverPageLimit)rows=rows.slice(0,options.serverPageLimit);
   return {data:this.singleResult?(rows[0]??null):rows,error:null,count:options.unknownCount?null:this.selectOptions?.count==='exact'?totalCount:null};
  }
 }
 const client={
  from(table){return new Query(table);},
  auth:{async getClaims(){return{data:{claims:{sub:'staff-A'}},error:null};}},
  async rpc(name,args){
   calls.push({rpc:name,args:structuredClone(args)});
   if(options.rpcError?.actor===args._user_id && (!options.rpcError.name || options.rpcError.name===name))return{data:null,error:{message:'Synthetic permission failure'}};
   if(name==='has_role'){
    if(options.unknownRole===args._user_id)return{data:null,error:null};
    return{data:(options.permissions?.[args._user_id]?.roles??[]).includes(args._role),error:null};
   }
   if(name==='has_admin_section_access'){
    assert.equal(args._section_code,'communication','no new contacts permission');
    const p=options.permissions?.[args._user_id]??(args._user_id==='staff-A'?{manage:true}:{});
    return{data:args._min_level==='manage'?p.manage===true:p.view===true||p.manage===true,error:null};
   }
   unexpected.push('rpc:'+name);throw Error('Unexpected mocked RPC '+name);
  },
 };
 return {client,state,calls,unexpected};
}
async function handler(path,mock){
 let captured;
 const fetches=[],logs=[],unexpected=[];
 const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-anon',TELEGRAM_WEBHOOK_SECRET:'synthetic-webhook-secret'};
 const context=vm.createContext({
  Deno:{env:{get:k=>env[k]??''},serve:h=>{assert.equal(captured,undefined);captured=h;}},
  Request,Response,Headers,URL,URLSearchParams,Blob,FormData,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,atob,btoa,
  console:{log:(...x)=>logs.push(x),error:(...x)=>logs.push(x),warn:(...x)=>logs.push(x)},
  fetch:async(url,options)=>{
   const parsed=new URL(String(url));
   if(parsed.hostname!=='api.telegram.org'||!parsed.pathname.endsWith('/setMessageReaction')){unexpected.push('fetch');throw Error('Unexpected mocked fetch');}
   // Never calls host/global fetch. Only records synthetic payload.
   const body=JSON.parse(options?.body??'{}');
   fetches.push({method:'setMessageReaction',body});
   return new Response(JSON.stringify({ok:true,result:true}),{status:200,headers:{'Content-Type':'application/json'}});
  },
  setTimeout:()=>{unexpected.push('setTimeout');throw Error('Unexpected timer');},
 });
 const modules=new Map();
 function synthetic(id,exports){
  const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context,identifier:id});
  return m;
 }
 const unused=()=>{unexpected.push('unused-dependency');throw Error('Unexpected dependency executed');};
 const mockImports={
  'npm:@supabase/supabase-js@2':{createClient:()=>mock.client},
  '../_shared/telegram-business.ts':{classifyBusinessMessage:unused},
  '../_shared/telegram-monitoring.ts':{persistMonitoredTelegramMessage:async()=>({handled:false,saved:false})},
  '../_shared/accessValidation.ts':{hasCommercialAccess:unused},
  '../_shared/cb21-release.ts':{CB21_RELEASE_DIGEST:'synthetic-release'},
  './questionnaire-bonus.ts':{handleQuestionnaireBonusJoin:unused},
  './supportSend.ts':{createSupportSendGate:unused,loadSupportUpload:unused},
  './messageFormat.ts':{prepareContactTelegramMessage:unused},
 };
 function actual(p) {
  if(modules.has(p))return modules.get(p);
  const js=stripTypeScriptTypes(originals.get(p),{mode:'strip',sourceUrl:p});
  const m=new vm.SourceTextModule(js,{context,identifier:p});
  modules.set(p,m);return m;
 }
 const m=actual(path);
 await m.link(async spec=>{
  if(spec==='./supportScope.ts')return actual(scopePath);
  if(!mockImports[spec])throw Error('Unexpected import '+spec);
  return synthetic(spec,mockImports[spec]);
 });
 await m.evaluate();
 assert.equal(typeof captured,'function');
 return {invoke:async(req)=>{const res=await captured(req);assert.deepEqual(unexpected,[]);assert.deepEqual(mock.unexpected,[]);return{status:res.status,body:await res.json()};},fetches,logs};
}

const bots=[{id:'bot-A',status:'active',support_enabled:true,bot_token_encrypted:'synthetic-A'},{id:'bot-B',status:'active',support_enabled:true,bot_token_encrypted:'synthetic-B'}];
const message=(id='message-A',bot='bot-A',created='2026-01-01',extra={})=>({id,bot_id:bot,user_id:'client-X',telegram_user_id:9001,message_id:7,transport:'bot',direction:'incoming',business_account_id:null,business_connection_id:null,created_at:created,...extra});
const rx=(user,emoji='❤️',created='2026-01-03',id=user)=>({id,message_id:'message-A',user_id:user,emoji,created_at:created});
const customer=[rx('client-X')];
const permissions={'staff-B':{manage:true},'admin-B':{roles:['admin']},'super-B':{roles:['superadmin']}};
const results=[];
async function check(name,body){
 try{await body();results.push({name,pass:true});}
 catch(e){results.push({name,pass:false,error:e.message});}
}
async function inbound(rows=[message()],options={}) {
 const mock=dbMock({telegram_bots:bots,telegram_messages:rows,profiles:[{user_id:'client-X',telegram_user_id:9001}],telegram_message_reactions:options.reactions??[]},options);
 const h=await handler(webhookPath,mock);
 const res=await h.invoke(new Request('https://synthetic.invalid/webhook?bot_id=bot-A',{method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':'synthetic-webhook-secret'},body:JSON.stringify({update_id:1,message_reaction:{chat:{id:9001,type:'private'},message_id:7,user:{id:9001},old_reaction:options.oldReactions??(options.remove?[{type:'emoji',emoji:'❤️'}]:[]),new_reaction:options.newReactions??(options.remove?[]:[{type:'emoji',emoji:'❤️'}])}})}));
 assert.equal(h.fetches.length,0);
 return{res,mock,reactions:mock.state.telegram_message_reactions};
}
async function outbound(reactions=[],options={}){
 const msg=message('message-A','bot-A','2026-01-01',options.message??{});
 const mock=dbMock({telegram_bots:bots,telegram_messages:[msg],contact_center_message_assignments:[],telegram_message_reactions:reactions},{...options,permissions:{...permissions,...options.permissions}});
 const h=await handler(adminPath,mock);
 const res=await h.invoke(new Request('https://synthetic.invalid/admin-chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-non-jwt'},body:JSON.stringify({action:'sync_telegram_reaction',support_bot_id:'bot-A',telegram_message_db_id:'message-A',emoji:'👍',remove:options.remove??true})}));
 return{res,mock,fetches:h.fetches,reaction:h.fetches[0]?.body.reaction};
}
function expectDelivered(r,emoji){
 assert.equal(r.res.status,200);
 assert.equal(r.res.body.ok,true);
 assert.equal(r.fetches.length,1);
 assert.deepEqual(r.reaction,emoji?[{type:'emoji',emoji}]:[]);
 assert.equal(r.mock.calls.some(c=>c.action&&c.action!=='read'),false,'outbound must not edit people/reactions');
}
function expectDenied(r,status=500){assert.equal(r.res.status,status);assert.equal(r.fetches.length,0);}
await check('inbound same provider IDs: exact bot wins',async()=>{
 const r=await inbound([message(),message('message-B','bot-B','2026-01-02')]);
 assert.equal(r.res.status,200);assert.equal(r.reactions[0]?.message_id,'message-A');
});
await check('inbound newer Business row cannot receive bot reaction',async()=>{
 const r=await inbound([message(),message('business-row','bot-A','2026-01-02',{transport:'business',business_account_id:'synthetic-business',business_connection_id:'synthetic-connection'})]);
 assert.equal(r.reactions[0]?.message_id,'message-A');
});
await check('remove with customer-only remainder clears bot',async()=>expectDelivered(await outbound(customer),null));
await check('remove preserves older operator instead of newer customer',async()=>{
 expectDelivered(await outbound([rx('staff-B','🔥','2026-01-02'),...customer]),'🔥');
});
if(!coreOnly){
 await check('no exact bot match: no reaction write',async()=>{
  const r=await inbound([message('message-B','bot-B')]);assert.equal(r.res.status,200);assert.deepEqual(r.reactions,[]);
 });
 for(const direction of ['incoming','outgoing'])await check('inbound accepts '+direction+' message',async()=>{
  const r=await inbound([message('message-A','bot-A','2026-01-01',{direction})]);assert.equal(r.reactions[0]?.message_id,'message-A');
 });
 await check('inbound database lookup error refuses',async()=>{
  const r=await inbound([message()],{queryError:{table:'telegram_messages'}});assert.equal(r.res.status,500);assert.deepEqual(r.reactions,[]);
  assert.equal(r.mock.calls.some(c=>c.action&&c.action!=='read'),false,'failure before mutation performs no DML');
 });
 await check('inbound upsert error refuses',async()=>{
  const r=await inbound([message()],{queryError:{table:'telegram_message_reactions',action:'upsert'}});assert.equal(r.res.status,500);assert.deepEqual(r.reactions,[]);
 });
 await check('inbound removal preserves another actor reaction',async()=>{
  const r=await inbound([message()],{remove:true,reactions:[rx('client-X'),rx('staff-B')]});
  assert.equal(r.res.status,200);assert.deepEqual(r.reactions,[rx('staff-B')]);
 });
 await check('inbound delete error refuses',async()=>{
  const r=await inbound([message()],{remove:true,reactions:[rx('client-X')],queryError:{table:'telegram_message_reactions',action:'delete'}});
  assert.equal(r.res.status,500);assert.deepEqual(r.reactions,[rx('client-X')]);
 });
 // Delta writes are independent: a later failure does not roll back an earlier delete.
 await check('later delta failure returns 500 with an earlier delete preserved',async()=>{
  const r=await inbound([message()],{reactions:[rx('client-X'),rx('staff-B')],oldReactions:[{type:'emoji',emoji:'❤️'}],newReactions:[{type:'emoji',emoji:'🔥'}],queryError:{table:'telegram_message_reactions',action:'upsert'}});
  assert.equal(r.res.status,500);assert.deepEqual(r.reactions,[rx('staff-B')]);
  assert.deepEqual(r.mock.calls.filter(c=>c.action&&c.action!=='read').map(c=>c.action),['delete','upsert']);
 });
 await check('revoked operator is not selected',async()=>expectDelivered(await outbound([rx('former-staff')]),null));
 await check('custom communication:manage staff is eligible without admin role',async()=>expectDelivered(await outbound([rx('staff-B','🔥')]),'🔥'));
 for(const actor of ['admin-B','super-B'])await check('existing role gate accepts '+actor,async()=>expectDelivered(await outbound([rx(actor,'🔥')]),'🔥'));
 await check('nonstaff customer is not selected or deleted',async()=>{
  const r=await outbound(customer);expectDelivered(r,null);assert.deepEqual(r.mock.state.telegram_message_reactions,customer);
 });
 await check('eligibility RPC error refuses before provider dispatch',async()=>expectDenied(await outbound([rx('staff-B')],{rpcError:{actor:'staff-B',name:'has_admin_section_access'}})));
 await check('unknown role answer refuses before provider dispatch',async()=>expectDenied(await outbound([rx('unknown-actor')],{unknownRole:'unknown-actor'})));
 await check('remainder DB error refuses before provider dispatch',async()=>expectDenied(await outbound(customer,{queryError:{table:'telegram_message_reactions'}})));
 await check('contact who also has current staff rights remains eligible',async()=>{
  expectDelivered(await outbound(customer,{permissions:{'client-X':{manage:true}}}),'❤️');
 });
 await check('empty remainder clears bot',async()=>expectDelivered(await outbound(),null));
 await check('scoped Business message still denied',async()=>expectDenied(await outbound([],{message:{transport:'business',business_account_id:'synthetic-business',business_connection_id:'synthetic-connection'}}),403));
 await check('foreign bot message still denied',async()=>expectDenied(await outbound([],{message:{bot_id:'bot-B'}}),403));
 await check('add stays unchanged and does not aggregate remainder',async()=>{
  expectDelivered(await outbound(customer,{remove:false,queryError:{table:'telegram_message_reactions'}}),'👍');
 });
 await check('equal timestamps have stable ID ordering',async()=>{
  expectDelivered(await outbound([rx('staff-B','🔥','2026-01-03','r-B'),rx('admin-B','❤️','2026-01-03','r-A')]),'🔥');
 });
 await check('full unqualified page is unknown, never a false clear',async()=>{
  const rows=Array.from({length:1001},(_,i)=>rx('revoked-'+i,'❤️','2026-01-03','r-'+String(i).padStart(4,'0')));
  expectDenied(await outbound(rows));
 });
 await check('server-truncated page cannot clear unseen operator',async()=>{
  expectDenied(await outbound([rx('client-X','❤️','2026-01-03'),rx('staff-B','🔥','2026-01-02')],{serverPageLimit:1}));
 });
 await check('unknown remainder count refuses a false clear',async()=>expectDenied(await outbound(customer,{unknownCount:true})));
}
const failed=results.filter(r=>!r.pass);
console.log(JSON.stringify({source_ref:sha??'working-tree',cases:results.length,passed:results.length-failed.length,failed:failed.length,real_network_calls:0,auth_DB_fetch_mocked:true,production_runtime_proof:false,source_files:evidence.source_files,results},null,2));
if(failed.length)process.exitCode=1;
