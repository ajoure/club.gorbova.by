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

export interface CreateCheckoutParams {
  supabase: ReturnType<typeof createClient>;
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
  } = params;

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

  const product = productResult.data;
  const tariff = tariffResult.data;
  const profile = profileResult.data;
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
    const { data: existingOrder } = await supabase
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
    const orderNumber = orderNumberData || `ORD-LINK-${Date.now()}`;

    const orderMeta = {
      type: effectiveActorType === 'admin' ? 'admin_payment_link' : 'system_payment_link',
      description: description || null,
      created_by: actorUserId,
      product_name: product.name,
      tariff_name: tariff.name,
      payment_flow: paymentFlow,
    };

    const accessDaysOneTime = tariff.access_days || 30;
    const nowOneTime = new Date();
    const plannedEndOneTime = new Date(nowOneTime);
    plannedEndOneTime.setDate(plannedEndOneTime.getDate() + accessDaysOneTime);

    const { data: order, error: orderError } = await supabase
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
        meta: orderMeta,
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
      console.error('[create-payment-checkout] bePaid checkout error:', {
        status: checkoutResponse.status,
        result: checkoutResult,
      });
      const { error: failErr1 } = await supabase.from('orders_v2').update({ status: 'failed' }).eq('id', order.id);
      if (failErr1) console.error('[payment_checkout] order status→failed update failed', { order_id: order.id, payment_type: 'one_time', error: failErr1 });
      return {
        success: false,
        error: checkoutResult.message || checkoutResult.errors?.base?.[0] || 'bePaid checkout creation failed',
      };
    }

    const redirectUrl = checkoutResult.checkout.redirect_url;

    // PATCH RENEWAL+PAYMENTS.1 C3: Meta MERGE (not overwrite) after checkout token
    const { error: metaMergeErr } = await supabase.from('orders_v2').update({
      meta: {
        ...orderMeta,
        bepaid_checkout_token: checkoutResult.checkout.token,
        checkout_created_at: new Date().toISOString(),
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

    // === DUPLICATE ACTIVE SUBSCRIPTION GUARD (bePaid only) ===
    try {
      const { data: existingProvSubs } = await supabase
        .from('provider_subscriptions')
        .select('id, provider_subscription_id, subscription_v2_id, meta')
        .eq('user_id', user_id)
        .eq('provider', 'bepaid')
        .in('state', ['active', 'pending']);

      if (existingProvSubs && existingProvSubs.length > 0) {
        // Collect order_ids and subscription_v2_ids for batched resolution
        const orderIds: string[] = [];
        const subV2Ids: string[] = [];
        for (const ps of existingProvSubs) {
          const metaObj = (ps.meta || {}) as Record<string, any>;
          if (metaObj.order_id) orderIds.push(metaObj.order_id);
          if (ps.subscription_v2_id) subV2Ids.push(ps.subscription_v2_id);
        }

        // Batched queries to resolve product_id
        const orderProductMap: Record<string, string> = {};
        const tariffProductMap: Record<string, string> = {};

        const [ordersResult, subsV2Result] = await Promise.all([
          orderIds.length > 0
            ? supabase.from('orders_v2').select('id, product_id').in('id', orderIds)
            : Promise.resolve({ data: [] }),
          subV2Ids.length > 0
            ? supabase.from('subscriptions_v2').select('id, tariff_id').in('id', subV2Ids)
            : Promise.resolve({ data: [] }),
        ]);

        for (const o of ordersResult.data || []) {
          if (o.product_id) orderProductMap[o.id] = o.product_id;
        }

        // Resolve tariff_ids → product_ids
        const tariffIds = (subsV2Result.data || []).map((s: any) => s.tariff_id).filter(Boolean);
        if (tariffIds.length > 0) {
          const { data: tariffsData } = await supabase
            .from('tariffs')
            .select('id, product_id')
            .in('id', tariffIds);
          for (const t of tariffsData || []) {
            if (t.product_id) tariffProductMap[t.id] = t.product_id;
          }
        }

        // Build sub_v2_id → tariff_id map
        const subV2TariffMap: Record<string, string> = {};
        for (const s of subsV2Result.data || []) {
          if (s.tariff_id) subV2TariffMap[s.id] = s.tariff_id;
        }

        // Check each existing provider subscription for product_id match
        for (const ps of existingProvSubs) {
          const metaObj = (ps.meta || {}) as Record<string, any>;
          let resolvedProductId: string | null = null;

          // Primary: via order_id
          if (metaObj.order_id && orderProductMap[metaObj.order_id]) {
            resolvedProductId = orderProductMap[metaObj.order_id];
          }
          // Fallback: via subscription_v2_id → tariff_id → product_id
          if (!resolvedProductId && ps.subscription_v2_id) {
            const tid = subV2TariffMap[ps.subscription_v2_id];
            if (tid && tariffProductMap[tid]) {
              resolvedProductId = tariffProductMap[tid];
            }
          }

          if (!resolvedProductId) {
            console.warn('[create-payment-checkout] Could not resolve product_id for provider_subscription:', ps.id);
            continue; // fail-open
          }

          if (resolvedProductId === product_id) {
            console.log('[create-payment-checkout] DUPLICATE GUARD: active bePaid subscription found for same product', {
              existing_provider_sub_id: ps.provider_subscription_id,
              product_id,
              user_id,
            });
            return {
              success: false,
              error: 'У клиента уже есть активная подписка bePaid на этот продукт. Сначала отмените текущую.',
            };
          }
        }
      }
    } catch (guardErr) {
      // Fail-open: log warning but don't block checkout
      console.warn('[create-payment-checkout] Duplicate guard error (fail-open):', guardErr);
    }

    // PATCH F3: Dedup subscription — strict key: user/product/tariff/amount/flow/currency/3d
    const { data: existingSubOrder } = await supabase
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
    };

    const accessDaysSub = tariff.access_days || 30;
    const nowSub = new Date();
    const plannedEndSub = new Date(nowSub);
    plannedEndSub.setDate(plannedEndSub.getDate() + accessDaysSub);

    const { data: order, error: orderError } = await supabase
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
        meta: subOrderMeta,
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

    const accessDays = tariff.access_days || 30;
    const intervalDays = 30;
    const trackingId = `link:order:${order.id}`;
    const successReturnUrl = `${effectiveOrigin}/purchases?bepaid_sub=success&order=${order.id}`;

    const planTitle = `${product.name} — ${tariff.name}`;
    const planDescription = `Подписка. Автосписание каждый месяц. Можно отменить в любой момент.`;

    const bepaidPayload = {
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
      console.error('[create-payment-checkout] bePaid subscription error:', {
        status: bepaidResponse.status,
        errors: bepaidResult.errors || bepaidResult.message,
      });
      const { error: failErr2 } = await supabase.from('orders_v2').update({ status: 'failed' }).eq('id', order.id);
      if (failErr2) console.error('[payment_checkout] order status→failed update failed', { order_id: order.id, payment_type: 'subscription', error: failErr2 });
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
      return { success: false, error: 'bePaid did not return a subscription URL' };
    }

    // PATCH F2: Store provider subscription — use REAL column names
    const { error: provSubError } = await supabase.from('provider_subscriptions').upsert({
      provider: 'bepaid',
      provider_subscription_id: String(bepaidSubId),
      subscription_v2_id: null,
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
      },
    }, { onConflict: 'provider,provider_subscription_id' });

    if (provSubError) {
      console.error('[create-payment-checkout] STOP: provider_subscriptions upsert failed:', provSubError);
      // Don't fail the whole flow — order+bePaid subscription already created
    }

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
