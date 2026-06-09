// Phase 4.1 — Shared helper: pre-create Stripe Subscription Checkout.
//
// Извлечено из supabase/functions/stripe-create-subscription-checkout/index.ts
// (шаги 8–11 + rollback). Поведение байт-в-байт идентично admin-функции.
// Auth / duplicate guards выполняет вызывающий, helper их НЕ дублирует.
//
// КОНТРАКТ:
//   - НЕ создаёт orders_v2 / payments_v2 / entitlements / access_rules.
//   - Создаёт subscriptions_v2(status='pending', billing_type='provider_managed')
//   - Создаёт provider_subscriptions(provider='stripe', state='pending',
//     provider_subscription_id='pending:{subscription_v2_id}')
//   - Создаёт Stripe Checkout Session (mode=subscription) и сохраняет session_id
//     в meta обеих pending-строк.
//   - При неудаче Stripe — rollback pending rows + audit.
//   - Если передан payment_link_id — кладёт его в metadata Session и subscription_data.
//
// SCOPE NON-GOALS:
//   - НЕ активирует подписку, НЕ выдаёт доступ.
//   - НЕ зовёт stripe-webhook, grant-access-for-order, bePaid.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveStripeCheckoutUrls } from './public-app-host.ts';
import { toStripeMinorUnits } from './stripe-minor-units.ts';

/**
 * INLINE PRICE (PATCH-SUB-PRICE-1 v2):
 * Если caller передал inline_price вместо price_id, Stripe Checkout Session
 * создаётся с line_items[0][price_data][...] — recurring price строится прямо
 * под конкретную payment_link.amount/currency. saved tariff_offers.meta.stripe.price_id
 * НЕ используется и НЕ retrieve'ится (drift-check скипается).
 *
 * Это нужно для parity с bePaid/e-clearing/Pay payment links: бизнес-SOT суммы =
 * payment_links.amount/currency, а не глобальная цена offer.
 */
export interface InlineStripePriceInput {
  amount_major: number;
  currency: string; // 3-letter, UPPER
  interval: 'day' | 'week' | 'month' | 'year';
  interval_count: number;
  /** prod_… — если уже есть в Stripe account, reuse чтобы не плодить лишних Stripe Products. */
  product_id?: string | null;
  /** Используется только если product_id не передан (Stripe создаст on-the-fly product). */
  product_name?: string;
}

export type StripePreCreateSubscriptionParams = {
  supabase: SupabaseClient;
  user_id: string;
  product_id: string;
  tariff_id: string;
  tariff_offer_id: string;
  account_code: string;
  business_stream: string | null;
  /** Только для Checkout Session — кладётся в customer_email, если customer_id не нужен. */
  customer_email?: string | null;
  /** Public-link path — пробрасываем в metadata Session и subscription_data. */
  payment_link_id?: string | null;
  /** Произвольный helper-вызвавший (для audit и lifecycle.created_by). */
  lifecycle_created_by: string;
  /** Stripe credentials + redirect URLs — резолвит вызывающий (он уже сделал test_mode guard). */
  stripe_secret_key: string;
  success_url: string;
  cancel_url: string;
  /** Опциональный actor_user_id для audit_logs (admin-функция передаёт user.user_id; public — null). */
  actor_user_id: string | null;
  /** stripe_product_id из offer.meta.stripe — для inline path можно использовать как price_data[product]. */
  stripe_product_id: string | null;
} & (
  | {
      /** Canonical saved Stripe price — drift-check выполняется. */
      price_id: string;
      inline_price?: undefined;
    }
  | {
      /** Inline custom price_data — для payment_link override. drift-check скипается. */
      price_id?: undefined;
      inline_price: InlineStripePriceInput;
    }
);

export interface StripePreCreateSubscriptionSuccess {
  ok: true;
  subscription_v2_id: string;
  provider_subscription_row_id: string;
  checkout_session: {
    id: string;
    url: string;
    status: string | null;
    livemode: boolean | null;
    expires_at: number | null;
  };
}

export interface StripePreCreateSubscriptionError {
  ok: false;
  error: string;
  detail?: unknown;
  stripe_error?: unknown;
  rollback_done?: boolean;
}

export type StripePreCreateSubscriptionResult =
  | StripePreCreateSubscriptionSuccess
  | StripePreCreateSubscriptionError;

async function stripeForm(
  secret: string,
  path: string,
  body: Record<string, string>,
  idempotencyKey: string,
): Promise<{ ok: boolean; status: number; data: any }> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: form.toString(),
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function stripeGet(secret: string, path: string): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function rollbackPending(
  supabase: SupabaseClient,
  subscription_v2_id: string,
  provider_subscription_row_id: string,
  reason: string,
  actor_user_id: string | null,
  lifecycle_created_by: string,
) {
  try {
    await supabase
      .from('provider_subscriptions')
      .delete()
      .eq('id', provider_subscription_row_id)
      .eq('state', 'pending');
    await supabase
      .from('subscriptions_v2')
      .delete()
      .eq('id', subscription_v2_id)
      .eq('status', 'pending');
    await supabase.from('audit_logs').insert({
      action: 'stripe.subscription_checkout.pre_create_rollback',
      actor_type: actor_user_id ? 'user' : 'system',
      actor_user_id,
      actor_label: lifecycle_created_by,
      entity_type: 'subscriptions_v2',
      entity_id: subscription_v2_id,
      meta: { reason, subscription_v2_id, provider_subscription_row_id },
    });
  } catch (e) {
    console.error('[stripe-pre-create-subscription] rollback failed', e);
  }
}

export async function stripePreCreateSubscription(
  params: StripePreCreateSubscriptionParams,
): Promise<StripePreCreateSubscriptionResult> {
  const {
    supabase,
    user_id,
    product_id,
    tariff_id,
    tariff_offer_id,
    account_code,
    business_stream,
    customer_email,
    payment_link_id,
    lifecycle_created_by,
    stripe_secret_key,
    success_url,
    cancel_url,
    stripe_product_id,
    actor_user_id,
  } = params;
  const price_id = (params as { price_id?: string }).price_id ?? null;
  const inline_price = (params as { inline_price?: InlineStripePriceInput }).inline_price ?? null;

  if (!price_id && !inline_price) {
    return { ok: false, error: 'missing_price_input' };
  }
  if (price_id && inline_price) {
    return { ok: false, error: 'conflicting_price_inputs' };
  }

  // Precompute inline amount in minor units (fail fast before any DB write).
  let inlineAmountMinor: number | null = null;
  let inlineCurrencyLower: string | null = null;
  if (inline_price) {
    try {
      inlineAmountMinor = toStripeMinorUnits(inline_price.amount_major, inline_price.currency);
    } catch (e) {
      return {
        ok: false,
        error: 'inline_amount_invalid',
        detail: e instanceof Error ? e.message : String(e),
      };
    }
    inlineCurrencyLower = String(inline_price.currency).toLowerCase();
  }

  // ---- 1) Pre-create subscriptions_v2(pending) ----
  const stripeMetaSnapshot: Record<string, unknown> = inline_price
    ? {
        account_code,
        price_id: null,
        // PATCH-SUB-PRICE-2: inline-product изолирован от saved meta.stripe.product_id —
        // Stripe создаст product по product_data.name в нужном mode/account.
        product_id: null,
        tariff_offer_id,
        inline_price: {
          amount_major: inline_price.amount_major,
          amount_minor: inlineAmountMinor,
          currency: inline_price.currency.toUpperCase(),
          interval: inline_price.interval,
          interval_count: inline_price.interval_count,
          source: 'payment_link',
          product_source: 'inline_product_data',
        },
      }
    : {
        account_code,
        price_id,
        product_id: stripe_product_id,
        tariff_offer_id,
      };

  const subInsert = {
    user_id,
    product_id,
    tariff_id,
    status: 'pending' as const,
    billing_type: 'provider_managed' as const,
    auto_renew: false,
    access_start_at: new Date().toISOString(),
    meta: {
      stripe: stripeMetaSnapshot,
      business_stream,
      lifecycle: {
        created_by: lifecycle_created_by,
        created_at: new Date().toISOString(),
        stage: 'pending_pre_create',
      },
      ...(payment_link_id ? { payment_link_id } : {}),
    },
  };

  const { data: subCreated, error: subErr } = await supabase
    .from('subscriptions_v2')
    .insert(subInsert)
    .select('id')
    .single();
  if (subErr || !subCreated) {
    console.error('[stripe-pre-create-subscription] sub insert failed', subErr);
    return { ok: false, error: 'subscriptions_v2_insert_failed', detail: subErr?.message };
  }
  const subscription_v2_id = (subCreated as any).id as string;

  // ---- 2) Pre-create provider_subscriptions(pending placeholder) ----
  const provInsert = {
    provider: 'stripe',
    provider_subscription_id: `pending:${subscription_v2_id}`,
    user_id,
    subscription_v2_id,
    state: 'pending',
    currency: inline_price ? inline_price.currency.toUpperCase() : 'BYN',
    meta: {
      stripe: stripeMetaSnapshot,
      stage: 'pending_pre_create',
      business_stream,
      ...(payment_link_id ? { payment_link_id } : {}),
    },
  };
  const { data: provCreated, error: provErr } = await supabase
    .from('provider_subscriptions')
    .insert(provInsert)
    .select('id')
    .single();
  if (provErr || !provCreated) {
    await supabase.from('subscriptions_v2').delete().eq('id', subscription_v2_id);
    return { ok: false, error: 'provider_subscriptions_insert_failed', detail: provErr?.message };
  }
  const provider_subscription_row_id = (provCreated as any).id as string;

  // ---- 3) Drift-check price (only for saved price_id path) ----
  if (price_id) {
    const priceCheck = await stripeGet(stripe_secret_key, `prices/${price_id}`);
    if (!priceCheck.ok) {
      await rollbackPending(supabase, subscription_v2_id, provider_subscription_row_id, 'price_retrieve_failed', actor_user_id, lifecycle_created_by);
      return { ok: false, error: 'price_retrieve_failed', stripe_error: priceCheck.data, rollback_done: true };
    }
    const p = priceCheck.data;
    const drift: string[] = [];
    if (!p.active) drift.push('inactive');
    // NOTE: drift на livemode сохраняется как в исходной логике (legacy test offers).
    if (p.livemode !== false) drift.push('livemode');
    if (!p.recurring) drift.push('not_recurring');
    if (drift.length > 0) {
      await rollbackPending(supabase, subscription_v2_id, provider_subscription_row_id, 'price_drift', actor_user_id, lifecycle_created_by);
      return { ok: false, error: 'price_drift_detected', detail: { drift }, rollback_done: true };
    }
  }

  // ---- 4) Stripe Checkout Session create (mode=subscription) ----
  const idempotencyKey = `subv2:${subscription_v2_id}:create`;
  const metaForm: Record<string, string> = {
    'metadata[subscription_v2_id]': subscription_v2_id,
    'metadata[provider_subscription_row_id]': provider_subscription_row_id,
    'metadata[tariff_offer_id]': tariff_offer_id,
    'metadata[product_id]': product_id,
    'metadata[tariff_id]': tariff_id,
    'metadata[account_code]': account_code,
    'metadata[business_stream]': business_stream ?? '',
    'metadata[price_id]': price_id ?? '',
    'subscription_data[metadata][subscription_v2_id]': subscription_v2_id,
    'subscription_data[metadata][provider_subscription_row_id]': provider_subscription_row_id,
    'subscription_data[metadata][tariff_offer_id]': tariff_offer_id,
    'subscription_data[metadata][product_id]': product_id,
    'subscription_data[metadata][tariff_id]': tariff_id,
    'subscription_data[metadata][account_code]': account_code,
    'subscription_data[metadata][business_stream]': business_stream ?? '',
    'subscription_data[metadata][price_id]': price_id ?? '',
  };
  if (inline_price) {
    const inlineMeta: Record<string, string> = {
      'metadata[inline_price]': '1',
      'metadata[inline_amount_minor]': String(inlineAmountMinor),
      'metadata[inline_currency]': inline_price.currency.toUpperCase(),
      'metadata[inline_interval]': inline_price.interval,
      'metadata[inline_interval_count]': String(inline_price.interval_count),
      'subscription_data[metadata][inline_price]': '1',
      'subscription_data[metadata][inline_amount_minor]': String(inlineAmountMinor),
      'subscription_data[metadata][inline_currency]': inline_price.currency.toUpperCase(),
      'subscription_data[metadata][inline_interval]': inline_price.interval,
      'subscription_data[metadata][inline_interval_count]': String(inline_price.interval_count),
    };
    Object.assign(metaForm, inlineMeta);
  }
  if (payment_link_id) {
    metaForm['metadata[payment_link_id]'] = payment_link_id;
    metaForm['subscription_data[metadata][payment_link_id]'] = payment_link_id;
  }

  const checkoutPayload: Record<string, string> = {
    mode: 'subscription',
    client_reference_id: subscription_v2_id,
    success_url,
    cancel_url,
    ...metaForm,
  };
  if (inline_price) {
    checkoutPayload['line_items[0][quantity]'] = '1';
    checkoutPayload['line_items[0][price_data][currency]'] = inlineCurrencyLower!;
    checkoutPayload['line_items[0][price_data][unit_amount]'] = String(inlineAmountMinor);
    checkoutPayload['line_items[0][price_data][recurring][interval]'] = inline_price.interval;
    checkoutPayload['line_items[0][price_data][recurring][interval_count]'] = String(inline_price.interval_count);
    // PATCH-SUB-PRICE-2: ВСЕГДА используем product_data.name, никогда не реюзаем saved product_id.
    // Saved id может быть test-mode, а ключ live (или наоборот) → checkout_session_create_failed.
    // Stripe создаст inline product в нужном mode/account автоматически.
    checkoutPayload['line_items[0][price_data][product_data][name]'] =
      inline_price.product_name || 'Subscription';
  } else {
    checkoutPayload['line_items[0][price]'] = price_id!;
    checkoutPayload['line_items[0][quantity]'] = '1';
  }
  if (customer_email) checkoutPayload.customer_email = customer_email;

  const csRes = await stripeForm(stripe_secret_key, 'checkout/sessions', checkoutPayload, idempotencyKey);
  if (!csRes.ok) {
    await rollbackPending(supabase, subscription_v2_id, provider_subscription_row_id, 'checkout_session_failed', actor_user_id, lifecycle_created_by);
    // Маппим Stripe 400 на currency mismatch в понятный код.
    const stripeMsg = String(csRes.data?.error?.message || '').toLowerCase();
    const stripeCode = String(csRes.data?.error?.code || '');
    let mappedError = 'checkout_session_create_failed';
    if (stripeMsg.includes('currency') && (stripeMsg.includes('support') || stripeMsg.includes('not') || stripeCode === 'currency_not_supported')) {
      mappedError = 'currency_not_supported_by_stripe_account';
    }
    return { ok: false, error: mappedError, stripe_error: csRes.data, rollback_done: true };
  }
  const cs = csRes.data;

  // ---- 5) Write checkout_session_id to meta ----
  const subMetaUpdate = {
    ...(subInsert.meta as Record<string, unknown>),
    stripe: {
      ...((subInsert.meta as any).stripe),
      checkout_session_id: cs.id,
    },
    lifecycle: {
      ...((subInsert.meta as any).lifecycle),
      stage: 'pending_checkout_created',
      checkout_session_id: cs.id,
    },
  };
  await supabase
    .from('subscriptions_v2')
    .update({ meta: subMetaUpdate })
    .eq('id', subscription_v2_id);

  const provMetaUpdate = {
    ...(provInsert.meta as Record<string, unknown>),
    stripe: {
      ...((provInsert.meta as any).stripe),
      checkout_session_id: cs.id,
    },
    stage: 'pending_checkout_created',
  };
  await supabase
    .from('provider_subscriptions')
    .update({ meta: provMetaUpdate })
    .eq('id', provider_subscription_row_id);

  // ---- 6) Audit ----
  await supabase.from('audit_logs').insert({
    action: 'stripe.subscription_checkout.pre_create',
    actor_user_id,
    actor_type: actor_user_id ? 'user' : 'system',
    actor_label: lifecycle_created_by,
    entity_type: 'subscriptions_v2',
    entity_id: subscription_v2_id,
    meta: {
      subscription_v2_id,
      provider_subscription_row_id,
      checkout_session_id: cs.id,
      account_code,
      price_id: price_id ?? null,
      inline_price: inline_price
        ? {
            amount_major: inline_price.amount_major,
            amount_minor: inlineAmountMinor,
            currency: inline_price.currency.toUpperCase(),
            interval: inline_price.interval,
            interval_count: inline_price.interval_count,
            product_id: inline_price.product_id ?? stripe_product_id ?? null,
          }
        : null,
      tariff_offer_id,
      business_stream,
      idempotency_key: idempotencyKey,
      payment_link_id: payment_link_id ?? null,
    },
  });

  return {
    ok: true,
    subscription_v2_id,
    provider_subscription_row_id,
    checkout_session: {
      id: cs.id,
      url: cs.url,
      status: cs.status ?? null,
      livemode: cs.livemode ?? null,
      expires_at: cs.expires_at ?? null,
    },
  };
}

// Re-export for callers that want consistent URL resolution alongside this helper.
export { resolveStripeCheckoutUrls };
