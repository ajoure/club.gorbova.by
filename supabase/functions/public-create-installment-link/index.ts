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
 * AUTH: JWT optional. Если передан — link.user_id = auth user (has_target_user
 * на /pay/:token, без повторного email). Гость — user_id=NULL, резолвится по email.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  resolveInstallmentRetryPolicy,
  resolveBepaidAttemptsValue,
  ProviderUnlimitedAttemptsNotSupportedError,
} from '../_shared/installment-retry-policy.ts';
import { getBepaidCredsStrict, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import {
  resolveChargeNotificationSnapshotForWriter,
  serializeChargeNotificationPolicy,
} from '../_shared/charge-notification-policy.ts';
import {
  calculateInstallmentPlan,
  InstallmentPlanError,
  kopecksToDecimal,
} from '../_shared/calculate-installment-plan.ts';

interface CreateInstallmentLinkRequest {
  product_id: string;
  tariff_id?: string | null;
  offer_id: string;
  // B9. Публичный клиент выбирает N платежей. Если max=2 и поле отсутствует —
  // берём 2. Если max>2 и поле отсутствует — 400 installment_months_required.
  selected_installment_months?: number | null;
}

// SINGLE SOURCE OF TRUTH: все payment ссылки строятся на https://gorbova.by.
// product.primary_domain НЕ используется для payment origin.
const CANONICAL_PUBLIC_HOST = 'https://gorbova.by';
const FORBIDDEN_HOST_RE = /(lovable\.dev|lovable\.app|lovableproject\.com|localhost|127\.0\.0\.1)/i;

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
    if ((offer as any).offer_type === 'invoice') return errorResponse('offer_type_invoice_not_chargeable', 400);
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

    // B9. В tariff_offers.installment_count хранится max_months (2..12).
    const maxMonthsColumn = Number((offer as any).installment_count ?? 0);
    if (!Number.isInteger(maxMonthsColumn) || maxMonthsColumn < 2) {
      return errorResponse('installment_count_invalid', 400);
    }

    // B9. Выбор клиента (N платежей). Default: если max=2 и не передано — 2.
    const requestedSel = body.selected_installment_months;
    let selectedMonths: number;
    if (requestedSel === null || requestedSel === undefined) {
      if (maxMonthsColumn === 2) {
        selectedMonths = 2;
      } else {
        return errorResponse('installment_months_required', 400);
      }
    } else {
      const n = Number(requestedSel);
      if (!Number.isInteger(n) || n < 2 || n > maxMonthsColumn) {
        return errorResponse('installment_months_out_of_range', 400);
      }
      selectedMonths = n;
    }

    const totalByn = Number(offer.amount);
    if (!Number.isFinite(totalByn) || totalByn < 1) {
      return errorResponse('invalid_offer_amount', 500);
    }
    const totalKopecks = Math.round(totalByn * 100);
    let plan;
    try {
      plan = calculateInstallmentPlan({
        total_amount_kopecks: totalKopecks,
        selected_cycles: selectedMonths,
      });
    } catch (e) {
      if (e instanceof InstallmentPlanError) {
        return errorResponse(e.code, 400);
      }
      throw e;
    }
    const perPaymentByn = kopecksToDecimal(plan.per_payment_kopecks);
    if (perPaymentByn < 1) {
      return errorResponse('per_payment_too_small', 400);
    }
    const perPaymentKopecks = plan.per_payment_kopecks;
    const totalInstallmentByn = kopecksToDecimal(plan.effective_total_kopecks);
    const roundingDeltaByn = kopecksToDecimal(plan.rounding_delta_kopecks);

    const rawInterval = (offer as any).installment_interval_days ?? 30;
    const intervalDays = Number(rawInterval);
    if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
      return errorResponse('invalid_installment_interval_days', 400);
    }
    const rawFirstDelay = (offer as any).first_payment_delay_days ?? 0;
    const firstDelay = Number(rawFirstDelay);
    if (!Number.isInteger(firstDelay) || firstDelay < 0 || firstDelay > 365) {
      return errorResponse('invalid_first_payment_delay_days', 400);
    }
    const metaMax = Number((offer as any).meta?.installment?.max_months ?? 0);
    const maxMonths = metaMax >= 2 ? metaMax : maxMonthsColumn;

    let retryPolicy;
    try {
      retryPolicy = resolveInstallmentRetryPolicy(
        (offer as any).meta?.installment?.max_charge_attempts,
      );
    } catch (_e) {
      return errorResponse('invalid_installment_max_charge_attempts', 400);
    }

    // P0.2 — Capability preflight ДО INSERT в payment_links.
    // Публичный endpoint → возвращаем ТОЛЬКО нейтральный текст.
    // Внутренний код фиксируем в audit_logs.
    if (retryPolicy.mode === 'unlimited_requested') {
      const publicInstallmentUnavailable = () =>
        jsonResponse({
          success: false,
          error_code: 'installment_temporarily_unavailable',
          error: 'Рассрочка по этому тарифу временно недоступна. Обратитесь к менеджеру.',
          message: 'Рассрочка по этому тарифу временно недоступна. Обратитесь к менеджеру.',
        }, 400);

      const bepaidCreds = await getBepaidCredsStrict(supabase);
      if (isBepaidCredsError(bepaidCreds)) {
        const { error: auditError } = await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_label: 'public-create-installment-link',
          action: 'installment.retry_policy.preflight_blocked',
          meta: {
            offer_id,
            tariff_id: (offer as any).tariff_id ?? null,
            product_id,
            reason: 'bepaid_not_configured',
            source: 'public-create-installment-link',
          },
        });
        if (auditError) {
          console.error('[installment-preflight] audit insert failed', {
            error: auditError.message,
            offer_id,
            source: 'public-create-installment-link',
          });
        }
        return publicInstallmentUnavailable();
      }
      try {
        resolveBepaidAttemptsValue({
          retryPolicy,
          capability: bepaidCreds.subscription_attempts_capability,
        });
      } catch (e) {
        if (e instanceof ProviderUnlimitedAttemptsNotSupportedError) {
          const { error: auditError } = await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_label: 'public-create-installment-link',
            action: 'installment.retry_policy.preflight_blocked',
            meta: {
              offer_id,
              tariff_id: (offer as any).tariff_id ?? null,
              product_id,
              reason: e.reason,
              source: 'public-create-installment-link',
            },
          });
          if (auditError) {
            console.error('[installment-preflight] audit insert failed', {
              error: auditError.message,
              offer_id,
              source: 'public-create-installment-link',
            });
          }
          return publicInstallmentUnavailable();
        }
        throw e;
      }
    }

    // ── Build canonical public_url ──
    // ВСЕГДА https://gorbova.by — независимо от продукта.
    const canonicalOrigin = CANONICAL_PUBLIC_HOST;
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

    // B2. Snapshot charge_notifications policy at link creation time.
    // Precedence: (no link meta yet) → live offer meta → legacy → defaults.
    const chargeNotifPolicy = resolveChargeNotificationSnapshotForWriter({
      offerMeta: (offer as any)?.meta,
    });
    const chargeNotifSnapshot = serializeChargeNotificationPolicy(chargeNotifPolicy);

    const installmentBlock = {
      payment_method: 'internal_installment',
      max_installment_months: maxMonths,
      selected_installment_months: selectedMonths,
      installment_count: selectedMonths,
      interval_days: intervalDays,
      first_payment_delay_days: firstDelay,
      total_amount: totalByn,
      per_payment_amount: perPaymentByn,
      // Canonical key для public-checkout/index.ts:194-196.
      per_payment_amount_byn: perPaymentByn,
      total_installment_amount: totalInstallmentByn,
      // B9. Canonical rounding snapshot fields.
      requested_total_byn: totalByn,
      per_payment_byn: perPaymentByn,
      effective_total_byn: totalInstallmentByn,
      rounding_delta_byn: roundingDeltaByn,
      rounding_mode: 'ceil_to_whole_byn',
      source: 'landing_payment_dialog',
      offer_id: offer.id,
      as_finite_subscription: true,
      billing_cycles: selectedMonths,
      // Retry policy — единый парсер (_shared/installment-retry-policy.ts).
      max_charge_attempts: retryPolicy.configured_value,
      retry_policy_mode: retryPolicy.mode,
      // B2. Canonical charge_notifications snapshot (installment scope).
      charge_notifications: chargeNotifSnapshot,
      charge_notifications_source: chargeNotifPolicy.source,
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
        // PATCH INSTALLMENT-SUB-FIX: installment-ссылка — это finite bePaid subscription
        // (billing_cycles = installment_count). Ранее было 'one_time' → shared checkout
        // уходил в разовую ветку и не создавал subscription. См. .lovable/plan.md.
        payment_type: 'subscription',
        description: null,
        max_uses: 1,
        // Если пользователь авторизован — привязываем ссылку к нему,
        // тогда PublicPayPage работает в режиме has_target_user=true
        // и не требует повторного ввода email / входа.
        // Гости (authUserId=null) резолвятся на /pay/:token как раньше.
        user_id: authUserId,
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
        installment_count: selectedMonths,
        total_installment_amount_byn: totalInstallmentByn,
        source: 'landing_payment_dialog',
      },
    });

    return jsonResponse({
      success: true,
      url_token: link.url_token,
      public_url: link.public_url,
      installment: {
        installment_count: selectedMonths,
        per_payment_amount_byn: perPaymentByn,
        total_installment_amount_byn: totalInstallmentByn,
      },
    });
  } catch (e) {
    console.error('[public-create-installment-link] unexpected error:', e);
    return errorResponse('internal_error', 500);
  }
});
