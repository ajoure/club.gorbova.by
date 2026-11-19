import { createClient } from 'npm:@supabase/supabase-js@2';
import { authenticateAdminActor } from '../_shared/admin-section-auth.ts';
import { getBepaidCredsStrict, isBepaidCredsError, createBepaidAuthHeader } from '../_shared/bepaid-credentials.ts';
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { callbackUrl, makeRunner, validateInput, type Input } from './runner.ts';
import { inspectCase, validateInspect, type InspectInput } from './inspect.ts';
import { makeHostedRunner, validateHosted, type HostedInput } from './hosted.ts';
const run=makeRunner();
let hosted:ReturnType<typeof makeHostedRunner>|undefined;
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return handleCorsPreflightRequest();
  // Dedicated no-op callback: no auth, parsing, logging, DB, or business handler.
  if(new URL(req.url).pathname.endsWith('/zg27-sandbox-acceptance/callback'))return new Response(null,{status:req.method==='POST'?204:405});
  if(req.method!=='POST')return errorResponse('method_not_allowed',405);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let auth;try{auth=await authenticateAdminActor(req,db)}catch{return errorResponse('authorization_unavailable',503)}
  if(!auth.ok)return errorResponse(auth.error,auth.status);
  let roles;try{roles=await Promise.all(['admin','super_admin'].map(role=>db.rpc('has_role_v2',{_user_id:auth.actor.id,_role_code:role})))}catch{return errorResponse('authorization_unavailable',503)}
  if(roles.some(r=>r.error)||!roles.some(r=>r.data===true))return errorResponse('forbidden',403);
  let dispatch:{operation:'inspect';input:InspectInput}|{operation:'run';input:Input}|{operation:'hosted';input:HostedInput};
  try{const raw=await req.json();dispatch=['hosted_create','hosted_inspect','hosted_finish_test'].includes(raw?.operation)?{operation:'hosted',input:validateHosted(raw)}:raw?.operation==='inspect'?{operation:'inspect',input:validateInspect(raw)}:{operation:'run',input:validateInput(raw)}}catch{return errorResponse('invalid_or_expired_case',400)}
  try{
    const notificationUrl=callbackUrl(Deno.env.get('SUPABASE_URL')!);
    const creds=await getBepaidCredsStrict(db);if(isBepaidCredsError(creds))return errorResponse('sandbox_credentials_unavailable',503);
    // Never switches integration.test_mode; test:true is immutable on EACH request.
    const options={actorId:auth.actor.id,authorization:createBepaidAuthHeader(creds),notificationUrl};
    if(dispatch.operation==='hosted'){const result=await(hosted??=makeHostedRunner())(dispatch.input,options);return jsonResponse(result);}
    if(dispatch.operation==='inspect'){
      const result=await inspectCase(dispatch.input,options);
      console.warn('zg27_sandbox_inspection',{status:result.status,code:'code' in result?result.code:undefined,
        provider_status:'provider_status' in result?result.provider_status:undefined,provider_code:'provider_code' in result?result.provider_code:undefined,
        response_shape:result.response_shape,envelope_type:result.envelope_type,envelope_keys:result.envelope_keys,
        candidate_count:result.candidate_count,provider_http_status:result.provider_http_status});
      return jsonResponse(result);
    }
    const result=await run(dispatch.input,options);
    if(result.status==='stopped')console.warn('zg27_sandbox_stopped',{code:result.code,provider_code:result.provider_code,
      provider_http_status:result.provider_http_status,validation_fields:result.validation_fields,requests:result.requests});
    return jsonResponse(result);
  }catch{return errorResponse('sandbox_unavailable_no_retry',503)}
});
