// PATCH Phase 2 (fix) — Admin-only Stripe Sandbox Checkout.
//
// Scope:
//   - Creates a test orders_v2 (provider='stripe', status='pending', meta.sandbox=true)
//   - Calls Stripe adapter to open a real sandbox Checkout Session
//   - Supports offer-based amount AND manual-amount sandbox fallback
//   - Returns { url, session_id, order_id }
//
// Hard guards:
//   - super_admin only
//   - Stripe connection MUST be active AND test_mode=true
//   - Does NOT touch bePaid, payment_links, create-payment-checkout.ts
//
// Add-only.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { resolveAdapter } from '../_shared/acquiring/index.ts';

interface Body {
  product_id: string;
  tariff_id?: string;
  offer_id?: string;
  amount?: number;
  currency?: string;
  customer_email?: string;
  account_code?: string;
  sandbox_fallback?: boolean;
}

const ALLOWED_CURRENCIES = new Set(['USD', 'EUR', 'PLN', 'BYN']);
// Stripe minor-unit conventions (ISO 4217 default ×100; zero-decimal exceptions exist
// but none of our whitelisted currencies are zero-decimal).
const ZERO_DECIMAL = new Set<string>(['JPY', 'KRW', 'VND']);

function toMinorUnits(amountMajor: number, currency: string): number {
  if (ZERO_DECIMAL.has(currency)) return Math.round(amountMajor);
  // Round-half-away-from-zero via Math.round on (×100)
  return Math.round(amountMajor * 100);
}

function isCurrencyError(msg: string): boolean {
  const s = msg.toLowerCase();
  return (
    s.includes('currency') &&
    (s.includes('not supported') ||
      s.includes('invalid') ||
      s.includes('unsupported') ||
      s.includes('not allowed'))
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { user, supabase } = await requireSuperAdmin(req);
    const body = (await req.json()) as Body;

    if (!body.product_id) return errorResponse('missing_product_id', 400);

    const account_code = body.account_code ?? 'stripe_poland';
    const currency = (body.currency ?? 'USD').toUpperCase();
    if (!ALLOWED_CURRENCIES.has(currency)) {
      return errorResponse(`currency_not_allowed:${currency}`, 400);
    }

    // 1) Resolve Stripe connection & enforce test_mode
    const { data: conn, error: connErr } = await supabase
      .from('acquiring_connections')
      .select('*')
      .eq('provider', 'stripe')
      .eq('account_code', account_code)
      .maybeSingle();
    if (connErr || !conn) return errorResponse('connection_not_found', 404);
    if (conn.status !== 'active') return errorResponse(`connection_not_active:${conn.status}`, 400);
    if (!conn.test_mode) {
      return jsonResponse({
        ok: false,
        fallback: true,
        code: 'sandbox_checkout_requires_test_keys',
        message:
          'Для тестовой оплаты нужны ключи тестового режима Stripe (pk_test_/sk_test_).',
      });
    }

    // 2) Resolve product (required)
    const { data: product } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', body.product_id)
      .maybeSingle();
    if (!product) return errorResponse('product_not_found', 404);

    // 3) Resolve tariff/offer if provided; otherwise sandbox-fallback path
    let tariff: { id: string; product_id: string; name: string } | null = null;
    let offer: { id: string; tariff_id: string; button_label: string; amount: number; is_active: boolean | null } | null = null;

    if (body.tariff_id) {
      const { data: t } = await supabase
        .from('tariffs')
        .select('id, product_id, name')
        .eq('id', body.tariff_id)
        .maybeSingle();
      if (!t || t.product_id !== body.product_id) {
        return errorResponse('tariff_mismatch', 400);
      }
      tariff = t as any;
    }

    if (body.offer_id) {
      const { data: o } = await supabase
        .from('tariff_offers')
        .select('id, tariff_id, button_label, amount, is_active')
        .eq('id', body.offer_id)
        .maybeSingle();
      if (!o) return errorResponse('offer_not_found', 404);
      if (body.tariff_id && o.tariff_id !== body.tariff_id) return errorResponse('offer_mismatch', 400);
      if (o.is_active === false) return errorResponse('offer_inactive', 400);
      offer = o as any;
    }

    // Determine final amount (major units)
    let amountMajor: number;
    let amountSource: 'offer' | 'override' | 'manual' = 'offer';
    let originalOfferAmount: number | null = null;

    const bodyAmount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    const bodyAmountValid = Number.isFinite(bodyAmount) && bodyAmount > 0;

    if (offer) {
      const offerAmount = Number(offer.amount);
      if (bodyAmountValid && Math.abs(bodyAmount - offerAmount) > 0.005) {
        amountMajor = bodyAmount;
        amountSource = 'override';
        originalOfferAmount = offerAmount;
      } else {
        amountMajor = offerAmount;
      }
    } else {
      // Sandbox manual-amount path
      if (!body.sandbox_fallback || !bodyAmountValid) {
        return errorResponse('missing_amount_or_offer', 400);
      }
      amountMajor = bodyAmount;
      amountSource = 'manual';
    }

    if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
      return errorResponse('invalid_amount', 400);
    }

    const minorAmount = toMinorUnits(amountMajor, currency);
    if (!Number.isInteger(minorAmount) || minorAmount <= 0) {
      return errorResponse('minor_units_conversion_failed', 500);
    }

    // 4) Generate order_number & create sandbox order
    const { data: orderNumber, error: onErr } = await supabase.rpc('generate_order_number');
    if (onErr || !orderNumber) return errorResponse('order_number_failed', 500);

    const customerEmail = body.customer_email ?? user.email ?? null;

    const meta: Record<string, unknown> = {
      sandbox: true,
      sandbox_source: 'admin_stripe_sandbox_checkout',
      created_by_user_id: user.user_id,
      account_code,
      amount_source: amountSource,
      minor_units: minorAmount,
    };
    if (amountSource === 'override' && originalOfferAmount != null) {
      meta.amount_override = true;
      meta.original_offer_amount = originalOfferAmount;
    }
    if (amountSource === 'manual') {
      meta.sandbox_fallback = true;
      meta.manual_amount = true;
    }

    const { data: order, error: ordErr } = await supabase
      .from('orders_v2')
      .insert({
        order_number: orderNumber as string,
        product_id: body.product_id,
        tariff_id: tariff?.id ?? null,
        offer_id: offer?.id ?? null,
        base_price: amountMajor,
        final_price: amountMajor,
        currency,
        status: 'pending',
        provider: 'stripe',
        customer_email: customerEmail,
        meta,
      })
      .select('id')
      .single();
    if (ordErr || !order) return errorResponse(`order_create_failed:${ordErr?.message ?? 'unknown'}`, 500);

    // 5) Create Stripe Checkout Session via adapter
    const adapter = resolveAdapter('stripe', account_code);
    const description = `[SANDBOX] ${product.name}${tariff ? ` / ${tariff.name}` : ''}${
      offer ? ` / ${offer.button_label}` : ' / manual-amount'
    }`;

    const result = await adapter.createCheckout({
      order_id: order.id,
      amount: minorAmount,
      currency,
      description,
      customer_email: customerEmail ?? undefined,
      return_url: conn.success_url ?? undefined,
      cancel_url: conn.cancel_url ?? undefined,
      is_one_time: true,
      metadata: {
        product_id: body.product_id,
        tariff_id: tariff?.id ?? '',
        offer_id: offer?.id ?? '',
        sandbox: 'true',
        amount_source: amountSource,
      },
      context: {
        provider: 'stripe',
        account_code,
        business_stream: null,
      },
    });

    if (!result.ok) {
      const errStr = String(result.error ?? 'unknown');
      const currencyIssue = isCurrencyError(errStr);
      await supabase
        .from('orders_v2')
        .update({
          meta: {
            ...meta,
            checkout_init_error: errStr,
            ...(currencyIssue ? { stripe_currency_not_supported: true } : {}),
          },
        })
        .eq('id', order.id);

      if (currencyIssue) {
        return jsonResponse({
          ok: false,
          fallback: true,
          code: 'stripe_currency_not_supported',
          message: `Stripe не принял валюту ${currency} для аккаунта ${account_code}. Выберите другую валюту.`,
          order_id: order.id,
        });
      }
      return jsonResponse({ ok: false, fallback: true, error: errStr, order_id: order.id });
    }

    return jsonResponse({
      ok: true,
      url: result.redirect_url,
      session_id: result.session_id,
      order_id: order.id,
      order_number: orderNumber,
      amount: amountMajor,
      minor_units: minorAmount,
      currency,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
