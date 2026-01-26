/**
 * Centralized helper: ensureOrderForPayment
 * 
 * INVARIANT: Every succeeded payment MUST have a valid order (deal).
 * 
 * Rules:
 * 1. If payment.order_id IS NULL → create order (orphan fix)
 * 2. If payment.order_id → trial order AND payment.amount > order.final_price + epsilon → create renewal order
 * 3. Idempotency by bepaid_uid / provider_payment_id
 * 4. MUST be called BEFORE granting access
 * 
 * PATCH 3: Dynamic threshold (order.final_price + epsilon instead of hardcoded 10)
 * PATCH 4: Separate meta for orphan vs renewal
 * PATCH 5: Product/tariff recovery without hardcoded UUIDs
 * PATCH 7: Card-based user recovery + collision guards
 * PATCH 8: ALWAYS create order (paid or needs_mapping) + ALWAYS link payment
 */

// Use 'any' for SupabaseClient to avoid version conflicts between esm.sh and npm imports
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface EnsureOrderResult {
  action: 'created' | 'relinked' | 'skipped' | 'error';
  orderId: string | null;
  reason?: string;
  wasOrphan?: boolean;
  wasTrialMismatch?: boolean;
  orderStatus?: string; // NEW: 'paid' or 'needs_mapping'
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

// PATCH 3: Epsilon for float comparison instead of hardcoded threshold
const EPSILON = 0.01;

// PATCH 7: Card brand normalization (mirrors frontend card-utils.ts)
const BRAND_ALIASES: Record<string, string> = {
  'master': 'mastercard',
  'mc': 'mastercard',
  'mastercard': 'mastercard',
  'visa': 'visa',
  'belkart': 'belkart',
  'maestro': 'maestro',
  'mir': 'mir',
};

function normalizeBrand(brand: string | null | undefined): string {
  if (!brand) return '';
  const lower = brand.toLowerCase().trim();
  return BRAND_ALIASES[lower] || lower;
}

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

  // Guard: Already has ensured_order_id or renewal_order_id - skip (idempotency)
  if (pMeta.ensured_order_id || pMeta.renewal_order_id) {
    const existingOrderId = pMeta.ensured_order_id || pMeta.renewal_order_id;
    return { action: 'skipped', orderId: existingOrderId, reason: 'already_has_ensured_or_renewal_order_id' };
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

  // CASE 2: Trial order with renewal payment (amount > order.final_price + epsilon)
  // PATCH 3: Dynamic threshold based on order.final_price
  if (order.is_trial && payment.amount > (order.final_price || 0) + EPSILON) {
    console.log(`[${callerLabel}] Trial mismatch detected: payment ${paymentId} (${payment.amount}) > trial order (${order.final_price})`);
    return await createRenewalOrderFromTrial(supabase, payment as PaymentData, order as OrderData, bepaidUid, callerLabel);
  }

  // CASE 3: Everything OK - order exists and matches payment type
  return { action: 'skipped', orderId: order.id, reason: 'order_already_valid' };
}

/**
 * PATCH 7: Recover product_id/tariff_id/offer_id for orphan payments
 * Priority:
 * 0. Card-based user recovery (if userId is NULL but card data exists)
 * 1. User's subscriptions (latest)
 * 2. User's last paid order
 * 3. requires_manual_mapping = true
 * 
 * NO hardcoded UUIDs - mapping only through DB lookups
 */
async function recoverProductTariffForOrphan(
  supabase: SupabaseClient,
  userId: string | null,
  _amount: number,
  _currency: string,
  cardLast4: string | null,
  cardBrand: string | null
): Promise<{
  productId: string | null;
  tariffId: string | null;
  offerId: string | null;
  source: string | null;
  requiresMapping: boolean;
  mappingReason: string | null;
  recoveredUserId: string | null;
  cardCollision: boolean;
}> {
  let productId: string | null = null;
  let tariffId: string | null = null;
  let offerId: string | null = null;
  let source: string | null = null;
  let recoveredUserId = userId;
  let cardCollision = false;

  // ============= PRIORITY 0: Card-based user recovery (STRICT GUARDED) =============
  if (!recoveredUserId && cardLast4 && cardBrand) {
    const normalizedBrand = normalizeBrand(cardBrand);
    
    // JOIN: card_profile_links.profile_id → profiles.id → profiles.user_id
    const { data: cardLinks, error: cardErr } = await supabase
      .from('card_profile_links')
      .select('profile_id, profiles!inner(id, user_id)')
      .eq('card_last4', cardLast4)
      .eq('card_brand', normalizedBrand);
    
    if (!cardErr && Array.isArray(cardLinks)) {
      if (cardLinks.length === 1) {
        // 1 match → recover user_id, continue standard recovery
        recoveredUserId = cardLinks[0].profiles?.user_id || null;
        source = 'card_profile_link';
      } else if (cardLinks.length >= 2) {
        // 2+ matches → COLLISION, do NOT pick one
        cardCollision = true;
      }
      // 0 matches → keep recoveredUserId null
    }
  }

  // Priority 1: User's latest subscription
  if (recoveredUserId) {
    const { data: userSub } = await supabase
      .from('subscriptions_v2')
      .select('product_id, tariff_id, offer_id')
      .eq('user_id', recoveredUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (userSub?.product_id) {
      productId = userSub.product_id;
      tariffId = userSub.tariff_id;
      offerId = userSub.offer_id;
      source = source || 'user_subscription';
    }
  }

  // Priority 2: User's last paid order
  if (!productId && recoveredUserId) {
    const { data: lastOrder } = await supabase
      .from('orders_v2')
      .select('product_id, tariff_id, offer_id')
      .eq('user_id', recoveredUserId)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (lastOrder?.product_id) {
      productId = lastOrder.product_id;
      tariffId = lastOrder.tariff_id;
      offerId = lastOrder.offer_id;
      source = source || 'last_paid_order';
    }
  }

  // Determine mapping requirement
  const requiresMapping = !productId || cardCollision;
  
  let mappingReason: string | null = null;
  if (cardCollision) {
    mappingReason = 'card_collision';
  } else if (!productId) {
    mappingReason = recoveredUserId ? 'no_subscription_or_order_found' : 'no_user_id';
  }

  return { 
    productId, 
    tariffId, 
    offerId, 
    source, 
    requiresMapping, 
    mappingReason, 
    recoveredUserId, 
    cardCollision 
  };
}

/**
 * Creates an order for an orphan payment (payment.order_id IS NULL)
 * PATCH 4: Uses ensured_order_id and ensure_reason='orphan' in meta
 * PATCH 7: Card-based recovery + collision guards
 * PATCH 8: ALWAYS create order (paid or needs_mapping) + ALWAYS link payment to order
 * This guarantees DoD-1: orphan_succeeded = 0
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
      .select('id, status')
      .contains('meta', { bepaid_uid: bepaidUid })
      .maybeSingle();

    if (existingOrder?.id) {
      // Order exists, just need to relink payment
      await relinkPaymentToOrder(supabase, payment, existingOrder.id, null, callerLabel, 'orphan');
      return { 
        action: 'relinked', 
        orderId: existingOrder.id, 
        wasOrphan: true, 
        reason: 'existing_order_found_by_uid',
        orderStatus: existingOrder.status 
      };
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

  // PATCH 7: Recover product/tariff/offer with card-based user recovery
  const recovery = await recoverProductTariffForOrphan(
    supabase,
    payment.user_id,
    payment.amount,
    payment.currency || 'BYN',
    payment.card_last4 ?? null,
    payment.card_brand ?? null
  );

  // PATCH 7: Log card collision as audit event
  if (recovery.cardCollision) {
    await logAudit(supabase, 'payment.card_link_collision', null, callerLabel, {
      payment_id: payment.id,
      card_last4: payment.card_last4,
      card_brand: payment.card_brand,
      bepaid_uid: bepaidUid,
      reason: 'multiple_profiles_for_card',
    });
  }

  // PATCH 8: Determine order status - paid if product recovered, needs_mapping otherwise
  const orderStatus = recovery.requiresMapping || !recovery.productId 
    ? 'needs_mapping' 
    : 'paid';

  // Generate order number
  const { data: ordNum } = await supabase.rpc('generate_order_number');
  const orderNumber = ordNum || `ORPH-${Date.now().toString(36).toUpperCase()}`;

  // PATCH 8: ALWAYS create order (even for needs_mapping)
  // product_id may be NULL for needs_mapping orders
  const { data: newOrder, error: createErr } = await supabase
    .from('orders_v2')
    .insert({
      order_number: orderNumber,
      user_id: recovery.recoveredUserId || payment.user_id,
      profile_id: profileId,
      status: orderStatus,
      currency: payment.currency || 'BYN',
      base_price: payment.amount,
      final_price: payment.amount,
      paid_amount: payment.amount,
      is_trial: false,
      product_id: recovery.productId, // May be NULL for needs_mapping
      tariff_id: recovery.tariffId,
      offer_id: recovery.offerId,
      meta: {
        source: 'orphan_payment_fix',
        payment_id: payment.id,
        bepaid_uid: bepaidUid,
        created_by: callerLabel,
        created_at: new Date().toISOString(),
        product_source: recovery.source,
        requires_manual_mapping: recovery.requiresMapping,
        mapping_reason: recovery.mappingReason,
        card_collision: recovery.cardCollision || false,
      },
    })
    .select('id, order_number, status')
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

  // PATCH 8: ALWAYS link payment to order (closes DoD-1 invariant)
  await relinkPaymentToOrder(supabase, payment, newOrder.id, null, callerLabel, 'orphan');

  // Audit log
  await logAudit(supabase, 'payment.order_ensured', recovery.recoveredUserId || payment.user_id, callerLabel, {
    payment_id: payment.id,
    order_id: newOrder.id,
    order_number: newOrder.order_number,
    order_status: orderStatus,
    was_orphan: true,
    bepaid_uid: bepaidUid,
    product_recovered: !!recovery.productId,
    product_source: recovery.source,
    requires_mapping: recovery.requiresMapping,
    mapping_reason: recovery.mappingReason,
    card_collision: recovery.cardCollision,
  });

  console.log(`[${callerLabel}] Created ${orderStatus} order ${newOrder.order_number} for orphan payment ${payment.id} (product: ${recovery.productId || 'NULL'}, source: ${recovery.source || 'none'})`);
  
  return { 
    action: 'created', 
    orderId: newOrder.id, 
    wasOrphan: true,
    orderStatus 
  };
}

/**
 * Creates a renewal order when payment.amount > trial order amount
 * PATCH 4: Uses renewal_order_id and original_trial_order_id in meta
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
      .select('id, status')
      .eq('user_id', payment.user_id)
      .contains('meta', { bepaid_uid: bepaidUid })
      .maybeSingle();

    if (existingOrder?.id && existingOrder.id !== trialOrder.id) {
      // Renewal order exists, just need to relink payment
      await relinkPaymentToOrder(supabase, payment, existingOrder.id, trialOrder.id, callerLabel, 'renewal');
      return { 
        action: 'relinked', 
        orderId: existingOrder.id, 
        wasTrialMismatch: true, 
        reason: 'existing_renewal_found_by_uid',
        orderStatus: existingOrder.status 
      };
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

  // Create renewal order - inherits product/tariff from trial order
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
    .select('id, order_number, status')
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

  // PATCH 4: Relink with renewal-specific meta
  await relinkPaymentToOrder(supabase, payment, newOrder.id, trialOrder.id, callerLabel, 'renewal');

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
  return { action: 'created', orderId: newOrder.id, wasTrialMismatch: true, orderStatus: 'paid' };
}

/**
 * Relinks payment to a new order, preserving original order reference
 * PATCH 4: Different meta structure for orphan vs renewal
 */
async function relinkPaymentToOrder(
  supabase: SupabaseClient,
  payment: PaymentData,
  newOrderId: string,
  originalOrderId: string | null,
  callerLabel: string,
  linkType: 'orphan' | 'renewal'
): Promise<void> {
  const existingMeta = (payment.meta || {}) as Record<string, any>;
  
  // PATCH 4: Separate meta for orphan vs renewal
  let newMeta: Record<string, any>;
  
  if (linkType === 'orphan') {
    newMeta = {
      ...existingMeta,
      ensured_order_id: newOrderId,
      ensure_reason: 'orphan',
      original_order_id: payment.order_id || null,
      relinked_at: new Date().toISOString(),
      relinked_by: callerLabel,
    };
  } else {
    // renewal
    newMeta = {
      ...existingMeta,
      renewal_order_id: newOrderId,
      original_trial_order_id: originalOrderId || payment.order_id,
      relinked_at: new Date().toISOString(),
      relinked_by: callerLabel,
    };
  }
  
  const { error } = await supabase
    .from('payments_v2')
    .update({
      order_id: newOrderId,
      meta: newMeta,
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
