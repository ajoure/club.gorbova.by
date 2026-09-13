import { reserveCheckoutDiscounts } from './checkout-discounts.ts';
import { reusePendingSubscriptionCheckout } from './pending-subscription-checkout.ts';
import { requestCheckoutProvider, claimPendingPurchase, finishCheckoutAttempt, lookupPendingCheckout } from './pending-purchase.ts';
import { paymentCheckoutExpiresAt } from './payment-checkout-lifetime.ts';
import { courseAccessEnd } from './course-access-window.ts';
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
import { resolveOrderRouting, buildNegativeSnapshot, auditNegativeSnapshot } from './crm-routing.ts';
import {
  validateReplacementSubscription,
  classifySameProductState,
  type SubscriptionConflict as SharedSubscriptionConflict,
  type ExistingProviderSub,
} from './subscription-conflict.ts';
import { createStripeCheckout } from './create-stripe-checkout.ts';
import {
  resolveInstallmentRetryPolicy,
  resolveBepaidAttemptsValue,
  ProviderUnlimitedAttemptsNotSupportedError,
  buildRetryPolicySnapshot,
  type BepaidAttemptsResolution,
} from './installment-retry-policy.ts';
import {
  resolveChargeNotificationSnapshotForWriter,
  serializeChargeNotificationPolicy,
} from './charge-notification-policy.ts';
import { referralDiscountMeta, resolveReferralCheckoutDiscount } from './referral-checkout-discount.ts';
import { resolvePublicReturnOrigin } from './access-alias-origin.ts';

export interface CreateCheckoutParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  user_id: string;
  product_id: string;
  tariff_id: string;
  amount: number; // ВНИМАНИЕ:
                  //   bepaid  → amount в копейках (kopecks), как было исторически.
                  //   stripe  → amount в MAJOR units (BYN/EUR/PLN/USD), конвертация
                  //             в minor units выполняется внутри Stripe-ветки.
  payment_type: 'one_time' | 'subscription';
  description?: string;
  offer_id?: string;
  origin?: string;
  actor_user_id?: string;
  actor_type?: 'admin' | 'system';
  /** Fixed sales manager inherited by every order created by this checkout. */
  responsible_user_id?: string | null;
  /** ID подписки, которую заменяем. Сервер проверит, что она реально отменена, прежде чем создать новую. */
  replacement_of_subscription_v2_id?: string;
  /**
   * Произвольные ключи, которые будут смёрджены в `orders_v2.meta` при создании.
   * Канонический способ прокинуть `payment_link_id` (и подобные привязки) без дублирования.
   * Анти-кейс: ручной post-insert UPDATE из вызывающей функции.
   */
  meta_extra?: Record<string, any>;
  /**
   * Phase 4.1 — provider selector для public payment links.
   * default 'bepaid' (полный бэк-компат: все существующие вызовы идут в bePaid-ветку).
   */
  provider?: 'bepaid' | 'stripe';
  /** Phase 4.1 — Stripe account override (иначе берётся default из acquiring_connections). */
  account_code?: string | null;
  /** Phase 4.1 — валюта для Stripe-ветки (BYN/EUR/PLN/USD). bePaid игнорирует. */
  currency?: string;
  /** Optional accumulated customer discount credit, in minor units. Never allowed for open-ended subscriptions. */
  customer_credit_requested_minor?: number;
  /** Stable per checkout attempt. Prevents repeated clicks from reserving the wallet twice. */
  customer_credit_checkout_key?: string;
  /** Partner's internal bonus wallet. Never accepted for open-ended subscriptions. */
  partner_bonus_requested_minor?: number;
  partner_bonus_checkout_key?: string;
}

export interface CreateCheckoutSuccess {
  success: true;
  redirect_url: string;
  /** bepaid one_time/subscription и stripe one_time — UUID заказа. stripe subscription — null. */
  order_id: string | null;
  order_number?: string;
  payment_type: 'one_time' | 'subscription';
  /** Phase 4.1 */
  provider?: 'bepaid' | 'stripe';
  subscription_v2_id?: string;
  provider_subscription_row_id?: string;
  checkout_session_id?: string;
  account_code?: string;
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
  message?: string;
  conflict?: SubscriptionConflict;
}

export type CreateCheckoutResult = CreateCheckoutSuccess | CreateCheckoutError;

export async function createPaymentCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult> {
  const {
    supabase, user_id, product_id, tariff_id, amount: requestedAmount,
    payment_type, description, offer_id, origin, actor_user_id, actor_type,
    responsible_user_id,
    replacement_of_subscription_v2_id,
    meta_extra,
  } = params;
  let extraMeta = meta_extra && typeof meta_extra === 'object' ? meta_extra : {};

  // === STOP-GUARD: validate required fields ===
  if (!user_id || !product_id || !tariff_id || !requestedAmount) {
    console.error('[create-payment-checkout] STOP-GUARD: missing required fields', {
      has_user_id: !!user_id,
      has_product_id: !!product_id,
      has_tariff_id: !!tariff_id,
      has_amount: !!requestedAmount,
    });
    return { success: false, error: 'Missing required fields: user_id, product_id, tariff_id, amount' };
  }
  let referralQuote;
  const isFiniteInstallment = Number((extraMeta as any)?.installment?.billing_cycles ?? 0) >= 2;
  const allowsImmediateDiscount = payment_type === 'one_time' || isFiniteInstallment;
  try {
    referralQuote = await resolveReferralCheckoutDiscount({
      supabase, userId: user_id, productId: product_id, amountMinor: requestedAmount,
      allowImmediateDiscount: allowsImmediateDiscount,
    });
  } catch (error) {
    console.error('[create-payment-checkout] referral discount lookup failed; checkout stopped', error);
    return { success: false, error: 'Could not safely calculate referral discount' };
  }
  let amount = referralQuote.finalAmountMinor;
  const baseAmountByn = referralQuote.baseAmountMinor / 100;
  extraMeta = { ...extraMeta, payment_type, ...referralDiscountMeta(referralQuote) };
  const requestedCreditMinor = Math.max(0, Math.round(Number(params.customer_credit_requested_minor ?? 0)));
  if (requestedCreditMinor > 0 && !allowsImmediateDiscount) {
    return { success: false, error: 'Customer credit cannot be used for recurring subscriptions' };
  }
  const requestedPartnerBonusMinor = Math.max(0, Math.round(Number(params.partner_bonus_requested_minor ?? 0)));
  if(requestedPartnerBonusMinor>0 && !allowsImmediateDiscount) return {success:false,error:'Partner bonus cannot be used for recurring subscriptions'};
  const creditCycles=isFiniteInstallment ? Math.max(2,Math.round(Number((extraMeta as any)?.installment?.billing_cycles ?? 2))) : 1;
  const discounts=await reserveCheckoutDiscounts(supabase,{
    user_id,product_id,tariff_id,offer_id:offer_id ?? null,final_price:amount/100,currency:params.currency ?? 'BYN',meta:extraMeta,
  },payment_type,requestedCreditMinor,requestedPartnerBonusMinor,creditCycles);
  amount=Math.max(100,amount-discounts.creditPerChargeMinor-discounts.bonusMinor);
  extraMeta={...extraMeta,
    ...(discounts.intentId ? {checkout_discount_intent_id:discounts.intentId} : {}),
    ...(discounts.creditMinor>0 ? {
      referral_customer_credit_applied_minor:discounts.creditMinor,
      referral_customer_credit_per_charge_minor:discounts.creditPerChargeMinor,
      referral_customer_credit_charge_count:creditCycles,
      referral_customer_credit_reservation_id:discounts.creditReservationId,
    } : {}),
    ...(discounts.bonusMinor>0 ? {referral_partner_bonus_applied_minor:discounts.bonusMinor,
      referral_partner_bonus_reservation_id:discounts.bonusReservationId} : {}),
  };

  // ============================================================
  // Phase 4.1 — provider dispatch (default 'bepaid' = байт-в-байт legacy path).
  // Stripe-ветка короткозамыкается ДО любых bePaid creds и DB-операций bepaid-flow.
  // ============================================================
  const providerSelector: 'bepaid' | 'stripe' =
    params.provider === 'stripe' ? 'stripe' : 'bepaid';
  if (providerSelector === 'stripe') {
    // amount у public-checkout приходит в копейках (link.amount), для Stripe
    // нам нужны MAJOR units. Конвертация amount/100 безопасна, потому что
    // public-checkout всегда передаёт integer kopecks. Если когда-нибудь caller
    // захочет миновать конвертацию — пусть передаст provider='stripe' + amount уже
    // в major (но текущий public-checkout этого не делает).
    const amountMajor = amount / 100;
    const stripeRes = await createStripeCheckout({
      supabase, user_id, product_id, tariff_id,
      amount: amountMajor,
      amount_major: amountMajor,
      currency: params.currency ?? 'BYN',
      payment_type, description, offer_id, origin,
      actor_user_id: actor_user_id ?? null,
      actor_type,
      responsible_user_id,
      account_code: params.account_code ?? null,
      payment_link_id: (extraMeta as any)?.payment_link_id ?? null,
      replacement_of_subscription_v2_id,
      meta_extra: extraMeta as Record<string, unknown>,
    });
    if (!stripeRes.success) {
      return { success: false, error: stripeRes.error, ...(stripeRes.conflict ? { conflict: stripeRes.conflict } : {}) };
    }
    return {
      success: true,
      redirect_url: stripeRes.redirect_url,
      order_id: stripeRes.order_id,
      order_number: stripeRes.order_number,
      payment_type: stripeRes.payment_type,
      provider: 'stripe',
      subscription_v2_id: stripeRes.subscription_v2_id,
      provider_subscription_row_id: stripeRes.provider_subscription_row_id,
      checkout_session_id: stripeRes.checkout_session_id,
      account_code: stripeRes.account_code,
    };
  }

  if (requestedAmount < 100) {
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
    supabase.from('tariffs').select('id, name, code, access_days, public_id, meta').eq('id', tariff_id).maybeSingle(),
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
  const effectiveOrigin = resolvePublicReturnOrigin(origin);
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
    const plannedEndOneTime = courseAccessEnd(tariff.meta) || new Date(nowOneTime.getTime() + accessDaysOneTime * 86_400_000);

    // CRM routing — Layer A (B.0 invariant): always materialize crm_routing_snapshot
    // (positive or structural-negative). Snapshot is written once at INSERT and never
    // overwritten downstream — see B.0 contract.
    const oneTimeRouting = await resolveOrderRouting(supabase, { offer_id, tariff_id, product_id });
    const oneTimeCrmSnapshot = oneTimeRouting.ok && oneTimeRouting.snapshot
      ? oneTimeRouting.snapshot
      : buildNegativeSnapshot({
          reason: oneTimeRouting.reason || 'unknown',
          offer_id: offer_id ?? null,
          tariff_id,
          product_id,
          resolved_via: oneTimeRouting.resolved_via ?? 'none',
          candidates_count: oneTimeRouting.candidates_count ?? 0,
          primary_reason: oneTimeRouting.primary_reason ?? null,
        });
    let oneTimeMetaWithRouting: Record<string, any> = { ...orderMeta, crm_routing_snapshot: oneTimeCrmSnapshot };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checkoutClaim = await claimPendingPurchase(supabase, {
        order_number: orderNumber,
        user_id,
        responsible_user_id: responsible_user_id || null,
        profile_id: profileId,
        product_id,
        tariff_id,
        offer_id: offer_id || null,
        base_price: baseAmountByn,
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
      }, 'one_time', 'bepaid');
    if (checkoutClaim.reusedResult) return checkoutClaim.reusedResult as CreateCheckoutSuccess;
    const order = checkoutClaim.order;
    oneTimeMetaWithRouting = { ...oneTimeMetaWithRouting, ...order.meta };

    // B.0: audit negative snapshot post-INSERT (non-blocking)
    if (!oneTimeRouting.ok) {
      await auditNegativeSnapshot(supabase, {
        order_id: order.id,
        offer_id: offer_id ?? null,
        tariff_id,
        product_id,
        reason: oneTimeRouting.reason || 'unknown',
        resolved_via: oneTimeRouting.resolved_via ?? 'none',
        candidates_count: oneTimeRouting.candidates_count ?? 0,
        primary_reason: oneTimeRouting.primary_reason ?? null,
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
          expired_at: paymentCheckoutExpiresAt(),
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

    const checkoutResponse = await requestCheckoutProvider(supabase,checkoutClaim.attemptId,()=>fetch('https://checkout.bepaid.by/ctp/api/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': bepaidAuth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'RequestID': checkoutClaim.attemptId,
      },
      body: JSON.stringify(checkoutPayload),
    }));

    const checkoutResult = await requestCheckoutProvider(supabase,checkoutClaim.attemptId,()=>checkoutResponse.json());

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

      await finishCheckoutAttempt(supabase, checkoutClaim.attemptId, (checkoutResponse.status >= 500 || [408,409,429].includes(checkoutResponse.status)) ? 'unknown' : 'failed', { success: false, error: 'bepaid_checkout_rejected' });
      return {
        success: false,
        error: checkoutResult.message || checkoutResult.errors?.base?.[0] || 'bePaid checkout creation failed',
      };
    }

    if(!checkoutResult.checkout?.token || !/^https:\/\//.test(checkoutResult.checkout?.redirect_url || '')) {
      await finishCheckoutAttempt(supabase,checkoutClaim.attemptId,'unknown',{success:false,error:'checkout_response_incomplete'});
      return {success:false,error:'checkout_response_incomplete'};
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
    const { error: metaMergeErr } = await supabase.rpc('crm_merge_checkout_metadata', {
      p_order_id:order.id, p_history_entry:tokenHistoryEntry,
      p_patch:{ bepaid_checkout_token:newCheckoutToken, active_checkout_token:newCheckoutToken,
        checkout_created_at:new Date().toISOString() },
    });
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

    const readyResult: CreateCheckoutSuccess = {
      success: true, redirect_url: redirectUrl, order_id: order.id,
      order_number: order.order_number, payment_type: 'one_time',
    };
    if (metaMergeErr) throw new Error('checkout_metadata_persist_failed');
    await finishCheckoutAttempt(supabase, checkoutClaim.attemptId, 'ready', readyResult);
    return readyResult;

  } else if (payment_type === 'subscription') {
    // === SUBSCRIPTION ===
    const pendingProposal = {
      user_id, product_id, tariff_id, offer_id: offer_id ?? null,
      final_price: amount / 100, currency: params.currency ?? 'BYN',
      meta: {...extraMeta,replacement_of_subscription_v2_id:replacement_of_subscription_v2_id ?? null},
      purchase_snapshot: {access_days:tariff.access_days || 30,is_trial:false},
    };
    const recoveredCheckout = await reusePendingSubscriptionCheckout(supabase,pendingProposal,'bepaid');
    if(recoveredCheckout) return recoveredCheckout as CreateCheckoutSuccess;
    const reusedCheckout = await lookupPendingCheckout(supabase,pendingProposal,'subscription','bepaid');
    if (reusedCheckout) return reusedCheckout as CreateCheckoutSuccess;

    // === PATCH H3.x-a (B-2 root-fix) ===
    // Различаем legitimate extend (same tariff) vs replacement (other tariff)
    // vs no_existing. Поведение:
    //   extend_same_tariff  → НЕ создавать новой subscriptions_v2 / orders_v2 / bePaid sub;
    //                         вернуть already_has_active_subscription;
    //   replace_other_tariff:
    //       + replacement_of_subscription_v2_id указан → validateReplacementSubscription (старое поведение);
    //       + не указан                              → existing_subscription_conflict (старое поведение);
    //   no_existing          → продолжаем создавать новый order+subscription.
    let classifyDecision: 'no_existing' | 'extend_same_tariff' | 'replace_other_tariff' = 'no_existing';
    let classifyExisting: ExistingProviderSub | null = null;
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
      const cls = await classifySameProductState(supabase, { user_id, product_id, tariff_id });
      if (cls.status === 'error') {
        return { success: false, error: cls.error };
      }
      classifyDecision = cls.decision;
      classifyExisting = cls.existing;

      if (cls.decision === 'extend_same_tariff' && cls.existing) {
        const ex = cls.existing;
        console.log('[create-payment-checkout] H3.x-a extend_same_tariff — reusing existing active sub', {
          existing_sub_id: ex.subscription_v2_id,
          tariff_id, product_id, user_id,
        });
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'create-payment-checkout',
          action: 'subscription.reused_existing_public_link',
          target_user_id: user_id,
          meta: {
            decision: 'extend_same_tariff',
            existing_subscription_v2_id: ex.subscription_v2_id,
            existing_status: ex.status,
            existing_tariff_id: ex.tariff_id,
            existing_provider_subscription_id: ex.provider_subscription_id,
            existing_provider_state: ex.provider_state,
            requested_product_id: product_id,
            requested_tariff_id: tariff_id,
            payment_flow: paymentFlow,
            stage: 'pre_insert_block',
          },
        });
        return {
          success: false,
          error: 'already_has_active_subscription',
          conflict: {
            subscription_v2_id: ex.subscription_v2_id,
            status: ex.status,
            next_charge_at: ex.next_charge_at,
            access_end_at: ex.access_end_at,
            bepaid_subscription_id: ex.provider_subscription_id,
            provider_subscription_id: ex.provider_subscription_id,
            product_id,
            tariff_id,
            display_next_charge_at: ex.next_charge_at,
            display_access_end_at: ex.access_end_at,
            timezone_used: 'Europe/Minsk',
          } as SharedSubscriptionConflict,
        };
      }

      if (cls.decision === 'replace_other_tariff' && cls.existing) {
        const ex = cls.existing;
        console.log('[create-payment-checkout] H3.x-a replace_other_tariff WITHOUT replacement_id — conflict', {
          existing_sub_id: ex.subscription_v2_id,
          existing_tariff_id: ex.tariff_id,
          requested_tariff_id: tariff_id,
        });
        return {
          success: false,
          error: 'existing_subscription_conflict',
          conflict: {
            subscription_v2_id: ex.subscription_v2_id,
            status: ex.status,
            next_charge_at: ex.next_charge_at,
            access_end_at: ex.access_end_at,
            bepaid_subscription_id: ex.provider_subscription_id,
            provider_subscription_id: ex.provider_subscription_id,
            product_id,
            tariff_id: ex.tariff_id ?? tariff_id,
            display_next_charge_at: ex.next_charge_at,
            display_access_end_at: ex.access_end_at,
            timezone_used: 'Europe/Minsk',
          } as SharedSubscriptionConflict,
        };
      }
      // no_existing → fall through to F3 + insert.
    }


    // PATCH INSTALLMENT-RETRY-POLICY (Sprint A · A1+A2+A3):
    //   Capability gate ДО любых INSERT в orders_v2 / subscriptions_v2 / provider_subscriptions.
    //   При unlimited_requested без proven capability возвращаем controlled error
    //   'provider_unlimited_attempts_not_supported' без создания заказов, подписок и CRM-сделки.
    // ============================================================================
    const installmentCountRawPre = Number(extraMeta.installment_count);
    const installmentExtraPre =
      extraMeta.installment && typeof extraMeta.installment === 'object'
        ? (extraMeta.installment as Record<string, any>)
        : {};
    // Stage 1 corrective: activate internal_installment ONLY when the exact canonical marker
    // is present (written by admin-create-public-link / public-create-installment-link after Stage 1).
    // A narrow legacy fallback keeps pre-Stage-1 internal installment links working.
    const hasCanonicalInternalInstallmentMarker =
      (extraMeta as any).payment_method === 'internal_installment' &&
      installmentExtraPre.type === 'internal' &&
      installmentExtraPre.provider === 'bepaid' &&
      installmentExtraPre.model === 'bepaid_finite_subscription' &&
      installmentExtraPre.infinite === false;
    const hasLegacyInternalInstallmentMarker =
      installmentExtraPre.payment_method === 'internal_installment' &&
      installmentExtraPre.as_finite_subscription === true;
    const isInstallmentSubscriptionPre =
      (hasCanonicalInternalInstallmentMarker || hasLegacyInternalInstallmentMarker) &&
      Number.isInteger(installmentCountRawPre) &&
      installmentCountRawPre >= 2 &&
      installmentCountRawPre <= 12;
    const billingCyclesPre = isInstallmentSubscriptionPre ? installmentCountRawPre : null;
    const intervalDaysPre = isInstallmentSubscriptionPre
      ? Number(installmentExtraPre.interval_days ?? 30)
      : 30;

    let retryPolicyResolutionPre: BepaidAttemptsResolution | null = null;
    let retryPolicySnapshotPre: Record<string, unknown> | null = null;
    if (isInstallmentSubscriptionPre) {
      try {
        const parsedPolicy = resolveInstallmentRetryPolicy(installmentExtraPre.max_charge_attempts);
        retryPolicyResolutionPre = resolveBepaidAttemptsValue({
          retryPolicy: parsedPolicy,
          capability: bepaidCreds.subscription_attempts_capability,
        });
        retryPolicySnapshotPre = buildRetryPolicySnapshot({
          retryPolicy: parsedPolicy,
          resolution: retryPolicyResolutionPre,
        });
      } catch (e) {
        const errCode =
          e instanceof ProviderUnlimitedAttemptsNotSupportedError
            ? e.code
            : (e as Error)?.message === 'invalid_installment_max_charge_attempts'
            ? 'invalid_installment_max_charge_attempts'
            : 'installment_retry_policy_resolution_failed';
        const message =
          errCode === 'provider_unlimited_attempts_not_supported'
            ? 'Безлимитные попытки не подтверждены провайдером. Выберите значение от 1 до 10.'
            : errCode === 'invalid_installment_max_charge_attempts'
            ? 'Некорректное значение количества попыток списания. Допустимо: пусто, 0 или 1..10.'
            : 'Не удалось определить политику повторных попыток по офферу.';
        console.error('[create-payment-checkout] retry policy pre-gate blocked checkout', {
          user_id,
          product_id,
          tariff_id,
          offer_id: offer_id || null,
          error: errCode,
          reason: (e as any)?.reason ?? null,
        });
        // Audit — но БЕЗ создания orders_v2 / subscriptions_v2 / provider_subscriptions.
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'create-payment-checkout',
          action: 'installment.retry_policy.pre_gate_blocked',
          target_user_id: user_id,
          meta: {
            product_id,
            tariff_id,
            offer_id: offer_id || null,
            payment_flow: paymentFlow,
            error: errCode,
            reason: (e as any)?.reason ?? null,
            configured_value: installmentExtraPre.max_charge_attempts ?? null,
          },
        });
        return { success: false, error: errCode, message };
      }
    }

    const orderNumber = `SUB-LINK-${Date.now().toString(36).toUpperCase()}`;

    const subOrderMeta = {
      type: effectiveActorType === 'admin' ? 'admin_payment_link_subscription' : 'system_payment_link_subscription',
      description: description || null,
      created_by: actorUserId,
      payment_flow: paymentFlow,
      ...extraMeta,
      replacement_of_subscription_v2_id:replacement_of_subscription_v2_id ?? null,
    };

    const accessDaysSub = tariff.access_days || 30;
    const nowSub = new Date();
    const plannedEndSub = courseAccessEnd(tariff.meta) || new Date(nowSub.getTime() + accessDaysSub * 86_400_000);

    // CRM routing — Layer A (B.0 invariant): always materialize crm_routing_snapshot
    const subRouting = await resolveOrderRouting(supabase, { offer_id, tariff_id, product_id });
    const subCrmSnapshot = subRouting.ok && subRouting.snapshot
      ? subRouting.snapshot
      : buildNegativeSnapshot({
          reason: subRouting.reason || 'unknown',
          offer_id: offer_id ?? null,
          tariff_id,
          product_id,
          resolved_via: subRouting.resolved_via ?? 'none',
          candidates_count: subRouting.candidates_count ?? 0,
          primary_reason: subRouting.primary_reason ?? null,
        });
    let subMetaWithRouting: Record<string, any> = { ...subOrderMeta, crm_routing_snapshot: subCrmSnapshot };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checkoutClaim = await claimPendingPurchase(supabase, {
        order_number: orderNumber,
        user_id,
        responsible_user_id: responsible_user_id || null,
        profile_id: profileId,
        product_id,
        tariff_id,
        offer_id: offer_id || null,
        base_price: baseAmountByn,
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
      }, 'subscription', 'bepaid');
    if (checkoutClaim.reusedResult) return checkoutClaim.reusedResult as CreateCheckoutSuccess;
    const order = checkoutClaim.order;
    subMetaWithRouting = { ...subMetaWithRouting, ...order.meta };

    // B.0: audit negative snapshot post-INSERT
    if (!subRouting.ok) {
      await auditNegativeSnapshot(supabase, {
        order_id: order.id,
        offer_id: offer_id ?? null,
        tariff_id,
        product_id,
        reason: subRouting.reason || 'unknown',
        resolved_via: subRouting.resolved_via ?? 'none',
        candidates_count: subRouting.candidates_count ?? 0,
        primary_reason: subRouting.primary_reason ?? null,
      });
    }

    // PATCH H3.x-a (B-1 partial / best-effort re-check) ===

    // Полный atomic-lock против race выносится в H3.x-a-migration (RPC pg_advisory_xact_lock).
    // Здесь только повторный classify за 1 шаг до INSERT — закроет окно, когда parallel-call
    // успел создать active sub после первичного classify (но до нашего INSERT).
    if (classifyDecision === 'no_existing' && !replacement_of_subscription_v2_id) {
      const recheck = await classifySameProductState(supabase, { user_id, product_id, tariff_id });
      if (recheck.status === 'ok' && recheck.decision === 'extend_same_tariff' && recheck.existing) {
        const ex = recheck.existing;
        console.warn('[create-payment-checkout] H3.x-a race_insert_avoided — parallel sub appeared between classify and insert', {
          existing_sub_id: ex.subscription_v2_id, user_id, product_id, tariff_id, order_id: order.id,
        });
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'create-payment-checkout',
          action: 'subscription.race_insert_avoided',
          target_user_id: user_id,
          meta: {
            existing_subscription_v2_id: ex.subscription_v2_id,
            existing_provider_subscription_id: ex.provider_subscription_id,
            cancelled_order_id: order.id,
            product_id, tariff_id,
            payment_flow: paymentFlow,
            stage: 'pre_insert_recheck',
            note: 'best_effort_no_db_lock_pending_h3xa_migration',
          },
        });
        await supabase.from('orders_v2').update({
          status: 'failed',
          meta: { ...subMetaWithRouting, race_insert_avoided: true, race_insert_avoided_at: new Date().toISOString() },
        }).eq('id', order.id);
        await finishCheckoutAttempt(supabase, checkoutClaim.attemptId, 'failed', { success: false, error: 'already_has_active_subscription' });
        return {
          success: false,
          error: 'already_has_active_subscription',
          conflict: {
            subscription_v2_id: ex.subscription_v2_id,
            status: ex.status,
            next_charge_at: ex.next_charge_at,
            access_end_at: ex.access_end_at,
            bepaid_subscription_id: ex.provider_subscription_id,
            provider_subscription_id: ex.provider_subscription_id,
            product_id,
            tariff_id,
            display_next_charge_at: ex.next_charge_at,
            display_access_end_at: ex.access_end_at,
            timezone_used: 'Europe/Minsk',
          } as SharedSubscriptionConflict,
        };
      }
    }


    const accessDays = tariff.access_days || 30;
    // PATCH INSTALLMENT-PUBLIC-LINK: используем pre-computed installment-контекст (см. A1 gate выше).
    const installmentCountRaw = installmentCountRawPre;
    const isInstallmentSubscription = isInstallmentSubscriptionPre;
    const billingCycles = billingCyclesPre;
    const installmentExtra = installmentExtraPre;
    const intervalDays = intervalDaysPre;

    // Stage 1 canonical snapshot — единый normalized блок для orders_v2.meta,
    // subscriptions_v2.meta и provider_subscriptions.meta (installment scope).
    // original_order_id пишется ТОЛЬКО сервером после INSERT orders_v2.
    const canonicalInstallmentSnapshot: Record<string, any> | null = isInstallmentSubscription
      ? {
          type: 'internal',
          provider: 'bepaid',
          model: 'bepaid_finite_subscription',
          billing_cycles: billingCycles,
          infinite: false,
          per_payment_byn: Number(extraMeta.installment_per_payment_amount_byn ?? amountByn),
          effective_total_byn: Number(
            extraMeta.installment_total_amount_byn ?? (amountByn * (billingCycles || 1)),
          ),
          rounding_mode: String(installmentExtra?.rounding_mode ?? 'ceil_to_whole_byn'),
          rounding_delta_byn: Number(installmentExtra?.rounding_delta_byn ?? 0),
          original_order_id: order.id,
        }
      : null;

    // PATCH PAYMENTS-REVISION: pre-create subscriptions_v2 ДО bePaid /subscriptions,
    // чтобы tracking_id содержал реальный subscription_v2_id.
    // B2 corrective. Resolve canonical charge_notifications policy with full
    // precedence: link snapshot → live offer meta → legacy → defaults. Offer
    // meta подгружаем ТОЛЬКО если link не дал canonical (иначе — лишний roundtrip).
    let offerMetaForNotif: unknown = null;
    {
      const preLink = resolveChargeNotificationSnapshotForWriter({ linkMeta: extraMeta });
      if (preLink.source === 'defaults' && offer_id) {
        const { data: offerRowForNotif } = await supabase
          .from('tariff_offers')
          .select('meta')
          .eq('id', offer_id)
          .maybeSingle();
        offerMetaForNotif = (offerRowForNotif as { meta?: unknown } | null)?.meta ?? null;
      }
    }
    const chargeNotifPolicy = resolveChargeNotificationSnapshotForWriter({
      linkMeta: extraMeta,
      offerMeta: offerMetaForNotif,
    });
    const chargeNotifSnapshot = serializeChargeNotificationPolicy(chargeNotifPolicy);

    const preSubMeta: Record<string, any> = {
      source: isInstallmentSubscription ? 'public_link_installment' : 'public_link_subscription',
      checkout_order_id: order.id,
      offer_id: offer_id || null,
      created_at_pre: new Date().toISOString(),
      tariff_access_days: accessDays,
      amount_byn: amountByn,
      currency: 'BYN',
      // B2. Canonical charge_notifications snapshot (subscription scope).
      charge_notifications: chargeNotifSnapshot,
      charge_notifications_source: chargeNotifPolicy.source,
    };
    if (isInstallmentSubscription) {
      preSubMeta.installment_count = installmentCountRaw;
      preSubMeta.billing_cycles = billingCycles;
      preSubMeta.installment_per_payment_amount_byn = Number(extraMeta.installment_per_payment_amount_byn ?? amountByn);
      preSubMeta.installment_total_amount_byn = Number(extraMeta.installment_total_amount_byn ?? (amountByn * (billingCycles || 1)));
      preSubMeta.installment = {
        ...installmentExtra,
        ...(canonicalInstallmentSnapshot || {}),
        retry_policy: retryPolicySnapshotPre,
        // B2. Canonical installment-scope charge_notifications snapshot.
        charge_notifications: chargeNotifSnapshot,
        charge_notifications_source: chargeNotifPolicy.source,
      };
      preSubMeta.model = 'bepaid_finite_subscription';
      // Stage 1 canonical marker (subscriptions_v2 scope).
      preSubMeta.payment_method = 'internal_installment';
      // PATCH A2 — единый effective retry snapshot (канонический путь meta.installment.retry_policy).
      // Дублируем на верхний уровень для legacy читателей — постепенно к удалению.
      preSubMeta.retry_policy = retryPolicySnapshotPre;
      preSubMeta.retry_policy_mode = retryPolicySnapshotPre?.mode ?? null;
      preSubMeta.max_charge_attempts_configured = installmentExtra.max_charge_attempts ?? null;
    }
    const { data: priorPreSub, error: priorPreSubError } = await supabase.from('subscriptions_v2')
      .select('id').eq('order_id', order.id).eq('status', 'past_due').limit(1).maybeSingle();
    if (priorPreSubError) throw new Error('checkout_subscription_read_failed');
    const { data: preSub, error: preSubError } = priorPreSub ? { data: priorPreSub, error: null } : await supabase
      .from('subscriptions_v2')
      .insert({
        user_id,
        profile_id: profileId,
        product_id,
        tariff_id,
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
      await finishCheckoutAttempt(supabase, checkoutClaim.attemptId, 'failed', { success: false, error: 'subscription_precreate_failed' });
      return { success: false, error: 'subscription_precreate_failed' };
    }
    const subscriptionV2Id = preSub.id as string;

    const trackingId = `subv2:${subscriptionV2Id}:order:${order.id}`;
    const successReturnUrl = `${effectiveOrigin}/purchases?bepaid_sub=success&order=${order.id}`;

    const planTitle = `${product.name} — ${tariff.name}`;
    const planDescription = isInstallmentSubscription
      ? `Рассрочка: ${billingCycles} платежа по ${amountByn} BYN каждые ${intervalDays} дней. Подписка завершится после ${billingCycles} платежей.`
      : `Подписка. Автосписание каждый месяц. Можно отменить в любой момент.`;

    // PATCH INSTALLMENT-RETRY-POLICY (A1): используем resolution, вычисленный ДО INSERT'ов.
    const bepaidAttemptsValue: number = isInstallmentSubscription
      ? (retryPolicyResolutionPre?.payloadValue ?? 3)
      : 3;

    // Audit — snapshot retry-policy перед bePaid запросом.
    if (isInstallmentSubscription && retryPolicySnapshotPre) {
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'create-payment-checkout',
        action: 'installment.retry_policy.resolved_pre_bepaid',
        target_user_id: user_id,
        meta: {
          order_id: order.id,
          subscription_v2_id: subscriptionV2Id,
          offer_id: offer_id || null,
          retry_policy: retryPolicySnapshotPre,
        },
      });
    }


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
          ? { infinite: false, billing_cycles: billingCycles, number_payment_attempts: bepaidAttemptsValue }
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

    const bepaidResponse = await requestCheckoutProvider(supabase,checkoutClaim.attemptId,()=>fetch('https://api.bepaid.by/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': bepaidAuth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'RequestID': checkoutClaim.attemptId,
      },
      body: JSON.stringify(bepaidPayload),
    }));

    const bepaidResult = await requestCheckoutProvider(supabase,checkoutClaim.attemptId,()=>bepaidResponse.json());

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

      await finishCheckoutAttempt(supabase, checkoutClaim.attemptId, (bepaidResponse.status >= 500 || [408,409,429].includes(bepaidResponse.status)) ? 'unknown' : 'failed', { success: false, error: 'bepaid_subscription_create_failed' });
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
      await finishCheckoutAttempt(supabase, checkoutClaim.attemptId, 'unknown', { success: false, error: 'bepaid_subscription_response_incomplete' });
      return { success: false, error: 'bePaid did not return a subscription URL' };
    }

    // PATCH F2 + INSTALLMENT-PUBLIC-LINK + PAYMENTS-REVISION:
    // Store provider subscription — с subscription_v2_id, явным order_id-колонкой и installment-полями.
    const { error: provSubError } = await supabase.from('provider_subscriptions').upsert({
      provider: 'bepaid',
      provider_subscription_id: String(bepaidSubId),
      subscription_v2_id: subscriptionV2Id,
      order_id: order.id,
      user_id,
      profile_id: profileId,
      state: 'pending',
      amount_cents: amount, // amount is already in kopecks
      currency: 'BYN',
      interval_days: intervalDays,
      meta: {
        checkout_attempt_id:checkoutClaim.attemptId,
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
              // Stage 1 canonical marker (provider_subscriptions scope).
              payment_method: 'internal_installment',
              // PATCH A2 — канонический путь meta.installment.retry_policy.
              // B2 — canonical installment.charge_notifications snapshot.
              installment: {
                ...(installmentExtra || {}),
                ...(canonicalInstallmentSnapshot || {}),
                retry_policy: retryPolicySnapshotPre,
                charge_notifications: chargeNotifSnapshot,
                charge_notifications_source: chargeNotifPolicy.source,
              },
              // legacy дубль — к удалению.
              retry_policy: retryPolicySnapshotPre,
              charge_notifications: chargeNotifSnapshot,
            }
          : {
              // Non-installment provider-managed subscription: сохраняем policy (subscription-scope).
              charge_notifications: chargeNotifSnapshot,
              charge_notifications_source: chargeNotifPolicy.source,
            }),
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
    const { error: subMetaActiveErr } = await supabase.rpc('crm_merge_checkout_metadata', {
      p_order_id:order.id, p_history_entry:subTokenHistoryEntry,
      p_patch: {
        bepaid_subscription_id: String(bepaidSubId),
        active_checkout_token: String(bepaidSubId),
        active_checkout_kind: 'bepaid_subscription_id',
        checkout_created_at: new Date().toISOString(),
        // B2 corrective. Explicit orders_v2 snapshot — не полагаемся на spread.
        charge_notifications: chargeNotifSnapshot,
        charge_notifications_source: chargeNotifPolicy.source,
        ...(isInstallmentSubscription && retryPolicySnapshotPre
          ? {
              // Stage 1 canonical marker (orders_v2 scope).
              payment_method: 'internal_installment',
              installment: {
                ...(installmentExtra || {}),
                ...(canonicalInstallmentSnapshot || {}),
                retry_policy: retryPolicySnapshotPre,
                charge_notifications: chargeNotifSnapshot,
                charge_notifications_source: chargeNotifPolicy.source,
              },
            }
          : {}),
      },
    });
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

    const readyResult: CreateCheckoutSuccess = {
      success: true, redirect_url: redirectUrl, order_id: order.id,
      order_number: order.order_number, payment_type: 'subscription', subscription_v2_id: subscriptionV2Id,
    };
    if (subMetaActiveErr || subLinkErr || provSubError) throw new Error('checkout_subscription_persist_failed');
    await finishCheckoutAttempt(supabase, checkoutClaim.attemptId, 'ready', readyResult);
    return readyResult;

  } else {
    return { success: false, error: 'Invalid payment_type. Expected: one_time or subscription' };
  }
}
