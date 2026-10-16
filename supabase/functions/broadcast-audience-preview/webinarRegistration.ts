export interface WebinarRegistrationCondition { page_id: string; block_id: string }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseWebinarRegistrationCondition(value: unknown): WebinarRegistrationCondition | null {
 if(!value || typeof value!=="object" || Array.isArray(value))return null;
 const raw=value as Record<string,unknown>;
 return typeof raw.page_id==="string"&&uuid.test(raw.page_id)&&typeof raw.block_id==="string"&&uuid.test(raw.block_id)?{page_id:raw.page_id,block_id:raw.block_id}:null;
}
/** Additive intersection; a malformed/failed filter must never expand the audience. */
export async function filterUsersByWebinarRegistration(supabase:any,candidateUserIds:string[],value:unknown):Promise<Set<string>>{
 const candidates=new Set(candidateUserIds.filter(Boolean));
 if(value===undefined)return candidates;
 const condition=parseWebinarRegistrationCondition(value);
 if(!condition)throw new Error("webinar_registration_filter_invalid");
 if(!candidates.size)return new Set();
 const matched=new Set<string>();
 for(let offset=0;;offset+=200){
  const {data,error}=await supabase.from("site_form_submissions").select("metadata")
   .eq("page_id",condition.page_id).eq("status","processed")
   .eq("metadata->>block_id",condition.block_id).eq("metadata->>webinar_registration","true")
   .order("id").range(offset,offset+199);
  if(error)throw new Error("webinar_registration_filter_failed");
  if(!Array.isArray(data))throw new Error("webinar_registration_filter_unavailable");
  for(const row of data){const userId=row.metadata?.user_id;if(typeof userId==="string"&&candidates.has(userId))matched.add(userId);}
  if(data.length<200)break;
 }
 return matched;
}

/** Scheduled dispatcher uses the same restricted population before anti-empty/run counters. */
export async function resolveWebinarBroadcastCounts(supabase:any,filters:Record<string,unknown>,emailOnlyWhenNoTelegram=false,channels:string[]=["email","telegram"]){
 const users:string[]=[];
 for(let offset=0;;offset+=200){
  const {data,error}=await supabase.rpc("resolve_broadcast_audience_user_ids_system",{_filters:{...filters,__system_bypass:true,channel:"any"}}).order("user_id").range(offset,offset+199);
  if(error||!Array.isArray(data))throw new Error("webinar_registration_audience_failed");
  users.push(...data.map(row=>row.user_id).filter(Boolean));
  if(data.length<200)break;
 }
 let eligible=await filterUsersByWebinarRegistration(supabase,users,filters.webinar_registration);
 if(filters.education){const {filterUsersByEducationCondition}=await import("../_shared/broadcastEducation.ts");eligible=await filterUsersByEducationCondition(supabase,[...eligible],filters.education);}
 let telegram_count=0,email_count=0,total_count=0;
 const ids=[...eligible];
 for(let offset=0;offset<ids.length;offset+=200){
  const {data,error}=await supabase.from("profiles").select("user_id,email,telegram_user_id").in("user_id",ids.slice(offset,offset+200));
  if(error||!Array.isArray(data))throw new Error("webinar_registration_profiles_failed");
  for(const profile of data){const tg=!!profile.telegram_user_id, email=!!profile.email&&(!emailOnlyWhenNoTelegram||!tg);if(tg)telegram_count++;if(email)email_count++;if((tg&&channels.includes("telegram"))||(email&&channels.includes("email")))total_count++;}
 }
 return {telegram_count,email_count,total_count};
}

import {evaluateBroadcastGuards,type BroadcastGuardInput,type BroadcastGuardResult} from "../_shared/broadcast-guards.ts";
/** Extend the existing guard only for the additional concrete, server-enforced restriction. */
export function evaluateWebinarBroadcastGuards(input:BroadcastGuardInput):BroadcastGuardResult{
 const result=evaluateBroadcastGuards(input);
 if(!result.blocked || input.allowFullAudience || !parseWebinarRegistrationCondition(input.filters?.webinar_registration)
  || result.reason!=="broadcast_blocked_empty_audience_filters")return result;
 const length=(input.messageText||"").trim().length;
 if(!input.isDryRun&&!input.isTestSelf&&length<5)return{blocked:true,reason:"broadcast_blocked_short_message",message:`Сообщение слишком короткое для реальной рассылки: ${length} символов, требуется не менее 5.`,meta:{message_length:length,would_be_full_audience:false}};
 return{blocked:false};
}
