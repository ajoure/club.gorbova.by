import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {requestHasServiceRoleKey} from '../_shared/service-request-auth.ts';
import {runArchivedLoginMerge} from './run.ts';
Deno.serve(async(req)=>{
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!requestHasServiceRoleKey(req,key))return Response.json({error:'Unauthorized'},{status:401});
 if(req.method!=='POST')return Response.json({error:'Method not allowed'},{status:405});
 const body=await req.json().catch(()=>null);
 if(!body||!['dry-run','execute'].includes(body.mode)||body.operation!=='archived-login-G9-20260911')return Response.json({error:'Invalid operation'},{status:400});
 const client=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const result=await runArchivedLoginMerge(client,body.mode);
  return Response.json(result,{status:result.ok?200:409});
 }catch{return Response.json({ok:false,stage:'unknown',manual_review:true},{status:500});}
});
