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
import { resolveDefaultStripeAccount } from '../_shared/acquiring/default-account.ts';
import { resolveBusinessStream } from '../_shared/acquiring/business-stream-resolver.ts';
import { resolveStripeCheckoutUrls } from '../_shared/public-app-host.ts';
import { resolveStripeCustomer } from '../_shared/acquiring/stripe-customer-resolver.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import {
  resolveOfferRoutingWithFallback,
  buildNegativeSnapshot,
  auditNegativeSnapshot,
} from '../_shared/crm-routing.ts';

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
  // MP-A2-2: caller may explicitly request PaymentMethod saving for one-time checkout.
  // Pilot ("Платная консультация") will pass true. Other one-time flows default to false.
  save_payment_method?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { supabase } = await requireSuperAdmin(req);
    const body = (await req.json()) as CreateBody;

    if (!body.order_id || !body.amount || !body.currency || !body.product_id || !body.tariff_id) {
      return errorResponse('missing_required_fields', 400);
    }

    // MP-A2-1: SOT resolver — no hardcoded 'stripe_poland' default.
    const acct = await resolveDefaultStripeAccount(supabase, body.account_code);
    const account_code = acct.account_code;

    // Re-fetch the full connection row (status/test_mode already validated by resolver,
    // but we still surface the legacy not-test guard for parity with previous behavior).
    if (!acct.test_mode) {
      return jsonResponse({
        ok: false,
        fallback: true,
        code: 'sandbox_checkout_requires_test_keys',
        message:
          'Подключены боевые ключи Stripe. Тестовая оплата в Фазе 2 недоступна. Для sandbox-проверки переключите подключение на тестовые ключи Stripe (pk_test_/sk_test_).',
      });
    }

    // Verify order exists & is pending stripe
    const { data: order, error: ordErr } = await supabase
      .from('orders_v2')
      .select('id, status, provider, final_price, currency, user_id, product_id, tariff_id, offer_id')
      .eq('id', body.order_id)
      .maybeSingle();
    if (ordErr || !order) {
      console.log('[stripe-create-checkout] order lookup miss', { order_id: body.order_id, ordErr: ordErr?.message, hasOrder: !!order });
      return errorResponse('order_not_found', 404);
    }
    if (order.provider !== 'stripe') return errorResponse('order_provider_mismatch', 400);
    if (!['pending', 'processing'].includes(order.status)) {
      return errorResponse(`order_invalid_status:${order.status}`, 400);
    }

    // MP-A2-1: business_stream via SOT resolver (offer → product → body override → 'unspecified').
    let bs: string | null = body.business_stream ?? null;
    if (!bs) {
      const offerId = body.offer_id ?? order.offer_id ?? null;
      const productId = body.product_id ?? order.product_id ?? null;
      const [offerRes, productRes] = await Promise.all([
        offerId
          ? supabase.from('tariff_offers').select('meta').eq('id', offerId).maybeSingle()
          : Promise.resolve({ data: null } as { data: null }),
        productId
          ? supabase.from('products_v2').select('meta').eq('id', productId).maybeSingle()
          : Promise.resolve({ data: null } as { data: null }),
      ]);
      bs = resolveBusinessStream({
        tariff_offer_meta: (offerRes.data as { meta?: Record<string, unknown> } | null)?.meta ?? null,
        product_meta: (productRes.data as { meta?: Record<string, unknown> } | null)?.meta ?? null,
        link_business_stream: null,
      });
    }

    // MP-A2-1: redirect URLs — connection → PUBLIC_APP_HOST fallback, no example.com.
    const urls = resolveStripeCheckoutUrls({
      connection_success_url: acct.success_url,
      connection_cancel_url: acct.cancel_url,
      test_mode: acct.test_mode,
      sandbox: false,
    });

    // MP-A2-2: resolve Stripe Customer for (user_id, account_code). user_id is REQUIRED for
    // resolver — if absent (legacy / guest), skip resolver and fall back to customer_email.
    const resolvedUserId = body.user_id ?? order.user_id ?? null;
    const resolvedEmail = body.customer_email ?? null;
    let customer_id: string | null = null;
    if (resolvedUserId && resolvedEmail) {
      try {
        const sk = await readAcquiringSecret('stripe', account_code, 'secret_key');
        const cust = await resolveStripeCustomer(supabase, sk, {
          user_id: resolvedUserId,
          account_code,
          email: resolvedEmail,
        });
        customer_id = cust.customer_id;
      } catch (e) {
        // Resolver failure is non-fatal for checkout; degrade to email-only mode + audit.
        await supabase.from('audit_logs').insert({
          action: 'stripe_customer_resolver_failed',
          entity_type: 'orders_v2',
          entity_id: body.order_id,
          meta: { error: e instanceof Error ? e.message : String(e), account_code },
        });
      }
    }

    const adapter = resolveAdapter('stripe', account_code);
    const result = await adapter.createCheckout({
      order_id: body.order_id,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      customer_email: body.customer_email,
      customer_id,
      save_payment_method: body.save_payment_method === true,
      return_url: urls.success_url,
      cancel_url: urls.cancel_url,
      is_one_time: true,
      metadata: {
        product_id: body.product_id,
        tariff_id: body.tariff_id,
        offer_id: body.offer_id,
        payment_link_id: body.payment_link_id,
        contact_id: body.contact_id ?? null,
        user_id: resolvedUserId,
      },
      context: {
        provider: 'stripe',
        account_code,
        business_stream: bs,
      },
    });

    if (!result.ok) {
      return jsonResponse({ ok: false, fallback: true, error: result.error });
    }

    // PRR-FIX-02 (F3): materialize crm_routing_snapshot + pipeline pending on order BEFORE
    // returning redirect URL. Same Layer A contract as create-payment-checkout.ts (bePaid).
    const offerIdForRouting = body.offer_id ?? order.offer_id ?? null;
    const tariffIdForRouting = body.tariff_id ?? order.tariff_id ?? null;
    const routing = await resolveOfferRoutingWithFallback(supabase, {
      offer_id: offerIdForRouting,
      tariff_id: tariffIdForRouting,
    });
    const crmSnapshot = routing.ok && routing.snapshot
      ? routing.snapshot
      : buildNegativeSnapshot({
          reason: routing.reason || 'unknown',
          offer_id: offerIdForRouting,
          tariff_id: tariffIdForRouting,
          resolved_via: routing.resolved_via ?? 'none',
          candidates_count: routing.candidates_count ?? 0,
        });

    // PRR-FIX-02 (F2, F4): sticky stripe meta + business_stream on order.
    const { data: curOrder } = await supabase
      .from('orders_v2')
      .select('meta, pipeline_id, pipeline_stage_id')
      .eq('id', body.order_id)
      .maybeSingle();
    const curMeta = (curOrder?.meta && typeof curOrder.meta === 'object')
      ? curOrder.meta as Record<string, unknown>
      : {};
    const curStripeMeta = (curMeta.stripe && typeof curMeta.stripe === 'object')
      ? curMeta.stripe as Record<string, unknown>
      : {};
    const mergedStripeMeta = {
      ...curStripeMeta,
      checkout_session_id: curStripeMeta.checkout_session_id ?? result.session_id,
      customer_id: customer_id ?? curStripeMeta.customer_id ?? null,
      account_code,
      business_stream: bs,
    };
    const nextMeta: Record<string, unknown> = {
      ...curMeta,
      crm_routing_snapshot: crmSnapshot,
      business_stream: bs ?? (curMeta.business_stream ?? null),
      stripe: mergedStripeMeta,
    };

    const updatePayload: Record<string, unknown> = { meta: nextMeta };
    // Only set pipeline fields if currently NULL (don't overwrite manual moves).
    if (routing.ok && routing.snapshot) {
      if (!curOrder?.pipeline_id) updatePayload.pipeline_id = routing.snapshot.pipeline_id;
      if (!curOrder?.pipeline_stage_id) updatePayload.pipeline_stage_id = routing.snapshot.stage_on_pending;
    }
    const { error: upErr } = await supabase
      .from('orders_v2')
      .update(updatePayload)
      .eq('id', body.order_id);
    if (upErr) {
      await supabase.from('audit_logs').insert({
        action: 'stripe.create_checkout.order_meta_update_failed',
        entity_type: 'orders_v2',
        entity_id: body.order_id,
        meta: { error: upErr.message, session_id: result.session_id },
      });
    }
    if (!routing.ok || !routing.snapshot) {
      await auditNegativeSnapshot(supabase, {
        order_id: body.order_id,
        offer_id: offerIdForRouting,
        tariff_id: tariffIdForRouting,
        reason: routing.reason || 'unknown',
        resolved_via: routing.resolved_via ?? 'none',
        candidates_count: routing.candidates_count ?? 0,
      });
    }

    return jsonResponse({ ok: true, url: result.redirect_url, session_id: result.session_id, customer_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
