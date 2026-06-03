// PATCH Phase 2 — Admin-only Stripe Sandbox Checkout.
//
// Scope:
//   - Creates a test orders_v2 (provider='stripe', status='pending', meta.sandbox=true)
//   - Calls Stripe adapter to open a real sandbox Checkout Session
//   - Returns { url, session_id, order_id }
//
// Hard guards:
//   - super_admin only
//   - Stripe connection MUST be active AND test_mode=true
//   - Does NOT touch bePaid, payment_links, create-payment-checkout.ts
//   - Does NOT use this path for normal/public flows
//
// Add-only.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { resolveAdapter } from '../_shared/acquiring/index.ts';

interface Body {
  product_id: string;
  tariff_id: string;
  offer_id: string;
  currency?: string;
  customer_email?: string;
  account_code?: string;
}

const ALLOWED_CURRENCIES = new Set(['USD', 'EUR', 'PLN', 'GBP']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { user, supabase } = await requireSuperAdmin(req);
    const body = (await req.json()) as Body;

    if (!body.product_id || !body.tariff_id || !body.offer_id) {
      return errorResponse('missing_required_fields', 400);
    }
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

    // 2) Resolve product / tariff / offer
    const [{ data: product }, { data: tariff }, { data: offer }] = await Promise.all([
      supabase.from('products').select('id, name').eq('id', body.product_id).maybeSingle(),
      supabase.from('tariffs').select('id, product_id, name').eq('id', body.tariff_id).maybeSingle(),
      supabase
        .from('tariff_offers')
        .select('id, tariff_id, button_label, amount, offer_type, is_active')
        .eq('id', body.offer_id)
        .maybeSingle(),
    ]);
    if (!product) return errorResponse('product_not_found', 404);
    if (!tariff || tariff.product_id !== body.product_id) return errorResponse('tariff_mismatch', 400);
    if (!offer || offer.tariff_id !== body.tariff_id) return errorResponse('offer_mismatch', 400);
    if (offer.is_active === false) return errorResponse('offer_inactive', 400);

    const amountMajor = Number(offer.amount);
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
      return errorResponse('offer_invalid_amount', 400);
    }

    // 3) Generate order_number & create sandbox order
    const { data: orderNumber, error: onErr } = await supabase.rpc('generate_order_number');
    if (onErr || !orderNumber) return errorResponse('order_number_failed', 500);

    const customerEmail = body.customer_email ?? user.email ?? null;

    const { data: order, error: ordErr } = await supabase
      .from('orders_v2')
      .insert({
        order_number: orderNumber as string,
        product_id: body.product_id,
        tariff_id: body.tariff_id,
        offer_id: body.offer_id,
        base_price: amountMajor,
        final_price: amountMajor,
        currency,
        status: 'pending',
        provider: 'stripe',
        customer_email: customerEmail,
        meta: {
          sandbox: true,
          sandbox_source: 'admin_stripe_sandbox_checkout',
          created_by_user_id: user.user_id,
          account_code,
        },
      })
      .select('id')
      .single();
    if (ordErr || !order) return errorResponse(`order_create_failed:${ordErr?.message ?? 'unknown'}`, 500);

    // 4) Create Stripe Checkout Session via adapter
    const adapter = resolveAdapter('stripe', account_code);
    const minorAmount = Math.round(amountMajor * 100);
    const description = `[SANDBOX] ${product.name} / ${tariff.name} / ${offer.button_label}`;

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
        tariff_id: body.tariff_id,
        offer_id: body.offer_id,
        sandbox: 'true',
      },
      context: {
        provider: 'stripe',
        account_code,
        business_stream: null,
      },
    });

    if (!result.ok) {
      // Mark order as failed-to-init for traceability, do NOT delete (audit trail).
      await supabase
        .from('orders_v2')
        .update({
          meta: {
            sandbox: true,
            sandbox_source: 'admin_stripe_sandbox_checkout',
            created_by_user_id: user.user_id,
            account_code,
            checkout_init_error: result.error ?? 'unknown',
          },
        })
        .eq('id', order.id);
      return jsonResponse({ ok: false, fallback: true, error: result.error, order_id: order.id });
    }

    return jsonResponse({
      ok: true,
      url: result.redirect_url,
      session_id: result.session_id,
      order_id: order.id,
      order_number: orderNumber,
      amount: amountMajor,
      currency,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
