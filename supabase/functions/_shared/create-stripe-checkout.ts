// Phase 4.1 — Stripe branch for shared public-payment checkout.
//
// Cалled from `_shared/create-payment-checkout.ts` ТОЛЬКО когда provider==='stripe'.
// bePaid-ветка не затрагивается ни на байт.
//
// Контракт совпадает с архитектурой bePaid public link:
//   one_time     → создаём orders_v2 pending provider='stripe', потом Stripe Checkout
//                  (mode=payment) через _shared/acquiring/stripe-adapter.ts.
//   subscription → orders_v2 НЕ создаём (Phase 3.1/3.2 канон: orders_v2 материализуется
//                  только из invoice.paid в stripe-webhook). Создаём только pending
//                  subscriptions_v2 + provider_subscriptions через
//                  stripe-pre-create-subscription helper. payment_link_id уходит в
//                  Stripe Session metadata, чтобы webhook мог записать его в order.
//
// На ошибку Stripe — FAIL (controlled). НИКАКОГО bePaid fallback.

import {
  resolveOfferRoutingWithFallback,
  buildNegativeSnapshot,
  auditNegativeSnapshot,
} from './crm-routing.ts';
import { buildPurchaseSnapshot } from './build-purchase-snapshot.ts';
import {
  classifySameProductState,
  validateReplacementSubscription,
  checkPendingCheckoutConflict,
  type SubscriptionConflict as SharedSubscriptionConflict,
} from './subscription-conflict.ts';
import { resolveAdapter } from './acquiring/index.ts';
import { resolveDefaultStripeAccount } from './acquiring/default-account.ts';
import { resolveBusinessStream } from './acquiring/business-stream-resolver.ts';
import { readAcquiringSecret } from './acquiring/vault.ts';
import { resolveStripeCheckoutUrls } from './public-app-host.ts';
import { stripePreCreateSubscription } from './stripe-pre-create-subscription.ts';
import { toStripeMinorUnits } from './stripe-minor-units.ts';

export interface StripeBranchParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  user_id: string;
  product_id: string;
  tariff_id: string;
  amount: number; // ВАЖНО: для Stripe сюда передаём ВСЕГДА сумму в MAJOR units (BYN/EUR/...).
                  // Helper сам делает toStripeMinorUnits. bePaid-ветка иначе — там minor.
  amount_major?: number; // explicit alias, если caller хочет быть явным
  currency: string;
  payment_type: 'one_time' | 'subscription';
  description?: string;
  offer_id?: string;
  origin?: string;
  actor_user_id?: string | null;
  actor_type?: 'admin' | 'system';
  account_code?: string | null;
  payment_link_id?: string | null;
  replacement_of_subscription_v2_id?: string;
  /** Произвольные ключи в orders_v2.meta (для one_time). Subscription orders_v2 не создаёт. */
  meta_extra?: Record<string, unknown>;
}

export interface StripeBranchSuccess {
  success: true;
  redirect_url: string;
  /** Для one_time — UUID созданного pending orders_v2. Для subscription — null (order ещё не создан). */
  order_id: string | null;
  order_number?: string;
  payment_type: 'one_time' | 'subscription';
  provider: 'stripe';
  /** Для subscription — UUID pending подписки. */
  subscription_v2_id?: string;
  provider_subscription_row_id?: string;
  checkout_session_id?: string;
  account_code: string;
}

export interface StripeBranchError {
  success: false;
  error: string;
  provider: 'stripe';
  detail?: unknown;
  conflict?: SharedSubscriptionConflict;
}

export type StripeBranchResult = StripeBranchSuccess | StripeBranchError;

export async function createStripeCheckout(params: StripeBranchParams): Promise<StripeBranchResult> {
  const {
    supabase, user_id, product_id, tariff_id,
    payment_type, description, offer_id, origin,
    actor_user_id, actor_type, account_code, payment_link_id,
    replacement_of_subscription_v2_id, meta_extra,
  } = params;
  const currency = String(params.currency || '').trim();
  const amountMajor = Number(params.amount_major ?? params.amount);

  if (!user_id || !product_id || !tariff_id) {
    return { success: false, provider: 'stripe', error: 'Missing required fields' };
  }
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    return { success: false, provider: 'stripe', error: 'invalid_amount' };
  }
  if (!currency) {
    return { success: false, provider: 'stripe', error: 'missing_currency' };
  }

  // === Resolve Stripe account ===
  // SOT режима — сама запись в acquiring_connections (test_mode/live).
  // Pre-prod guard `stripe_account_not_test_mode` снят: live-checkout разрешён,
  // когда admin сохранил live connection через UI интеграций. test_mode остаётся
  // в meta для телеметрии (см. ниже).
  let acct: Awaited<ReturnType<typeof resolveDefaultStripeAccount>>;
  try {
    acct = await resolveDefaultStripeAccount(supabase, account_code ?? null);
  } catch (e) {
    return { success: false, provider: 'stripe', error: e instanceof Error ? e.message : 'stripe_account_resolve_failed' };
  }
  const resolved_account_code = acct.account_code;

  // === Resolve business_stream from offer/product (SOT) ===
  const [offerRowRes, productRowRes, tariffRowRes, profileRowRes] = await Promise.all([
    offer_id
      ? supabase.from('tariff_offers').select('id, tariff_id, is_active, offer_type, meta').eq('id', offer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('products_v2').select('id, name, code, public_id, meta').eq('id', product_id).maybeSingle(),
    supabase.from('tariffs').select('id, name, code, access_days, public_id').eq('id', tariff_id).maybeSingle(),
    supabase.from('profiles').select('id, email, full_name').eq('user_id', user_id).maybeSingle(),
  ]);

  const product = (productRowRes as any).data;
  const tariff = (tariffRowRes as any).data;
  const profile = (profileRowRes as any).data;
  const offerRow = (offerRowRes as any).data;
  if (!product) return { success: false, provider: 'stripe', error: 'product_not_found' };
  if (!tariff) return { success: false, provider: 'stripe', error: 'tariff_not_found' };
  const profileId = profile?.id ?? null;
  const customerEmail = profile?.email ?? null;

  const business_stream = resolveBusinessStream({
    tariff_offer_meta: (offerRow as any)?.meta ?? null,
    product_meta: (product as any)?.meta ?? null,
    link_business_stream: null,
  });

  const effectiveOrigin = origin || 'https://club.gorbova.by';
  const effectiveActorType = actor_type || 'system';
  const auditActorType = effectiveActorType === 'admin' ? 'user' : effectiveActorType;
  const paymentFlow = payment_type === 'one_time'
    ? (effectiveActorType === 'admin' ? 'admin_one_time' : 'public_one_time')
    : (effectiveActorType === 'admin' ? 'admin_subscription' : 'public_subscription');

  const urls = resolveStripeCheckoutUrls({
    connection_success_url: acct.success_url,
    connection_cancel_url: acct.cancel_url,
    test_mode: acct.test_mode,
    sandbox: false,
  });

  // ============================================================
  // ONE-TIME
  // ============================================================
  if (payment_type === 'one_time') {
    let amountMinor: number;
    try {
      amountMinor = toStripeMinorUnits(amountMajor, currency);
    } catch (e) {
      return { success: false, provider: 'stripe', error: e instanceof Error ? e.message : 'amount_conversion_failed' };
    }

    // CRM routing snapshot (parity with bePaid one_time)
    const routing = await resolveOfferRoutingWithFallback(supabase, { offer_id, tariff_id });
    const crmSnapshot = routing.ok && routing.snapshot
      ? routing.snapshot
      : buildNegativeSnapshot({
          reason: routing.reason || 'unknown',
          offer_id: offer_id ?? null,
          tariff_id,
          resolved_via: routing.resolved_via ?? 'none',
          candidates_count: routing.candidates_count ?? 0,
        });

    const { data: orderNumberData } = await supabase.rpc('generate_order_number');
    const orderNumber: string =
      (orderNumberData as string | null) || `ORD-STRIPE-LINK-${Date.now()}`;

    const accessDays = tariff.access_days || 30;
    const nowD = new Date();
    const plannedEnd = new Date(nowD);
    plannedEnd.setDate(plannedEnd.getDate() + accessDays);

    const orderMeta: Record<string, unknown> = {
      type: 'public_payment_link_stripe',
      description: description ?? null,
      created_by: actor_user_id ?? null,
      product_name: product.name,
      tariff_name: tariff.name,
      payment_flow: paymentFlow,
      crm_routing_snapshot: crmSnapshot,
      business_stream,
      stripe: {
        account_code: resolved_account_code,
      },
      ...(payment_link_id ? { payment_link_id } : {}),
      ...(meta_extra ?? {}),
    };

    const { data: order, error: orderError } = await supabase
      .from('orders_v2')
      .insert({
        order_number: orderNumber,
        user_id,
        profile_id: profileId,
        product_id,
        tariff_id,
        offer_id: offer_id || null,
        base_price: amountMajor,
        final_price: amountMajor,
        paid_amount: 0,
        currency: currency.toUpperCase(),
        status: 'pending',
        provider: 'stripe',
        customer_email: customerEmail ?? 'unknown@example.com',
        deal_date: new Date().toISOString(),
        meta: orderMeta,
        pipeline_id: routing.ok && routing.snapshot ? routing.snapshot.pipeline_id : null,
        pipeline_stage_id: routing.ok && routing.snapshot ? routing.snapshot.stage_on_pending : null,
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
          price: amountMajor,
          currency: currency.toUpperCase(),
          access_days: accessDays,
          planned_access_start_at: nowD.toISOString(),
          planned_access_end_at: plannedEnd.toISOString(),
          is_trial: false,
          extra: { payment_flow: paymentFlow, provider: 'stripe' },
        }),
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('[create-stripe-checkout] order insert failed', orderError);
      return { success: false, provider: 'stripe', error: 'order_insert_failed', detail: orderError?.message };
    }

    if (!routing.ok) {
      await auditNegativeSnapshot(supabase, {
        order_id: order.id,
        offer_id: offer_id ?? null,
        tariff_id,
        reason: routing.reason || 'unknown',
        resolved_via: routing.resolved_via ?? 'none',
        candidates_count: routing.candidates_count ?? 0,
      });
    }

    // ── Resolve Stripe Customer (best-effort: only if email known) ──
    // Reuses the same path admin uses; failure → email-only mode.
    let customer_id: string | null = null;
    try {
      if (customerEmail) {
        const sk = await readAcquiringSecret('stripe', resolved_account_code, 'secret_key');
        const { resolveStripeCustomer } = await import('./acquiring/stripe-customer-resolver.ts');
        const cust = await resolveStripeCustomer(supabase, sk, {
          user_id,
          account_code: resolved_account_code,
          email: customerEmail,
        });
        customer_id = cust.customer_id;
      }
    } catch (e) {
      await supabase.from('audit_logs').insert({
        action: 'stripe_customer_resolver_failed',
        actor_type: 'system',
        actor_label: 'create-stripe-checkout',
        entity_type: 'orders_v2',
        entity_id: order.id,
        meta: { error: e instanceof Error ? e.message : String(e), account_code: resolved_account_code, source: 'public-link' },
      });
    }

    const adapter = resolveAdapter('stripe', resolved_account_code);
    const adapterResult = await adapter.createCheckout({
      order_id: order.id,
      amount: amountMinor,
      currency: currency.toLowerCase(),
      description: description ?? `${product.name} — ${tariff.name}`,
      customer_email: customerEmail ?? undefined,
      customer_id,
      save_payment_method: false,
      return_url: urls.success_url,
      cancel_url: urls.cancel_url,
      is_one_time: true,
      metadata: {
        product_id,
        tariff_id,
        offer_id: offer_id ?? null,
        payment_link_id: payment_link_id ?? null,
        contact_id: null,
        user_id,
      },
      context: {
        provider: 'stripe',
        account_code: resolved_account_code,
        business_stream,
      },
    });

    if (!adapterResult.ok) {
      // Controlled FAIL — никакого bePaid fallback.
      await supabase
        .from('orders_v2')
        .update({
          status: 'failed',
          meta: { ...orderMeta, last_provider_error: { error: adapterResult.error, captured_at: new Date().toISOString(), flow: 'stripe_one_time' } },
        })
        .eq('id', order.id);
      await supabase.from('audit_logs').insert({
        action: 'stripe.checkout.declined',
        actor_type: 'system',
        actor_label: 'create-stripe-checkout',
        target_user_id: user_id,
        meta: {
          order_id: order.id,
          payment_type: 'one_time',
          payment_flow: paymentFlow,
          provider_error: adapterResult.error,
          account_code: resolved_account_code,
        },
      });
      return { success: false, provider: 'stripe', error: adapterResult.error ?? 'stripe_checkout_failed' };
    }

    // Update meta with session_id + customer_id (sticky)
    await supabase
      .from('orders_v2')
      .update({
        meta: {
          ...orderMeta,
          stripe: {
            account_code: resolved_account_code,
            checkout_session_id: adapterResult.session_id ?? null,
            customer_id: customer_id ?? null,
          },
        },
      })
      .eq('id', order.id);

    await supabase.from('audit_logs').insert({
      actor_type: auditActorType,
      actor_user_id: actor_user_id ?? null,
      target_user_id: user_id,
      action: `${effectiveActorType}.payment_link.created`,
      meta: {
        payment_type: 'one_time',
        order_id: order.id,
        amount: amountMajor,
        currency: currency.toUpperCase(),
        product_name: product.name,
        tariff_name: tariff.name,
        provider: 'stripe',
        account_code: resolved_account_code,
        checkout_session_id: adapterResult.session_id ?? null,
        payment_link_id: payment_link_id ?? null,
      },
    });

    return {
      success: true,
      provider: 'stripe',
      payment_type: 'one_time',
      redirect_url: adapterResult.redirect_url,
      order_id: order.id,
      order_number: orderNumber,
      checkout_session_id: adapterResult.session_id ?? undefined,
      account_code: resolved_account_code,
    };
  }

  // ============================================================
  // SUBSCRIPTION (orders_v2 НЕ создаём — Phase 3.1/3.2 контракт)
  // ============================================================
  if (!offer_id) {
    return { success: false, provider: 'stripe', error: 'subscription_requires_offer_id' };
  }
  if (!offerRow) {
    return { success: false, provider: 'stripe', error: 'tariff_offer_not_found' };
  }
  if (!(offerRow as any).is_active) {
    return { success: false, provider: 'stripe', error: 'tariff_offer_inactive' };
  }
  if ((offerRow as any).tariff_id !== tariff_id) {
    return { success: false, provider: 'stripe', error: 'tariff_offer_tariff_mismatch' };
  }
  const offerMeta = ((offerRow as any).meta ?? {}) as Record<string, unknown>;
  const stripeOnOffer = (offerMeta.stripe ?? {}) as Record<string, unknown>;
  const stripeAccountsOnOffer = (stripeOnOffer.accounts ?? {}) as Record<string, { product_id?: string; price_id?: string }>;
  const stripe_product_id =
    (stripeAccountsOnOffer[resolved_account_code]?.product_id as string | undefined)
    ?? (stripeOnOffer.product_id as string | undefined)
    ?? null;
  const offer_price_id = (stripeOnOffer.price_id as string | undefined) ?? null;

  // PATCH-SUB-PRICE-1 v2 — payment_link amount/currency override parity.
  // Если subscription checkout создаётся из payment_link, бизнес-SOT суммы —
  // payment_links.amount/currency (caller передал amountMajor + currency).
  // Игнорируем saved offer.meta.stripe.price_id и строим inline recurring price_data.
  const useInlinePrice = Boolean(payment_link_id);

  if (!useInlinePrice && !offer_price_id) {
    return { success: false, provider: 'stripe', error: 'stripe_price_missing_in_offer_meta' };
  }

  // Резолвим recurring period из offer.meta.recurring (canonical SOT).
  let inlineRecurring: { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number } | null = null;
  if (useInlinePrice) {
    const rec = (offerMeta.recurring ?? {}) as Record<string, unknown>;
    if (!rec || rec.is_recurring !== true) {
      return { success: false, provider: 'stripe', error: 'offer_not_recurring_for_subscription_link' };
    }
    const periodMode = String((rec.billing_period_mode as string) || 'days').toLowerCase();
    const periodN = Number(rec.billing_period_days ?? 0);
    if (!Number.isFinite(periodN) || periodN <= 0) {
      return { success: false, provider: 'stripe', error: 'unsupported_recurring_period_for_inline_price', detail: { periodMode, periodN } };
    }
    if (periodMode === 'days') {
      if (periodN === 30 || periodN === 31) inlineRecurring = { interval: 'month', interval_count: 1 };
      else if (periodN === 7) inlineRecurring = { interval: 'week', interval_count: 1 };
      else if (periodN === 365 || periodN === 366) inlineRecurring = { interval: 'year', interval_count: 1 };
      else if (periodN <= 365) inlineRecurring = { interval: 'day', interval_count: periodN };
      else return { success: false, provider: 'stripe', error: 'unsupported_recurring_period_for_inline_price', detail: { periodMode, periodN } };
    } else {
      return { success: false, provider: 'stripe', error: 'unsupported_recurring_period_for_inline_price', detail: { periodMode, periodN } };
    }
  }


  // Replacement vs duplicate guards (same contract as bePaid subscription branch).
  if (replacement_of_subscription_v2_id) {
    const repl = await validateReplacementSubscription(supabase, {
      replacement_of_subscription_v2_id,
      user_id,
      product_id,
      tariff_id,
    });
    if (repl.status === 'error') {
      return { success: false, provider: 'stripe', error: repl.error };
    }
  } else {
    const cls = await classifySameProductState(supabase, { user_id, product_id, tariff_id });
    if (cls.status === 'error') {
      return { success: false, provider: 'stripe', error: cls.error };
    }
    if (cls.decision === 'extend_same_tariff' && cls.existing) {
      const ex = cls.existing;
      return {
        success: false,
        provider: 'stripe',
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
      return {
        success: false,
        provider: 'stripe',
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
  }

  // Provider-aware pending checkout guard.
  const pendingCheck = await checkPendingCheckoutConflict(supabase, {
    user_id, product_id, tariff_id, provider: 'stripe',
  });
  if (pendingCheck.status === 'error') {
    return { success: false, provider: 'stripe', error: 'pending_check_failed' };
  }
  if (pendingCheck.status === 'pending_conflict' && pendingCheck.pending) {
    // Re-use checkout_url if pending session still present (same pattern as admin).
    const url = (pendingCheck.pending as any).checkout_url as string | undefined;
    if (url && typeof url === 'string' && url.startsWith('http')) {
      return {
        success: true,
        provider: 'stripe',
        payment_type: 'subscription',
        redirect_url: url,
        order_id: null,
        subscription_v2_id: (pendingCheck.pending as any).subscription_v2_id,
        account_code: resolved_account_code,
      };
    }
    // Otherwise return controlled conflict.
    return { success: false, provider: 'stripe', error: 'pending_conflict' };
  }

  let secret: string;
  try {
    secret = await readAcquiringSecret('stripe', resolved_account_code, 'secret_key');
  } catch (e) {
    return { success: false, provider: 'stripe', error: 'stripe_secret_read_failed', detail: String((e as Error)?.message ?? e) };
  }

  const preResult = await stripePreCreateSubscription({
    supabase,
    user_id,
    product_id,
    tariff_id,
    tariff_offer_id: offer_id,
    account_code: resolved_account_code,
    business_stream,
    customer_email: customerEmail,
    payment_link_id: payment_link_id ?? null,
    lifecycle_created_by: actor_type === 'admin' ? 'admin:public-checkout' : 'public-checkout',
    stripe_secret_key: secret,
    success_url: urls.success_url,
    cancel_url: urls.cancel_url,
    price_id,
    stripe_product_id,
    actor_user_id: actor_user_id ?? null,
  });

  if (!preResult.ok) {
    return {
      success: false,
      provider: 'stripe',
      error: preResult.error,
      detail: preResult.stripe_error ?? preResult.detail,
    };
  }

  await supabase.from('audit_logs').insert({
    actor_type: auditActorType,
    actor_user_id: actor_user_id ?? null,
    target_user_id: user_id,
    action: `${effectiveActorType}.payment_link.created`,
    meta: {
      payment_type: 'subscription',
      provider: 'stripe',
      subscription_v2_id: preResult.subscription_v2_id,
      provider_subscription_row_id: preResult.provider_subscription_row_id,
      checkout_session_id: preResult.checkout_session.id,
      product_name: product.name,
      tariff_name: tariff.name,
      account_code: resolved_account_code,
      payment_link_id: payment_link_id ?? null,
      note: 'orders_v2_deferred_to_invoice_paid',
    },
  });

  return {
    success: true,
    provider: 'stripe',
    payment_type: 'subscription',
    redirect_url: preResult.checkout_session.url,
    order_id: null,
    subscription_v2_id: preResult.subscription_v2_id,
    provider_subscription_row_id: preResult.provider_subscription_row_id,
    checkout_session_id: preResult.checkout_session.id,
    account_code: resolved_account_code,
  };
}
