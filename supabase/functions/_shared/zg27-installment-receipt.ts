import { isRetryExhausted, resolveEffectiveRetryPolicy } from './renewal-retry-policy.ts';
import { ZG27_PRODUCT_ID } from './zg27-policy.ts';
import { resolveZg27DebtToken } from './zg27-debt-proof.ts';
/** Shared HTTP/webhook settlement: no grant, provider-subscription sync, or auto-renew writes. */
export async function settleZg27InstallmentReceipt(db: any, paymentId: string, tx: any): Promise<{ applicable: boolean; paymentId?: string; status?: 'succeeded'|'failed'|'uncertain' }> {
  const read = async (table: string, id: string) => {
    const r = await db.from(table).select('*').eq('id', id).maybeSingle();
    if (r.error || !r.data) throw Error('zg27_installment_receipt_unavailable'); return r.data;
  };
  let payment = await read('payments_v2', paymentId);
  const order = await read('orders_v2', payment.order_id);
  if (order.product_id !== ZG27_PRODUCT_ID) return { applicable: false };
  if (payment.meta?.type !== 'installment_auto_charge' || !payment.meta?.installment_id || !payment.meta?.subscription_id) throw Error('zg27_installment_receipt_identity');
  const row = await read('installment_payments', payment.meta.installment_id);
  if (row.order_id !== order.id || row.user_id !== order.user_id || payment.user_id !== order.user_id
    || row.subscription_id !== payment.meta.subscription_id || row.payment_id !== payment.id
    || row.payment_number <= 1 || payment.installment_number !== row.payment_number
    || payment.provider !== 'bepaid' || payment.currency !== 'BYN' || row.currency !== 'BYN'
    || typeof tx?.uid !== 'string' || !tx.uid || tx.currency !== 'BYN'
    || tx.amount !== Math.round(Number(row.amount) * 100) || tx.amount !== Math.round(Number(payment.amount) * 100)
    || Number(payment.refunded_amount || 0) !== 0 || payment.is_deleted || order.is_deleted
    || ['refunded','canceled'].includes(order.status)) throw Error('zg27_installment_receipt_identity');
  if (tx.status !== 'successful') {
    if(payment.status==='succeeded')return {applicable:true,paymentId:payment.id,status:'succeeded'};
    if(!['failed','declined','expired','canceled','cancelled','error'].includes(tx.status))
      return {applicable:true,paymentId:payment.id,status:'uncertain'};
    if(payment.status==='failed'&&['pending','failed'].includes(row.status))return {applicable:true,paymentId:payment.id,status:'failed'};
    if(!await resolveZg27DebtToken(db,row.subscription_id,row.id))throw Error('zg27_installment_failure_debt_proof');
    const sub=await read('subscriptions_v2',row.subscription_id);
    const exhausted=isRetryExhausted(Number(row.charge_attempts||0),resolveEffectiveRetryPolicy(sub.meta));
    const failed=await db.from('payments_v2').update({status:'failed',error_message:'installment_provider_declined'})
      .eq('id',payment.id).eq('status','processing');
    const released=await db.from('installment_payments').update({status:exhausted?'failed':'pending',error_message:'installment_provider_declined'})
      .eq('id',row.id).eq('status','processing').eq('payment_id',payment.id);
    if(failed.error||released.error)throw Error('zg27_installment_failure_write');    return {applicable:true,paymentId:payment.id,status:'failed'};
  }
  if (payment.provider_payment_id && payment.provider_payment_id !== tx.uid) throw Error('zg27_installment_receipt_uid_conflict');
  const complete = payment.status === 'succeeded' && row.status === 'succeeded' && row.payment_id === payment.id;
  if (!complete) {
    if (!['processing','succeeded'].includes(payment.status) || !['processing','succeeded'].includes(row.status)) throw Error('zg27_installment_receipt_state');
    // A webhook after the payment commit but before the schedule commit still
    // proves against this processing row. No access expiry restriction applies.
    if (!await resolveZg27DebtToken(db, row.subscription_id, row.id)) throw Error('zg27_installment_receipt_debt_proof');
  }
  if (!payment.provider_payment_id) {
    const { error } = await db.from('payments_v2').update({ provider_payment_id: tx.uid })
      .eq('id', payment.id).eq('status', 'processing').is('provider_payment_id', null);
    if (error) throw Error('zg27_installment_receipt_uid_claim');
    payment = await read('payments_v2', payment.id);
    if (payment.provider_payment_id !== tx.uid) throw Error('zg27_installment_receipt_uid_conflict');
  }
  const paidAt = payment.paid_at || tx.paid_at || new Date().toISOString();
  const { data: settled, error } = await db.rpc('crm_settle_one_time_receipt', { p_order_id: order.id, p_payment: {
    order_id: order.id, user_id: order.user_id, profile_id: order.profile_id, amount: payment.amount,
    currency: 'BYN', provider: 'bepaid', provider_payment_id: tx.uid, status: 'succeeded', paid_at: paidAt,
    transaction_type: 'payment', origin: 'installment', meta: payment.meta,
  } });
  if (error || settled?.payment_id !== payment.id || settled?.order_id !== order.id || settled?.access_allowed !== true) throw Error('zg27_installment_receipt_settlement');
  // Recompute on every replay: repair an interruption after payment commit.
  const refreshed = await db.rpc('crm_refresh_paid_purchase', { p_order_id: order.id });
  if (refreshed.error || refreshed.data !== true) throw Error('zg27_installment_receipt_aggregate');
  const updated = await db.from('installment_payments').update({ status: 'succeeded', payment_id: payment.id,
    paid_at: payment.paid_at || paidAt, error_message: null }).eq('id', row.id).eq('subscription_id', row.subscription_id);
  if (updated.error) throw Error('zg27_installment_receipt_row');
  const {data:schedule,error:se}=await db.from('installment_payments').select('status,payment_id,due_date').eq('order_id',order.id);
  if(se)throw Error('zg27_installment_completion_read');
  const next=schedule?.filter((r:any)=>['pending','processing'].includes(r.status)).sort((a:any,b:any)=>Date.parse(a.due_date)-Date.parse(b.due_date))[0];
  const nextUpdate=await db.from('subscriptions_v2').update({next_charge_at:next?.due_date||null}).eq('id',row.subscription_id).eq('user_id',order.user_id);
  if(nextUpdate.error)throw Error('zg27_installment_next_charge_write');
  if(schedule?.length===order.meta.zg27_installment.amounts_minor.length&&schedule.every((r:any)=>r.status==='succeeded'&&r.payment_id)) {
    const {data:sub,error:su}=await db.from('subscriptions_v2').select('meta').eq('id',row.subscription_id).maybeSingle();
    if(su||!sub)throw Error('zg27_installment_completion_read');
    const binding=sub.meta?.zg27_installment_orders?.[order.id];
    const {error:ce}=await db.from('subscriptions_v2').update({meta:{...sub.meta,zg27_installment_orders:{
      ...sub.meta?.zg27_installment_orders,[order.id]:{...binding,completed:true,completed_at:binding?.completed_at||paidAt},
    }}}).eq('id',row.subscription_id);
    if(ce)throw Error('zg27_installment_completion_write');
  }
  return { applicable: true, paymentId: payment.id, status: 'succeeded' };
}
