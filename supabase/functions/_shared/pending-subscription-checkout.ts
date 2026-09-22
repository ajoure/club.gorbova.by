import { BLOCKING_PROVIDER_STATES } from './subscription-conflict.ts';
import { pendingPurchaseContext } from './pending-purchase.ts';
import { getBepaidCredsStrict, isBepaidCredsError, createBepaidAuthHeader } from './bepaid-credentials.ts';
import { readAcquiringSecret } from './acquiring/vault.ts';
import { stripeGetCheckoutSession } from './acquiring/stripe-client.ts';

type Row=Record<string,any>;
const stable=(value:any):string=>value && typeof value==='object' ? Array.isArray(value)
  ? '['+value.map(stable).join(',')+']' : '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}' : JSON.stringify(value);
export function samePendingSubscriptionPurchase(existing:Row, proposed:Row):boolean {
  const existingContext=pendingPurchaseContext(existing,'subscription');
  const proposedContext=pendingPurchaseContext(proposed,'subscription');
  // Renewal checkout writers historically did not persist offer_id. A later
  // public link for the same recipient/product/tariff/price must reuse that
  // provider checkout instead of treating it as an unrelated mandate. Keep
  // offer_id contractual for every other flow.
  if(existing.offer_id==null && proposed.offer_id!=null && existing.meta?.payment_flow==='renewal_subscription') {
    existingContext.offer_id=null;
    proposedContext.offer_id=null;
  }
  return !existing.is_deleted && ['pending','failed'].includes(existing.status) && Number(existing.paid_amount||0)===0
    && ['user_id','product_id','tariff_id'].every(k=>existing[k]===proposed[k])
    && Number(existing.final_price)===Number(proposed.final_price)
    && String(existing.currency).toUpperCase()===String(proposed.currency).toUpperCase()
    && stable(existingContext)===stable(proposedContext);
}

/** Reuse legacy and expired local caches only after a provider GET. Never
 * cancel a mandate or issue a second subscription based on its local age. */
export async function reusePendingSubscriptionCheckout(db:any,proposed:Row,provider:'bepaid'|'stripe',accountCode='') {
  // Read the whole product, including locally superseded rows. A local status
  // cannot prove that the provider stopped a recurring mandate.
  const {data:subs,error:subError}=await db.from('subscriptions_v2').select('id,order_id,status,meta,tariff_id')
    .eq('user_id',proposed.user_id).eq('product_id',proposed.product_id);
  if(subError) throw new Error('pending_subscription_read_failed');
  const providers:Row[]=[];
  if(subs?.length) {
    const {data,error}=await db.from('provider_subscriptions').select('id,provider,subscription_v2_id,provider_subscription_id,order_id,state,meta')
      .in('subscription_v2_id',subs.map((s:Row)=>s.id)).in('state',BLOCKING_PROVIDER_STATES);
    if(error) throw new Error('pending_provider_read_failed');
    providers.push(...(data || []));
  }
  // Orphan provider rows may still point to a real unfinished purchase.
  const {data:orphans,error:orphanError}=await db.from('provider_subscriptions')
    .select('id,order_id,meta').eq('user_id',proposed.user_id).is('subscription_v2_id',null)
    .in('state',BLOCKING_PROVIDER_STATES);
  if(orphanError) throw new Error('pending_provider_read_failed');
  for(const orphan of orphans || []) {
    const orderId=orphan.order_id || orphan.meta?.order_id;
    // Historical provider rows can outlive both their local subscription and
    // order (for example after an administrator cancels the old mandate). Such
    // rows cannot represent an unfinished purchase and must not permanently
    // block a fresh checkout. Reconcile only against a real, unpaid,
    // non-deleted pending order for the same product.
    if(!orderId) continue;
    const {data:linked,error}=await db.from('orders_v2')
      .select('product_id,status,paid_amount,is_deleted').eq('id',orderId).maybeSingle();
    if(error) throw new Error('pending_purchase_read_failed');
    if(linked && linked.product_id===proposed.product_id && !linked.is_deleted
      && ['pending','failed'].includes(String(linked.status)) && Number(linked.paid_amount || 0)===0)
      throw new Error('orphan_provider_subscription_requires_reconciliation');
  }
  const matches:Row[]=[];
  for(const p of providers) {
    if(p.provider!==provider || !['pending','redirecting'].includes(p.state)) continue;
    if(provider==='stripe' && p.meta?.stripe?.account_code!==accountCode) continue;
    const sub=subs.find((s:Row)=>s.id===p.subscription_v2_id);
    if(!sub || !['pending','past_due'].includes(sub.status) || sub.tariff_id!==proposed.tariff_id) continue;
    const orderId=p.order_id || sub?.order_id || p.meta?.order_id;
    if(!orderId) continue;
    const {data:order,error}=await db.from('orders_v2').select('*').eq('id',orderId).maybeSingle();
    if(error) throw new Error('pending_purchase_read_failed');
    if(order && samePendingSubscriptionPurchase(order,proposed)) matches.push({p,sub,order});
  }
  if(matches.length>1) throw new Error('multiple_pending_provider_checkouts_require_reconciliation');
  if(!matches.length) {
    // A live subscription (active/trial) is not an unreconciled checkout: the
    // caller's same-product classification returns a user-facing conflict with
    // the replacement flow. Only ambiguous provider rows without a live local
    // subscription still require manual reconciliation.
    const unreconciled=providers.filter(p=>{
      const sub=subs?.find((s:Row)=>s.id===p.subscription_v2_id);
      // A canceled/expired/superseded local subscription is no longer a live
      // purchase. Historical provider rows attached to it must not block a
      // fresh checkout forever. Active/trial rows are handled by the caller's
      // same-product conflict; only genuinely unfinished local subscriptions
      // still require reconciliation here.
      return !sub || !['active','trial','canceled','expired','superseded'].includes(String(sub.status));
    });
    if(unreconciled.length) throw new Error('existing_provider_subscription_requires_reconciliation');
    return null;
  }
  const {p,sub,order}=matches[0];
  if(providers.some(other=>other.id!==p.id)) throw new Error('multiple_live_provider_subscriptions_require_reconciliation');
  const {data:money,error:moneyError}=await db.from('payments_v2').select('id').eq('order_id',order.id)
    .in('status',['succeeded','refunded','partially_refunded']).gt('amount',0).eq('is_deleted',false).limit(1);
  if(moneyError || money?.length) throw new Error('pending_purchase_payment_requires_reconciliation');
  let url:string|null=null;let terminal:string|null=null;let sessionId:string|null=null;
  if(provider==='stripe') {
    sessionId=p.meta?.stripe?.checkout_session_id || sub.meta?.stripe?.checkout_session_id;
    if(!sessionId) throw new Error('pending_checkout_session_unknown');
    const secret=await readAcquiringSecret('stripe',accountCode,'secret_key');
    const result=await stripeGetCheckoutSession(secret,sessionId!);
    if(!result.ok || !result.data || result.data.id!==sessionId) throw new Error('pending_checkout_provider_unavailable');
    const session=result.data;
    if(session.status==='expired') terminal='expired';
    else if(session.status==='open' && Number(session.expires_at)*1000>Date.now() && session.payment_status!=='paid') url=String(session.url || '');
    else throw new Error('pending_checkout_payment_requires_reconciliation');
  } else {
    if(!/^sbs_[A-Za-z0-9_-]+$/.test(p.provider_subscription_id)) throw new Error('pending_provider_id_unknown');
    const creds=await getBepaidCredsStrict(db);if(isBepaidCredsError(creds)) throw new Error('pending_checkout_credentials_unavailable');
    const result=await fetch(`https://api.bepaid.by/subscriptions/${encodeURIComponent(p.provider_subscription_id)}`,{
      headers:{Authorization:createBepaidAuthHeader(creds),Accept:'application/json'},signal:AbortSignal.timeout(15000),
    });
    if(!result.ok) throw new Error('pending_checkout_provider_unavailable');
    const body=await result.json();const remote=body.subscription || body;
    if((remote.id && remote.id!==p.provider_subscription_id) || (remote.subscription_id && remote.subscription_id!==p.provider_subscription_id)) throw new Error('pending_provider_identity_mismatch');
    const state=remote.state || remote.status;
    if(['expired','canceled','cancelled'].includes(state)) terminal=state==='expired'?'expired':'canceled';
    else if(['pending','redirecting'].includes(state) && remote.last_transaction?.status!=='successful') url=remote.checkout_url || remote.redirect_url || p.meta?.checkout_url || null;
    else throw new Error('pending_checkout_payment_requires_reconciliation');
  }
  if(terminal) {
    const {error}=await db.rpc('crm_sync_expired_pending_checkout',{
      p_provider_row_id:p.id,p_provider_subscription_id:p.provider_subscription_id,p_terminal_state:terminal,
    });
    if(error) throw new Error('pending_checkout_terminal_sync_failed');
    return null;
  }
  if(!url || !/^https:\/\//.test(url)) throw new Error('pending_checkout_url_missing');
  const {error:auditError}=await db.from('audit_logs').insert({actor_type:'system',action:'payment_checkout.provider_confirmed_reused',
    entity_type:'orders_v2',entity_id:order.id,meta:{order_id:order.id,provider,provider_subscription_row_id:p.id}});
  if(auditError) throw new Error('pending_checkout_reuse_audit_failed');
  return {success:true,redirect_url:url,order_id:order.id,order_number:order.order_number,payment_type:'subscription',provider,
    subscription_v2_id:sub.id,provider_subscription_row_id:p.id,account_code:accountCode,
    ...(sessionId ? {checkout_session_id:sessionId} : {subscription_id:p.provider_subscription_id,bepaid_subscription_id:p.provider_subscription_id})};
}
