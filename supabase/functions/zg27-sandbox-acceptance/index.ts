import { createClient } from 'npm:@supabase/supabase-js@2';
import { authenticateAdminActor } from '../_shared/admin-section-auth.ts';
import { getBepaidCredsStrict, isBepaidCredsError, createBepaidAuthHeader } from '../_shared/bepaid-credentials.ts';
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { callbackUrl, makeRunner, validateInput } from './runner.ts';
const run=makeRunner();
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
  let input;try{input=validateInput(await req.json())}catch{return errorResponse('invalid_or_expired_case',400)}
  try{
    const notificationUrl=callbackUrl(Deno.env.get('SUPABASE_URL')!);
    const creds=await getBepaidCredsStrict(db);if(isBepaidCredsError(creds))return errorResponse('sandbox_credentials_unavailable',503);
    // Never switches integration.test_mode; test:true is immutable on EACH request.
    const result=await run(input,{actorId:auth.actor.id,authorization:createBepaidAuthHeader(creds),notificationUrl});
    return jsonResponse(result);
  }catch{return errorResponse('sandbox_unavailable_no_retry',503)}
});
