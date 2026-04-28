/**
 * public-charge-saved-card — Pay a public payment_link with a saved card token (MIT).
 *
 * Canonical contract:
 *   - Visibility/ownership: link.user_id IS NULL OR link.user_id = auth.uid()
 *   - Scope v1: payment_type='one_time' only (subscription → 422 unsupported_subscription)
 *   - tracking_id = `link:order:{order_id}` — webhook (bepaid-webhook) routes via kind='link_order'
 *   - Fulfillment goes ONLY through bepaid-webhook (grant-access-for-order + consumePaymentLinkForOrder)
 *   - Idempotency: dual guard
 *       (a) fast-path: meta.idempotency_key match within 10 min
 *       (b) natural-key: same user_id + payment_link_id + payment_method_id + amount + currency,
 *           created within 2 min, payment.status IN ('pending','processing')
 *   - 409 on existing attempt: do NOT return old gateway redirect_url (one-shot)
 *   - provider_token NEVER returned to client and NEVER logged in full
 *
 * STOP-guards (S2bis):
 *   #9 ownership uses NULL-or-equal
 *   #10 idempotency works without idempotency_key
 *   #11 statuses use real enum values from payments_v2 ('pending','processing')
 *   #12 409 has no redirect_url
 *   #13 subscription falls back to bePaid checkout (handled in UI)
 *   #14 no "3DS skipped" wording in code/UI
 *   #15 audit `payment.saved_card_charge.idempotency_hit` written on guard hit
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { buildPurchaseSnapshot } from '../_shared/build-purchase-snapshot.ts';
import {
  resolveOfferRoutingWithFallback,
  buildNegativeSnapshot,
  auditNegativeSnapshot,
} from '../_shared/crm-routing.ts';

// Active (non-final) payment statuses — verified against payments_v2 enum on 2026-04-26.
// Real enum values: pending, processing, succeeded, failed, refunded, canceled.
const ACTIVE_PAYMENT_STATUSES = ['pending', 'processing'] as const;

interface ChargeBody {
  url_token?: string;
  payment_method_id?: string;
  idempotency_key?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // --- 1. Auth (REQUIRED) -----------------------------------------------
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader?.toLowerCase().startsWith('bearer ')) {
      return errorResponse('auth_required', 401);
    }
    const accessToken = authHeader.slice(7).trim();
    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user?.id) {
      return errorResponse('auth_required', 401);
    }
    const authUser = userData.user;

    // --- 2. Body validation ----------------------------------------------
    const body = (await req.json().catch(() => ({}))) as ChargeBody;
    const { url_token, payment_method_id, idempotency_key } = body;
    if (!url_token || typeof url_token !== 'string') {
      return errorResponse('missing_url_token', 400);
    }
    if (!payment_method_id || typeof payment_method_id !== 'string') {
      return errorResponse('missing_payment_method_id', 400);
    }

    // --- 3. Load and validate payment link --------------------------------
    const { data: link, error: linkErr } = await supabase
      .from('payment_links')
      .select('*')
      .eq('url_token', url_token)
      .maybeSingle();

    if (linkErr || !link) {
      return errorResponse('payment_link_not_found', 404);
    }
    if (link.status !== 'active') {
      return errorResponse('payment_link_inactive', 410);
    }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return errorResponse('payment_link_expired', 410);
    }
    if (link.max_uses && link.current_uses >= link.max_uses) {
      return errorResponse('payment_link_usage_limit_reached', 410);
    }

    // --- 4. Ownership guard (S2bis.1) -------------------------------------
    // Personal link → only owner. Public link (user_id IS NULL) → any auth user.
    if (link.user_id !== null && link.user_id !== authUser.id) {
      return errorResponse('forbidden_link_owner_mismatch', 403);
    }

    // --- 5. Scope guard: v1 supports only one_time ------------------------
    if (link.payment_type !== 'one_time') {
      return jsonResponse(
        {
          error: 'unsupported_subscription',
          message: 'Saved-card flow поддерживает только разовые платежи. Используйте стандартную оплату через bePaid.',
        },
        422,
      );
    }

    const linkInstallment = (link.meta && typeof link.meta === 'object')
      ? (link.meta as Record<string, any>).installment
      : null;
    if (linkInstallment && Number(linkInstallment.selected_installment_months ?? 0) >= 2) {
      return jsonResponse(
        {
          error: 'unsupported_installment_saved_card',
          message: 'Рассрочка оформляется только через стандартную страницу bePaid с новой картой.',
        },
        422,
      );
    }

    // The recipient of the order is always the authenticated user (the payer is also the recipient
    // for saved-card MIT — using someone else's saved card is impossible).
    const targetUserId = authUser.id;

    // --- 6. Load payment method (server-side, never returned to client) ---
    const { data: paymentMethod, error: pmErr } = await supabase
      .from('payment_methods')
      .select(
        'id, user_id, provider, provider_token, brand, last4, exp_month, exp_year, status, supports_recurring',
      )
      .eq('id', payment_method_id)
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (pmErr || !paymentMethod) {
      return errorResponse('payment_method_not_found', 404);
    }
    if (paymentMethod.status !== 'active') {
      return errorResponse('payment_method_inactive', 422);
    }
    if (!paymentMethod.provider_token) {
      return errorResponse('payment_method_invalid', 422);
    }
    // Card expiration check
    if (paymentMethod.exp_month && paymentMethod.exp_year) {
      const now = new Date();
      const expEnd = new Date(paymentMethod.exp_year, paymentMethod.exp_month, 1);
      if (expEnd <= now) {
        return errorResponse('payment_method_expired', 422);
      }
    }

    // --- 7. Idempotency guard (S2bis.2) -----------------------------------
    // (a) fast-path: idempotency_key
    if (idempotency_key) {
      const { data: byKey } = await (supabase as any)
        .from('payments_v2')
        .select('id, order_id, status, provider_payment_id, meta')
        .eq('user_id', authUser.id)
        .filter('meta->>idempotency_key', 'eq', idempotency_key)
        .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byKey?.id && (ACTIVE_PAYMENT_STATUSES as readonly string[]).includes(byKey.status)) {
        await auditIdempotencyHit(supabase, {
          actor_user_id: authUser.id,
          link_id: link.id,
          payment_method_id,
          existing_order_id: byKey.order_id,
          existing_payment_id: byKey.id,
          matched_by: 'idempotency_key',
          amount: link.amount,
          currency: link.currency,
        });
        return inProgressResponse({
          order_id: byKey.order_id,
          payment_id: byKey.id,
          tracking_id: byKey.order_id ? `link:order:${byKey.order_id}` : null,
        });
      }
    }

    // (b) natural-key (always runs, regardless of idempotency_key)
    // (b) natural-key (always runs, regardless of idempotency_key).
    // payments_v2 has NO payment_method_id column — match via meta.payment_method_id
    // and via the joined order's meta.payment_link_id.
    const { data: byNatural } = await (supabase as any)
      .from('payments_v2')
      .select('id, order_id, status, meta, amount, currency, orders_v2!inner(id, user_id, meta)')
      .eq('user_id', authUser.id)
      .eq('amount', link.amount / 100)
      .eq('currency', link.currency)
      .in('status', ACTIVE_PAYMENT_STATUSES as unknown as string[])
      .gte('created_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(20);

    const naturalHit = (byNatural || []).find((p: any) =>
      p?.meta?.payment_method_id === payment_method_id &&
      p?.orders_v2?.meta?.payment_link_id === link.id,
    );

    if (naturalHit?.id) {
      await auditIdempotencyHit(supabase, {
        actor_user_id: authUser.id,
        link_id: link.id,
        payment_method_id,
        existing_order_id: naturalHit.order_id,
        existing_payment_id: naturalHit.id,
        matched_by: 'natural_key',
        amount: link.amount,
        currency: link.currency,
      });
      return inProgressResponse({
        order_id: naturalHit.order_id,
        payment_id: naturalHit.id,
        tracking_id: naturalHit.order_id ? `link:order:${naturalHit.order_id}` : null,
      });
    }

    // --- 8. bePaid creds --------------------------------------------------
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      console.error('[public-charge-saved-card] bePaid creds error:', credsResult.error);
      return errorResponse('payment_provider_unavailable', 503);
    }
    const bepaidCreds = credsResult;

    // --- 9. Load product / tariff / profile (canonical 1:1 with public-checkout) ---
    const [productRes, tariffRes, profileRes] = await Promise.all([
      supabase.from('products_v2').select('id, name, code, public_id, primary_domain').eq('id', link.product_id).maybeSingle(),
      supabase.from('tariffs').select('id, name, code, access_days, public_id').eq('id', link.tariff_id).maybeSingle(),
      supabase.from('profiles').select('id, email, full_name').eq('user_id', targetUserId).maybeSingle(),
    ]);
    if (!productRes.data) return errorResponse('product_not_found', 404);
    if (!tariffRes.data) return errorResponse('tariff_not_found', 404);

    const product = productRes.data as any;
    const tariff = tariffRes.data as any;
    const profile = profileRes.data as any;
    const profileId = profile?.id || null;
    const customerEmail = profile?.email || authUser.email || 'unknown@example.com';
    const amountKopecks = link.amount;
    const amountByn = amountKopecks / 100;
    const accessDays = tariff.access_days || 30;
    const nowDt = new Date();
    const plannedEnd = new Date(nowDt);
    plannedEnd.setDate(plannedEnd.getDate() + accessDays);

    // --- 10. CRM routing snapshot (B.0 invariant) -------------------------
    const routing = await resolveOfferRoutingWithFallback(supabase, {
      offer_id: link.offer_id,
      tariff_id: link.tariff_id,
    });
    const crmSnapshot = routing.ok && routing.snapshot
      ? routing.snapshot
      : buildNegativeSnapshot({
          reason: routing.reason || 'unknown',
          offer_id: link.offer_id ?? null,
          tariff_id: link.tariff_id,
          resolved_via: routing.resolved_via ?? 'none',
          candidates_count: routing.candidates_count ?? 0,
        });

    // --- 11. Generate order number + INSERT order ------------------------
    const { data: orderNumberData } = await supabase.rpc('generate_order_number');
    const orderNumber: string = (orderNumberData as string | null) || `ORD-LINK-SC-${Date.now()}`;

    const orderMeta: Record<string, any> = {
      type: 'system_payment_link',
      description: link.description || null,
      created_by: null,
      product_name: product.name,
      tariff_name: tariff.name,
      payment_flow: 'renewal_one_time',
      payment_link_id: link.id,
      source: 'saved_card_public_pay',
      payment_method_id,
      ...(idempotency_key ? { idempotency_key } : {}),
      crm_routing_snapshot: crmSnapshot,
    };

    const { data: order, error: orderErr } = await (supabase as any)
      .from('orders_v2')
      .insert({
        order_number: orderNumber,
        user_id: targetUserId,
        profile_id: profileId,
        product_id: link.product_id,
        tariff_id: link.tariff_id,
        offer_id: link.offer_id || null,
        base_price: amountByn,
        final_price: amountByn,
        paid_amount: 0,
        currency: link.currency,
        status: 'pending',
        customer_email: customerEmail,
        deal_date: new Date().toISOString(),
        meta: orderMeta,
        pipeline_id: routing.ok && routing.snapshot ? routing.snapshot.pipeline_id : null,
        pipeline_stage_id: routing.ok && routing.snapshot ? routing.snapshot.stage_on_pending : null,
        purchase_snapshot: buildPurchaseSnapshot({
          product_id: link.product_id,
          product_public_id: product.public_id,
          product_name: product.name,
          product_code: product.code,
          tariff_id: link.tariff_id,
          tariff_public_id: tariff.public_id,
          tariff_name: tariff.name,
          tariff_code: tariff.code,
          offer_id: link.offer_id || null,
          price: amountByn,
          currency: link.currency,
          access_days: accessDays,
          planned_access_start_at: nowDt.toISOString(),
          planned_access_end_at: plannedEnd.toISOString(),
          is_trial: false,
          extra: { payment_flow: 'renewal_one_time', source: 'saved_card_public_pay' },
        }),
      })
      .select('id, order_number')
      .single();

    if (orderErr || !order) {
      console.error('[public-charge-saved-card] order insert failed:', orderErr);
      return errorResponse('order_create_failed', 500);
    }

    if (!routing.ok) {
      await auditNegativeSnapshot(supabase, {
        order_id: order.id,
        offer_id: link.offer_id ?? null,
        tariff_id: link.tariff_id,
        reason: routing.reason || 'unknown',
        resolved_via: routing.resolved_via ?? 'none',
        candidates_count: routing.candidates_count ?? 0,
      });
    }

    // --- 12. INSERT payment (status=processing pre-gateway) -------------
    const paymentMeta: Record<string, any> = {
      payment_link_id: link.id,
      payment_method_id,
      source: 'saved_card_public_pay',
      ...(idempotency_key ? { idempotency_key } : {}),
    };

    const { data: payment, error: payErr } = await (supabase as any)
      .from('payments_v2')
      .insert({
        order_id: order.id,
        user_id: targetUserId,
        profile_id: profileId,
        amount: amountByn,
        currency: link.currency,
        status: 'processing',
        provider: 'bepaid',
        card_brand: paymentMethod.brand || null,
        card_last4: paymentMethod.last4 || null,
        is_recurring: false,
        // 'payment' aligns with existing payments_v2.transaction_type values
        // ('payment','refund','tokenization','void'). Saved-card marker lives in meta.source.
        transaction_type: 'payment',
        origin: 'public_link',
        meta: paymentMeta,
      })
      .select('id')
      .single();

    if (payErr || !payment) {
      console.error('[public-charge-saved-card] payment insert failed:', payErr);
      return errorResponse('payment_create_failed', 500);
    }

    // Audit: requested (post-validation, post-insert, pre-gateway).
    await safeAudit(supabase, {
      action: 'payment.saved_card_charge.requested',
      actor_user_id: authUser.id,
      target_user_id: targetUserId,
      meta: {
        order_id: order.id,
        payment_id: payment.id,
        payment_link_id: link.id,
        payment_method_id,
        amount: amountKopecks,
        currency: link.currency,
      },
    });

    // --- 13. bePaid Gateway charge --------------------------------------
    const trackingId = `link:order:${order.id}`;

    // CANONICAL RETURN_URL — never req.headers.origin/referer.
    // Source of truth: products_v2.primary_domain → fallback CANONICAL_PUBLIC_HOST.
    // Same forbidden-host policy as admin-create-public-link.
    const CANONICAL_PUBLIC_HOST = 'https://club.gorbova.by';
    const FORBIDDEN_HOST_RE = /(lovable\.dev|lovable\.app|lovableproject\.com|localhost|127\.0\.0\.1)/i;
    const VALID_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
    const rawPrimaryDomain: string | null =
      typeof product.primary_domain === 'string' ? product.primary_domain : null;
    const primaryDomain = rawPrimaryDomain ? rawPrimaryDomain.trim().toLowerCase() : null;
    const primaryDomainValid =
      !!primaryDomain &&
      VALID_DOMAIN_RE.test(primaryDomain) &&
      !FORBIDDEN_HOST_RE.test(primaryDomain);
    const canonicalOrigin = primaryDomainValid
      ? `https://${primaryDomain}`
      : CANONICAL_PUBLIC_HOST;
    if (!/^https:\/\//.test(canonicalOrigin) || FORBIDDEN_HOST_RE.test(canonicalOrigin)) {
      console.error('[public-charge-saved-card] canonical origin rejected:', canonicalOrigin);
      return errorResponse('internal_invalid_canonical_origin', 500);
    }
    const originSource: 'product_primary_domain' | 'fallback_canonical' =
      primaryDomainValid ? 'product_primary_domain' : 'fallback_canonical';

    const notificationUrl = `${supabaseUrl}/functions/v1/bepaid-webhook`;
    const returnUrl = `${canonicalOrigin}/purchases?order=${order.id}&payment=processing`;

    const chargePayload = {
      request: {
        amount: amountKopecks,
        currency: link.currency,
        description: link.description || `${product.name} — ${tariff.name}`,
        tracking_id: trackingId,
        test: bepaidCreds.test_mode,
        return_url: returnUrl,
        notification_url: notificationUrl,
        skip_three_d_secure_verification: true,
        credit_card: {
          token: paymentMethod.provider_token,
        },
        additional_data: {
          contract: ['recurring', 'unscheduled'],
          card_on_file: {
            initiator: 'merchant',
            type: 'delayed_charge',
          },
          order_id: order.id,
          payment_id: payment.id,
        },
      },
    };

    // Safe log: provider_token is NEVER included.
    console.log('[public-charge-saved-card] gateway charge', {
      order_id: order.id,
      payment_id: payment.id,
      tracking_id: trackingId,
      amount: amountKopecks,
      currency: link.currency,
      pm_brand: paymentMethod.brand,
      pm_last4: paymentMethod.last4,
      origin_source: originSource,
      return_url: returnUrl,
    });

    // Audit: gateway_called (just before POST).
    await safeAudit(supabase, {
      action: 'payment.saved_card_charge.gateway_called',
      actor_user_id: authUser.id,
      target_user_id: targetUserId,
      meta: {
        order_id: order.id,
        payment_id: payment.id,
        tracking_id: trackingId,
        amount: amountKopecks,
        currency: link.currency,
        origin_source: originSource,
        return_url: returnUrl,
      },
    });

    const bepaidAuth = createBepaidAuthHeader(bepaidCreds);
    const chargeResp = await fetch('https://gateway.bepaid.by/transactions/payments', {
      method: 'POST',
      headers: {
        Authorization: bepaidAuth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Version': '2',
      },
      body: JSON.stringify(chargePayload),
    });
    const chargeResult = await chargeResp.json().catch(() => ({} as any));

    if (!chargeResp.ok) {
      const errMsg = chargeResult?.message || chargeResult?.errors?.base?.[0] || `bePaid error ${chargeResp.status}`;
      console.error('[public-charge-saved-card] gateway error', {
        status: chargeResp.status,
        order_id: order.id,
        message: errMsg,
      });
      await supabase
        .from('payments_v2')
        .update({
          status: 'failed',
          error_message: errMsg,
          provider_response: sanitizeProviderResponse(chargeResult),
        })
        .eq('id', payment.id);
      await supabase.from('orders_v2').update({ status: 'failed' }).eq('id', order.id);

      await safeAudit(supabase, {
        action: 'payment.saved_card_charge.failed',
        actor_user_id: authUser.id,
        target_user_id: targetUserId,
        meta: {
          order_id: order.id,
          payment_id: payment.id,
          gateway_status: chargeResp.status,
          error_message: errMsg,
        },
      });

      return jsonResponse(
        { success: false, error: 'payment_declined', message: errMsg, order_id: order.id },
        400,
      );
    }

    const txStatus = chargeResult?.transaction?.status;
    const txUid = chargeResult?.transaction?.uid;
    const redirectUrl = chargeResult?.transaction?.redirect_url || null;

    // Persist tx uid + sanitized response (status remains 'processing' — webhook closes it).
    await supabase
      .from('payments_v2')
      .update({
        provider_payment_id: txUid || null,
        provider_response: sanitizeProviderResponse(chargeResult),
        status: 'processing',
      })
      .eq('id', payment.id);

    // Audit: created (always).
    await safeAudit(supabase, {
      action: 'payment.saved_card_charge.created',
      actor_user_id: authUser.id,
      target_user_id: targetUserId,
      meta: {
        order_id: order.id,
        payment_id: payment.id,
        payment_link_id: link.id,
        tracking_id: trackingId,
        tx_uid: txUid || null,
        tx_status: txStatus || null,
        requires_redirect: !!redirectUrl,
      },
    });

    // Audit: redirect_issued (only when bank confirmation page must be shown).
    if (redirectUrl) {
      await safeAudit(supabase, {
        action: 'payment.saved_card_charge.redirect_issued',
        actor_user_id: authUser.id,
        target_user_id: targetUserId,
        meta: {
          order_id: order.id,
          payment_id: payment.id,
          tx_uid: txUid || null,
          tx_status: txStatus || null,
        },
      });
    }

    // Response: never includes provider_token.
    return jsonResponse({
      success: true,
      status: txStatus || 'processing',
      order_id: order.id,
      payment_id: payment.id,
      tracking_id: trackingId,
      redirect_url: redirectUrl,
      message: redirectUrl
        ? 'Требуется подтверждение банка. Сейчас откроется страница подтверждения.'
        : 'Платёж создан. Финальный статус подтвердит банк.',
    });
  } catch (err) {
    console.error('[public-charge-saved-card] unexpected', err);
    return errorResponse('internal_error', 500);
  }
});

// ---------- helpers ----------

/** Best-effort audit insert — never throws / never blocks main flow. */
async function safeAudit(
  supabase: any,
  p: {
    action: string;
    actor_user_id: string;
    target_user_id: string;
    meta: Record<string, any>;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      action: p.action,
      actor_type: 'user',
      actor_user_id: p.actor_user_id,
      actor_label: 'public-charge-saved-card',
      target_user_id: p.target_user_id,
      meta: p.meta,
    });
    if (error) {
      console.error('[public-charge-saved-card] audit failed', { action: p.action, error });
    }
  } catch (e) {
    console.error('[public-charge-saved-card] audit threw', { action: p.action, e });
  }
}


function inProgressResponse(p: { order_id: string | null; payment_id: string; tracking_id: string | null }): Response {
  return new Response(
    JSON.stringify({
      status: 'in_progress',
      code: 'payment_already_processing',
      order_id: p.order_id,
      payment_id: p.payment_id,
      tracking_id: p.tracking_id,
      // Intentionally NO redirect_url — old gateway redirect may be one-shot.
      message: 'Платёж уже создан. Завершите подтверждение или попробуйте позже.',
    }),
    { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

async function auditIdempotencyHit(
  supabase: any,
  p: {
    actor_user_id: string;
    link_id: string;
    payment_method_id: string;
    existing_order_id: string | null;
    existing_payment_id: string;
    matched_by: 'idempotency_key' | 'natural_key';
    amount: number;
    currency: string;
  },
): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert({
    action: 'payment.saved_card_charge.idempotency_hit',
    actor_type: 'user',
    actor_user_id: p.actor_user_id,
    actor_label: 'public-charge-saved-card',
    target_user_id: p.actor_user_id,
    meta: {
      payment_link_id: p.link_id,
      payment_method_id: p.payment_method_id,
      existing_order_id: p.existing_order_id,
      existing_payment_id: p.existing_payment_id,
      matched_by: p.matched_by,
      amount: p.amount,
      currency: p.currency,
    },
  });
  if (error) {
    console.error('[public-charge-saved-card] idempotency_hit audit failed', error);
  }
}

/** Strip any token-like fields from provider_response before persistence. */
function sanitizeProviderResponse(resp: any): any {
  if (!resp || typeof resp !== 'object') return resp;
  try {
    const cloned = JSON.parse(JSON.stringify(resp));
    const tx = cloned.transaction;
    if (tx && typeof tx === 'object') {
      if (tx.credit_card && typeof tx.credit_card === 'object') {
        delete tx.credit_card.token;
      }
    }
    return cloned;
  } catch {
    return null;
  }
}
