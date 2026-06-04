// Phase 3.1 Stage 1 — stripe-create-subscription-checkout
//
// Pre-create writer для Stripe Subscription Checkout.
//
// STRICT SCOPE (Stage 1):
//   - Создаёт subscriptions_v2(status='pending', billing_type='provider_managed')
//   - Создаёт provider_subscriptions(provider='stripe', state='pending',
//     provider_subscription_id='pending:{subscription_v2_id}')
//   - Создаёт Stripe Checkout Session (mode=subscription)
//   - Возвращает {url, session_id, subscription_v2_id, provider_subscription_row_id}
//
// EXPLICIT NON-GOALS:
//   - НЕ активирует подписку
//   - НЕ выдаёт доступ
//   - НЕ создаёт orders_v2 / payments_v2 / entitlements
//   - НЕ меняет stripe-webhook
//   - НЕ зовёт grant-access-for-order
//   - НЕ трогает bePaid
//
// На ошибку Stripe API — rollback pending rows.
// На успех — pending rows остаются, ждут Stage 2 webhook lifecycle.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { resolveDefaultStripeAccount } from '../_shared/acquiring/default-account.ts';
import { resolveBusinessStream } from '../_shared/acquiring/business-stream-resolver.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { resolveStripeCheckoutUrls } from '../_shared/public-app-host.ts';
import {
  checkPendingCheckoutConflict,
  checkSubscriptionConflict,
} from '../_shared/subscription-conflict.ts';

interface ReqBody {
  user_id: string;
  product_id: string;
  tariff_id: string;
  tariff_offer_id: string;
  account_code?: string;
  business_stream?: string | null;
  customer_email?: string;
  dry_run?: boolean;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let admin: ReturnType<typeof createClient> | null = null;
  let actor_user_id: string | null = null;

  try {
    const { user } = await requireSuperAdmin(req);
    actor_user_id = user.user_id;
    admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = (await req.json()) as ReqBody;
    const dryRun = body.dry_run === true;

    // ---- 1) Validate body ----
    for (const k of ['user_id', 'product_id', 'tariff_id', 'tariff_offer_id'] as const) {
      if (!body[k]) return json(400, { ok: false, error: `missing_${k}` });
    }

    // ---- 2) Resolve Stripe account (test-mode only) ----
    const acct = await resolveDefaultStripeAccount(admin, body.account_code);
    if (!acct.test_mode) {
      return json(422, { ok: false, error: 'stripe_account_not_test_mode', account_code: acct.account_code });
    }
    const account_code = acct.account_code;

    // ---- 3) Resolve offer + price_id from tariff_offers.meta.stripe.price_id ----
    const { data: offer } = await admin
      .from('tariff_offers')
      .select('id, tariff_id, meta, is_active')
      .eq('id', body.tariff_offer_id)
      .maybeSingle();
    if (!offer) return json(404, { ok: false, error: 'tariff_offer_not_found' });
    if (!(offer as any).is_active) return json(422, { ok: false, error: 'tariff_offer_inactive' });
    if ((offer as any).tariff_id !== body.tariff_id) {
      return json(422, { ok: false, error: 'tariff_offer_tariff_mismatch' });
    }
    const offerMeta = ((offer as any).meta ?? {}) as Record<string, unknown>;
    const stripeMetaOnOffer = (offerMeta.stripe ?? {}) as Record<string, unknown>;
    const price_id = (stripeMetaOnOffer.price_id as string | undefined) ?? null;
    const stripe_product_id = (stripeMetaOnOffer.product_id as string | undefined) ?? null;
    if (!price_id) return json(422, { ok: false, error: 'stripe_price_missing_in_offer_meta' });

    // ---- 4) Resolve business_stream (offer → product → body override) ----
    const { data: productRow } = await admin
      .from('products_v2')
      .select('meta')
      .eq('id', body.product_id)
      .maybeSingle();
    const business_stream = resolveBusinessStream({
      tariff_offer_meta: offerMeta,
      product_meta: (productRow as any)?.meta ?? null,
      link_business_stream: body.business_stream ?? null,
    });

    // ---- 5) checkPendingCheckoutConflict ----
    const pendingCheck = await checkPendingCheckoutConflict(admin, {
      user_id: body.user_id,
      product_id: body.product_id,
      tariff_id: body.tariff_id,
      provider: 'stripe',
    });
    if (pendingCheck.status === 'error') {
      return json(500, { ok: false, error: 'pending_check_failed', detail: pendingCheck.error });
    }
    if (pendingCheck.status === 'pending_conflict') {
      return json(409, { ok: false, error: 'pending_conflict', pending: pendingCheck.pending });
    }

    // ---- 6) active/trial duplicate guard ----
    // Spec says active/trial/past_due — но SOT helper checkSubscriptionConflict
    // покрывает только provider='bepaid' (исторически). Для Stripe Stage 1
    // добавляем provider-aware guard поверх того же датасета.
    const dupCheck = await checkSubscriptionConflict(admin, {
      user_id: body.user_id,
      product_id: body.product_id,
      tariff_id: body.tariff_id,
    });
    if (dupCheck.status === 'error') {
      return json(500, { ok: false, error: 'duplicate_check_failed', detail: dupCheck.error });
    }
    if (dupCheck.status === 'conflict') {
      return json(409, { ok: false, error: 'duplicate_subscription', conflict: dupCheck.conflict });
    }
    // 6.b) Stripe-aware active/trial duplicate guard
    const { data: activeRows } = await admin
      .from('subscriptions_v2')
      .select('id, status, tariff_id, access_end_at, next_charge_at')
      .eq('user_id', body.user_id)
      .eq('product_id', body.product_id)
      .in('status', ['active', 'trial']);
    const activeIds = ((activeRows as any[] | null) ?? []).map((r) => r.id);
    if (activeIds.length > 0) {
      const { data: stripeActive } = await admin
        .from('provider_subscriptions')
        .select('subscription_v2_id, state, provider, provider_subscription_id')
        .in('subscription_v2_id', activeIds)
        .eq('provider', 'stripe')
        .eq('state', 'active');
      const hit = ((stripeActive as any[] | null) ?? [])[0];
      if (hit) {
        const subRow = (activeRows as any[]).find((r) => r.id === hit.subscription_v2_id);
        return json(409, {
          ok: false,
          error: 'duplicate_subscription',
          conflict: {
            subscription_v2_id: hit.subscription_v2_id,
            status: subRow?.status,
            tariff_id: subRow?.tariff_id,
            provider: 'stripe',
            provider_subscription_id: hit.provider_subscription_id,
            access_end_at: subRow?.access_end_at ?? null,
            next_charge_at: subRow?.next_charge_at ?? null,
          },
        });
      }
    }
    // 6.c) past_due provider-managed guard (Stripe + bePaid, любая provider-связь)
    const { data: pastDueRows } = await admin
      .from('subscriptions_v2')
      .select('id, status')
      .eq('user_id', body.user_id)
      .eq('product_id', body.product_id)
      .eq('status', 'past_due');
    const pastDueIds = ((pastDueRows as any[] | null) ?? []).map((r) => r.id);
    if (pastDueIds.length > 0) {
      const { data: provRows } = await admin
        .from('provider_subscriptions')
        .select('subscription_v2_id, provider, state')
        .in('subscription_v2_id', pastDueIds);
      const blocking = ((provRows as any[] | null) ?? []).find(
        (p) => p.state === 'active' || p.state === 'past_due',
      );
      if (blocking) {
        return json(409, {
          ok: false,
          error: 'duplicate_past_due_subscription',
          subscription_v2_id: blocking.subscription_v2_id,
        });
      }
    }


    // ---- 7) DRY RUN preview ----
    const success_url = resolveStripeCheckoutUrls({
      connection_success_url: acct.success_url,
      connection_cancel_url: acct.cancel_url,
      test_mode: acct.test_mode,
      sandbox: false,
    });

    const planPreview = {
      account_code,
      price_id,
      stripe_product_id,
      business_stream,
      mode: 'subscription',
      success_url: success_url.success_url,
      cancel_url: success_url.cancel_url,
    };

    if (dryRun) {
      return json(200, {
        ok: true,
        mode: 'dry_run',
        plan: planPreview,
        pending_check: pendingCheck,
        duplicate_check: dupCheck,
      });
    }

    // ---- 8) Pre-create subscriptions_v2(pending) ----
    const subInsert = {
      user_id: body.user_id,
      product_id: body.product_id,
      tariff_id: body.tariff_id,
      status: 'pending' as const,
      billing_type: 'provider_managed' as const,
      auto_renew: false,
      access_start_at: new Date().toISOString(),
      meta: {
        stripe: {
          account_code,
          price_id,
          product_id: stripe_product_id,
          tariff_offer_id: body.tariff_offer_id,
        },
        business_stream,
        lifecycle: {
          created_by: 'stripe-create-subscription-checkout',
          created_at: new Date().toISOString(),
          stage: 'pending_pre_create',
        },
      },
    };

    const { data: subCreated, error: subErr } = await admin
      .from('subscriptions_v2')
      .insert(subInsert)
      .select('id')
      .single();
    if (subErr || !subCreated) {
      console.error('[stripe-create-subscription-checkout] sub insert failed', subErr);
      return json(500, { ok: false, error: 'subscriptions_v2_insert_failed', detail: subErr?.message });
    }
    const subscription_v2_id = (subCreated as any).id as string;

    // ---- 9) Pre-create provider_subscriptions(pending placeholder) ----
    // provider_subscription_id LIKE 'pending:%' соответствует фильтру cleanup-функции.
    const provInsert = {
      provider: 'stripe',
      provider_subscription_id: `pending:${subscription_v2_id}`,
      user_id: body.user_id,
      subscription_v2_id,
      state: 'pending',
      currency: 'BYN',
      meta: {
        stripe: {
          account_code,
          price_id,
          product_id: stripe_product_id,
          tariff_offer_id: body.tariff_offer_id,
        },
        stage: 'pending_pre_create',
        business_stream,
      },
    };
    const { data: provCreated, error: provErr } = await admin
      .from('provider_subscriptions')
      .insert(provInsert)
      .select('id')
      .single();
    if (provErr || !provCreated) {
      // Rollback sub
      await admin.from('subscriptions_v2').delete().eq('id', subscription_v2_id);
      return json(500, { ok: false, error: 'provider_subscriptions_insert_failed', detail: provErr?.message });
    }
    const provider_subscription_row_id = (provCreated as any).id as string;

    // ---- 10) Stripe Checkout Session create (mode=subscription) ----
    let secret: string;
    try {
      secret = await readAcquiringSecret('stripe', account_code, 'secret_key');
    } catch (e) {
      await rollbackPending(admin, subscription_v2_id, provider_subscription_row_id, 'secret_read_failed');
      return json(500, { ok: false, error: 'stripe_secret_read_failed', detail: String((e as Error)?.message ?? e) });
    }

    // Drift-check price (active+test+recurring) перед Checkout.
    const priceCheck = await stripeGet(secret, `prices/${price_id}`);
    if (!priceCheck.ok) {
      await rollbackPending(admin, subscription_v2_id, provider_subscription_row_id, 'price_retrieve_failed');
      return json(422, { ok: false, error: 'price_retrieve_failed', stripe_error: priceCheck.data });
    }
    const p = priceCheck.data;
    const drift: string[] = [];
    if (!p.active) drift.push('inactive');
    if (p.livemode !== false) drift.push('livemode');
    if (!p.recurring) drift.push('not_recurring');
    if (drift.length > 0) {
      await rollbackPending(admin, subscription_v2_id, provider_subscription_row_id, 'price_drift');
      return json(422, { ok: false, error: 'price_drift_detected', drift });
    }

    const idempotencyKey = `subv2:${subscription_v2_id}:create`;
    const metaForm: Record<string, string> = {
      'metadata[subscription_v2_id]': subscription_v2_id,
      'metadata[provider_subscription_row_id]': provider_subscription_row_id,
      'metadata[tariff_offer_id]': body.tariff_offer_id,
      'metadata[product_id]': body.product_id,
      'metadata[tariff_id]': body.tariff_id,
      'metadata[account_code]': account_code,
      'metadata[business_stream]': business_stream ?? '',
      'metadata[price_id]': price_id,
      'subscription_data[metadata][subscription_v2_id]': subscription_v2_id,
      'subscription_data[metadata][provider_subscription_row_id]': provider_subscription_row_id,
      'subscription_data[metadata][tariff_offer_id]': body.tariff_offer_id,
      'subscription_data[metadata][product_id]': body.product_id,
      'subscription_data[metadata][tariff_id]': body.tariff_id,
      'subscription_data[metadata][account_code]': account_code,
      'subscription_data[metadata][business_stream]': business_stream ?? '',
      'subscription_data[metadata][price_id]': price_id,
    };

    const checkoutPayload: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': price_id,
      'line_items[0][quantity]': '1',
      client_reference_id: subscription_v2_id,
      success_url: success_url.success_url,
      cancel_url: success_url.cancel_url,
      ...metaForm,
    };
    if (body.customer_email) checkoutPayload.customer_email = body.customer_email;

    const csRes = await stripeForm(secret, 'checkout/sessions', checkoutPayload, idempotencyKey);
    if (!csRes.ok) {
      await rollbackPending(admin, subscription_v2_id, provider_subscription_row_id, 'checkout_session_failed');
      return json(502, {
        ok: false,
        error: 'checkout_session_create_failed',
        stripe_error: csRes.data,
      });
    }
    const cs = csRes.data;

    // ---- 11) Write checkout_session_id to meta ----
    const subMetaUpdate = {
      ...(subInsert.meta),
      stripe: {
        ...(subInsert.meta.stripe),
        checkout_session_id: cs.id,
      },
      lifecycle: {
        ...(subInsert.meta.lifecycle),
        stage: 'pending_checkout_created',
        checkout_session_id: cs.id,
      },
    };
    await admin
      .from('subscriptions_v2')
      .update({ meta: subMetaUpdate })
      .eq('id', subscription_v2_id);

    const provMetaUpdate = {
      ...(provInsert.meta),
      stripe: {
        ...(provInsert.meta.stripe),
        checkout_session_id: cs.id,
      },
      stage: 'pending_checkout_created',
    };
    await admin
      .from('provider_subscriptions')
      .update({ meta: provMetaUpdate })
      .eq('id', provider_subscription_row_id);

    // ---- 12) Audit ----
    await admin.from('audit_logs').insert({
      action: 'stripe.subscription_checkout.pre_create',
      actor_user_id,
      actor_type: 'user',
      actor_label: 'super_admin:stripe-create-subscription-checkout',
      entity_type: 'subscriptions_v2',
      entity_id: subscription_v2_id,
      meta: {
        subscription_v2_id,
        provider_subscription_row_id,
        checkout_session_id: cs.id,
        account_code,
        price_id,
        tariff_offer_id: body.tariff_offer_id,
        business_stream,
        idempotency_key: idempotencyKey,
      },
    });

    return json(200, {
      ok: true,
      mode: 'execute',
      subscription_v2_id,
      provider_subscription_row_id,
      checkout_session: {
        id: cs.id,
        url: cs.url,
        status: cs.status,
        livemode: cs.livemode,
        expires_at: cs.expires_at,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.startsWith('unauthorized') ? 401 : msg.startsWith('forbidden') ? 403 : 500;
    console.error('[stripe-create-subscription-checkout] unhandled', msg);
    return json(status, { ok: false, error: msg });
  }
});

async function rollbackPending(
  admin: ReturnType<typeof createClient>,
  subscription_v2_id: string,
  provider_subscription_row_id: string,
  reason: string,
) {
  try {
    await admin
      .from('provider_subscriptions')
      .delete()
      .eq('id', provider_subscription_row_id)
      .eq('state', 'pending');
    await admin
      .from('subscriptions_v2')
      .delete()
      .eq('id', subscription_v2_id)
      .eq('status', 'pending');
    await admin.from('audit_logs').insert({
      action: 'stripe.subscription_checkout.pre_create_rollback',
      actor_type: 'system',
      entity_type: 'subscriptions_v2',
      entity_id: subscription_v2_id,
      meta: { reason, subscription_v2_id, provider_subscription_row_id },
    });
  } catch (e) {
    console.error('[stripe-create-subscription-checkout] rollback failed', e);
  }
}
