// Phase 2 — stripe-create-checkout
// Admin-only entrypoint to create a Stripe Checkout Session for an existing test order.
// Strictly add-only: does NOT touch bepaid-*, create-payment-checkout.ts, payment_links.
//
// Flow:
//   1) require super_admin
//   2) lookup orders_v2 (must already exist, provider='stripe', status='pending')
//   3) resolve acquiring_connections row by account_code (must be active + test)
//   4) call stripeAdapter.createCheckout via resolveAdapter('stripe')
//   5) return {url, session_id}

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { resolveAdapter } from '../_shared/acquiring/index.ts';

interface CreateBody {
  order_id: string;
  account_code?: string;
  business_stream?: string | null;
  amount: number;          // minor units
  currency: string;
  description?: string;
  customer_email?: string;
  product_id: string;
  tariff_id: string;
  offer_id?: string;
  payment_link_id?: string;
  contact_id?: string;
  user_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { supabase } = await requireSuperAdmin(req);
    const body = (await req.json()) as CreateBody;

    if (!body.order_id || !body.amount || !body.currency || !body.product_id || !body.tariff_id) {
      return errorResponse('missing_required_fields', 400);
    }
    const account_code = body.account_code ?? 'stripe_poland';

    // Resolve & validate connection
    const { data: conn, error: connErr } = await supabase
      .from('acquiring_connections')
      .select('*')
      .eq('provider', 'stripe')
      .eq('account_code', account_code)
      .maybeSingle();
    if (connErr || !conn) return errorResponse('connection_not_found', 404);
    if (conn.status !== 'active') return errorResponse(`connection_not_active:${conn.status}`, 400);
    if (!conn.test_mode) return errorResponse('phase_2_test_mode_only', 400);

    // Verify order exists & is pending stripe
    const { data: order, error: ordErr } = await supabase
      .from('orders_v2')
      .select('id, status, provider, amount, currency, contact_id, user_id')
      .eq('id', body.order_id)
      .maybeSingle();
    if (ordErr || !order) return errorResponse('order_not_found', 404);
    if (order.provider !== 'stripe') return errorResponse('order_provider_mismatch', 400);
    if (!['pending', 'processing'].includes(order.status)) {
      return errorResponse(`order_invalid_status:${order.status}`, 400);
    }

    const adapter = resolveAdapter('stripe', account_code);
    const result = await adapter.createCheckout({
      order_id: body.order_id,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      customer_email: body.customer_email,
      return_url: conn.success_url ?? undefined,
      cancel_url: conn.cancel_url ?? undefined,
      is_one_time: true,
      metadata: {
        product_id: body.product_id,
        tariff_id: body.tariff_id,
        offer_id: body.offer_id,
        payment_link_id: body.payment_link_id,
        contact_id: body.contact_id ?? order.contact_id,
        user_id: body.user_id ?? order.user_id,
      },
      context: {
        provider: 'stripe',
        account_code,
        business_stream: body.business_stream ?? null,
      },
    });

    if (!result.ok) {
      return jsonResponse({ ok: false, fallback: true, error: result.error });
    }
    return jsonResponse({ ok: true, url: result.redirect_url, session_id: result.session_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
