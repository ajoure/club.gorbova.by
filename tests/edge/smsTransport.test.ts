import {describe,it,expect,vi} from 'vitest';
import {normalizeSmsPhone,sendSmsByTransport,checkSmsDelivery,drainSmsBroadcastQueue,smsConfiguration} from '../../supabase/functions/_shared/sms-transport';
const config={token:'synthetic-token-only',alphanameId:'1',sender:'Fixture'};
const phone='+99900123456';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function dbFixture(rows:any[]=[]){
 const updates:any[]=[];let claimed=false;
 return {updates,db:{rpc:vi.fn(async()=>({data:claimed?[]:(claimed=true,rows),error:null})),from:(table:string)=>{
  if(table==='integrations')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{is_enabled:true},error:null})})})};
  if(table==='integration_credentials')return {select:()=>({eq:async()=>({data:[{secrets:{token:config.token},config:{}}],error:null})})};
  return {update:(value:any)=>{updates.push(value);return {eq:()=>({eq:async()=>({error:null})})};}};
 }}};
}
describe('SMS.by transport acceptance and uncertainty',()=>{
 it('normalizes a known international phone without accepting extra plus signs',()=>{
  expect(normalizeSmsPhone('999 001-23-456')).toBe(phone);expect(normalizeSmsPhone('++99900123456')).toBeNull();expect(normalizeSmsPhone('short')).toBeNull();
 });
 it('uses the documented POST and requires a positive provider receipt, not status text',async()=>{
  const fetcher=vi.fn(async()=>response({sms_id:21,status:'NEW',parts:1}));
  expect(await sendSmsByTransport(config,phone,'Fixture message',fetcher as typeof fetch)).toMatchObject({status:'sent',external_id:'21'});
  const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(new URL(url).origin).toBe('https://app.sms.by');expect(init.method).toBe('POST');expect(init.redirect).toBe('error');expect(init.signal).toBeDefined();
  expect((await sendSmsByTransport(config,phone,'Fixture message',vi.fn(async()=>response({status:'sent'})) as typeof fetch)).status).toBe('unknown');
 });
 it('keeps timeout/network and ambiguous server results unknown',async()=>{
  for(const fetcher of [vi.fn(async()=>{throw Error('synthetic network interruption')}),vi.fn(async()=>response({error:'synthetic provider failure'},500)),vi.fn(async()=>new Response('not JSON',{status:200}))]){
   expect(await sendSmsByTransport(config,phone,'Fixture message',fetcher as typeof fetch)).toMatchObject({status:'unknown'});
  }
 });
 it('classifies an explicit provider rejection as failed without returning its raw body',async()=>{
  const result=await sendSmsByTransport(config,phone,'Fixture message',vi.fn(async()=>response({error:'sensitive untrusted text'},403)) as typeof fetch);
  expect(result).toEqual({status:'failed',error:'sms_provider_rejected'});
 });
 it('proves handset delivery only by matching receipt and positive delivered timestamp',async()=>{
  expect(await checkSmsDelivery(config,'21',vi.fn(async()=>response({sms_id:21,delivered:1616407673})) as typeof fetch)).toBe('delivered');
  expect(await checkSmsDelivery(config,'21',vi.fn(async()=>response({sms_id:22,delivered:1616407673})) as typeof fetch)).toBe('unknown');
  expect(await checkSmsDelivery(config,'21',vi.fn(async()=>response({sms_id:21,delivered:0})) as typeof fetch)).toBe('pending');
  expect(await checkSmsDelivery(config,'21',vi.fn(async()=>{throw Error('offline')}) as typeof fetch)).toBe('unknown');
 });
 it('never requeues a paid request after unknown transport',async()=>{
  const fixture=dbFixture([{id:'fixture-id',phone_e164:phone,text:'Fixture message'}]);
  const fetcher=vi.fn(async()=>{throw Error('offline')});
  expect(await drainSmsBroadcastQueue(fixture.db,undefined,fetcher as typeof fetch)).toEqual({sent:0,failed:0,unknown:1});
  await drainSmsBroadcastQueue(fixture.db,undefined,fetcher as typeof fetch);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fixture.updates[0].status).toBe('unknown');expect(fixture.updates.some(x=>x.status==='queued')).toBe(false);
 });
 it('rejects an alternate provider origin before any SMS request',async()=>{
  const fixture=dbFixture();const original=fixture.db.from;fixture.db.from=(table:string)=>table==='integration_credentials'?{select:()=>({eq:async()=>({data:[{secrets:{token:'synthetic'},config:{base_url:'https://other.invalid'}}],error:null})})} as any:original(table);
  await expect(smsConfiguration(fixture.db)).rejects.toThrow('sms_provider_url_invalid');
 });
});
