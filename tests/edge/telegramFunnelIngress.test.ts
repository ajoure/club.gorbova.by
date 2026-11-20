import {describe,it,expect,vi} from 'vitest';
import {load} from './zg27-ingress-harness';
const launchId='00000000-0000-4000-8000-000000000006';
function mass(options:{auth?:boolean;manage?:boolean;self?:string|null;creator?:string}={}){
 const drain=vi.fn(async()=>({results:[]}));const rpc=vi.fn(async(name:string)=>({data:name==='has_admin_section_access'?options.manage!==false:name==='has_role_v2'?false:{state:'prepared'},error:null}));
 const db={rpc,auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='telegram_funnel_launches'?{id:launchId,status:'active',test_profile_id:options.self||null,created_by:options.creator||'actor'}:{id:'own-profile'},error:null})};return q}};
 const h=load('supabase/functions/telegram-mass-broadcast/index.ts',{'npm:@supabase/supabase-js@2':{createClient:()=>db},'../_shared/telegram-funnel.ts':{drainFunnelQueue:drain}});
 const request=(body:any)=>new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(options.auth===false?{}:{Authorization:'Bearer synthetic'})},body:JSON.stringify(body)});
 return{h,drain,rpc,request};
}
describe('actual existing broadcast handler funnel authorization boundary',()=>{
 for(const [auth,manage,status]of [[false,true,401],[true,false,403]]as const)it(`rejects unauthorized launch ${status} before preparing any recipient`,async()=>{
  const f=mass({auth,manage});const response=await f.h.handler(f.request({funnel_action:'dispatch',launch_id:launchId}));expect(response.status).toBe(status);expect(f.drain).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(([n])=>n==='telegram_funnel_prepare_audience')).toBe(false);
 });
 it('freezes recipients immediately before queue dispatch through the existing admin action',async()=>{
  const f=mass();const response=await f.h.handler(f.request({funnel_action:'dispatch',launch_id:launchId}));expect(response.status).toBe(200);expect(f.rpc).toHaveBeenCalledWith('telegram_funnel_prepare_audience',{p_launch:launchId});expect(f.drain).toHaveBeenCalledOnce();expect(f.h.effects).not.toHaveBeenCalled();
 });
 it('self test cannot substitute recipient or reuse another recipient test launch',async()=>{
  const f=mass({self:'foreign-profile'});expect((await f.h.handler(f.request({funnel_action:'test',launch_id:launchId}))).status).toBe(403);
  expect((await f.h.handler(f.request({funnel_action:'dispatch',launch_id:launchId}))).status).toBe(409);
  const switched=mass({self:'own-profile',creator:'actor-a'});expect((await switched.h.handler(switched.request({funnel_action:'test',launch_id:launchId}))).status).toBe(403);expect(switched.drain).not.toHaveBeenCalled();
  expect((await f.h.handler(f.request({funnel_action:'test',launch_id:launchId,profile_id:'foreign'}))).status).toBe(400);expect(f.drain).not.toHaveBeenCalled();
 });
 it('self test only dispatches its authenticated actor own prepared enrollment',async()=>{
  const f=mass({self:'own-profile'});expect((await f.h.handler(f.request({funnel_action:'test',launch_id:launchId}))).status).toBe(200);expect(f.drain).toHaveBeenCalledOnce();
 });
});
describe('actual existing webhook funnel branch',()=>{
 function fixture(active=true){let entry:any;const callback=vi.fn(async()=>({handled:true,state:'deferred'}));const create=vi.fn(()=>({from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:active?{id:'bot',status:'active',bot_token_encrypted:'synthetic'}:null})};return q}}));
  const h=load('supabase/functions/telegram-webhook/index.ts',{'npm:@supabase/supabase-js@2':{createClient:create},'../_shared/telegram-funnel.ts':{handleFunnelCallback:callback}}, {Deno:{serve:(fn:any)=>entry=fn,env:{get:(name:string)=>name==='TELEGRAM_WEBHOOK_SECRET'?'provider-secret':'synthetic'}}});
  return{entry,callback,create,h};}
 it('rejects unsigned callbacks before bot lookup or callback effects',async()=>{const f=fixture();const r=await f.entry(new Request('https://synthetic.invalid?bot_id=bot',{method:'POST',body:'{}'}));expect(r.status).toBe(401);expect(f.create).not.toHaveBeenCalled();expect(f.callback).not.toHaveBeenCalled()});
 it('requires the exact active selected bot before forwarding callback',async()=>{const f=fixture(false);const r=await f.entry(new Request('https://synthetic.invalid?bot_id=bot',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'provider-secret'},body:'{}'}));expect(r.status).toBe(404);expect(f.callback).not.toHaveBeenCalled()});
 it('only after secret+bot checks forwards to the recipient-bound reusable helper',async()=>{const f=fixture();const update={update_id:1,callback_query:{id:'synthetic'}};const r=await f.entry(new Request('https://synthetic.invalid?bot_id=bot',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'provider-secret'},body:JSON.stringify(update)}));expect(r.status).toBe(200);expect(f.callback).toHaveBeenCalledOnce();expect(f.callback.mock.calls[0][1]).toBe('bot');expect(f.h.effects).not.toHaveBeenCalled()});
});
