import { createClient } from "npm:@supabase/supabase-js@2";
import { getClientIp } from "../_shared/inline-otp-crypto.ts";
import { questionnaireAttribution } from "./attribution.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (data: unknown, status=200) => new Response(JSON.stringify(data), {status,headers:{...cors,"Content-Type":"application/json"}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,"0")).join(""); }
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:cors});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  if(Number(req.headers.get("content-length")||0)>8192)return json({error:"request_too_large"},413);
  try {
    const raw=await req.text(); if(raw.length>8192)return json({error:"request_too_large"},413);
    const body=JSON.parse(raw);
    if(!uuid.test(body.page_id||"")||!uuid.test(body.visit_id||""))return json({error:"invalid_request"},400);
    // An existing journey needs its opaque key; never resume by UUID alone.
    const resumed=body.journey_id!==undefined;
    if(resumed&&(!uuid.test(body.journey_id)||typeof body.journey_key!=="string"||!/^([a-f0-9]{64})$/.test(body.journey_key)))return json({error:"invalid_journey"},400);
    if(!resumed&&(typeof body.request_key!=="string"||!/^[a-f0-9]{64}$/.test(body.request_key)))return json({error:"invalid_request_key"},400);
    const pepper=Deno.env.get("INLINE_OTP_PEPPER"); if(!pepper)return json({error:"tracking_unavailable"},503);
    // An opaque browser nonce makes a lost first response safely retryable.
    // Knowing a visitor UUID alone never lets another browser recover its key.
    const seed=await hash(`questionnaire-journey-id:${pepper}:${body.page_id}:${body.request_key||""}`);
    const journeyId=resumed?body.journey_id:`${seed.slice(0,8)}-${seed.slice(8,12)}-4${seed.slice(13,16)}-8${seed.slice(17,20)}-${seed.slice(20,32)}`;
    const journeyKey=resumed?body.journey_key:await hash(`questionnaire-journey-key:${pepper}:${body.page_id}:${body.request_key}`);
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await admin.rpc("track_site_questionnaire_visit",{p_journey_id:journeyId,p_key_hash:await hash(journeyKey),p_visit_id:body.visit_id,p_page_id:body.page_id,p_attribution:questionnaireAttribution(body.attribution),p_ip_hash:await hash(`questionnaire-visit:${pepper}:${getClientIp(req)}`)});
    if(error)return json({error:"tracking_rejected"},error.code==="42501"?403:400);
    if(data?.status==="rate_limited")return json({error:"rate_limited"},429);
    if(data?.status!=="tracked")return json({error:"tracking_unavailable"},503);
    return json({success:true,journey_id:journeyId,journey_key:journeyKey});
  }catch{return json({error:"invalid_request"},400);}
});
