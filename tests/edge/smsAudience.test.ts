import {describe,it,expect,vi} from 'vitest';
import {resolveSmsAudience,validateSmsAudienceFilters} from '../../supabase/functions/websms-send/sms-audience';
const education={lesson_id:'00000000-0000-4000-8000-000000000001',status:'lesson_completed'};
function dbFixture(rows:any[],completed:string[]=[]){
 const rpc=vi.fn(()=>({order:()=>({range:async(a:number,b:number)=>({data:rows.slice(a,b+1),error:null})})}));
 return {rpc,from:()=>({select:()=>({eq:()=>({in:async()=>({data:completed.map(user_id=>({user_id})),error:null})})})})};
}
describe('SMS audience uses the same server-side restrictions',()=>{
 it('reads every bounded page beyond the default response cap',async()=>{
  const rows=Array.from({length:1201},(_,n)=>({profile_id:String(n),user_id:null}));const db=dbFixture(rows);
  expect(await resolveSmsAudience(db,{})).toHaveLength(1201);expect(db.rpc).toHaveBeenCalledTimes(7);
 });
 it('intersects education and excludes contacts without account evidence',async()=>{
  const db=dbFixture([{profile_id:'p1',user_id:'u1'},{profile_id:'p2',user_id:'u2'},{profile_id:'p3',user_id:null}],['u2']);
  expect(await resolveSmsAudience(db,{education})).toEqual([{profile_id:'p2',user_id:'u2'}]);
 });
 it('deduplicates phone after educational eligibility rather than before it',async()=>{
  const db=dbFixture([{profile_id:'p1',user_id:'u1',phone_e164:'+99900123456'},{profile_id:'p2',user_id:'u2',phone_e164:'+99900123456'}],['u2']);
  expect(await resolveSmsAudience(db,{education})).toEqual([{profile_id:'p2',user_id:'u2',phone_e164:'+99900123456'}]);
 });
 it('rejects malformed conditions instead of widening the paid audience',async()=>{
  const db=dbFixture([{profile_id:'p1',user_id:'u1'}]);await expect(resolveSmsAudience(db,{education:{}})).rejects.toThrow('sms_education_filter_invalid');
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it('fails closed on any audience page error',async()=>{
  const db={rpc:()=>({order:()=>({range:async()=>({data:null,error:{message:'unavailable'}})})})};await expect(resolveSmsAudience(db,{})).rejects.toThrow('sms_audience_unavailable');
 });
});

describe('SMS filter validation',()=>{it('preserves exact user IDs and rejects malformed exclusions',()=>{const id='00000000-0000-4000-8000-000000000001';expect(()=>validateSmsAudienceFilters({include:[id],exclude:[id]})).not.toThrow();for(const exclude of [[{mode:'invalid'}],[{productId:id}],[{mode:'purchased',tariff_ids:[null]}],['bad-id']])expect(()=>validateSmsAudienceFilters({exclude})).toThrow('sms_filter_invalid');});});
