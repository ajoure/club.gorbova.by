import { filterUsersByEducationCondition, parseEducationCondition } from './broadcastEducation.ts';
import { filterUsersByWebinarRegistration } from '../broadcast-audience-preview/webinarRegistration.ts';
/** Reuse contact filters, then the same education/webinar eligibility as other channels. */
export async function resolveSmsAudience(db:any,filters:Record<string,any>){
 if(filters.education!==undefined&&!parseEducationCondition(filters.education))throw Error('sms_education_filter_invalid');
 const rows:any[]=[];
 for(let offset=0;;offset+=200){
  const {data,error}=await db.rpc('resolve_sms_broadcast_contacts',{_filters:{...filters,...(filters.education!==undefined||filters.webinar_registration!==undefined?{__sms_keep_duplicates:true}:{})}}).order('profile_id').range(offset,offset+199);
  if(error)throw Error('sms_audience_unavailable');
  rows.push(...(data||[]));if((data||[]).length<200)break;
  if(offset>=100000)throw Error('sms_audience_too_large');
 }
 let result=rows;
 if(filters.education!==undefined||filters.webinar_registration!==undefined){
  const eligible=new Set<string>();
  for(let offset=0;offset<rows.length;offset+=200){
   const userIds=[...new Set<string>(rows.slice(offset,offset+200).map(r=>r.user_id).filter(Boolean))];
   let allowed=await filterUsersByEducationCondition(db,userIds,filters.education);
   if(filters.webinar_registration!==undefined)allowed=await filterUsersByWebinarRegistration(db,[...allowed],filters.webinar_registration);
   for(const id of allowed)eligible.add(id);
  }
  result=result.filter(r=>r.user_id&&eligible.has(r.user_id));
 }
 const byPhone=new Map<string,any>();
 for(const row of result.sort((a,b)=>Number(Boolean(b.has_account))-Number(Boolean(a.has_account))||String(a.profile_id).localeCompare(String(b.profile_id)))){
  // SQL always returns normalized phone; tests may omit it to isolate eligibility.
  const key=row.phone_e164??row.profile_id;if(!byPhone.has(key))byPhone.set(key,row);
 }
 return [...byPhone.values()];
}
