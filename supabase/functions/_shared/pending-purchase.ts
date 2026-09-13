/** Database-serialized reuse of a CRM purchase. The provider owns attempts,
 * never purchase identity. Only trusted checkout writers can call these RPCs. */
type Row = Record<string, any>;

export function pendingPurchaseContext(order: Row, kind: string): Row {
  const meta = order.meta || {};
  const quote = meta.composable_checkout;
  const composition = Array.isArray(quote?.items) ? quote.items.filter((item: Row) => !(
    quote.items.length === 1 && item.role === 'primary' && item.product_id === order.product_id
    && item.tariff_id === order.tariff_id && (item.offer_id ?? null) === (order.offer_id ?? null)
    && (item.quantity ?? 1) === 1
    && (item.final_amount ?? item.final_price ?? item.amount) === order.final_price
  )).map((item: Row) => ({
    product_id: item.product_id ?? null, tariff_id: item.tariff_id ?? null, offer_id: item.offer_id ?? null,
    role: item.role ?? null, quantity: item.quantity ?? 1,
    amount: item.final_amount ?? item.final_price ?? item.amount ?? null,
  })).sort((a: Row, b: Row) => {
    const key = (i: Row) => JSON.stringify([i.product_id, i.tariff_id, i.offer_id, i.role, i.quantity, i.amount]);
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  }) : [];
  const installment = meta.installment || {};
  return {
    kind,
    // Offer terms and explicit service periods are contractual; timestamps of
    // checkout issuance, actor/manager and payment link IDs are not.
    offer_id: order.offer_id ?? null,
    payer_type: order.payer_type === 'individual' ? null : order.payer_type ?? null,
    company_id: order.company_id ?? null,
    legal_details_id: meta.legal_details_id ?? null,
    month: meta.deal_month ?? null,
    access_days: order.purchase_snapshot?.access_days ?? null,
    is_trial: order.is_trial ?? order.purchase_snapshot?.is_trial ?? false,
    cohort_id: meta.cohort_id ?? order.purchase_snapshot?.cohort_id ?? null,
    composition,
    replacement_of_subscription_v2_id: meta.replacement_of_subscription_v2_id ?? null,
    billing_cycles: installment.billing_cycles ?? meta.installment_count ?? null,
    interval_days: installment.interval_days ?? null,
    customer_credit: meta.referral_customer_credit_applied_minor ?? 0,
    partner_bonus: meta.referral_partner_bonus_applied_minor ?? 0,
  };
}

export async function claimPendingPurchase(db: any, proposed: Row, kind: string, provider: string, accountCode = '', attemptKind: 'checkout' | 'charge' = 'checkout') {
  const { data, error } = await db.rpc('crm_claim_pending_purchase', {
    p_order: proposed, p_context: pendingPurchaseContext(proposed, kind),
    p_provider: provider, p_account_code: accountCode, p_attempt_kind: attemptKind,
  });
  if (error || !data?.order?.id || !data?.attempt_id) throw new Error('checkout_purchase_claim_failed');
  if (data.state === 'in_progress') throw new Error('checkout_purchase_in_progress');
  return { order: data.order as Row, attemptId: data.attempt_id as string,
    reusedResult: data.state === 'ready' ? data.result as Row : null };
}

export async function finishCheckoutAttempt(db: any, attemptId: string, state: 'ready' | 'failed' | 'unknown', result: Row) {
  const { data, error } = await db.rpc('crm_finish_checkout_attempt', {
    p_attempt_id: attemptId, p_state: state, p_result: result,
  });
  if (error || data !== true) throw new Error('checkout_attempt_persist_failed');
}

export async function lookupPendingCheckout(db: any, proposed: Row, kind: string, provider: string, accountCode = '') {
  const { data, error } = await db.rpc('crm_lookup_pending_checkout', {
    p_order: proposed, p_context: pendingPurchaseContext(proposed, kind),
    p_provider: provider, p_account_code: accountCode,
  });
  if (error) throw new Error('checkout_purchase_lookup_failed');
  if (data && data.state !== 'ready') throw new Error('checkout_purchase_in_progress');
  return data?.result ?? null;
}

/** A missing HTTP response is an unknown provider outcome, never a new purchase. */
export async function requestCheckoutProvider<T>(db:any,attemptId:string,request:()=>Promise<T>):Promise<T> {
  try { return await request(); }
  catch(error) {
    await finishCheckoutAttempt(db,attemptId,'unknown',{success:false,error:'checkout_outcome_unknown'});
    throw error;
  }
}
