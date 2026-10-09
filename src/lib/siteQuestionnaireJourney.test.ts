import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
import {trackQuestionnaireJourney} from './siteQuestionnaireJourney';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>{map.set(k,v);}};}
describe('questionnaire visitor persistence',()=>{
 beforeEach(()=>{vi.clearAllMocks();});
 it('coalesces replayed requests, resumes with the issued key and preserves first UTM source',async()=>{
  const store=storage();mocks.invoke.mockResolvedValue({data:{success:true,journey_id:id(3),journey_key:'a'.repeat(64)},error:null});
  const one=trackQuestionnaireJourney(id(1),id(2),'?utm_source=Stories&utm_campaign=ЦБ21',store);
  const two=trackQuestionnaireJourney(id(1),id(2),'?utm_source=Telegram',store);
  expect(await one).toEqual(await two);expect(mocks.invoke).toHaveBeenCalledOnce();
  await trackQuestionnaireJourney(id(1),id(4),'?utm_source=Telegram',store);
  const body=mocks.invoke.mock.calls[1][1].body;
  expect(body.attribution).toEqual({utm_source:'Stories',utm_campaign:'ЦБ21'});
  expect(body.journey_id).toBe(id(3));expect(body.journey_key).toBe('a'.repeat(64));
  expect(JSON.stringify(body)).not.toMatch(/email|answers|password|session/);
 });
 it('keeps a private request nonce when a first response is lost and accepts a later visit',async()=>{
  const store=storage();mocks.invoke.mockResolvedValueOnce({data:null,error:new Error('network')});
  expect(await trackQuestionnaireJourney(id(11),id(12),'?utm_source=Email',store)).toBeNull();
  const nonce=mocks.invoke.mock.calls[0][1].body.request_key;
  mocks.invoke.mockResolvedValueOnce({data:{success:true,journey_id:id(13),journey_key:'b'.repeat(64)},error:null});
  await trackQuestionnaireJourney(id(11),id(14),'?utm_source=Other',store);
  expect(mocks.invoke.mock.calls[1][1].body.request_key).toBe(nonce);
  expect(mocks.invoke.mock.calls[1][1].body.attribution).toEqual({utm_source:'Email'});
 });
});
