import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CASES,validateInput,requestId,callbackUrl,runCase,makeRunner } from '../../supabase/functions/zg27-sandbox-acceptance/runner';
import { load } from './zg27-ingress-harness';
import { authenticateAdminActor } from '../../supabase/functions/_shared/admin-section-auth';
vi.stubGlobal('crypto',webcrypto);
const originalFetch=globalThis.fetch;
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('unmocked network forbidden')})));
afterEach(()=>vi.stubGlobal('fetch',originalFetch));
const run='12345678-1234-4234-8234-123456789abc';
const input=(case_id:keyof typeof CASES='repeat_3')=>({run_id:run,case_id,started_at:new Date().toISOString()});
const notificationUrl=callbackUrl('https://synthetic.supabase.co');
function provider(patch:Record<string,unknown>={}){
  return vi.fn(async(url:any,init:any)=>{
    expect(url).toBe('https://gateway.bepaid.by/transactions/payments');expect(init.redirect).toBe('error');
    const r=JSON.parse(init.body).request;
    expect(r.test).toBe(true);expect(r.notification_url).toBe(notificationUrl);expect(r.notification_url).not.toContain('bepaid-webhook');
    return new Response(JSON.stringify({transaction:{test:true,status:'successful',amount:r.amount,currency:'BYN',tracking_id:r.tracking_id,
      uid:init.headers.RequestID,credit_card:{token:'private-test-token'},...patch}}));
  });
}
describe('isolated bePaid sandbox acceptance',()=>{
  it.each(Object.keys(CASES) as (keyof typeof CASES)[])('executes only exact N TEST requests for %s',async key=>{
    const send=provider();const result=await runCase(input(key),{actorId:'actor-A',authorization:'private-auth',notificationUrl,fetcher:send});
    expect(result.status).toBe('passed');expect(result.test_confirmed).toBe(true);expect(send).toHaveBeenCalledTimes(CASES[key].length);
    expect(send.mock.calls.map(([,r])=>JSON.parse(r.body).request.amount)).toEqual([...CASES[key]]);
    const payloads=send.mock.calls.map(([,r])=>JSON.parse(r.body).request);
    expect(payloads[0].additional_data?.contract).toEqual(CASES[key].length>1?['recurring']:undefined);
    for(const r of payloads.slice(1)){expect(r.credit_card).toEqual({token:'private-test-token'});expect(r.test).toBe(true)}
    expect(result.sum_minor).toBe(key.startsWith('first')?129000:89000);
    expect(JSON.stringify(result)).not.toMatch(/private-test-token|private-auth|4200000000000000|verification_value|redirect_url/);
  });
  it.each([false,'true',undefined])('stops before next request when test flag is %s',async test=>{
    const send=provider({test});const result=await runCase(input(),{actorId:'actor-A',authorization:'private-auth',notificationUrl,fetcher:send});
    expect(result.status).toBe('stopped');expect(result.code).toBe('provider_test_unconfirmed');expect(send).toHaveBeenCalledOnce();
  });
  it.each([{status:'failed'},{status:'incomplete'},{credit_card:{}},{amount:1}])('fails closed without retry for %j',async patch=>{
    const send=provider(patch);expect((await runCase(input(),{actorId:'actor-A',authorization:'private-auth',notificationUrl,fetcher:send})).status).toBe('stopped');expect(send).toHaveBeenCalledOnce();
  });
  it.each([undefined,null,'bad-uid','12345678','00000000-0000-0000-0000-000000000000'])('rejects missing/malformed provider UID %s before token or next request',async uid=>{
    const send=provider({uid});const result=await runCase(input(),{actorId:'actor-A',authorization:'secret',notificationUrl,fetcher:send});
    expect(result.code).toBe('provider_uid_invalid');expect(result.steps).toHaveLength(0);expect(send).toHaveBeenCalledOnce();
  });
  it('reused provider UID stops at second request before a third charge',async()=>{
    const send=provider({uid:'12345678-1234-4234-8234-123456789abc'});
    const result=await runCase(input(),{actorId:'actor-A',authorization:'secret',notificationUrl,fetcher:send});
    expect(result.code).toBe('provider_uid_reused');expect(result.steps).toHaveLength(1);expect(send).toHaveBeenCalledTimes(2);
  });
  it('same client run UUID is independently namespaced by authenticated actor',async()=>{
    expect(await requestId('actor-A',run,'first_1',0)).not.toBe(await requestId('actor-B',run,'first_1',0));
    const runner=makeRunner(),send=provider(),args=input('first_1');
    await runner(args,{actorId:'actor-A',authorization:'secret',notificationUrl,fetcher:send});
    await runner(args,{actorId:'actor-B',authorization:'secret',notificationUrl,fetcher:send});
    expect(send).toHaveBeenCalledTimes(2);expect(send.mock.calls[0][1].headers.RequestID).not.toBe(send.mock.calls[1][1].headers.RequestID);
  });
  it.each(['throw','non-test','malformed'])('second-step %s never inherits first successful provider code',async failure=>{
    const first=provider({code:'S.0000'});
    const send=vi.fn(async(url:any,init:any)=>{
      if(first.mock.calls.length===0)return first(url,init);
      if(failure==='throw')throw Error('private transport failure');
      if(failure==='malformed')return new Response('{not-json');
      return new Response(JSON.stringify({transaction:{test:false,status:'failed'}}));
    });
    const result=await runCase(input(),{actorId:'actor-A',authorization:'secret',notificationUrl,fetcher:send});
    expect(result.status).toBe('stopped');expect(result.requests).toBe(2);expect(result.steps).toHaveLength(1);
    expect(result.sum_minor).toBe(29667);expect(result).not.toHaveProperty('provider_code');
    expect(result.code).toBe(failure==='non-test'?'provider_test_unconfirmed':'provider_result_unknown');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('unknown result is cached and never automatically re-dispatched',async()=>{
    const runner=makeRunner(),send=vi.fn(async()=>{throw Error('private provider failure')});
    const args=input();const a=await runner(args,{actorId:'actor-A',authorization:'private-auth',notificationUrl,fetcher:send});
    expect(a.code).toBe('provider_result_unknown');expect(await runner(args,{actorId:'actor-A',authorization:'private-auth',notificationUrl,fetcher:send})).toEqual(a);expect(send).toHaveBeenCalledOnce();
  });
  it('stable unique per-run/plan/index UUIDs and concurrent request coalescing',async()=>{
    const a=await requestId('actor-A',run,'repeat_3',0);expect(a).toBe(await requestId('actor-A',run,'repeat_3',0));expect(a).not.toBe(await requestId('actor-A',run,'repeat_3',1));
    expect(a).not.toBe(await requestId('actor-A',run,'first_3',0));
    const runner=makeRunner(),send=provider(),args=input();await Promise.all([runner(args,{actorId:'actor-A',authorization:'secret',notificationUrl,fetcher:send}),runner(args,{actorId:'actor-A',authorization:'secret',notificationUrl,fetcher:send})]);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('rejects arbitrary body, card, amount, token, destination and old run before dispatch',()=>{
    for(const extra of [{amount:1},{token:'x'},{provider:'x'},{url:'https://evil.invalid'},{card:{}},{actorId:'forged'},{actor_id:'forged'}])expect(()=>validateInput({...input(),...extra})).toThrow('invalid_case');
    expect(()=>validateInput({...input(),started_at:'2020-01-01'})).toThrow('run_expired');
    expect(()=>callbackUrl('http://evil.invalid')).toThrow('callback_unavailable');
  });
  it.each(['anonymous','customer','rbac-error'])('actual edge handler rejects %s before credentials/provider or business reads/writes',async actor=>{
    const creds=vi.fn();const writes=vi.fn(()=>{throw Error('business access forbidden')});
    const db={auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},rpc:async()=>({data:actor==='customer'?false:true,error:actor==='rbac-error'?{}:null}),from:writes};
    const h=load('supabase/functions/zg27-sandbox-acceptance/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>db},'../_shared/admin-section-auth.ts':{authenticateAdminActor},
      '../_shared/bepaid-credentials.ts':{getBepaidCredsStrict:creds},'./runner.ts':{makeRunner,validateInput,callbackUrl},
      '../_shared/cors.ts':{errorResponse:(error:string,status:number)=>new Response(JSON.stringify({error}),{status})},
    });
    const response=await h.handler(new Request('https://synthetic.invalid',{method:'POST',headers:actor==='anonymous'?{}:{Authorization:'Bearer synthetic'},body:JSON.stringify(input())}));
    expect(response.status).toBe(actor==='anonymous'?401:403);expect(creds).not.toHaveBeenCalled();expect(writes).not.toHaveBeenCalled();expect(h.effects).not.toHaveBeenCalled();
  });
  it.each(['admin','super_admin'])('actual %s handler uses configured creds without writes/test-mode changes',async role=>{
    const forbidden=vi.fn(()=>{throw Error('no business DB access')});const send=provider();const creds=vi.fn(async()=>({test_mode:false}));
    const previousFetch=globalThis.fetch;vi.stubGlobal('fetch',send);
    const db={auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},rpc:async(_name:string,args:any)=>({data:args._role_code===role,error:null}),from:forbidden};
    const h=load('supabase/functions/zg27-sandbox-acceptance/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>db},'../_shared/admin-section-auth.ts':{authenticateAdminActor},
      '../_shared/bepaid-credentials.ts':{getBepaidCredsStrict:creds,isBepaidCredsError:()=>false,createBepaidAuthHeader:()=> 'private-auth'},
      './runner.ts':{makeRunner,validateInput,callbackUrl},'../_shared/cors.ts':{
        jsonResponse:(body:any,status=200)=>new Response(JSON.stringify(body),{status}),errorResponse:(error:string,status:number)=>new Response(JSON.stringify({error}),{status})},
    },{Deno:{serve:(fn:any)=>{(db as any).handler=fn},env:{get:()=> 'https://synthetic.supabase.co'}},fetch:send});
    // Use captured actual Deno handler; overriding env never exposes configured secrets.
    const response=await(db as any).handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(input('first_1'))}));
    expect(response.status).toBe(200);expect((await response.json()).test_confirmed).toBe(true);expect(creds).toHaveBeenCalledOnce();expect(forbidden).not.toHaveBeenCalled();expect(send).toHaveBeenCalledOnce();expect(h.effects).not.toHaveBeenCalled();vi.stubGlobal('fetch',previousFetch);
  });
  it('callback subpath is a no-op without client creation, auth, credentials or body processing',async()=>{
    const create=vi.fn(()=>{throw Error('no callback DB')});const h=load('supabase/functions/zg27-sandbox-acceptance/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:create},'./runner.ts':{makeRunner,validateInput,callbackUrl},
    });expect((await h.handler(new Request('https://synthetic.invalid/functions/v1/zg27-sandbox-acceptance/callback',{method:'POST',body:'privateignored'}))).status).toBe(204);
    expect(create).not.toHaveBeenCalled();expect(h.effects).not.toHaveBeenCalled();
  });
});
