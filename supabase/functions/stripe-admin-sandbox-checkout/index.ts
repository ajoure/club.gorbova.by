// PATCH Phase 2 (manual + currency-policy fix) — Admin-only Stripe Sandbox Checkout.
//
// Modes:
//   - "catalog" — product_id + (tariff_id/offer_id) — текущий путь через products_v2
//   - "manual"  — без product/tariff/offer; обязательны description, amount, currency, customer_email
//
// Currency whitelist (UI + backend): USD, EUR, PLN, BYN, RUB.
// BYN/RUB НЕ блокируются заранее — отдаём в Stripe; если Stripe откажет —
// маппим в { ok:false, code:'stripe_currency_rejected_by_stripe', stripe_message }.
//
// Order create order:
//   1) validate
//   2) resolve profile/user_id by email
//   3) create Stripe Checkout Session
//   4) ONLY on success → INSERT orders_v2 (status='pending', provider='stripe', meta.sandbox=true)
//   No more "pending без cs_*".
//
// Hard guards:
//   - super_admin only
//   - Stripe connection active AND test_mode=true
//
// FREEZE: bePaid, payment_links, create-payment-checkout.ts — не трогаем.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { resolveAdapter } from '../_shared/acquiring/index.ts';
import { resolveDefaultStripeAccount } from '../_shared/acquiring/default-account.ts';
import { resolveBusinessStream } from '../_shared/acquiring/business-stream-resolver.ts';
import { resolveStripeCheckoutUrls } from '../_shared/public-app-host.ts';
import { resolveStripeCustomer } from '../_shared/acquiring/stripe-customer-resolver.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

interface Body {
  mode?: 'manual' | 'catalog';
  // catalog
  product_id?: string;
  tariff_id?: string;
  offer_id?: string;
  // manual
  description?: string;
  // shared
  amount?: number;
  currency?: string;
  customer_email?: string;
  account_code?: string;
  // MP-A2-2: explicit save-PM flag. Catalog branch with resolved user_id may set true to
  // test pilot one-time saved-card flow. Manual branch ignores (no resolver, no user).
  save_payment_method?: boolean;
  // legacy simulation (kept for prior proof)
  simulate_order_id?: string;
}

const ALLOWED_CURRENCIES = new Set(['USD', 'EUR', 'PLN', 'BYN', 'RUB']);
const ZERO_DECIMAL = new Set<string>(['JPY', 'KRW', 'VND']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toMinorUnits(amountMajor: number, currency: string): number {
  if (ZERO_DECIMAL.has(currency)) return Math.round(amountMajor);
  return Math.round(amountMajor * 100);
}

function isCurrencyError(msg: string): boolean {
  const s = msg.toLowerCase();
  return (
    s.includes('currency') &&
    (s.includes('not supported') ||
      s.includes('invalid') ||
      s.includes('unsupported') ||
      s.includes('not allowed') ||
      s.includes('not a supported'))
  );
}

function safeStripeMessage(raw: string): string {
  // Strip anything that looks like a key/secret prefix
  return raw
    .replace(/sk_[A-Za-z0-9_]+/g, '[REDACTED]')
    .replace(/pk_[A-Za-z0-9_]+/g, '[REDACTED]')
    .replace(/whsec_[A-Za-z0-9_]+/g, '[REDACTED]')
    .slice(0, 500);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { user, supabase } = await requireSuperAdmin(req);
    const body = (await req.json()) as Body;

    // ---------- Legacy simulation branch (unchanged, kept for prior proof) ----------
    if (body.simulate_order_id) {
      const { data: order, error: orderErr } = await supabase
        .from('orders_v2')
        .select('id, order_number, provider, status, currency, final_price, customer_email, meta, user_id, profile_id, product_id, tariff_id, offer_id')
        .eq('id', body.simulate_order_id)
        .maybeSingle();
      if (orderErr || !order) return errorResponse('simulation_order_not_found', 404);
      const orderMeta = (order.meta ?? {}) as Record<string, unknown>;
      if (order.provider !== 'stripe' || orderMeta.sandbox !== true) {
        return errorResponse('simulation_requires_stripe_sandbox_order', 400);
      }
      let profileId = order.profile_id ?? null;
      let userId = order.user_id ?? null;
      const buyerEmail = order.customer_email ?? user.email ?? null;
      if ((!profileId || !userId) && buyerEmail) {
        const { data: profile } = await supabase
          .from('profiles').select('id, user_id').ilike('email', buyerEmail).maybeSingle();
        profileId = profile?.id ?? profileId;
        userId = profile?.user_id ?? userId;
      }
      if (!userId) return errorResponse('simulation_buyer_profile_not_found', 400);

      const providerPaymentId = `pi_sim_${String(order.id).replaceAll('-', '').slice(0, 24)}`;
      const eventId = `evt_sim_${String(order.id).replaceAll('-', '').slice(0, 24)}`;
      const amountMajor = Number(order.final_price ?? 0);
      if (!Number.isFinite(amountMajor) || amountMajor <= 0) return errorResponse('simulation_invalid_order_amount', 400);

      const { data: existingPayment } = await supabase
        .from('payments_v2').select('id')
        .eq('provider', 'stripe').eq('provider_payment_id', providerPaymentId).maybeSingle();
      let paymentId = existingPayment?.id ?? null;
      if (!paymentId) {
        const { data: payment, error: payErr } = await supabase
          .from('payments_v2').insert({
            order_id: order.id, user_id: userId, profile_id: profileId,
            provider: 'stripe', provider_payment_id: providerPaymentId,
            amount: amountMajor, currency: order.currency, status: 'succeeded',
            paid_at: new Date().toISOString(),
            meta: { stripe: { simulation: true, source: 'admin_stripe_sandbox_simulation' } },
          }).select('id').single();
        if (payErr || !payment) return errorResponse(`simulation_payment_create_failed:${payErr?.message ?? 'unknown'}`, 500);
        paymentId = payment.id;
      }
      await supabase.from('orders_v2').update({
        status: 'paid', paid_amount: amountMajor, provider_payment_id: providerPaymentId,
        user_id: userId, profile_id: profileId,
        meta: { ...orderMeta, sandbox_simulated_paid: true, sandbox_simulated_paid_at: new Date().toISOString() },
      }).eq('id', order.id);
      // MP-A2-1: resolve account_code via SOT (no hardcoded 'stripe_poland').
      const simAcct = await resolveDefaultStripeAccount(supabase, body.account_code);
      const { data: insertedEvent, error: eventErr } = await supabase
        .from('provider_events').insert({
          provider: 'stripe', account_code: simAcct.account_code,
          event_id: eventId, event_type: 'checkout.session.completed',
          idempotency_key: `stripe:simulation:${eventId}`,
          payload: { id: eventId, type: 'checkout.session.completed', simulated: true,
            data: { object: { id: `cs_sim_${String(order.id).replaceAll('-', '').slice(0, 24)}`, client_reference_id: order.id, payment_intent: providerPaymentId } } },
          signature_valid: true, processing_status: 'received',
          related_order_id: order.id, related_payment_id: paymentId,
        }).select('id').maybeSingle();
      if (eventErr && eventErr.code !== '23505') return errorResponse(`simulation_provider_event_failed:${eventErr.message}`, 500);
      const grant = await supabase.functions.invoke('grant-access-for-order', {
        body: { order_id: order.id, source: 'stripe_sandbox_simulation', provider: 'stripe' },
      });
      if (insertedEvent?.id) {
        await supabase.from('provider_events').update({
          processed_at: new Date().toISOString(),
          processing_status: grant.error ? 'failed' : 'processed',
          processing_error: grant.error?.message ?? null,
        }).eq('id', insertedEvent.id);
      }
      return jsonResponse({ ok: !grant.error, simulated: true, order_id: order.id });
    }

    // ---------- Mode detection ----------
    const mode: 'manual' | 'catalog' = body.mode
      ?? (body.product_id ? 'catalog' : 'manual');

    // ---------- Common validation ----------
    // MP-A2-1: resolve account via SOT — no hardcoded 'stripe_poland' fallback.
    const acct = await resolveDefaultStripeAccount(supabase, body.account_code);
    const account_code = acct.account_code;
    const currency = (body.currency ?? 'USD').toUpperCase();
    if (!ALLOWED_CURRENCIES.has(currency)) {
      return jsonResponse({ ok: false, code: 'currency_not_allowed', message: `Валюта ${currency} не во whitelist (USD/EUR/PLN/BYN/RUB).` });
    }
    const amountMajor = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
      return jsonResponse({ ok: false, code: 'invalid_amount', message: 'Сумма должна быть > 0.' });
    }
    const minorAmount = toMinorUnits(amountMajor, currency);
    if (!Number.isInteger(minorAmount) || minorAmount <= 0) {
      return jsonResponse({ ok: false, code: 'minor_units_conversion_failed' });
    }

    // ---------- Stripe connection guards (test_mode required for sandbox) ----------
    if (acct.status !== 'active') return errorResponse(`connection_not_active:${acct.status}`, 400);
    if (!acct.test_mode) {
      return jsonResponse({ ok: false, fallback: true, code: 'sandbox_checkout_requires_test_keys',
        message: 'Для тестовой оплаты нужны тестовые ключи Stripe (pk_test_/sk_test_).' });
    }

    // ---------- Mode-specific data ----------
    let productRow: { id: string; name: string; meta: Record<string, unknown> | null } | null = null;
    let tariffRow: { id: string; name: string } | null = null;
    let offerRow: { id: string; button_label: string; amount: number; meta: Record<string, unknown> | null } | null = null;
    let description = '';

    if (mode === 'catalog') {
      if (!body.product_id) return errorResponse('missing_product_id', 400);
      const { data: product } = await supabase
        .from('products_v2').select('id, name, meta').eq('id', body.product_id).maybeSingle();
      if (!product) return errorResponse('product_not_found', 404);
      productRow = {
        id: (product as any).id,
        name: (product as any).name,
        meta: ((product as any).meta as Record<string, unknown> | null) ?? null,
      };
      if (body.tariff_id) {
        const { data: t } = await supabase
          .from('tariffs').select('id, product_id, name').eq('id', body.tariff_id).maybeSingle();
        if (!t || t.product_id !== body.product_id) return errorResponse('tariff_mismatch', 400);
        tariffRow = { id: t.id, name: t.name };
      }
      if (body.offer_id) {
        const { data: o } = await supabase
          .from('tariff_offers').select('id, tariff_id, button_label, amount, is_active, meta')
          .eq('id', body.offer_id).maybeSingle();
        if (!o) return errorResponse('offer_not_found', 404);
        if (body.tariff_id && o.tariff_id !== body.tariff_id) return errorResponse('offer_mismatch', 400);
        if (o.is_active === false) return errorResponse('offer_inactive', 400);
        offerRow = {
          id: o.id,
          button_label: o.button_label,
          amount: Number(o.amount),
          meta: ((o as any).meta as Record<string, unknown> | null) ?? null,
        };
      }
      description = `[SANDBOX] ${productRow!.name}${tariffRow ? ` / ${tariffRow.name}` : ''}${offerRow ? ` / ${offerRow.button_label}` : ''}`;
    } else {
      // manual
      const desc = (body.description ?? '').trim();
      const emailRaw = (body.customer_email ?? '').trim();
      if (!desc) return errorResponse('missing_description', 400);
      if (!emailRaw || !EMAIL_RE.test(emailRaw)) return errorResponse('invalid_customer_email', 400);
      description = `[SANDBOX manual] ${desc}`;
    }

    // MP-A2-1: business_stream via SOT resolver. Manual mode → 'unspecified'.
    const businessStream = mode === 'catalog'
      ? resolveBusinessStream({
          tariff_offer_meta: offerRow?.meta ?? null,
          product_meta: productRow?.meta ?? null,
          link_business_stream: null,
        })
      : null;

    // MP-A2-1: redirect URLs — connection → PUBLIC_APP_HOST sandbox fallback, no example.com.
    const urls = resolveStripeCheckoutUrls({
      connection_success_url: acct.success_url,
      connection_cancel_url: acct.cancel_url,
      test_mode: acct.test_mode,
      sandbox: true,
    });

    // ---------- Resolve buyer profile ----------
    const customerEmail = (body.customer_email ?? user.email ?? '').trim() || null;
    let profileId: string | null = null;
    let userId: string | null = null;
    if (customerEmail) {
      const { data: profile } = await supabase
        .from('profiles').select('id, user_id').ilike('email', customerEmail).maybeSingle();
      profileId = profile?.id ?? null;
      userId = profile?.user_id ?? null;
    }

    // ---------- Generate order_number (kept for tracing in Stripe metadata) ----------
    const { data: orderNumber, error: onErr } = await supabase.rpc('generate_order_number');
    if (onErr || !orderNumber) return errorResponse('order_number_failed', 500);

    const preOrderId = crypto.randomUUID();

    // MP-A2-2: catalog branch may resolve a Stripe Customer when buyer profile is known.
    // Manual branch (no real user_id) MUST NOT create a Customer from email alone.
    let customer_id: string | null = null;
    if (mode === 'catalog' && userId && customerEmail) {
      try {
        const sk = await readAcquiringSecret('stripe', account_code, 'secret_key');
        const cust = await resolveStripeCustomer(supabase, sk, {
          user_id: userId,
          account_code,
          email: customerEmail,
        });
        customer_id = cust.customer_id;
      } catch (e) {
        await supabase.from('audit_logs').insert({
          action: 'stripe_customer_resolver_failed',
          entity_type: 'orders_v2',
          entity_id: preOrderId,
          meta: { error: e instanceof Error ? e.message : String(e), account_code, mode },
        });
      }
    }

    // ---------- Create Stripe Checkout Session FIRST ----------
    const adapter = resolveAdapter('stripe', account_code);
    const result = await adapter.createCheckout({
      order_id: preOrderId,
      amount: minorAmount,
      currency,
      description,
      customer_email: customerEmail ?? undefined,
      customer_id,
      // Save PM only when caller asked AND we have a customer (pilot one-time path).
      save_payment_method: body.save_payment_method === true && !!customer_id,
      return_url: urls.success_url,
      cancel_url: urls.cancel_url,
      is_one_time: true,
      metadata: {
        mode,
        // adapter contract requires non-empty product_id + tariff_id strings
        product_id: productRow?.id ?? 'sandbox_manual',
        tariff_id: tariffRow?.id ?? 'sandbox_manual',
        offer_id: offerRow?.id ?? '',
        sandbox: 'true',
        order_number: String(orderNumber),
        user_id: userId ?? '',
      },
      context: { provider: 'stripe', account_code, business_stream: businessStream },
    });

    if (!result.ok) {
      const errStr = safeStripeMessage(String(result.error ?? 'unknown'));
      if (isCurrencyError(errStr)) {
        return jsonResponse({
          ok: false, fallback: true,
          code: 'stripe_currency_rejected_by_stripe',
          stripe_message: errStr,
          currency,
          account_code,
        });
      }
      return jsonResponse({ ok: false, fallback: true, code: 'stripe_checkout_create_failed', stripe_message: errStr });
    }

    // ---------- INSERT orders_v2 ONLY after Stripe success ----------
    const meta: Record<string, unknown> = {
      sandbox: true,
      sandbox_source: 'admin_stripe_sandbox_checkout',
      checkout_mode: mode,
      created_by_user_id: user.user_id,
      account_code,
      minor_units: minorAmount,
      stripe_session_id: result.session_id,
      stripe_customer_id: customer_id,
      save_payment_method: body.save_payment_method === true && !!customer_id,
    };
    if (mode === 'manual') {
      meta.manual_description = body.description?.trim();
    }

    const { data: order, error: ordErr } = await supabase
      .from('orders_v2')
      .insert({
        id: preOrderId,
        order_number: orderNumber as string,
        product_id: productRow?.id ?? null,
        tariff_id: tariffRow?.id ?? null,
        offer_id: offerRow?.id ?? null,
        base_price: amountMajor,
        final_price: amountMajor,
        currency,
        status: 'pending',
        provider: 'stripe',
        provider_payment_id: result.session_id ?? null,
        customer_email: customerEmail,
        user_id: userId,
        profile_id: profileId,
        meta,
      })
      .select('id, order_number')
      .single();
    if (ordErr || !order) {
      // Order create failed AFTER Stripe Session created — surface error; the session will simply expire.
      return jsonResponse({
        ok: false, fallback: true, code: 'order_insert_failed_after_stripe',
        stripe_message: safeStripeMessage(ordErr?.message ?? 'unknown'),
        stripe_session_id: result.session_id,
      });
    }

    return jsonResponse({
      ok: true,
      url: result.redirect_url,
      session_id: result.session_id,
      order_id: order.id,
      order_number: order.order_number,
      amount: amountMajor,
      minor_units: minorAmount,
      currency,
      mode,
      stripe_customer_id: customer_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
