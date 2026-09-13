import { pendingPurchaseContext } from './pending-purchase.ts';
/** Database serialization makes provider changes reuse the same reservations. */
export async function reserveCheckoutDiscounts(db:any,order:Record<string,any>,kind:string,credit:number,bonus:number,cycles=1) {
  if((credit<=0 && bonus<=0) || Number(order.final_price)<=1) return {creditMinor:0,creditPerChargeMinor:0,creditReservationId:null,bonusMinor:0,bonusReservationId:null,intentId:null};
  const {data,error}=await db.rpc('crm_reserve_checkout_discounts',{
    p_order:order,p_context:pendingPurchaseContext(order,kind),p_credit:Math.max(0,Math.round(credit)),
    p_bonus:Math.max(0,Math.round(bonus)),p_cycles:cycles,
  });
  if(error || !data?.intent_id) throw new Error('checkout_discount_reservation_failed');
  return {creditMinor:Number(data.credit_minor),creditPerChargeMinor:Number(data.credit_per_charge_minor),
    creditReservationId:data.credit_reservation_id,bonusMinor:Number(data.bonus_minor),bonusReservationId:data.bonus_reservation_id,intentId:data.intent_id};
}
