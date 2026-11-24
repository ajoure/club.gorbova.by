import { filterUsersByEducationCondition, parseEducationCondition } from './broadcastEducation.ts';
import { filterUsersByWebinarRegistration } from './broadcast-webinar.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Invalid exclusions must never silently turn a restricted SMS into a full-base send. */
export function validateSmsAudienceFilters(filters:Record<string,any>){
 for(const field of ['include','exclude']){
  if(filters[field]===undefined)continue;
  if(!Array.isArray(filters[field]))throw Error('sms_filter_invalid');
  for(const rule of filters[field]){
   if(typeof rule==='string'){if(!uuid.test(rule))throw Error('sms_filter_invalid');continue;}
   if(!rule||typeof rule!=='object'||Array.isArray(rule)||!('mode'in rule||'product_id'in rule)
    ||Object.keys(rule).some(key=>!['mode','product_id','tariff_ids'].includes(key))
    ||!['purchased','active_access'].includes(rule.mode??'purchased')
    ||(rule.product_id!=null&&rule.product_id!==''&&(typeof rule.product_id!=='string'||!uuid.test(rule.product_id)))
    ||(rule.tariff_ids!==undefined&&(!Array.isArray(rule.tariff_ids)||rule.tariff_ids.some((id:any)=>typeof id!=='string'||!uuid.test(id)))))throw Error('sms_filter_invalid');
  }
 }
 if(filters.club_ids!==undefined&&(!Array.isArray(filters.club_ids)||filters.club_ids.some((id:any)=>typeof id!=='string'||!uuid.test(id))))throw Error('sms_filter_invalid');
 if(filters.club_membership!==undefined&&!['current','ever','any'].includes(filters.club_membership))throw Error('sms_filter_invalid');
}
/** Reuse contact filters, then the same education/webinar eligibility as other channels. */
export async function resolveSmsAudience(db:any,filters:Record<string,any>){
 validateSmsAudienceFilters(filters);
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
