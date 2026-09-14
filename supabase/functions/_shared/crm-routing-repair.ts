import { resolveOrderRouting, resolveOfferRouting } from './crm-routing.ts';

export interface RepairOrder {
  order_id:string; status:string; paid_amount:number|null; product_id:string|null; tariff_id:string|null; offer_id:string|null;
  pipeline_id:string|null; pipeline_stage_id:string|null; snapshot:any; row_fingerprint:string;
}

export function repairStage(order:RepairOrder,snapshot:any):string|null {
  if(order.status==='refunded') return snapshot.stage_on_failed ?? null;
  // `paid_amount` alone is not a settlement proof: historic failed attempts
  // can retain it without a successful ledger payment. Correct checkout flows
  // transition the order to paid/partial before routing is repaired.
  if(['paid','partial'].includes(order.status)) return snapshot.stage_on_success ?? null;
  if(['failed','canceled'].includes(order.status)) return snapshot.stage_on_failed ?? null;
  return (order.pipeline_id===snapshot.pipeline_id ? order.pipeline_stage_id : null) || snapshot.stage_on_pending || null;
}

/** Use the immutable snapshot first. Ambiguous historical offers can only
 * supply a terminal route when every enabled candidate proves the same one. */
export async function previewRoutingRepair(db:any,order:RepairOrder,cache=new Map<string,Promise<any>>()) {
  let snapshot=order.snapshot;
  if(snapshot?.enabled!==true) {
    const key=JSON.stringify([order.product_id,order.tariff_id,order.offer_id,['paid','partial','refunded'].includes(order.status)]);
    if(!cache.has(key)) cache.set(key,(async()=>{
      const route=await resolveOrderRouting(db,order);
      if(route.ok && route.snapshot) return {snapshot:route.snapshot};
      if(route.reason!=='ambiguous_offers_for_tariff' || order.offer_id || !['paid','partial','refunded'].includes(order.status)) return {blocked:route.reason || 'route_missing'};
      const {data:offers,error}=await db.from('tariff_offers').select('id,meta').eq('tariff_id',order.tariff_id).eq('is_active',true).eq('offer_type','pay_now');
      if(error) throw new Error('routing_offer_read_failed');
      const enabled=(offers||[]).filter((o:any)=>o.meta?.crm_routing?.enabled===true);
      const resolved=await Promise.all(enabled.map((o:any)=>resolveOfferRouting(db,o.id)));
      if(!resolved.length || resolved.some(r=>!r.ok || !r.snapshot)) return {blocked:'invalid_terminal_offer_routes'};
      const terminalKeys=new Set(resolved.map(r=>JSON.stringify([r.snapshot!.pipeline_id,r.snapshot!.stage_on_success,r.snapshot!.stage_on_failed])));
      if(terminalKeys.size!==1) return {blocked:'ambiguous_terminal_routes'};
      // No original checkout method can be inferred. Null pending is deliberate;
      // these settled legacy orders must never be reopened for a new purchase.
      const first=resolved[0].snapshot!;
      return {snapshot:{...first,offer_id:null,offer_title:null,offer_updated_at:null,stage_on_pending:null,
        stage_names:{...first.stage_names,pending:null},stage_types:{...first.stage_types,pending:null},
        resolved_via:'tariff_terminal_consensus',repair_terminal_only:true,
        repair_candidate_offer_ids:enabled.map((o:any)=>o.id).sort()}};
    })());
    const route=await cache.get(key)!;
    if(route.blocked) return {order_id:order.order_id,blocked:route.blocked};
    snapshot=route.snapshot;
  }
  const stage=repairStage(order,snapshot);
  if(!stage) return {order_id:order.order_id,blocked:'target_stage_missing'};
  if(order.pipeline_id===snapshot.pipeline_id && order.pipeline_stage_id===stage && order.snapshot?.enabled===true) return {order_id:order.order_id,unchanged:true};
  return {order_id:order.order_id,row_fingerprint:order.row_fingerprint,snapshot,target_stage_id:stage};
}
