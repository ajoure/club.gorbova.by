/**
 * Centralized helper: ensureOrderForPayment
 * 
 * INVARIANT: Every succeeded payment MUST have a valid order (deal).
 * 
 * Rules:
 * 1. If payment.order_id IS NULL → create order
 * 2. If payment.order_id → trial order AND payment.amount > trial_amount → create renewal order
 * 3. Idempotency by bepaid_uid / provider_payment_id
 * 4. MUST be called BEFORE granting access
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface EnsureOrderResult {
  action: 'created' | 'relinked' | 'skipped' | 'error';
  orderId: string | null;
  reason?: string;
  wasOrphan?: boolean;
  wasTrialMismatch?: boolean;
}

interface PaymentData {
  id: string;
  order_id: string | null;
  user_id: string | null;
  profile_id: string | null;
  amount: number;
  currency: string;
  status: string;
  provider_payment_id: string | null;
  paid_at: string | null;
  meta: Record<string, any> | null;
  card_brand?: string | null;
  card_last4?: string | null;
}

interface OrderData {
  id: string;
  is_trial: boolean;
  final_price: number;
  product_id: string | null;
  tariff_id: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  offer_id?: string | null;
}

// Trial amount threshold (typically 1 BYN for trial orders)
const TRIAL_AMOUNT_THRESHOLD = 10;

/**
 * Ensures a succeeded payment has a valid order.
 * MUST be called BEFORE grant-access to prevent "access without deal" scenario.
 */
export async function ensureOrderForPayment(
  supabase: SupabaseClient,
  paymentId: string,
  callerLabel: string = 'ensure-order-for-payment'
): Promise<EnsureOrderResult> {
  
  // 1. Load payment with its order (if any)
  const { data: payment, error: paymentErr } = await supabase
    .from('payments_v2')
    .select('id, order_id, user_id, profile_id, amount, currency, status, provider_payment_id, paid_at, meta, card_brand, card_last4')
    .eq('id', paymentId)
    .single();

  if (paymentErr || !payment) {
    console.error(`[${callerLabel}] Payment not found: ${paymentId}`);
    return { action: 'error', orderId: null, reason: 'payment_not_found' };
  }

  // Guard: Only process succeeded payments
  if (payment.status !== 'succeeded') {
    return { action: 'skipped', orderId: payment.order_id, reason: 'payment_not_succeeded' };
  }

  // Guard: Only process positive amounts
  if ((payment.amount || 0) <= 0) {
    return { action: 'skipped', orderId: payment.order_id, reason: 'zero_or_negative_amount' };
  }

  const pMeta = (payment.meta || {}) as Record<string, any>;
  const bepaidUid = payment.provider_payment_id || pMeta.bepaid_uid;

  // Guard: Already has renewal_order_id - skip (idempotency)
  if (pMeta.renewal_order_id) {
    return { action: 'skipped', orderId: pMeta.renewal_order_id, reason: 'already_has_renewal_order_id' };
  }

  // CASE 1: Orphan payment (no order_id at all)
  if (!payment.order_id) {
    console.log(`[${callerLabel}] Orphan payment detected: ${paymentId}`);
    return await createOrderForOrphanPayment(supabase, payment as PaymentData, bepaidUid, callerLabel);
  }

  // Load associated order
  const { data: order, error: orderErr } = await supabase
    .from('orders_v2')
    .select('id, is_trial, final_price, product_id, tariff_id, customer_email, customer_phone, offer_id')
    .eq('id', payment.order_id)
    .single();

  if (orderErr || !order) {
    console.error(`[${callerLabel}] Order not found for payment ${paymentId}`);
    return { action: 'error', orderId: null, reason: 'order_not_found' };
  }

  // CASE 2: Trial order with renewal payment (amount > trial)
  if (order.is_trial && payment.amount > TRIAL_AMOUNT_THRESHOLD) {
    console.log(`[${callerLabel}] Trial mismatch detected: payment ${paymentId} (${payment.amount}) > trial order (${order.final_price})`);
    return await createRenewalOrderFromTrial(supabase, payment as PaymentData, order as OrderData, bepaidUid, callerLabel);
  }

  // CASE 3: Everything OK - order exists and matches payment type
  return { action: 'skipped', orderId: order.id, reason: 'order_already_valid' };
}

/**
 * Creates an order for an orphan payment (payment.order_id IS NULL)
 */
async function createOrderForOrphanPayment(
  supabase: SupabaseClient,
  payment: PaymentData,
  bepaidUid: string | null,
  callerLabel: string
): Promise<EnsureOrderResult> {
  
  // Idempotency check by bepaid_uid
  if (bepaidUid) {
    const { data: existingOrder } = await supabase
      .from('orders_v2')
      .select('id')
      .contains('meta', { bepaid_uid: bepaidUid })
      .maybeSingle();

    if (existingOrder?.id) {
      // Order exists, just need to relink payment
      await relinkPaymentToOrder(supabase, payment, existingOrder.id, null, callerLabel);
      return { action: 'relinked', orderId: existingOrder.id, wasOrphan: true, reason: 'existing_order_found_by_uid' };
    }
  }

  // Get profile_id
  let profileId = payment.profile_id;
  if (!profileId && payment.user_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', payment.user_id)
      .maybeSingle();
    profileId = profile?.id ?? null;
  }

  // Generate order number
  const { data: ordNum } = await supabase.rpc('generate_order_number');
  const orderNumber = ordNum || `ORPH-${Date.now().toString(36).toUpperCase()}`;

  // Create order
  const { data: newOrder, error: createErr } = await supabase
    .from('orders_v2')
    .insert({
      order_number: orderNumber,
      user_id: payment.user_id,
      profile_id: profileId,
      status: 'paid',
      currency: payment.currency || 'BYN',
      base_price: payment.amount,
      final_price: payment.amount,
      paid_amount: payment.amount,
      is_trial: false,
      meta: {
        source: 'orphan_payment_fix',
        payment_id: payment.id,
        bepaid_uid: bepaidUid,
        created_by: callerLabel,
        created_at: new Date().toISOString(),
      },
    })
    .select('id, order_number')
    .single();

  if (createErr || !newOrder) {
    console.error(`[${callerLabel}] Failed to create order for orphan payment:`, createErr);
    await logAudit(supabase, 'payment.ensure_order_failed', payment.user_id, callerLabel, {
      payment_id: payment.id,
      reason: 'create_failed',
      error: createErr?.message,
      was_orphan: true,
    });
    return { action: 'error', orderId: null, reason: 'create_order_failed', wasOrphan: true };
  }

  // Relink payment
  await relinkPaymentToOrder(supabase, payment, newOrder.id, null, callerLabel);

  // Audit log
  await logAudit(supabase, 'payment.order_ensured', payment.user_id, callerLabel, {
    payment_id: payment.id,
    order_id: newOrder.id,
    order_number: newOrder.order_number,
    was_orphan: true,
    bepaid_uid: bepaidUid,
  });

  console.log(`[${callerLabel}] Created order ${newOrder.order_number} for orphan payment ${payment.id}`);
  return { action: 'created', orderId: newOrder.id, wasOrphan: true };
}

/**
 * Creates a renewal order when payment.amount > trial order amount
 */
async function createRenewalOrderFromTrial(
  supabase: SupabaseClient,
  payment: PaymentData,
  trialOrder: OrderData,
  bepaidUid: string | null,
  callerLabel: string
): Promise<EnsureOrderResult> {

  // Idempotency check by bepaid_uid
  if (bepaidUid) {
    const { data: existingOrder } = await supabase
      .from('orders_v2')
      .select('id')
      .eq('user_id', payment.user_id)
      .contains('meta', { bepaid_uid: bepaidUid })
      .maybeSingle();

    if (existingOrder?.id && existingOrder.id !== trialOrder.id) {
      // Renewal order exists, just need to relink payment
      await relinkPaymentToOrder(supabase, payment, existingOrder.id, trialOrder.id, callerLabel);
      return { action: 'relinked', orderId: existingOrder.id, wasTrialMismatch: true, reason: 'existing_renewal_found_by_uid' };
    }
  }

  // Get profile_id
  let profileId = payment.profile_id;
  if (!profileId && payment.user_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', payment.user_id)
      .maybeSingle();
    profileId = profile?.id ?? null;
  }

  // Generate order number
  const { data: ordNum } = await supabase.rpc('generate_order_number');
  const orderNumber = ordNum || `REN-${Date.now().toString(36).toUpperCase()}`;

  // Create renewal order
  const { data: newOrder, error: createErr } = await supabase
    .from('orders_v2')
    .insert({
      order_number: orderNumber,
      user_id: payment.user_id,
      profile_id: profileId,
      status: 'paid',
      currency: payment.currency || 'BYN',
      base_price: payment.amount,
      final_price: payment.amount,
      paid_amount: payment.amount,
      is_trial: false,
      product_id: trialOrder.product_id,
      tariff_id: trialOrder.tariff_id,
      customer_email: trialOrder.customer_email,
      customer_phone: trialOrder.customer_phone,
      offer_id: trialOrder.offer_id || null,
      meta: {
        source: 'subscription-renewal',
        trial_order_id: trialOrder.id,
        payment_id: payment.id,
        bepaid_uid: bepaidUid,
        created_by: callerLabel,
        created_at: new Date().toISOString(),
      },
    })
    .select('id, order_number')
    .single();

  if (createErr || !newOrder) {
    console.error(`[${callerLabel}] Failed to create renewal order:`, createErr);
    await logAudit(supabase, 'payment.ensure_order_failed', payment.user_id, callerLabel, {
      payment_id: payment.id,
      trial_order_id: trialOrder.id,
      reason: 'create_renewal_failed',
      error: createErr?.message,
      was_trial_mismatch: true,
    });
    return { action: 'error', orderId: null, reason: 'create_renewal_failed', wasTrialMismatch: true };
  }

  // Relink payment to renewal order
  await relinkPaymentToOrder(supabase, payment, newOrder.id, trialOrder.id, callerLabel);

  // Audit log
  await logAudit(supabase, 'payment.order_ensured', payment.user_id, callerLabel, {
    payment_id: payment.id,
    order_id: newOrder.id,
    order_number: newOrder.order_number,
    original_trial_order_id: trialOrder.id,
    was_trial_mismatch: true,
    bepaid_uid: bepaidUid,
  });

  console.log(`[${callerLabel}] Created renewal order ${newOrder.order_number} for trial-mismatch payment ${payment.id}`);
  return { action: 'created', orderId: newOrder.id, wasTrialMismatch: true };
}

/**
 * Relinks payment to a new order, preserving original order reference
 */
async function relinkPaymentToOrder(
  supabase: SupabaseClient,
  payment: PaymentData,
  newOrderId: string,
  originalOrderId: string | null,
  callerLabel: string
): Promise<void> {
  const existingMeta = (payment.meta || {}) as Record<string, any>;
  
  const { error } = await supabase
    .from('payments_v2')
    .update({
      order_id: newOrderId,
      meta: {
        ...existingMeta,
        renewal_order_id: newOrderId,
        original_trial_order_id: originalOrderId || existingMeta.original_trial_order_id || payment.order_id,
        relinked_at: new Date().toISOString(),
        relinked_by: callerLabel,
      },
    })
    .eq('id', payment.id);

  if (error) {
    console.error(`[${callerLabel}] Failed to relink payment ${payment.id}:`, error);
  }
}

/**
 * Logs audit entry with SYSTEM ACTOR pattern
 */
async function logAudit(
  supabase: SupabaseClient,
  action: string,
  targetUserId: string | null,
  actorLabel: string,
  meta: Record<string, any>
): Promise<void> {
  await supabase.from('audit_logs').insert({
    action,
    actor_type: 'system',
    actor_user_id: null,
    actor_label: actorLabel,
    target_user_id: targetUserId,
    meta,
  });
}
