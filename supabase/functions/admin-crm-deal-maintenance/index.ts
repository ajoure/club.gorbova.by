import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { previewRoutingRepair, type RepairOrder } from '../_shared/crm-routing-repair.ts';

/** Internal maintenance only: bounded previews, explicit reviewed batches,
 * exact fingerprints. No payments, access grants, provider calls or messages. */
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return handleCorsPreflightRequest();
  try {
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
    const db=token===serviceKey && serviceKey ? createClient(Deno.env.get('SUPABASE_URL')!,serviceKey)
      : (await requireSuperAdmin(req)).supabase;
    const body=await req.json();
    const rpc=async(name:string,args:Record<string,unknown>={})=>{
      const {data,error}=await db.rpc(name,args);if(error) throw new Error(`${name}_failed`);return data;
    };
    if(body.action==='preview_archive') return jsonResponse({ok:true,candidates:await rpc('crm_preview_empty_deal_duplicates',{
      p_source_ids:body.source_ids ?? null,
    })});
    if(body.action==='archive') return jsonResponse({ok:true,result:await rpc('crm_archive_empty_deal_duplicates',{
      p_batch_id:body.batch_id,p_candidates:body.candidates,
    })});
    if(body.action==='restore_archive') return jsonResponse({ok:true,restored:await rpc('crm_restore_empty_deal_archive',{p_batch_id:body.batch_id})});
    if(body.action==='preview_routes') {
      const config=await rpc('crm_routing_config_fingerprint');
      const rows=await rpc('crm_routing_review_page',{p_after:body.after ?? null,p_limit:100}) as RepairOrder[];
      const cache=new Map<string,Promise<any>>();
      const results=[];
      for(const row of rows) results.push(await previewRoutingRepair(db,row,cache));
      if(await rpc('crm_routing_config_fingerprint')!==config) throw new Error('routing_config_changed_during_preview');
      return jsonResponse({ok:true,config_fingerprint:config,rows:rows.length,results,
        next_after:rows.length===100 ? rows[rows.length-1].order_id : null});
    }
    if(body.action==='apply_routes') return jsonResponse({ok:true,result:await rpc('crm_apply_reviewed_routes',{
      p_batch_id:body.batch_id,p_config_fingerprint:body.config_fingerprint,p_candidates:body.candidates,
    })});
    if(body.action==='restore_routes') return jsonResponse({ok:true,restored:await rpc('crm_restore_routing_batch',{p_batch_id:body.batch_id})});
    return errorResponse('unknown_maintenance_action',400);
  } catch(e) {
    const message=e instanceof Error ? e.message : 'maintenance_failed';
    return errorResponse(message.startsWith('unauthorized') ? 'unauthorized' : message.startsWith('forbidden') ? 'forbidden' : message,
      message.startsWith('unauthorized') ? 401 : message.startsWith('forbidden') ? 403 : 409);
  }
});
