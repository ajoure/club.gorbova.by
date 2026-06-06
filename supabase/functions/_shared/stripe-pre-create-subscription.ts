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

export interface StripePreCreateSubscriptionParams {
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
  /** Цены/продукта price_id и stripe_product_id — резолвит вызывающий из tariff_offers.meta.stripe. */
  price_id: string;
  stripe_product_id: string | null;
  /** Опциональный actor_user_id для audit_logs (admin-функция передаёт user.user_id; public — null). */
  actor_user_id: string | null;
}

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
    price_id,
    stripe_product_id,
    actor_user_id,
  } = params;

  // ---- 1) Pre-create subscriptions_v2(pending) ----
  const subInsert = {
    user_id,
    product_id,
    tariff_id,
    status: 'pending' as const,
    billing_type: 'provider_managed' as const,
    auto_renew: false,
    access_start_at: new Date().toISOString(),
    meta: {
      stripe: {
        account_code,
        price_id,
        product_id: stripe_product_id,
        tariff_offer_id,
      },
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
    currency: 'BYN',
    meta: {
      stripe: {
        account_code,
        price_id,
        product_id: stripe_product_id,
        tariff_offer_id,
      },
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

  // ---- 3) Drift-check price (active + test + recurring) ----
  const priceCheck = await stripeGet(stripe_secret_key, `prices/${price_id}`);
  if (!priceCheck.ok) {
    await rollbackPending(supabase, subscription_v2_id, provider_subscription_row_id, 'price_retrieve_failed', actor_user_id, lifecycle_created_by);
    return { ok: false, error: 'price_retrieve_failed', stripe_error: priceCheck.data, rollback_done: true };
  }
  const p = priceCheck.data;
  const drift: string[] = [];
  if (!p.active) drift.push('inactive');
  if (p.livemode !== false) drift.push('livemode');
  if (!p.recurring) drift.push('not_recurring');
  if (drift.length > 0) {
    await rollbackPending(supabase, subscription_v2_id, provider_subscription_row_id, 'price_drift', actor_user_id, lifecycle_created_by);
    return { ok: false, error: 'price_drift_detected', detail: { drift }, rollback_done: true };
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
    'metadata[price_id]': price_id,
    'subscription_data[metadata][subscription_v2_id]': subscription_v2_id,
    'subscription_data[metadata][provider_subscription_row_id]': provider_subscription_row_id,
    'subscription_data[metadata][tariff_offer_id]': tariff_offer_id,
    'subscription_data[metadata][product_id]': product_id,
    'subscription_data[metadata][tariff_id]': tariff_id,
    'subscription_data[metadata][account_code]': account_code,
    'subscription_data[metadata][business_stream]': business_stream ?? '',
    'subscription_data[metadata][price_id]': price_id,
  };
  if (payment_link_id) {
    metaForm['metadata[payment_link_id]'] = payment_link_id;
    metaForm['subscription_data[metadata][payment_link_id]'] = payment_link_id;
  }

  const checkoutPayload: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': price_id,
    'line_items[0][quantity]': '1',
    client_reference_id: subscription_v2_id,
    success_url,
    cancel_url,
    ...metaForm,
  };
  if (customer_email) checkoutPayload.customer_email = customer_email;

  const csRes = await stripeForm(stripe_secret_key, 'checkout/sessions', checkoutPayload, idempotencyKey);
  if (!csRes.ok) {
    await rollbackPending(supabase, subscription_v2_id, provider_subscription_row_id, 'checkout_session_failed', actor_user_id, lifecycle_created_by);
    return { ok: false, error: 'checkout_session_create_failed', stripe_error: csRes.data, rollback_done: true };
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
      price_id,
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
