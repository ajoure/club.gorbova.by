import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const absent='00000000-0000-0000-0000-000000000000';
for(const name of ['telegram-admin-chat','contact-center-assignment-notify']) {
 test(`${name}: actual entrypoint revision is observable without business effects`,async()=>{
  let handler;let authenticated=false;let effects=0;const cache=new Map();
  const forbidden=()=>{effects++;throw new Error('Unexpected business effect');};
  const actor='00000000-0000-0000-0000-000000000001';
  const client={
   auth:{getClaims:async()=>authenticated?{data:{claims:{sub:actor}},error:null}:{data:null,error:{message:'unauthorized'}},getUser:async()=>({data:{user:authenticated?{id:actor}:null},error:authenticated?null:{message:'unauthorized'}})},
   rpc:async(fn)=>{assert.ok(['has_role','has_admin_section_access'].includes(fn));return{data:true,error:null};},
   from:(table)=>{
    assert.equal(table,'contact_center_message_assignments');let observed;
    const chain={select:()=>chain,eq:(_key,value)=>{observed=value;return chain;},maybeSingle:async()=>{assert.equal(observed,absent);return{data:null,error:null};},insert:forbidden,update:forbidden,delete:forbidden};return chain;
   },storage:new Proxy({}, {get:forbidden}),
  };
  function load(url) {
   if(cache.has(url.href))return cache.get(url.href);
   const source=readFileSync(url,'utf8');const exports={};cache.set(url.href,exports);
   const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   vm.runInNewContext(js,{
    exports,module:{exports},require:(id)=>id.startsWith('npm:@supabase/')?{createClient:()=>client}:load(new URL(id,url)),
    Deno:{serve:(fn)=>{handler=fn;},env:{get:()=> 'synthetic-not-a-key'}},
    Response,Request,Headers,FormData,Blob,URL,TextEncoder,TextDecoder,AbortSignal,
    console:{log:()=>{},warn:()=>{},error:()=>{}},fetch:forbidden,
   },{filename:url.pathname,timeout:2000});return exports;
  }
  load(new URL(`../../supabase/functions/${name}/index.ts`,import.meta.url));assert.equal(typeof handler,'function');
  const cases=[{method:'OPTIONS',status:200},{method:'POST',status:401},{method:'POST',status:name==='telegram-admin-chat'?400:404,auth:true}];
  for(const item of cases){
   authenticated=!!item.auth;
   const body=name==='telegram-admin-chat'?{action:'support_runtime_probe'}:{assignment_id:absent};
   const response=await handler(new Request('https://example.invalid/runtime-proof',{method:item.method,headers:item.auth?{Authorization:'Bearer synthetic'}:{},body:item.method==='POST'?JSON.stringify(body):undefined}));
   assert.equal(response.headers.get('X-Support-Boundary-Version'),'support-boundary-20261022-r1');
   assert.equal(response.headers.get('Access-Control-Expose-Headers'),'X-Support-Boundary-Version');assert.equal(response.status,item.status);
  }
  assert.equal(effects,0,'No writes, Storage or Telegram call is permitted by the probe');
 });
}
