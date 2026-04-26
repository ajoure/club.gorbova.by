/**
 * payment-dialog-create-bridge-link (PAY-K)
 *
 * НАЗНАЧЕНИЕ: создать короткоживущую internal payment_link для one_time оплаты
 * сохранённой картой через PaymentDialog (без выхода на /pay/:token UI).
 *
 * После создания клиент вызывает существующую public-charge-saved-card с
 * полученным url_token + payment_method_id. Webhook/grant/consume не меняются.
 *
 * ЯВНЫЕ ГРАНИЦЫ:
 *   • НЕ создаёт orders_v2.
 *   • НЕ вызывает bePaid.
 *   • НЕ возвращает provider_token / payment_method чувствительные поля.
 *   • Только INSERT в payment_links + возврат { url_token }.
 *   • payment_type ВСЕГДА 'one_time' (subscription/trial вне scope PAY-K).
 *   • amount резолвится СТРОГО на сервере из tariff_offers — body.expected_amount
 *     используется только как guard (price_mismatch при расхождении).
 *
 * AUTH: JWT обязателен (любой авторизованный user). user_id ссылки = auth.uid().
 *
 * Anti-duplicate (60s window): если у того же user уже есть active bridge link
 * с теми же product_id/tariff_id/offer_id/amount/currency и current_uses=0 и
 * не истёк — возвращаем существующий url_token.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';

interface BridgeRequest {
  product_id: string;
  tariff_id?: string | null;
  tariff_code?: string | null;
  offer_id?: string | null;
  expected_amount: number; // kopecks (BYN)
  currency?: string;
  description?: string | null;
}

const CANONICAL_PUBLIC_HOST = 'https://club.gorbova.by';
const FORBIDDEN_HOST_RE = /(lovable\.dev|lovable\.app|lovableproject\.com|localhost|127\.0\.0\.1)/i;
const VALID_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── AUTH ──
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

    // ── Body validation ──
    const body = (await req.json().catch(() => ({}))) as BridgeRequest;
    const {
      product_id,
      tariff_id: tariffIdInput,
      tariff_code,
      offer_id = null,
      expected_amount,
      currency = 'BYN',
      description = null,
    } = body;

    if (!product_id || typeof product_id !== 'string') {
      return errorResponse('missing_product_id', 400);
    }
    if (!Number.isFinite(expected_amount) || expected_amount < 100) {
      return errorResponse('invalid_expected_amount', 400);
    }
    // ── Currency guard: BYN-only (frontend is NOT source of truth) ──
    if (currency !== 'BYN') {
      console.warn('[bridge-link] currency_not_supported', { currency, user: authUser.id });
      return errorResponse('currency_not_supported', 400);
    }

    // ── Resolve product ──
    const { data: product } = await supabase
      .from('products_v2')
      .select('id, is_active, primary_domain')
      .eq('id', product_id)
      .maybeSingle();
    if (!product) return errorResponse('product_not_found', 404);
    if (product.is_active === false) return errorResponse('product_inactive', 400);

    // ── Resolve tariff ──
    // Приоритет: tariff_id → tariff_code → fallback резолв из offer_id (для caller'ов
    // которые передают только offerId, напр. LiveEventProductCta).
    let tariff_id: string | null = tariffIdInput || null;
    if (!tariff_id && !tariff_code && offer_id) {
      const { data: offerForTariff } = await supabase
        .from('tariff_offers')
        .select('tariff_id, tariffs!inner(id, product_id, is_active)')
        .eq('id', offer_id)
        .maybeSingle();
      const t = (offerForTariff as { tariffs?: { id: string; product_id: string; is_active: boolean } } | null)?.tariffs;
      if (!t) return errorResponse('tariff_not_found', 404);
      if (t.product_id !== product_id) return errorResponse('tariff_product_mismatch', 400);
      if (t.is_active === false) return errorResponse('tariff_inactive', 400);
      tariff_id = t.id;
    } else if (!tariff_id) {
      if (!tariff_code) {
        return errorResponse('missing_tariff_id_or_code', 400);
      }
      const { data: tariffByCode } = await supabase
        .from('tariffs')
        .select('id, product_id, is_active')
        .eq('product_id', product_id)
        .eq('code', tariff_code)
        .eq('is_active', true)
        .limit(2);
      if (!tariffByCode || tariffByCode.length === 0) {
        return errorResponse('tariff_not_found', 404);
      }
      if (tariffByCode.length > 1) {
        return errorResponse('tariff_code_ambiguous', 409);
      }
      tariff_id = tariffByCode[0].id;
    } else {
      const { data: tariff } = await supabase
        .from('tariffs')
        .select('id, product_id, is_active')
        .eq('id', tariff_id)
        .maybeSingle();
      if (!tariff) return errorResponse('tariff_not_found', 404);
      if (tariff.product_id !== product_id) return errorResponse('tariff_product_mismatch', 400);
      if (tariff.is_active === false) return errorResponse('tariff_inactive', 400);
    }

    // ── Resolve offer ──
    // Если offer_id передан — используем его. Иначе берём primary pay_now offer тарифа.
    let resolvedOfferId: string | null = offer_id;
    let canonicalAmountByn: number;
    if (resolvedOfferId) {
      const { data: offer } = await supabase
        .from('tariff_offers')
        .select('id, tariff_id, amount, is_active, offer_type')
        .eq('id', resolvedOfferId)
        .maybeSingle();
      if (!offer) return errorResponse('offer_not_found', 404);
      if (offer.tariff_id !== tariff_id) return errorResponse('offer_tariff_mismatch', 400);
      if (!offer.is_active) return errorResponse('offer_inactive', 400);
      if (offer.offer_type !== 'pay_now') return errorResponse('offer_not_pay_now', 400);
      canonicalAmountByn = Number(offer.amount);
    } else {
      const { data: primary } = await supabase
        .from('tariff_offers')
        .select('id, amount, is_primary, sort_order')
        .eq('tariff_id', tariff_id)
        .eq('is_active', true)
        .eq('offer_type', 'pay_now')
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!primary) return errorResponse('no_active_pay_now_offer', 404);
      resolvedOfferId = primary.id;
      canonicalAmountByn = Number(primary.amount);
    }

    if (!Number.isFinite(canonicalAmountByn) || canonicalAmountByn < 1) {
      return errorResponse('invalid_canonical_amount', 500);
    }

    const canonicalAmountKopecks = Math.round(canonicalAmountByn * 100);

    // ── Price guard (server is source of truth) ──
    if (expected_amount !== canonicalAmountKopecks) {
      console.warn('[bridge-link] price_mismatch', {
        user: authUser.id,
        product_id,
        tariff_id,
        offer_id: resolvedOfferId,
        expected: expected_amount,
        canonical: canonicalAmountKopecks,
      });
      return errorResponse('price_mismatch', 422);
    }

    // ── Anti-duplicate: existing active bridge link for same user/scope (60s) ──
    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: existing } = await supabase
      .from('payment_links')
      .select('id, url_token, public_url, expires_at, current_uses, status, meta, offer_id, amount, currency')
      .eq('user_id', authUser.id)
      .eq('product_id', product_id)
      .eq('tariff_id', tariff_id)
      .eq('payment_type', 'one_time')
      .eq('status', 'active')
      .eq('current_uses', 0)
      .eq('amount', canonicalAmountKopecks)
      .eq('currency', currency)
      .gte('created_at', sixtySecondsAgo)
      .order('created_at', { ascending: false })
      .limit(5);

    if (existing && existing.length > 0) {
      const reused = existing.find((row) => {
        const meta = (row as { meta?: Record<string, unknown> }).meta || {};
        const sameOffer = (row.offer_id ?? null) === (resolvedOfferId ?? null);
        const isBridge = meta.source === 'payment_dialog_saved_card_bridge';
        const notExpired = !row.expires_at || new Date(row.expires_at as string).getTime() > Date.now();
        return sameOffer && isBridge && notExpired;
      });
      if (reused) {
        return jsonResponse({
          success: true,
          url_token: reused.url_token,
          reused: true,
        });
      }
    }

    // ── Build canonical public_url (server-side, never trust window.location) ──
    const rawPrimaryDomain: string | null = (product as { primary_domain?: string | null })?.primary_domain ?? null;
    const primaryDomain = rawPrimaryDomain ? rawPrimaryDomain.trim().toLowerCase() : null;
    const primaryDomainValid =
      !!primaryDomain &&
      VALID_DOMAIN_RE.test(primaryDomain) &&
      !FORBIDDEN_HOST_RE.test(primaryDomain);
    const canonicalOrigin = primaryDomainValid ? `https://${primaryDomain}` : CANONICAL_PUBLIC_HOST;

    if (!/^https:\/\//.test(canonicalOrigin) || FORBIDDEN_HOST_RE.test(canonicalOrigin)) {
      console.error('[bridge-link] invalid canonical origin:', canonicalOrigin);
      return errorResponse('internal_invalid_origin', 500);
    }

    const tokenBytes = new Uint8Array(16);
    crypto.getRandomValues(tokenBytes);
    const url_token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const public_url = `${canonicalOrigin}/pay/${url_token}`;
    const expires_at = new Date(Date.now() + 15 * 60_000).toISOString();

    const meta = {
      source: 'payment_dialog_saved_card_bridge',
      internal: true,
      created_for_user: authUser.id,
      expires_reason: 'saved_card_bridge_15min',
    };

    const { data: link, error: insertErr } = await supabase
      .from('payment_links')
      .insert({
        product_id,
        tariff_id,
        offer_id: resolvedOfferId,
        amount: canonicalAmountKopecks,
        currency,
        payment_type: 'one_time',
        description,
        max_uses: 1,
        user_id: authUser.id,
        created_by: authUser.id,
        url_token,
        public_url,
        expires_at,
        meta,
      })
      .select('id, url_token')
      .single();

    if (insertErr || !link) {
      console.error('[bridge-link] insert failed:', insertErr);
      return errorResponse(`insert_failed: ${insertErr?.message ?? 'unknown'}`, 500);
    }

    // ── Audit ──
    await supabase.from('audit_logs').insert({
      actor_type: 'user',
      actor_user_id: authUser.id,
      action: 'payment_link.bridge_created',
      actor_label: 'payment-dialog-create-bridge-link',
      meta: {
        payment_link_id: link.id,
        url_token: link.url_token,
        product_id,
        tariff_id,
        offer_id: resolvedOfferId,
        amount: canonicalAmountKopecks,
        currency,
        source: 'payment_dialog_saved_card_bridge',
      },
    });

    return jsonResponse({
      success: true,
      url_token: link.url_token,
    });
  } catch (e) {
    console.error('[bridge-link] unexpected error:', e);
    return errorResponse('internal_error', 500);
  }
});
