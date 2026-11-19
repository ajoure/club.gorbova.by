import { describe,it,expect,vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { inspectCase,validateInspect } from '../../supabase/functions/zg27-sandbox-acceptance/inspect';
import { makeRunner,validateInput,callbackUrl } from '../../supabase/functions/zg27-sandbox-acceptance/runner';
import { load } from './zg27-ingress-harness';
vi.stubGlobal('crypto',webcrypto);
const input={operation:'inspect' as const,run_id:'12345678-1234-4234-8234-123456789abc',case_id:'first_1' as const,started_at:new Date().toISOString(),index:0};
function provider(patch:any={},shape='single'){
  return vi.fn(async(url:string,init:any)=>{
    expect(init.method).toBe('GET');expect(init.body).toBeUndefined();expect(init.redirect).toBe('error');
    expect(url).toMatch(/^https:\/\/gateway\.bepaid\.by\/v2\/transactions\/tracking_id\/zg27-sandbox%3A[0-9a-f-]+$/);
    const tx={test:true,status:'successful',uid:'12345678-1234-4234-8234-123456789abc',amount:129000,currency:'BYN',tracking_id:decodeURIComponent(url.split('/').at(-1)!),
      code:'S.0000',message:'private-secret',credit_card:{token:'private-token'},receipt_url:'https://private.invalid',...patch};
    return new Response(JSON.stringify(shape==='multiple'?{transaction:[tx,tx]}:shape==='array'?{transaction:[tx]}:{transaction:tx}));
  });
}
describe('read-only same sandbox request reconciliation',()=>{
  it.each(['single','array'])('strict sanitized confirmed %s response; never payment POST',async shape=>{
    const send=provider({},shape);const result=await inspectCase(input,{actorId:'actor',authorization:'secret-auth',fetcher:send});
    expect(result).toMatchObject({status:'inspected',provider_status:'successful',provider_code:'S.0000',test_confirmed:true,amount_minor:129000,tracking_verified:true,uid_suffix:'56789abc'});
    expect(send).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toMatch(/private|secret|credit_card|https:|tracking_id/);
  });
  it.each([{test:false},{test:'true'},{amount:1},{currency:'USD'},{tracking_id:'foreign'},{uid:null},{status:'secret-status'}])('fails closed for %j without retry',async patch=>{
    const send=provider(patch);expect((await inspectCase(input,{actorId:'actor',authorization:'secret',fetcher:send})).status).toBe('unknown');expect(send).toHaveBeenCalledOnce();
  });
  it('multiple matching transactions are unknown; malformed code is never exported',async()=>{
    expect((await inspectCase(input,{actorId:'actor',authorization:'secret',fetcher:provider({},'multiple')})).status).toBe('unknown');
    const r=await inspectCase(input,{actorId:'actor',authorization:'secret',fetcher:provider({code:'private-token'})});expect(JSON.stringify(r)).not.toContain('private-token');
  });
  it('same run actor namespace and exact index are server-derived',async()=>{
    const send=provider();await inspectCase(input,{actorId:'A',authorization:'secret',fetcher:send});await inspectCase(input,{actorId:'B',authorization:'secret',fetcher:send});
    expect(send.mock.calls[0][0]).not.toBe(send.mock.calls[1][0]);
    for(const patch of [{index:1},{index:-1},{operation:'run'},{url:'evil'},{actorId:'B'},{started_at:'2020-01-01'}])expect(()=>validateInspect({...input,...patch})).toThrow();
  });
  it('caps streamed body at64KB and HTTP/transport failures remain unknown',async()=>{
    for(const fetcher of [vi.fn(async()=>new Response('x'.repeat(65537))),vi.fn(async()=>new Response('',{status:404})),vi.fn(async()=>{throw Error('secret')})]){
      expect((await inspectCase(input,{actorId:'A',authorization:'secret',fetcher:fetcher as any})).status).toBe('unknown');expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it.each([false,true])('actual handler inspect auth=%s before creds; no business reads/writes',async allowed=>{
    const send=provider();const creds=vi.fn(async()=>({})),business=vi.fn(()=>{throw Error('no DB')});
    const db={rpc:async()=>({data:allowed,error:null}),from:business};
    const h=load('supabase/functions/zg27-sandbox-acceptance/index.ts',{
      'npm:@supabase/supabase-js@2':{createClient:()=>db},'../_shared/admin-section-auth.ts':{authenticateAdminActor:async()=>({ok:true,actor:{id:'actor'}})},
      '../_shared/bepaid-credentials.ts':{getBepaidCredsStrict:creds,isBepaidCredsError:()=>false,createBepaidAuthHeader:()=> 'secret'},
      './runner.ts':{makeRunner,validateInput,callbackUrl},'./inspect.ts':{inspectCase:(i:any,o:any)=>inspectCase(i,{...o,fetcher:send}),validateInspect},
      '../_shared/cors.ts':{jsonResponse:(d:any)=>new Response(JSON.stringify(d)),errorResponse:(e:string,status:number)=>new Response(JSON.stringify({error:e}),{status})},
    },{Deno:{serve:(fn:any)=>{(db as any).handler=fn},env:{get:()=> 'https://synthetic.supabase.co'}}});
    const response=await(db as any).handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));
    expect(response.status).toBe(allowed?200:403);expect(creds).toHaveBeenCalledTimes(allowed?1:0);expect(send).toHaveBeenCalledTimes(allowed?1:0);expect(business).not.toHaveBeenCalled();expect(h.effects).not.toHaveBeenCalled();
  });
});

describe('inspection age and safe transport classification',()=>{
  it('read-only inspect allows 7 days while a new payment run still expires after 1 hour',()=>{
    const started_at=new Date(Date.now()-2*24*3600000).toISOString();
    expect(validateInspect({...input,started_at}).operation).toBe('inspect');
    expect(()=>validateInput({...input,operation:undefined,started_at})).toThrow();
    expect(()=>validateInput({run_id:input.run_id,case_id:input.case_id,started_at})).toThrow('run_expired');
    expect(()=>validateInspect({...input,started_at:new Date(Date.now()-8*24*3600000).toISOString()})).toThrow('run_expired');
  });
  it.each([[401,'inspection_http_401'],[403,'inspection_http_403'],[404,'inspection_not_found'],[503,'inspection_http_5xx']])('classifies GET %s without exposing body',async(status,code)=>{
    const send=vi.fn(async()=>new Response('private-provider-body',{status:Number(status)}));
    const r=await inspectCase(input,{actorId:'actor',authorization:'secret',fetcher:send});expect(r).toMatchObject({status:'unknown',code});expect(JSON.stringify(r)).not.toContain('private');expect(send).toHaveBeenCalledOnce();
  });
});
