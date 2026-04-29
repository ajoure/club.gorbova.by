/**
 * Shared helper: create bePaid payment checkout (one_time or subscription)
 * 
 * Extracted from admin-create-payment-link for reuse in cron jobs (e.g. subscription-renewal-reminders).
 * This module does NOT do auth/permission checks — the caller is responsible.
 * 
 * STOP-GUARD: If product_id, tariff_id, or amount are missing/invalid — returns error, never creates orphan orders.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from './bepaid-credentials.ts';
import { buildPurchaseSnapshot } from './build-purchase-snapshot.ts';
import { resolveOfferRoutingWithFallback, buildNegativeSnapshot, auditNegativeSnapshot } from './crm-routing.ts';
import {
  checkSubscriptionConflict,
  validateReplacementSubscription,
  type SubscriptionConflict as SharedSubscriptionConflict,
} from './subscription-conflict.ts';

export interface CreateCheckoutParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  user_id: string;
  product_id: string;
  tariff_id: string;
  amount: number; // kopecks
  payment_type: 'one_time' | 'subscription';
  description?: string;
  offer_id?: string;
  origin?: string;
  actor_user_id?: string;
  actor_type?: 'admin' | 'system';
  /** ID подписки, которую заменяем. Сервер проверит, что она реально отменена, прежде чем создать новую. */
  replacement_of_subscription_v2_id?: string;
  /**
   * Произвольные ключи, которые будут смёрджены в `orders_v2.meta` при создании.
   * Канонический способ прокинуть `payment_link_id` (и подобные привязки) без дублирования.
   * Анти-кейс: ручной post-insert UPDATE из вызывающей функции.
   */
  meta_extra?: Record<string, any>;
}

export interface CreateCheckoutSuccess {
  success: true;
  redirect_url: string;
  order_id: string;
  order_number?: string;
  payment_type: 'one_time' | 'subscription';
}

export interface SubscriptionConflict {
  subscription_v2_id: string;
  status: string;
  next_charge_at: string | null;
  access_end_at: string | null;
  bepaid_subscription_id: string | null;
  provider_subscription_id: string | null;
  product_id: string;
  tariff_id: string;
  display_next_charge_at: string | null;
  display_access_end_at: string | null;
  timezone_used: string;
}

export interface CreateCheckoutError {
  success: false;
  error: string;
  conflict?: SubscriptionConflict;
}

export type CreateCheckoutResult = CreateCheckoutSuccess | CreateCheckoutError;

export async function createPaymentCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult> {
  const {
    supabase, user_id, product_id, tariff_id, amount,
    payment_type, description, offer_id, origin, actor_user_id, actor_type,
    replacement_of_subscription_v2_id,
    meta_extra,
  } = params;
  const extraMeta = meta_extra && typeof meta_extra === 'object' ? meta_extra : {};

  // === STOP-GUARD: validate required fields ===
  if (!user_id || !product_id || !tariff_id || !amount) {
    console.error('[create-payment-checkout] STOP-GUARD: missing required fields', {
      has_user_id: !!user_id,
      has_product_id: !!product_id,
      has_tariff_id: !!tariff_id,
      has_amount: !!amount,
    });
    return { success: false, error: 'Missing required fields: user_id, product_id, tariff_id, amount' };
  }

  if (amount < 100) {
    return { success: false, error: 'Minimum amount is 100 kopecks (1 BYN)' };
  }

  // === Get bePaid credentials ===
  const credsResult = await getBepaidCredsStrict(supabase);
  if (isBepaidCredsError(credsResult)) {
    console.error('[create-payment-checkout] bePaid credentials error:', credsResult.error);
    return { success: false, error: credsResult.error };
  }
  const bepaidCreds = credsResult;
  const bepaidAuth = createBepaidAuthHeader(bepaidCreds);

  // === Load product, tariff, profile ===
  const [productResult, tariffResult, profileResult] = await Promise.all([
    supabase.from('products_v2').select('id, name, code, public_id').eq('id', product_id).maybeSingle(),
    supabase.from('tariffs').select('id, name, code, access_days, public_id').eq('id', tariff_id).maybeSingle(),
    supabase.from('profiles').select('id, email, full_name').eq('user_id', user_id).maybeSingle(),
  ]);

  if (!productResult.data) {
    return { success: false, error: 'Product not found' };
  }
  if (!tariffResult.data) {
    return { success: false, error: 'Tariff not found' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const product = productResult.data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tariff = tariffResult.data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = profileResult.data as any;
  const profileId = profile?.id || null;
  const customerEmail = profile?.email || 'unknown@example.com';

  const amountByn = amount / 100;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const notificationUrl = `${supabaseUrl}/functions/v1/bepaid-webhook`;
  const effectiveOrigin = origin || 'https://club.gorbova.by';
  const actorUserId = actor_user_id || null;
  const effectiveActorType = actor_type || 'system';
  // audit_logs CHECK constraint allows only 'user' | 'system'; map 'admin' → 'user'
  const auditActorType = effectiveActorType === 'admin' ? 'user' : effectiveActorType;

  // Determine payment_flow based on actor_type and payment_type
  const paymentFlow = payment_type === 'one_time'
    ? (effectiveActorType === 'admin' ? 'admin_one_time' : 'renewal_one_time')
    : (effectiveActorType === 'admin' ? 'admin_subscription' : 'renewal_subscription');

  if (payment_type === 'one_time') {
    // === ONE-TIME PAYMENT ===

    // PATCH F1: Dedup one_time — strict key: user/product/tariff/amount/flow/currency/3d
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingOrder } = await (supabase as any)
      .from('orders_v2')
      .select('id, meta, created_at')
      .eq('user_id', user_id)
      .eq('product_id', product_id)
      .eq('tariff_id', tariff_id)
      .eq('status', 'pending')
      .eq('currency', 'BYN')
      .eq('final_price', amountByn)
      .filter('meta->>payment_flow', 'eq', paymentFlow)
      .is('meta->>checkout_expired', null)
      .gte('created_at', new Date(Date.now() - 3 * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingOrder?.id) {
      const existingMeta = (existingOrder.meta || {}) as Record<string, any>;
      const existingToken = existingMeta.bepaid_checkout_token;
      if (existingToken) {
        // PATCH-PAYLINK-v2: Time-based TTL validation (bePaid HPP API returns 'expired' immediately, so API check is unreliable)
        const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
        const orderCreatedAt = new Date(existingOrder.created_at).getTime();
        const orderAge = Date.now() - orderCreatedAt;
        const tokenAlive = orderAge > 0 && orderAge < TOKEN_TTL_MS;
        const expiredReason = tokenAlive ? null : 'token_ttl_exceeded_15min';

        if (tokenAlive) {
          // Token within TTL — reuse
          const existingUrl = `https://checkout.bepaid.by/v2/checkout?token=${existingToken}`;
          console.log('[create-payment-checkout] Reusing existing pending one_time order (TTL alive, age=' + Math.round(orderAge / 1000) + 's):', existingOrder.id);

          const { error: auditReusedErr } = await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            action: 'payment_checkout.reused',
            actor_label: 'payment_checkout',
            created_at: new Date().toISOString(),
            meta: { reused_order_id: existingOrder.id, payment_type: 'one_time', reuse_reason: 'pending_dedup', token_age_s: Math.round(orderAge / 1000) },
          });
          if (auditReusedErr) console.error('[payment_checkout] audit insert failed', { action: 'payment_checkout.reused', order_id: existingOrder.id, payment_type: 'one_time', error: auditReusedErr });

          return {
            success: true,
            redirect_url: existingUrl,
            order_id: existingOrder.id,
            payment_type: 'one_time',
          };
        }

        // Token TTL exceeded — mark meta (add-only, no status change) and fall through to create new
        console.log('[create-payment-checkout] Token TTL exceeded for one_time order, age=' + Math.round(orderAge / 1000) + 's, will create new:', existingOrder.id);
        const { error: metaExpErr } = await supabase.from('orders_v2').update({
          meta: {
            ...existingMeta,
            checkout_expired: true,
            checkout_expired_at: new Date().toISOString(),
            checkout_expired_reason: expiredReason,
          },
        }).eq('id', existingOrder.id).is('meta->>checkout_expired', null);
        if (metaExpErr) console.error('[payment_checkout] order meta update failed', { order_id: existingOrder.id, reason: expiredReason, error: metaExpErr });

        const { error: auditExpErr } = await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          action: 'payment_checkout.token_expired',
          actor_label: 'payment_checkout',
          created_at: new Date().toISOString(),
          meta: { order_id: existingOrder.id, payment_type: 'one_time', reason: expiredReason },
        });
        if (auditExpErr) console.error('[payment_checkout] audit insert failed', { action: 'payment_checkout.token_expired', order_id: existingOrder.id, payment_type: 'one_time', error: auditExpErr });
        // Fall through — create new order + checkout below
      }
    }

    const { data: orderNumberData } = await supabase.rpc('generate_order_number');
    const orderNumber: string = (orderNumberData as string | null) || `ORD-LINK-${Date.now()}`;

    const orderMeta = {
      type: effectiveActorType === 'admin' ? 'admin_payment_link' : 'system_payment_link',
      description: description || null,
      created_by: actorUserId,
      product_name: product.name,
      tariff_name: tariff.name,
      payment_flow: paymentFlow,
      ...extraMeta,
    };

    const accessDaysOneTime = tariff.access_days || 30;
    const nowOneTime = new Date();
    const plannedEndOneTime = new Date(nowOneTime);
    plannedEndOneTime.setDate(plannedEndOneTime.getDate() + accessDaysOneTime);

    // CRM routing — Layer A (B.0 invariant): always materialize crm_routing_snapshot
    // (positive or structural-negative). Snapshot is written once at INSERT and never
    // overwritten downstream — see B.0 contract.
    const oneTimeRouting = await resolveOfferRoutingWithFallback(supabase, { offer_id, tariff_id });
    const oneTimeCrmSnapshot = oneTimeRouting.ok && oneTimeRouting.snapshot
      ? oneTimeRouting.snapshot
      : buildNegativeSnapshot({
          reason: oneTimeRouting.reason || 'unknown',
          offer_id: offer_id ?? null,
          tariff_id,
          resolved_via: oneTimeRouting.resolved_via ?? 'none',
          candidates_count: oneTimeRouting.candidates_count ?? 0,
        });
    const oneTimeMetaWithRouting = { ...orderMeta, crm_routing_snapshot: oneTimeCrmSnapshot };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order, error: orderError } = await (supabase as any)
      .from('orders_v2')
      .insert({
        order_number: orderNumber,
        user_id,
        profile_id: profileId,
        product_id,
        tariff_id,
        offer_id: offer_id || null,
        base_price: amountByn,
        final_price: amountByn,
        paid_amount: 0,
        currency: 'BYN',
        status: 'pending',
        customer_email: customerEmail,
        deal_date: new Date().toISOString(),
        meta: oneTimeMetaWithRouting,
        pipeline_id: oneTimeRouting.ok && oneTimeRouting.snapshot ? oneTimeRouting.snapshot.pipeline_id : null,
        pipeline_stage_id: oneTimeRouting.ok && oneTimeRouting.snapshot ? oneTimeRouting.snapshot.stage_on_pending : null,
        purchase_snapshot: buildPurchaseSnapshot({
          product_id,
          product_public_id: product.public_id,
          product_name: product.name,
          product_code: product.code,
          tariff_id,
          tariff_public_id: tariff.public_id,
          tariff_name: tariff.name,
          tariff_code: tariff.code,
          offer_id: offer_id || null,
          price: amountByn,
          currency: 'BYN',
          access_days: accessDaysOneTime,
          planned_access_start_at: nowOneTime.toISOString(),
          planned_access_end_at: plannedEndOneTime.toISOString(),
          is_trial: false,
          extra: { payment_flow: paymentFlow },
        }),
      })
      .select('id')
      .single();

    if (orderError) {
      console.error('[create-payment-checkout] Order creation error:', orderError);
      return { success: false, error: 'Failed to create order' };
    }

    // B.0: audit negative snapshot post-INSERT (non-blocking)
    if (!oneTimeRouting.ok) {
      await auditNegativeSnapshot(supabase, {
        order_id: order.id,
        offer_id: offer_id ?? null,
        tariff_id,
        reason: oneTimeRouting.reason || 'unknown',
        resolved_via: oneTimeRouting.resolved_via ?? 'none',
        candidates_count: oneTimeRouting.candidates_count ?? 0,
      });
    }

    const trackingId = `link:order:${order.id}`;
    const returnUrl = `${effectiveOrigin}/purchases?order=${order.id}&status=success`;

    const checkoutPayload = {
      checkout: {
        test: bepaidCreds.test_mode,
        transaction_type: 'payment',
        attempts: 3,
        settings: {
          success_url: returnUrl,
          decline_url: `${effectiveOrigin}/purchases?order=${order.id}&status=decline`,
          fail_url: `${effectiveOrigin}/purchases?order=${order.id}&status=fail`,
          notification_url: notificationUrl,
          language: 'ru',
          customer_fields: { read_only: ['email'] },
          // No save_card_toggle for one-time: avoid creating recurring contracts
        },
        order: {
          amount,
          currency: 'BYN',
          description: description || `${product.name} — ${tariff.name}`,
          tracking_id: trackingId,
          additional_data: {
            receipt: [`${product.name} — ${tariff.name}`],
          },
        },
        customer: {
          email: customerEmail,
          first_name: profile?.full_name?.split(' ')[0] || undefined,
          last_name: profile?.full_name?.split(' ').slice(1).join(' ') || undefined,
        },
      },
    };

    console.log('[create-payment-checkout] Creating one-time checkout:', {
      order_id: order.id,
      amount,
      product: product.name,
    });

    const checkoutResponse = await fetch('https://checkout.bepaid.by/ctp/api/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': bepaidAuth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(checkoutPayload),
    });

    const checkoutResult = await checkoutResponse.json();

    if (!checkoutResponse.ok || !checkoutResult.checkout?.redirect_url) {
      // PATCH PAYMENTS+REMINDERS v3 S3: persist provider decline reason for diagnostics.
      // UI продолжает показывать нормализованную ошибку; здесь — серверный proof.
      const providerErrorPayload = {
        status: checkoutResponse.status,
        message: checkoutResult?.message ?? null,
        code: checkoutResult?.code ?? checkoutResult?.errors?.code ?? null,
        errors: checkoutResult?.errors ?? null,
        request_id: checkoutResponse.headers.get('x-request-id') || checkoutResult?.request_id || null,
        captured_at: new Date().toISOString(),
        flow: 'one_time',
      };
      console.error('[create-payment-checkout] bePaid checkout error:', {
        status: checkoutResponse.status,
        result: checkoutResult,
      });
      const { error: failErr1 } = await supabase
        .from('orders_v2')
        .update({
          status: 'failed',
          meta: { ...oneTimeMetaWithRouting, last_provider_error: providerErrorPayload },
        })
        .eq('id', order.id);
      if (failErr1) console.error('[payment_checkout] order status→failed update failed', { order_id: order.id, payment_type: 'one_time', error: failErr1 });

      await supabase.from('audit_logs').insert({
        action: 'bepaid.checkout.declined',
        actor_type: 'system',
        actor_label: 'create-payment-checkout',
        target_user_id: user_id,
        meta: {
          order_id: order.id,
          payment_type: 'one_time',
          payment_flow: paymentFlow,
          provider_error: providerErrorPayload,
        },
      });

      return {
        success: false,
        error: checkoutResult.message || checkoutResult.errors?.base?.[0] || 'bePaid checkout creation failed',
      };
    }

    const redirectUrl = checkoutResult.checkout.redirect_url;

    // PATCH RENEWAL+PAYMENTS.1 C3 + CRM-ROUTING fix:
    // Meta MERGE (not overwrite) after checkout token. CRITICAL: spread oneTimeMetaWithRouting
    // (which already contains crm_routing_snapshot) — NOT plain orderMeta — otherwise the snapshot
    // written on insert is silently overwritten and immutability proof breaks.
    //
    // STEP A (active_checkout_token guard): пишем active_checkout_token + append в
    // checkout_tokens_history[]. Это база для будущего reuse (шаг B) и для webhook stale-token guard.
    const newCheckoutToken = checkoutResult.checkout.token;
    const tokenHistoryEntry = {
      token: newCheckoutToken,
      issued_at: new Date().toISOString(),
      payment_flow: paymentFlow,
      amount: amountByn,
      reason: 'initial_checkout',
    };
    const { error: metaMergeErr } = await supabase.from('orders_v2').update({
      meta: {
        ...oneTimeMetaWithRouting,
        bepaid_checkout_token: newCheckoutToken,
        active_checkout_token: newCheckoutToken,
        checkout_created_at: new Date().toISOString(),
        checkout_tokens_history: [tokenHistoryEntry],
      },
    }).eq('id', order.id);
    if (metaMergeErr) console.error('[payment_checkout] order meta merge failed', { order_id: order.id, payment_type: 'one_time', error: metaMergeErr });

    // Audit log
    const { error: auditCreatedErr1 } = await supabase.from('audit_logs').insert({
      actor_type: auditActorType,
      actor_user_id: actorUserId,
      target_user_id: user_id,
      action: `${effectiveActorType}.payment_link.created`,
      created_at: new Date().toISOString(),
      meta: {
        payment_type: 'one_time',
        order_id: order.id,
        amount: amountByn,
        product_name: product.name,
        tariff_name: tariff.name,
      },
    });
    if (auditCreatedErr1) console.error('[payment_checkout] audit insert failed', { action: 'payment_link.created', order_id: order.id, payment_type: 'one_time', error: auditCreatedErr1 });

    return {
      success: true,
      redirect_url: redirectUrl,
      order_id: order.id,
      order_number: orderNumber,
      payment_type: 'one_time',
    };

  } else if (payment_type === 'subscription') {
    // === SUBSCRIPTION ===

    // === PATCH PAYMENT-CONFLICT: shared exact-pair guard + replacement validation ===
    if (replacement_of_subscription_v2_id) {
      const repl = await validateReplacementSubscription(supabase, {
        replacement_of_subscription_v2_id,
        user_id,
        product_id,
        tariff_id,
      });
      if (repl.status === 'error') {
        return { success: false, error: repl.error };
      }
      console.log('[create-payment-checkout] replacement verified (shared)', {
        replacement_of_subscription_v2_id, user_id, product_id, tariff_id,
      });
    } else {
      const conflictCheck = await checkSubscriptionConflict(supabase, {
        user_id, product_id, tariff_id,
      });
      if (conflictCheck.status === 'error') {
        return { success: false, error: conflictCheck.error };
      }
      if (conflictCheck.status === 'conflict') {
        console.log('[create-payment-checkout] DUPLICATE GUARD (shared) — same-pair active subscription', {
          existing_sub_id: conflictCheck.conflict.subscription_v2_id,
          status: conflictCheck.conflict.status,
          product_id, tariff_id, user_id,
        });
        return {
          success: false,
          error: 'existing_subscription_conflict',
          conflict: conflictCheck.conflict as SharedSubscriptionConflict,
        };
      }
    }

    // PATCH F3: Dedup subscription — strict key: user/product/tariff/amount/flow/currency/3d
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingSubOrder } = await (supabase as any)
      .from('orders_v2')
      .select('id, meta, created_at')
      .eq('user_id', user_id)
      .eq('product_id', product_id)
      .eq('tariff_id', tariff_id)
      .eq('status', 'pending')
      .eq('currency', 'BYN')
      .eq('final_price', amountByn)
      .filter('meta->>payment_flow', 'eq', paymentFlow)
      .is('meta->>checkout_expired', null)
      .gte('created_at', new Date(Date.now() - 3 * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingSubOrder?.id) {
      // PATCH F3: Strict provider_subscriptions search by order_id + state
      const { data: reusableProvSub } = await supabase
        .from('provider_subscriptions')
        .select('meta')
        .eq('user_id', user_id)
        .eq('state', 'pending')
        .filter('meta->>order_id', 'eq', existingSubOrder.id)
        .limit(1)
        .maybeSingle();

      // STOP-guard: only reuse if checkout_url is present and valid
      const reusableCheckoutUrl = reusableProvSub
        ? (reusableProvSub.meta as Record<string, any>)?.checkout_url
        : null;

      if (reusableCheckoutUrl && typeof reusableCheckoutUrl === 'string' && reusableCheckoutUrl.startsWith('http')) {
        // PATCH-PAYLINK-v2: Time-based TTL validation (bePaid subscription checkout URLs may also expire quickly)
        const SUB_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
        const subCreatedAt = new Date(existingSubOrder.created_at).getTime();
        const subAge = Date.now() - subCreatedAt;
        const checkoutAlive = subAge > 0 && subAge < SUB_TOKEN_TTL_MS;
        const subExpiredReason = checkoutAlive ? null : 'token_ttl_exceeded_24h';

        if (checkoutAlive) {
          // Checkout URL within TTL — reuse
          console.log('[create-payment-checkout] Reusing existing pending subscription order (TTL alive, age=' + Math.round(subAge / 1000) + 's):', existingSubOrder.id);

          const { error: auditSubReusedErr } = await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            action: 'payment_checkout.reused',
            actor_label: 'payment_checkout',
            created_at: new Date().toISOString(),
            meta: { reused_order_id: existingSubOrder.id, payment_type: 'subscription', reuse_reason: 'pending_dedup', token_age_s: Math.round(subAge / 1000) },
          });
          if (auditSubReusedErr) console.error('[payment_checkout] audit insert failed', { action: 'payment_checkout.reused', order_id: existingSubOrder.id, payment_type: 'subscription', error: auditSubReusedErr });

          return {
            success: true,
            redirect_url: reusableCheckoutUrl,
            order_id: existingSubOrder.id,
            payment_type: 'subscription',
          };
        }

        // Checkout URL TTL exceeded — mark meta (add-only) and fall through
        console.log('[create-payment-checkout] Subscription checkout TTL exceeded, age=' + Math.round(subAge / 1000) + 's, will create new:', existingSubOrder.id);
        const existingSubMeta = (existingSubOrder.meta || {}) as Record<string, any>;
        const { error: subMetaExpErr } = await supabase.from('orders_v2').update({
          meta: {
            ...existingSubMeta,
            checkout_expired: true,
            checkout_expired_at: new Date().toISOString(),
            checkout_expired_reason: subExpiredReason,
          },
        }).eq('id', existingSubOrder.id).is('meta->>checkout_expired', null);
        if (subMetaExpErr) console.error('[payment_checkout] order meta update failed', { order_id: existingSubOrder.id, reason: subExpiredReason, error: subMetaExpErr });

        const { error: auditSubExpErr } = await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          action: 'payment_checkout.token_expired',
          actor_label: 'payment_checkout',
          created_at: new Date().toISOString(),
          meta: { order_id: existingSubOrder.id, payment_type: 'subscription', reason: subExpiredReason },
        });
        if (auditSubExpErr) console.error('[payment_checkout] audit insert failed', { action: 'payment_checkout.token_expired', order_id: existingSubOrder.id, payment_type: 'subscription', error: auditSubExpErr });
      } else {
        // No valid checkout_url — fall through to create new order+subscription
        console.log('[create-payment-checkout] Found pending sub order but no valid checkout_url, creating new');
      }
    }

    const orderNumber = `SUB-LINK-${Date.now().toString(36).toUpperCase()}`;

    const subOrderMeta = {
      type: effectiveActorType === 'admin' ? 'admin_payment_link_subscription' : 'system_payment_link_subscription',
      description: description || null,
      created_by: actorUserId,
      payment_flow: paymentFlow,
      ...extraMeta,
    };

    const accessDaysSub = tariff.access_days || 30;
    const nowSub = new Date();
    const plannedEndSub = new Date(nowSub);
    plannedEndSub.setDate(plannedEndSub.getDate() + accessDaysSub);

    // CRM routing — Layer A (B.0 invariant): always materialize crm_routing_snapshot
    const subRouting = await resolveOfferRoutingWithFallback(supabase, { offer_id, tariff_id });
    const subCrmSnapshot = subRouting.ok && subRouting.snapshot
      ? subRouting.snapshot
      : buildNegativeSnapshot({
          reason: subRouting.reason || 'unknown',
          offer_id: offer_id ?? null,
          tariff_id,
          resolved_via: subRouting.resolved_via ?? 'none',
          candidates_count: subRouting.candidates_count ?? 0,
        });
    const subMetaWithRouting = { ...subOrderMeta, crm_routing_snapshot: subCrmSnapshot };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order, error: orderError } = await (supabase as any)
      .from('orders_v2')
      .insert({
        order_number: orderNumber,
        user_id,
        profile_id: profileId,
        product_id,
        tariff_id,
        offer_id: offer_id || null,
        base_price: amountByn,
        final_price: amountByn,
        paid_amount: 0,
        currency: 'BYN',
        status: 'pending',
        customer_email: customerEmail,
        deal_date: new Date().toISOString(),
        meta: subMetaWithRouting,
        pipeline_id: subRouting.ok && subRouting.snapshot ? subRouting.snapshot.pipeline_id : null,
        pipeline_stage_id: subRouting.ok && subRouting.snapshot ? subRouting.snapshot.stage_on_pending : null,
        purchase_snapshot: buildPurchaseSnapshot({
          product_id,
          product_public_id: product.public_id,
          product_name: product.name,
          product_code: product.code,
          tariff_id,
          tariff_public_id: tariff.public_id,
          tariff_name: tariff.name,
          tariff_code: tariff.code,
          offer_id: offer_id || null,
          price: amountByn,
          currency: 'BYN',
          access_days: accessDaysSub,
          planned_access_start_at: nowSub.toISOString(),
          planned_access_end_at: plannedEndSub.toISOString(),
          is_trial: false,
          extra: { payment_flow: paymentFlow },
        }),
      })
      .select('id')
      .single();

    if (orderError) {
      console.error('[create-payment-checkout] Order creation error:', orderError);
      return { success: false, error: 'Failed to create order' };
    }

    // B.0: audit negative snapshot post-INSERT
    if (!subRouting.ok) {
      await auditNegativeSnapshot(supabase, {
        order_id: order.id,
        offer_id: offer_id ?? null,
        tariff_id,
        reason: subRouting.reason || 'unknown',
        resolved_via: subRouting.resolved_via ?? 'none',
        candidates_count: subRouting.candidates_count ?? 0,
      });
    }

    const accessDays = tariff.access_days || 30;
    // PATCH INSTALLMENT-PUBLIC-LINK: распознаём installment-subscription по meta_extra.installment_count.
    // Для обычной подписки — старое поведение (infinite, interval=30).
    const installmentCountRaw = Number(extraMeta.installment_count);
    const isInstallmentSubscription = Number.isFinite(installmentCountRaw) && installmentCountRaw >= 2;
    const billingCycles = isInstallmentSubscription ? installmentCountRaw : null;
    const installmentExtra = (extraMeta.installment && typeof extraMeta.installment === 'object')
      ? extraMeta.installment as Record<string, any>
      : {};
    const intervalDays = isInstallmentSubscription
      ? Number(installmentExtra.interval_days ?? 30)
      : 30;

    // PATCH PAYMENTS-REVISION: pre-create subscriptions_v2 ДО bePaid /subscriptions,
    // чтобы tracking_id содержал реальный subscription_v2_id (canonical формат subv2:{sub_id}:order:{order_id}).
    // billing_type=provider_managed (enum допускает только 'mit'|'provider_managed').
    // ВАЖНО: subscriptions_v2 НЕ имеет колонки access_days/amount/currency —
    // храним их ТОЛЬКО в meta (источник истины: tariffs.access_days + orders_v2.final_price).
    const preSubMeta: Record<string, any> = {
      source: isInstallmentSubscription ? 'public_link_installment' : 'public_link_subscription',
      checkout_order_id: order.id,
      created_at_pre: new Date().toISOString(),
      tariff_access_days: accessDays,
      amount_byn: amountByn,
      currency: 'BYN',
    };
    if (isInstallmentSubscription) {
      preSubMeta.installment_count = installmentCountRaw;
      preSubMeta.billing_cycles = billingCycles;
      preSubMeta.installment_per_payment_amount_byn = Number(extraMeta.installment_per_payment_amount_byn ?? amountByn);
      preSubMeta.installment_total_amount_byn = Number(extraMeta.installment_total_amount_byn ?? (amountByn * (billingCycles || 1)));
      preSubMeta.installment = installmentExtra;
      preSubMeta.model = 'bepaid_finite_subscription';
    }
    const { data: preSub, error: preSubError } = await supabase
      .from('subscriptions_v2')
      .insert({
        user_id,
        profile_id: profileId,
        product_id,
        tariff_id,
        offer_id: offer_id || null,
        order_id: order.id,
        status: 'past_due',
        billing_type: 'provider_managed',
        auto_renew: !isInstallmentSubscription, // installment завершается сам после N платежей
        meta: preSubMeta,
      })
      .select('id')
      .single();
    if (preSubError || !preSub) {
      // PATCH PAYMENTS-REVISION: усиленный audit/meta proof + стабильный error-code.
      const safeErrPayload = {
        code: (preSubError as any)?.code ?? null,
        message: (preSubError as any)?.message ?? String(preSubError),
        captured_at: new Date().toISOString(),
      };
      console.error('[create-payment-checkout] subscriptions_v2 pre-create failed:', safeErrPayload);

      const { error: orderFailErr } = await supabase
        .from('orders_v2')
        .update({
          status: 'failed',
          meta: {
            ...subMetaWithRouting,
            precreate_subscription_error: safeErrPayload,
          },
        })
        .eq('id', order.id);
      if (orderFailErr) console.error('[payment_checkout] order status→failed update failed', { order_id: order.id, payment_type: 'subscription', error: orderFailErr });

      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'create-payment-checkout',
        action: 'payment_checkout.subscription_precreate_failed',
        target_user_id: user_id,
        meta: {
          order_id: order.id,
          payment_type: 'subscription',
          payment_flow: paymentFlow,
          is_installment: isInstallmentSubscription,
          provider_error: safeErrPayload,
        },
      });
      return { success: false, error: 'subscription_precreate_failed' };
    }
    const subscriptionV2Id = preSub.id as string;

    const trackingId = `subv2:${subscriptionV2Id}:order:${order.id}`;
    const successReturnUrl = `${effectiveOrigin}/purchases?bepaid_sub=success&order=${order.id}`;

    const planTitle = `${product.name} — ${tariff.name}`;
    const planDescription = isInstallmentSubscription
      ? `Рассрочка: ${billingCycles} платежа по ${amountByn} BYN каждые ${intervalDays} дней. Подписка завершится после ${billingCycles} платежей.`
      : `Подписка. Автосписание каждый месяц. Можно отменить в любой момент.`;

    const bepaidPayload: Record<string, any> = {
      notification_url: notificationUrl,
      return_url: successReturnUrl,
      tracking_id: trackingId,
      customer: {
        email: customerEmail,
        first_name: profile?.full_name?.split(' ')[0] || undefined,
        last_name: profile?.full_name?.split(' ').slice(1).join(' ') || undefined,
        ip: '127.0.0.1',
      },
      plan: {
        shop_id: Number(bepaidCreds.shop_id),
        currency: 'BYN',
        title: planTitle,
        description: planDescription,
        plan: {
          amount,
          interval: intervalDays,
          interval_unit: 'day',
        },
        ...(isInstallmentSubscription
          ? { infinite: false, billing_cycles: billingCycles, number_payment_attempts: 3 }
          : {}),
      },
      settings: {
        language: 'ru',
      },
    };

    console.log('[create-payment-checkout] Creating bePaid subscription:', {
      order_id: order.id,
      amount,
    });

    const bepaidResponse = await fetch('https://api.bepaid.by/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': bepaidAuth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(bepaidPayload),
    });

    const bepaidResult = await bepaidResponse.json();

    if (!bepaidResponse.ok || bepaidResult.errors) {
      // PATCH PAYMENTS+REMINDERS v3 S3: persist provider decline reason for diagnostics (subscription branch).
      const providerErrorPayloadSub = {
        status: bepaidResponse.status,
        message: bepaidResult?.message ?? null,
        code: bepaidResult?.code ?? bepaidResult?.errors?.code ?? null,
        errors: bepaidResult?.errors ?? null,
        request_id: bepaidResponse.headers.get('x-request-id') || bepaidResult?.request_id || null,
        captured_at: new Date().toISOString(),
        flow: 'subscription',
      };
      console.error('[create-payment-checkout] bePaid subscription error:', {
        status: bepaidResponse.status,
        errors: bepaidResult.errors || bepaidResult.message,
      });
      const { error: failErr2 } = await supabase
        .from('orders_v2')
        .update({
          status: 'failed',
          meta: { ...subMetaWithRouting, last_provider_error: providerErrorPayloadSub },
        })
        .eq('id', order.id);
      if (failErr2) console.error('[payment_checkout] order status→failed update failed', { order_id: order.id, payment_type: 'subscription', error: failErr2 });

      // PATCH INSTALLMENT-PUBLIC-LINK: rollback pre-created subscriptions_v2 чтобы не оставлять past_due-мусор.
      const { error: rollbackErr } = await supabase
        .from('subscriptions_v2')
        .update({
          status: 'canceled',
          auto_renew: false,
          meta: { ...preSubMeta, rollback_reason: 'bepaid_subscription_create_failed', rollback_at: new Date().toISOString(), provider_error: providerErrorPayloadSub },
        })
        .eq('id', subscriptionV2Id);
      if (rollbackErr) console.error('[payment_checkout] subscriptions_v2 rollback failed', { subscription_v2_id: subscriptionV2Id, error: rollbackErr });

      await supabase.from('audit_logs').insert({
        action: 'bepaid.checkout.declined',
        actor_type: 'system',
        actor_label: 'create-payment-checkout',
        target_user_id: user_id,
        meta: {
          order_id: order.id,
          subscription_v2_id: subscriptionV2Id,
          payment_type: 'subscription',
          payment_flow: paymentFlow,
          model: isInstallmentSubscription ? 'bepaid_finite_subscription' : 'bepaid_subscription',
          provider_error: providerErrorPayloadSub,
        },
      });

      return {
        success: false,
        error: bepaidResult.message || bepaidResult.errors?.base?.[0] || 'bePaid subscription creation failed',
      };
    }

    const bepaidSubscription = bepaidResult.subscription || bepaidResult;
    const bepaidSubId = bepaidSubscription.id;
    const redirectUrl = bepaidSubscription.checkout_url || bepaidSubscription.redirect_url;

    if (!bepaidSubId || !redirectUrl) {
      console.error('[create-payment-checkout] No subscription ID or redirect URL in bePaid response');
      const { error: failErr3 } = await supabase.from('orders_v2').update({ status: 'failed' }).eq('id', order.id);
      if (failErr3) console.error('[payment_checkout] order status→failed update failed', { order_id: order.id, payment_type: 'subscription', error: failErr3 });
      // Rollback pre-created subscription
      await supabase
        .from('subscriptions_v2')
        .update({
          status: 'canceled',
          auto_renew: false,
          meta: { ...preSubMeta, rollback_reason: 'bepaid_no_subscription_or_redirect_url', rollback_at: new Date().toISOString() },
        })
        .eq('id', subscriptionV2Id);
      return { success: false, error: 'bePaid did not return a subscription URL' };
    }

    // PATCH F2 + INSTALLMENT-PUBLIC-LINK: Store provider subscription — теперь с subscription_v2_id и installment-полями.
    const { error: provSubError } = await supabase.from('provider_subscriptions').upsert({
      provider: 'bepaid',
      provider_subscription_id: String(bepaidSubId),
      subscription_v2_id: subscriptionV2Id,
      user_id,
      profile_id: profileId,
      state: 'pending',
      amount_cents: amount, // amount is already in kopecks
      currency: 'BYN',
      interval_days: intervalDays,
      meta: {
        tracking_id: trackingId,
        checkout_url: redirectUrl,
        checkout_created_at: new Date().toISOString(),
        created_by_admin: actorUserId,
        order_id: order.id,
        plan_title: planTitle,
        plan_description: planDescription,
        ...(isInstallmentSubscription
          ? {
              installment_count: installmentCountRaw,
              billing_cycles: billingCycles,
              model: 'bepaid_finite_subscription',
            }
          : {}),
      },
    }, { onConflict: 'provider,provider_subscription_id' });

    if (provSubError) {
      console.error('[create-payment-checkout] STOP: provider_subscriptions upsert failed:', provSubError);
      // Don't fail the whole flow — order+bePaid subscription already created
    }

    // STEP A (active_checkout_token guard): для subscription активный «токен» = bepaid_subscription_id.
    // Записываем его в meta + history, чтобы webhook мог сверить актуальность.
    const subTokenHistoryEntry = {
      token: String(bepaidSubId),
      kind: 'bepaid_subscription_id',
      issued_at: new Date().toISOString(),
      payment_flow: paymentFlow,
      amount: amountByn,
      reason: 'initial_subscription',
    };
    const { error: subMetaActiveErr } = await supabase.from('orders_v2').update({
      meta: {
        ...subMetaWithRouting,
        bepaid_subscription_id: String(bepaidSubId),
        active_checkout_token: String(bepaidSubId),
        active_checkout_kind: 'bepaid_subscription_id',
        checkout_created_at: new Date().toISOString(),
        checkout_tokens_history: [subTokenHistoryEntry],
      },
    }).eq('id', order.id);
    if (subMetaActiveErr) console.error('[payment_checkout] subscription order meta merge failed', { order_id: order.id, payment_type: 'subscription', error: subMetaActiveErr });

    // PATCH INSTALLMENT-PUBLIC-LINK: связать pre-created subscriptions_v2 с bepaid_subscription_id.
    const { error: subLinkErr } = await supabase
      .from('subscriptions_v2')
      .update({
        meta: {
          ...preSubMeta,
          bepaid_subscription_id: String(bepaidSubId),
          tracking_id: trackingId,
          checkout_url: redirectUrl,
        },
      })
      .eq('id', subscriptionV2Id);
    if (subLinkErr) console.error('[payment_checkout] subscriptions_v2 link to bepaid failed', { subscription_v2_id: subscriptionV2Id, error: subLinkErr });

    // Audit log
    const { error: auditCreatedErr2 } = await supabase.from('audit_logs').insert({
      actor_type: auditActorType,
      actor_user_id: actorUserId,
      target_user_id: user_id,
      action: `${effectiveActorType}.payment_link.created`,
      created_at: new Date().toISOString(),
      meta: {
        payment_type: 'subscription',
        order_id: order.id,
        bepaid_subscription_id: bepaidSubId,
        amount: amountByn,
        product_name: product.name,
        tariff_name: tariff.name,
      },
    });
    if (auditCreatedErr2) console.error('[payment_checkout] audit insert failed', { action: 'payment_link.created', order_id: order.id, payment_type: 'subscription', error: auditCreatedErr2 });

    // PATCH E: Server-side audit for subscription replacement (stage 2 — after new checkout created)
    if (replacement_of_subscription_v2_id) {
      const { error: replaceAuditErr } = await supabase.from('audit_logs').insert({
        actor_type: auditActorType,
        actor_user_id: actorUserId,
        target_user_id: user_id,
        action: 'subscription.replaced',
        created_at: new Date().toISOString(),
        meta: {
          old_subscription_v2_id: replacement_of_subscription_v2_id,
          new_order_id: order.id,
          new_checkout_or_order_id: order.id,
          product_id,
          tariff_id,
          bepaid_subscription_id: bepaidSubId,
          actor_type: effectiveActorType,
        },
      });
      if (replaceAuditErr) console.error('[payment_checkout] subscription.replaced audit insert failed', { order_id: order.id, replacement_of_subscription_v2_id, error: replaceAuditErr });
    }

    return {
      success: true,
      redirect_url: redirectUrl,
      order_id: order.id,
      payment_type: 'subscription',
    };

  } else {
    return { success: false, error: 'Invalid payment_type. Expected: one_time or subscription' };
  }
}
