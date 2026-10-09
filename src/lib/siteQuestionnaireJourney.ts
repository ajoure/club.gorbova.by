import { supabase } from "@/integrations/supabase/client";
import { questionnaireAttribution } from "../../supabase/functions/site-questionnaire-visit/attribution";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secret=/^[a-f0-9]{64}$/;
const ttl=90*24*60*60*1000;
export type QuestionnaireJourney = { journey_id: string; journey_key: string };
type PendingJourney={createdAt:number;requestKey:string;attribution:Record<string,string>;journey?:QuestionnaireJourney};
type StoragePort=Pick<Storage,"getItem"|"setItem">;
const requests=new Map<string,Promise<QuestionnaireJourney|null>>();
function nonce(){return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");}
function read(storage:StoragePort,key:string):PendingJourney|null{
 try{
  const raw=storage.getItem(key);if(!raw||raw.length>4096)return null;
  const value=JSON.parse(raw);
  if(!Number.isFinite(value.createdAt)||value.createdAt>Date.now()||Date.now()-value.createdAt>ttl||!secret.test(value.requestKey))return null;
  const journey=value.journey;
  if(journey&&(!uuid.test(journey.journey_id)||!secret.test(journey.journey_key)))return null;
  return {createdAt:value.createdAt,requestKey:value.requestKey,attribution:questionnaireAttribution(value.attribution),...(journey?{journey:{journey_id:journey.journey_id,journey_key:journey.journey_key}}:{})};
 }catch{return null;}
}
/** Analytics-only key: never contains email, answers, OTPs or an auth session. */
export function trackQuestionnaireJourney(pageId:string,visitId:string,search:string,storage:StoragePort=window.localStorage):Promise<QuestionnaireJourney|null>{
 if(!uuid.test(pageId)||!uuid.test(visitId))return Promise.resolve(null);
 const requestId=`${pageId}:${visitId}`;
 const existing=requests.get(requestId);if(existing)return existing;
 const promise=(async()=>{
  try{
   const storageKey=`site-questionnaire-journey:v1:${pageId}`;
   const record=read(storage,storageKey)||{createdAt:Date.now(),requestKey:nonce(),attribution:questionnaireAttribution(Object.fromEntries(new URLSearchParams(search)))};
   // Retaining this nonce makes a lost first response retryable without extra views.
   try{storage.setItem(storageKey,JSON.stringify(record));}catch{/* Private mode may disable persistence. */}
   const {data,error}=await supabase.functions.invoke("site-questionnaire-visit",{body:{page_id:pageId,visit_id:visitId,attribution:record.attribution,
    ...(record.journey?record.journey:{request_key:record.requestKey})}});
   if(error||data?.success!==true||!uuid.test(data.journey_id)||!secret.test(data.journey_key))return null;
   const journey={journey_id:data.journey_id,journey_key:data.journey_key};
   try{storage.setItem(storageKey,JSON.stringify({...record,journey}));}catch{/* Tracking does not block the questionnaire. */}
   return journey;
  }catch{return null;}
 })();
 requests.set(requestId,promise);if(requests.size>100)requests.delete(requests.keys().next().value!);
 return promise;
}
