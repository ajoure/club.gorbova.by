/**
 * public-create-installment-link
 *
 * НАЗНАЧЕНИЕ: создать public payment_links для installment-оффера с лендинговой
 * кнопки (PaymentDialog). Гость или авторизованный — оба сценария поддерживаются.
 *
 * ЯВНЫЕ ГРАНИЦЫ (Public Link Writer Standard):
 *   • НЕ создаёт orders_v2.
 *   • НЕ вызывает bePaid.
 *   • НЕ создаёт checkout/redirect_url.
 *   • Только INSERT в payment_links + возврат { url_token } для редиректа на /pay/:token.
 *
 * Gate рассрочки: payment_method='internal_installment' (НЕ is_installment).
 *
 * Контракт meta.installment (sync с public-checkout/index.ts:194):
 *   - selected_installment_months
 *   - per_payment_amount_byn   ← ключевое поле, читает public-checkout
 *   - max_installment_months
 *   - interval_days
 *   - first_payment_delay_days
 *   - rounding_mode
 *   - installment_count, total_amount, total_installment_amount, source, offer_id (для трассировки)
 *
 * AUTH: JWT optional. Если передан — пишем created_by; user_id ссылки = NULL
 * (плательщик резолвится в public-checkout как любой email).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';

interface CreateInstallmentLinkRequest {
  product_id: string;
  tariff_id?: string | null;
  offer_id: string;
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

    // Optional JWT — для аудита/трассировки. Не блокируем гостей.
    let authUserId: string | null = null;
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      const { data: userData } = await supabase.auth.getUser(token);
      if (userData?.user?.id) authUserId = userData.user.id;
    }

    const body = (await req.json().catch(() => ({}))) as CreateInstallmentLinkRequest;
    const { product_id, tariff_id: tariffIdInput, offer_id } = body;

    if (!product_id || typeof product_id !== 'string') {
      return errorResponse('missing_product_id', 400);
    }
    if (!offer_id || typeof offer_id !== 'string') {
      return errorResponse('missing_offer_id', 400);
    }

    // ── Resolve product ──
    const { data: product } = await supabase
      .from('products_v2')
      .select('id, is_active, primary_domain')
      .eq('id', product_id)
      .maybeSingle();
    if (!product) return errorResponse('product_not_found', 404);
    if (product.is_active === false) return errorResponse('product_inactive', 400);

    // ── Resolve offer + installment validation ──
    const { data: offer } = await supabase
      .from('tariff_offers')
      .select('id, tariff_id, amount, is_active, offer_type, payment_method, installment_count, installment_interval_days, first_payment_delay_days, meta')
      .eq('id', offer_id)
      .maybeSingle();
    if (!offer) return errorResponse('offer_not_found', 404);
    if (!offer.is_active) return errorResponse('offer_inactive', 400);
    if (offer.offer_type !== 'pay_now') return errorResponse('offer_not_pay_now', 400);

    // Cross-check tariff
    const tariff_id = tariffIdInput || offer.tariff_id;
    if (offer.tariff_id !== tariff_id) {
      return errorResponse('offer_tariff_mismatch', 400);
    }
    const { data: tariff } = await supabase
      .from('tariffs')
      .select('id, product_id, is_active')
      .eq('id', tariff_id)
      .maybeSingle();
    if (!tariff) return errorResponse('tariff_not_found', 404);
    if (tariff.product_id !== product_id) return errorResponse('tariff_product_mismatch', 400);
    if (tariff.is_active === false) return errorResponse('tariff_inactive', 400);

    // GATE: payment_method='internal_installment'
    if (offer.payment_method !== 'internal_installment') {
      return errorResponse('not_installment_offer', 400);
    }

    const installmentCount = Number((offer as any).installment_count ?? 0);
    if (!Number.isInteger(installmentCount) || installmentCount < 2) {
      return errorResponse('installment_count_invalid', 400);
    }

    const totalByn = Number(offer.amount);
    if (!Number.isFinite(totalByn) || totalByn < 1) {
      return errorResponse('invalid_offer_amount', 500);
    }
    // round-half-up до целых BYN (см. admin-create-public-link).
    const perPaymentByn = Math.round(totalByn / installmentCount);
    if (perPaymentByn < 1) {
      return errorResponse('per_payment_too_small', 400);
    }
    const perPaymentKopecks = perPaymentByn * 100;
    const totalInstallmentByn = perPaymentByn * installmentCount;

    const intervalDays = Number((offer as any).installment_interval_days ?? 30) || 30;
    const firstDelay = Number((offer as any).first_payment_delay_days ?? 0) || 0;
    const metaMax = Number((offer as any).meta?.installment?.max_months ?? 0);
    const maxMonths = metaMax >= 2 ? metaMax : installmentCount;

    // ── Build canonical public_url ──
    const rawPrimaryDomain: string | null = (product as { primary_domain?: string | null })?.primary_domain ?? null;
    const primaryDomain = rawPrimaryDomain ? rawPrimaryDomain.trim().toLowerCase() : null;
    const primaryDomainValid =
      !!primaryDomain &&
      VALID_DOMAIN_RE.test(primaryDomain) &&
      !FORBIDDEN_HOST_RE.test(primaryDomain);
    const canonicalOrigin = primaryDomainValid ? `https://${primaryDomain}` : CANONICAL_PUBLIC_HOST;

    if (!/^https:\/\//.test(canonicalOrigin) || FORBIDDEN_HOST_RE.test(canonicalOrigin)) {
      console.error('[public-create-installment-link] invalid canonical origin:', canonicalOrigin);
      return errorResponse('internal_invalid_origin', 500);
    }

    const tokenBytes = new Uint8Array(16);
    crypto.getRandomValues(tokenBytes);
    const url_token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const public_url = `${canonicalOrigin}/pay/${url_token}`;
    // 24h окно — гость может вернуться завершить оплату.
    const expires_at = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

    const installmentBlock = {
      payment_method: 'internal_installment',
      max_installment_months: maxMonths,
      selected_installment_months: installmentCount,
      installment_count: installmentCount,
      interval_days: intervalDays,
      first_payment_delay_days: firstDelay,
      total_amount: totalByn,
      per_payment_amount: perPaymentByn,
      // Canonical key для public-checkout/index.ts:194-196.
      per_payment_amount_byn: perPaymentByn,
      total_installment_amount: totalInstallmentByn,
      rounding_mode: 'round_half_up_byn',
      source: 'landing_payment_dialog',
      offer_id: offer.id,
    };

    const meta = {
      source: 'landing_payment_dialog_installment',
      internal: false,
      installment: installmentBlock,
    };

    const { data: link, error: insertErr } = await supabase
      .from('payment_links')
      .insert({
        product_id,
        tariff_id,
        offer_id: offer.id,
        amount: perPaymentKopecks,
        currency: 'BYN',
        payment_type: 'one_time',
        description: null,
        max_uses: 1,
        // user_id = NULL — payer резолвится на /pay/:token.
        user_id: null,
        created_by: authUserId,
        url_token,
        public_url,
        expires_at,
        meta,
      })
      .select('id, url_token, public_url')
      .single();

    if (insertErr || !link) {
      console.error('[public-create-installment-link] insert failed:', insertErr);
      return errorResponse(`insert_failed: ${insertErr?.message ?? 'unknown'}`, 500);
    }

    // ── Audit ──
    await supabase.from('audit_logs').insert({
      actor_type: authUserId ? 'user' : 'system',
      actor_user_id: authUserId,
      action: 'payment_link.installment_landing_created',
      actor_label: 'public-create-installment-link',
      meta: {
        payment_link_id: link.id,
        url_token: link.url_token,
        product_id,
        tariff_id,
        offer_id: offer.id,
        per_payment_amount_byn: perPaymentByn,
        installment_count: installmentCount,
        total_installment_amount_byn: totalInstallmentByn,
        source: 'landing_payment_dialog',
      },
    });

    return jsonResponse({
      success: true,
      url_token: link.url_token,
      public_url: link.public_url,
      installment: {
        installment_count: installmentCount,
        per_payment_amount_byn: perPaymentByn,
        total_installment_amount_byn: totalInstallmentByn,
      },
    });
  } catch (e) {
    console.error('[public-create-installment-link] unexpected error:', e);
    return errorResponse('internal_error', 500);
  }
});
