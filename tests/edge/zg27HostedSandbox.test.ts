import { describe,it,expect,vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { makeHostedRunner,validateHosted,hostedPayload } from '../../supabase/functions/zg27-sandbox-acceptance/hosted';
import { CASES,requestId,callbackUrl,makeRunner,validateInput } from '../../supabase/functions/zg27-sandbox-acceptance/runner';
import { authenticateAdminActor } from '../../supabase/functions/_shared/admin-section-auth';
import { load } from './zg27-ingress-harness';
vi.stubGlobal('crypto',webcrypto);
const TOKEN='a'.repeat(64),CARD='never-export-card-token',RUN='12345678-1234-4234-8234-123456789abc';
const args=(case_id:keyof typeof CASES='repeat_3',operation='hosted_create')=>({operation,run_id:RUN,started_at:new Date().toISOString(),case_id,...(operation==='hosted_create'?{}:{checkout_token:TOKEN})}) as any;
const options={actorId:'actor-A',authorization:'private-credentials',notificationUrl:callbackUrl('https://synthetic.supabase.co')};
async function fixture(key:keyof typeof CASES='repeat_3',patch:any={}){
  const receipts=new Map<string,any>();let paid=false,post=0;
  const first=await requestId(options.actorId,RUN,`hosted_${key}`,0),tracking=`zg27-sandbox:hosted:${first}`;
  const send=vi.fn(async(url:string,init:any)=>{
    expect(init.redirect).toBe('error');expect(url).toMatch(/^https:\/\/(checkout|gateway)\.bepaid\.by\//);
    if(url.endsWith('/ctp/api/checkouts')){
      expect(init.method).toBe('POST');const c=JSON.parse(init.body).checkout;expect(c.test).toBe(true);expect(c.attempts).toBe(1);expect(c.order.tracking_id).toBe(tracking);
      return new Response(JSON.stringify({checkout:{token:TOKEN,redirect_url:`https://checkout.bepaid.by/v2/checkout?token=${TOKEN}`}}));
    }
    if(url.includes('/ctp/api/checkouts/'))return new Response(JSON.stringify({checkout:{token:TOKEN,test:true,transaction_type:'payment',finished:paid,expired:false,status:paid?'successful':'pending',order:{amount:CASES[key][0],currency:'BYN',tracking_id:tracking,additional_data:CASES[key].length>1?{contract:['recurring']}:{}},gateway_response:{payment:{uid:first}},...patch.checkout}}));
    if(url===`https://gateway.bepaid.by/transactions/${first}`)return new Response(JSON.stringify({transaction:{uid:first,test:true,type:'payment',status:'successful',amount:CASES[key][0],currency:'BYN',tracking_id:tracking,credit_card:{token:CARD},...patch.first}}));
    if(url.includes('/tracking_id/')){const tx=receipts.get(decodeURIComponent(url.split('/').at(-1)!));return tx?new Response(JSON.stringify({transaction:tx})):new Response('{}',{status:404})}
    if(url.endsWith('/transactions/payments')){
      post++;const r=JSON.parse(init.body).request;expect(r.test).toBe(true);expect(r.credit_card).toEqual({token:CARD});expect(r.notification_url).toBe(options.notificationUrl);expect(r.tracking_id).toMatch(/^zg27-sandbox:hosted:/);expect(init.headers.RequestID).toBe(r.tracking_id.split(':').at(-1));
      if(patch.throwMit)throw Error('private provider uncertainty');
      const tx={uid:init.headers.RequestID,test:true,type:'payment',status:'successful',amount:r.amount,currency:'BYN',tracking_id:r.tracking_id,...patch.mit};receipts.set(r.tracking_id,tx);return new Response(JSON.stringify({transaction:tx}));
    }
    throw Error('unexpected route');
  });
  return {send,receipts,paid:()=>{paid=true},post:()=>post};
}
describe('isolated hosted widget→verified first CIT→finite TEST MIT',()=>{
  it.each(Object.keys(CASES) as (keyof typeof CASES)[])('%s exact first hosted amount, mandatory contract, exact N and replay without N+1',async key=>{
    const f=await fixture(key),run=makeHostedRunner(),opts={...options,fetcher:f.send};
    const ready=await run(args(key),opts);expect(ready).toMatchObject({status:'hosted_ready',test_confirmed:true,checkout_token:TOKEN});
    const c=JSON.parse(f.send.mock.calls[0][1].body).checkout;expect(c.order.amount).toBe(CASES[key][0]);expect(c.order.additional_data.contract).toEqual(CASES[key].length>1?['recurring']:undefined);expect(c.settings.save_card_toggle).toBeUndefined();
    expect(c.settings.notification_url).toBe(options.notificationUrl);expect(c.settings.return_url).toBe('https://gorbova.by/admin/zg27-sandbox?mode=hosted');expect(c.settings.notification_url).not.toContain('bepaid-webhook');
    expect((await run(args(key,'hosted_inspect'),opts)).status).toBe('awaiting_customer');expect(f.post()).toBe(0);
    f.paid();const finish=args(key,'hosted_finish_test');const result=await run(finish,opts);
    expect(result).toMatchObject({status:'passed',test_confirmed:true,confirmed_payments:CASES[key].length,sum_minor:key.startsWith('first')?129000:89000});
    expect(f.post()).toBe(CASES[key].length-1);expect(f.send.mock.calls.filter(([url,init])=>url.endsWith('/transactions/payments')).map(([,init])=>JSON.parse(init.body).request.amount)).toEqual(CASES[key].slice(1));
    await run(finish,opts);await makeHostedRunner()(finish,opts);expect(f.post()).toBe(CASES[key].length-1);
    const before=f.send.mock.calls.length;expect((await run(args(key,'hosted_inspect'),opts)).status).toBe('passed');expect(f.send.mock.calls.slice(before).every(([,init])=>init.method==='GET')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/never-export|private|checkout_token|checkout_url|credit_card/);
  });
  it.each([{checkout:{order:{amount:29667,currency:'BYN',tracking_id:'foreign',additional_data:{contract:[]}}}},{checkout:{transaction_type:'authorization'}},{checkout:{test:false}},{checkout:{order:{amount:1}}},{checkout:{token:'b'.repeat(64)}}])('never exposes widget URL before checkout proof %j',async patch=>{
    const f=await fixture('repeat_3',patch);const result=await makeHostedRunner()(args(),{...options,fetcher:f.send});expect(result.status).toBe('stopped');expect(result).not.toHaveProperty('checkout_url');expect(f.post()).toBe(0);
  });
  it.each([{test:false},{amount:1},{tracking_id:'foreign'},{uid:'foreign'},{credit_card:{}},{status:'failed'}])('first receipt %j blocks ALL MIT',async first=>{
    const f=await fixture('repeat_3',{first});f.paid();expect((await makeHostedRunner()(args('repeat_3','hosted_finish_test'),{...options,fetcher:f.send})).status).toBe('stopped');expect(f.post()).toBe(0);
  });
  it('uncertain second payment is cached, stops at exactly one MIT, never runs third',async()=>{
    const f=await fixture('repeat_3',{throwMit:true});f.paid();const run=makeHostedRunner(),input=args('repeat_3','hosted_finish_test'),opts={...options,fetcher:f.send};
    expect((await run(input,opts)).status).toBe('stopped');await run(input,opts);expect(f.post()).toBe(1);
  });
  it.each([{test:false},{status:'failed'},{uid:'bad-uid'}])('unconfirmed MIT %j stops before third charge',async mit=>{
    const f=await fixture('repeat_3',{mit});f.paid();const r=await makeHostedRunner()(args('repeat_3','hosted_finish_test'),{...options,fetcher:f.send});expect(r.status).toBe('stopped');expect(f.post()).toBe(1);
  });
  it('mutation age remains1h, readonly inspect7days, create single-flight does not resend unknown',async()=>{
    const old=new Date(Date.now()-2*86400000).toISOString();expect(()=>validateHosted({...args(),started_at:old})).toThrow();expect(()=>validateHosted({...args('repeat_3','hosted_finish_test'),started_at:old})).toThrow();expect(validateHosted({...args('repeat_3','hosted_inspect'),started_at:old}).operation).toBe('hosted_inspect');
    const send=vi.fn(async()=>{throw Error('lost response')});const run=makeHostedRunner(),input=args(),opts={...options,fetcher:send};
    await Promise.all([run(input,opts),run(input,opts)]);await run(input,opts);expect(send).toHaveBeenCalledOnce();
  });
  it('foreign actor cannot reuse checkout even with same browser token; no MIT',async()=>{
    const f=await fixture();f.paid();const r=await makeHostedRunner()(args('repeat_3','hosted_finish_test'),{...options,actorId:'actor-B',fetcher:f.send});expect(r.status).toBe('stopped');expect(f.post()).toBe(0);
  });
  it('client cannot choose provider, amount, tracking, card token or extra fields',()=>{
    for(const extra of [{amount:1},{actorId:'A'},{token:CARD},{url:'https://evil.invalid'},{tracking_id:'x'},{checkout_token:TOKEN}])expect(()=>validateHosted({...args(),...extra})).toThrow();
    expect(()=>validateHosted({...args('repeat_3','hosted_inspect'),checkout_token:'https://evil.invalid'})).toThrow();
  });
  it('actual unauthenticated/forbidden hosted entry rejects before credentials or any provider/business access',async()=>{
    const creds=vi.fn(),write=vi.fn();const h=load('supabase/functions/zg27-sandbox-acceptance/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>({from:write})},'../_shared/admin-section-auth.ts':{authenticateAdminActor:async()=>({ok:false,status:401,error:'unauthorized'})},
      '../_shared/bepaid-credentials.ts':{getBepaidCredsStrict:creds},'./runner.ts':{makeRunner,validateInput,callbackUrl},'./hosted.ts':{makeHostedRunner,validateHosted},
      '../_shared/cors.ts':{errorResponse:(e:string,status:number)=>new Response(JSON.stringify({error:e}),{status})},
    });expect((await h.handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(args())}))).status).toBe(401);expect(creds).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(h.effects).not.toHaveBeenCalled();
  });
  it.each(['admin','super_admin','customer'])('actual hosted entry %s uses canonical auth before credentials and never business storage',async role=>{
    const f=await fixture('first_1'),writes=vi.fn(()=>{throw Error('business access forbidden')}),creds=vi.fn(async()=>({test_mode:false}));
    const db={auth:{getUser:async()=>({data:{user:{id:options.actorId}},error:null})},rpc:async(_n:string,a:any)=>({data:a._role_code===role,error:null}),from:writes};
    const h=load('supabase/functions/zg27-sandbox-acceptance/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>db},'../_shared/admin-section-auth.ts':{authenticateAdminActor},
      '../_shared/bepaid-credentials.ts':{getBepaidCredsStrict:creds,isBepaidCredsError:()=>false,createBepaidAuthHeader:()=>options.authorization},
      './runner.ts':{makeRunner,validateInput,callbackUrl},'./hosted.ts':{validateHosted,makeHostedRunner:()=>{const run=makeHostedRunner();return(i:any,o:any)=>run(i,{...o,fetcher:f.send})}},
      '../_shared/cors.ts':{jsonResponse:(body:any)=>new Response(JSON.stringify(body)),errorResponse:(e:string,status:number)=>new Response(JSON.stringify({error:e}),{status})},
    },{Deno:{serve:(fn:any)=>{(db as any).handler=fn},env:{get:()=> 'https://synthetic.supabase.co'}}});
    const r=await(db as any).handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(args('first_1'))}));
    expect(r.status).toBe(role==='customer'?403:200);expect(creds).toHaveBeenCalledTimes(role==='customer'?0:1);expect(f.send).toHaveBeenCalledTimes(role==='customer'?0:2);expect(writes).not.toHaveBeenCalled();expect(h.effects).not.toHaveBeenCalled();
    if(role!=='customer')expect(await r.json()).toMatchObject({status:'hosted_ready',test_confirmed:true});
  });

  it('HTTP400 validation diagnostics contain closed field names, never provider values/token/URL',async()=>{
    const send=vi.fn(async()=>new Response(JSON.stringify({errors:{amount:['private-amount'],return_url:['https://private.invalid/token'],secret_field:['private-secret']},message:'private-message',checkout:{token:TOKEN}}),{status:400}));
    const r=await makeHostedRunner()(args(),{...options,fetcher:send});
    expect(r).toMatchObject({status:'stopped',code:'provider_http_unconfirmed',provider_http_status:400,validation_fields:['amount','return_url'],verification_fields:[]});
    expect(JSON.stringify(r)).not.toMatch(/private|secret_field|https:|aaaaaaaa|checkout_token/);expect(send).toHaveBeenCalledOnce();
  });
  it('failed checkout TEST predicate reports only its closed name and HTTP status, no further calls',async()=>{
    const f=await fixture('repeat_3',{checkout:{test:false,message:'private-provider-message'}});
    const r=await makeHostedRunner()(args(),{...options,fetcher:f.send});
    expect(r).toMatchObject({status:'stopped',code:'checkout_unconfirmed',provider_http_status:200,validation_fields:[],verification_fields:['test']});
    expect(r).not.toHaveProperty('checkout_url');expect(JSON.stringify(r)).not.toMatch(/private|aaaaaaaa|tracking_id/);expect(f.send).toHaveBeenCalledTimes(2);expect(f.post()).toBe(0);
  });
  it('actual entrypoint logs only bounded safe hosted stop metadata even if response is lost',async()=>{
    const warn=vi.fn(),send=vi.fn(async()=>new Response(JSON.stringify({errors:{currency:['private-secret']},message:'private-provider-error'}),{status:400}));
    const db={rpc:async()=>({data:true,error:null}),from:vi.fn(()=>{throw Error('no business storage')})};
    const h=load('supabase/functions/zg27-sandbox-acceptance/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>db},'../_shared/admin-section-auth.ts':{authenticateAdminActor:async()=>({ok:true,actor:{id:options.actorId}})},
      '../_shared/bepaid-credentials.ts':{getBepaidCredsStrict:async()=>({}),isBepaidCredsError:()=>false,createBepaidAuthHeader:()=>options.authorization},
      './runner.ts':{makeRunner,validateInput,callbackUrl},'./hosted.ts':{validateHosted,makeHostedRunner:()=>{const run=makeHostedRunner();return(i:any,o:any)=>run(i,{...o,fetcher:send})}},
      '../_shared/cors.ts':{jsonResponse:(body:any)=>new Response(JSON.stringify(body)),errorResponse:(e:string,status:number)=>new Response(JSON.stringify({error:e}),{status})},
    },{console:{warn},Deno:{serve:(fn:any)=>{(db as any).handler=fn},env:{get:()=> 'https://synthetic.supabase.co'}}});
    const r=await(db as any).handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(args())}));
    expect(r.status).toBe(200);expect(warn).toHaveBeenCalledOnce();expect(warn.mock.calls[0]).toEqual(['zg27_hosted_sandbox_stopped',{code:'provider_http_unconfirmed',provider_http_status:400,validation_fields:['currency'],verification_fields:[]}]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|actor|run_id|tracking|token|https:/);expect(db.from).not.toHaveBeenCalled();expect(h.effects).not.toHaveBeenCalled();
  });

});
