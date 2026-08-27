/**
 * admin-create-public-link
 *
 * НАЗНАЧЕНИЕ: единственный канонический writer для public payment_links (/pay/:token).
 *
 * ЯВНЫЕ ГРАНИЦЫ (anti-duplication guard):
 *   • НЕ создаёт orders_v2.
 *   • НЕ вызывает bePaid.
 *   • НЕ создаёт checkout/redirect_url.
 *   • Только INSERT в payment_links + возврат публичного URL вида https://<origin>/pay/<token>.
 *
 * Реальный платёж по этому row создаётся позже:
 *   /pay/:token → public-checkout (POST) → _shared/create-payment-checkout.ts
 * Это тот же canonical downstream-path. Второй payment-path не вводится.
 *
 * AUTH: JWT обязателен. Требуется доступ payments:edit; admin/super_admin
 * получают его через канонический RBAC bypass.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  ComposableCheckoutError,
  resolveComposableCheckout,
  type ResolvedComposableCheckout,
} from '../_shared/resolve-composable-checkout.ts';
import { resolveBusinessStream } from '../_shared/acquiring/business-stream-resolver.ts';
import { requirePaymentsEdit } from '../_shared/admin-section-auth.ts';
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

interface CreatePublicLinkRequest {
  product_id: string;
  tariff_id: string;
  offer_id?: string | null;
  amount: number; // BYN kopecks (полная стоимость, для installment — total)
  currency?: string;
  payment_type?: 'one_time' | 'subscription';
  description?: string | null;
  max_uses?: number | null;
  expires_at?: string | null; // ISO
  user_id?: string | null; // optional pre-assignment
  // Audit / трассировка контракта (writer не использует для решений, только пишет в audit_logs)
  requested_payment_type?: 'one_time' | 'subscription';
  resolved_mode?: 'canonical' | 'override';
  cta_source?: 'admin_manual' | 'reminder' | 'contact_card' | 'telegram_combined' | string;
  cta_contract_version?: number;
  // Stage L: installment
  installment_offer?: boolean;
  selected_installment_months?: number;
  // Phase 4.1 — provider routing for public payment link
  provider?: 'bepaid' | 'stripe';
  account_code?: string | null;
  // Phase 5-C — provider_mode для пользовательского выбора.
  // 'fixed' (default, backward-compat) — ссылка жёстко привязана к provider.
  // 'customer_choice' — на /pay/:token покупатель выбирает между bepaid и stripe.
  provider_mode?: 'fixed' | 'customer_choice';
  // Phase 5-D — был ли provider выбран админом явно ('explicit') или взят из настроек кнопки ('auto').
  // Используется только для audit: 'explicit' → пишем admin.payment_provider.override.
  provider_choice_source?: 'auto' | 'explicit';
  // «Клиент выбирает» override (Phase 6-G/H boundary): explicit override allowed_payment_providers
  // поверх offer.meta.acquiring.allowed_payment_providers. Применяется ТОЛЬКО для
  // provider_mode='customer_choice' + provider_choice_source='explicit'. Не изменяет offer.
  allowed_payment_providers?: ('bepaid' | 'stripe')[];
  // Stripe-валюта для price provisioning, когда provider_mode='customer_choice' и stripe в list.
  // link.currency при этом остаётся BYN (bepaid-домен).
  stripe_currency?: string;
  // Phase 6 hot-patch: explicit business_stream override на ссылку (низший приоритет в резолвере).
  // SOT остаётся offer.meta → product.meta (см. shared resolveBusinessStream).
  business_stream?: string | null;
  composable_quote?: Record<string, unknown> | null;
}

// Phase 7-EXEC — Canonical resolver SOT.
// STRIPE_ALLOWED_CURRENCIES оставлен только как тонкая обёртка для обратной совместимости
// логов / error-кодов; реальная проверка теперь идёт через resolveAvailableProviders.
import {
  resolveAvailableProviders,
  type PaymentProvider as ResolverProvider,
} from '../_shared/acquiring/currency-provider-resolver.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const access = await requirePaymentsEdit(req, supabase);
    if (!access.ok) return errorResponse(access.error, access.status);
    const user = access.actor;
    const { data: isSuperRole } = await supabase.rpc('has_role_v2', {
      _user_id: user.id,
      _role_code: 'super_admin',
    });
    const isSuper = isSuperRole === true;

    const body: CreatePublicLinkRequest = await req.json();
    const {
      product_id, tariff_id, offer_id, amount,
      currency: rawCurrency,
      payment_type: rawPaymentType = 'one_time',
      description = null, max_uses = null, expires_at = null, user_id = null,
      requested_payment_type, resolved_mode, cta_source, cta_contract_version,
      installment_offer = false, selected_installment_months,
      provider: rawProvider,
      account_code: rawAccountCode = null,
      provider_mode: rawProviderMode,
      provider_choice_source: rawProviderChoiceSource,
      allowed_payment_providers: rawAllowedProvidersExplicit,
      stripe_currency: rawStripeCurrency,
      business_stream: rawBusinessStream = null,
      composable_quote: rawComposableQuote = null,
    } = body;
    let payment_type: 'one_time' | 'subscription' = rawPaymentType;
    const providerMode: 'fixed' | 'customer_choice' =
      rawProviderMode === 'customer_choice' ? 'customer_choice' : 'fixed';
    const provider: 'bepaid' | 'stripe' = rawProvider === 'stripe' ? 'stripe' : 'bepaid';
    const providerChoiceSource: 'auto' | 'explicit' =
      rawProviderChoiceSource === 'explicit' ? 'explicit' : 'auto';
    const currency = (rawCurrency ?? (provider === 'stripe' ? 'EUR' : 'BYN')).toUpperCase();

    // ── Validate required ──
    if (!product_id || !tariff_id || !amount) {
      return errorResponse('Missing required: product_id, tariff_id, amount', 400);
    }
    if (amount < 100) return errorResponse('Minimum amount is 100 kopecks (1 BYN)', 400);
    if (!['one_time', 'subscription'].includes(payment_type)) {
      return errorResponse('Invalid payment_type', 400);
    }

    // ── Validate referential integrity ──
    const { data: product } = await supabase
      .from('products_v2').select('id, is_active, primary_domain').eq('id', product_id).maybeSingle();
    if (!product) return errorResponse('Product not found', 400);
    if (product.is_active === false) return errorResponse('Product is not active', 400);

    const { data: tariff } = await supabase
      .from('tariffs').select('id, product_id, is_active').eq('id', tariff_id).maybeSingle();
    if (!tariff) return errorResponse('Tariff not found', 400);
    if (tariff.product_id !== product_id) {
      return errorResponse('Tariff does not belong to product', 400);
    }
    if (tariff.is_active === false) return errorResponse('Tariff is not active', 400);

    // ── Override-safety: у тарифа должен существовать хотя бы один active pay_now offer.
    //    Это защищает от создания one_time ссылки на основе мёртвого/архивного offer'а.
    //    ВАЖНО: НЕ блокируем по recurring-flag — payment_type ссылки = выбору источника CTA.
    const { data: anyActiveOffer } = await supabase
      .from('tariff_offers')
      .select('id')
      .eq('tariff_id', tariff_id)
      .eq('is_active', true)
      .eq('offer_type', 'pay_now')
      .limit(1)
      .maybeSingle();
    if (!anyActiveOffer) {
      return errorResponse('Tariff has no active pay_now offer (override forbidden)', 400);
    }

    // ── Если передан offer_id — он должен быть active pay_now этого тарифа.
    let offerIsRecurring: boolean | null = null;
    let offerPaymentMethod: string | null = null;
    let offerInstallmentMaxMonths: number | null = null;
    let offerInstallmentCountLegacy: number | null = null;
    // Phase 5-C — snapshot acquiring из оффера для customer_choice ссылок.
    let offerAllowedProviders: ('bepaid' | 'stripe')[] = [];
    let offerStripeAccountCode: string | null = null;
    let resolvedOffer: any = null;
    if (offer_id) {
      const { data: loadedOffer } = await supabase
        .from('tariff_offers')
        .select('id, tariff_id, is_active, offer_type, payment_method, amount, installment_count, installment_interval_days, first_payment_delay_days, meta')
        .eq('id', offer_id).maybeSingle();
      if (!loadedOffer) return errorResponse('Offer not found', 400);
      if (loadedOffer.tariff_id !== tariff_id) return errorResponse('Offer does not belong to tariff', 400);
      if (!loadedOffer.is_active) return errorResponse('Offer is not active', 400);
      if ((loadedOffer as any).offer_type === 'invoice') return errorResponse('offer_type_invoice_not_chargeable', 400);
      if (loadedOffer.offer_type !== 'pay_now') return errorResponse('Offer is not a pay_now offer', 400);
      resolvedOffer = loadedOffer;
      offerIsRecurring = !!(resolvedOffer as any).meta?.recurring?.is_recurring;
      offerPaymentMethod = (resolvedOffer as any).payment_method ?? null;
      offerInstallmentCountLegacy = Number((resolvedOffer as any).installment_count ?? 0) || null;
      // Priority: precise installment_count > legacy meta.installment.max_months.
      const metaMax = Number((resolvedOffer as any).meta?.installment?.max_months ?? 0);
      offerInstallmentMaxMonths =
        (offerInstallmentCountLegacy && offerInstallmentCountLegacy >= 2)
          ? offerInstallmentCountLegacy
          : (metaMax >= 2 ? metaMax : null);
      const acq = (resolvedOffer as any).meta?.acquiring;
      if (Array.isArray(acq?.allowed_payment_providers)) {
        offerAllowedProviders = acq.allowed_payment_providers.filter(
          (p: any) => p === 'bepaid' || p === 'stripe'
        );
      }
      if (acq?.stripe?.account_code) offerStripeAccountCode = String(acq.stripe.account_code);
    }
    if (offerAllowedProviders.length === 0) {
      // Legacy / offer без acquiring meta → backward-compat: только bepaid.
      offerAllowedProviders = ['bepaid'];
    }

    // «Клиент выбирает» override (Phase 6-G/H boundary).
    // Если admin прислал explicit allowed_payment_providers вместе с provider_mode='customer_choice'
    // и provider_choice_source='explicit' — применяем override поверх offer.allowed_payment_providers.
    // Override живёт ТОЛЬКО в payment_links; offer/tariff не модифицируется.
    let effectiveAllowedProviders: ('bepaid' | 'stripe')[] = offerAllowedProviders;
    let allowedProvidersOverride = false;
    const explicitAllowedList = Array.isArray(rawAllowedProvidersExplicit)
      ? Array.from(
          new Set(
            rawAllowedProvidersExplicit.filter(
              (p: any) => p === 'bepaid' || p === 'stripe',
            ),
          ),
        )
      : null;
    if (
      providerMode === 'customer_choice' &&
      providerChoiceSource === 'explicit' &&
      explicitAllowedList &&
      explicitAllowedList.length > 0
    ) {
      effectiveAllowedProviders = explicitAllowedList as ('bepaid' | 'stripe')[];
      allowedProvidersOverride = true;
    }

    // ── Phase 5-C / 5-D / Hotfix admin_provider_override_v1: validation per provider_mode ──
    //
    // Контракт:
    //   • offer.allowed_payment_providers = настройка ПУБЛИЧНОЙ кнопки на сайте.
    //   • Admin-created payment link (карточка контакта / админ-диалог) = OVERRIDE
    //     на уровне конкретной ссылки. tariff_offers.meta.acquiring НЕ изменяется.
    //
    //   • providerChoiceSource='auto'     → «По настройке кнопки» (UI),
    //                                       guard offer.allowed применяется.
    //   • providerChoiceSource='explicit' → admin явно выбрал bePaid/Stripe/customer_choice,
    //                                       guard offer.allowed НЕ применяется.
    //                                       Валидируются ТОЛЬКО технические условия
    //                                       (currency × provider × account_code × installment)
    //                                       — Step 1 (bePaid) и Step 2 (Stripe) ниже.
    //
    // super_admin bypass остаётся safety-net для auto-режима; обычные admin'ы получают
    // override через explicit flag без super_admin.
    let superAdminBypass = false;
    if (providerMode === 'fixed' && providerChoiceSource === 'auto') {
      if (!offerAllowedProviders.includes(provider)) {
        if (isSuper) {
          superAdminBypass = true;
        } else {
          return errorResponse(`provider_not_allowed_by_offer:${provider}`, 400);
        }
      }
    } else if (providerMode === 'customer_choice') {
      if (effectiveAllowedProviders.length < 1) {
        return errorResponse('customer_choice_requires_at_least_one_provider', 400);
      }
      if (
        effectiveAllowedProviders.includes('stripe') &&
        (installment_offer || offerPaymentMethod === 'internal_installment')
      ) {
        return errorResponse('customer_choice_not_supported_for_installment', 400);
      }
    }
    // providerMode === 'fixed' && providerChoiceSource === 'explicit'
    // → НЕ блокируем по offer.allowed_payment_providers. Технические проверки
    //   (валюта по resolver, account_code, capability snapshot, installment guard,
    //   Stripe price provisioning) выполняются в Step 1 / Step 2 ниже.


    // ── Stage L: installment validation + расчёт сумм ──
    // Контракт:
    //   • installment_offer=true ↔ offer.payment_method='internal_installment'.
    //   • selected_installment_months: integer, 2..max_months.
    //   • payment_type ссылки для installment = 'subscription' (finite bePaid subscription).
    //   • amount ссылки = per_payment_kopecks; total — в meta.installment.
    let installmentBlock: Record<string, unknown> | null = null;
    let installmentLinkAmountKopecks: number | null = null;
    let pendingInstallmentAudit: Record<string, unknown> | null = null;
    if (installment_offer || offerPaymentMethod === 'internal_installment') {
      if (!resolvedOffer) {
        return errorResponse('installment_offer_id_required', 400);
      }
      if (offerPaymentMethod !== 'internal_installment') {
        return errorResponse('Offer is not an installment offer', 400);
      }
      if (!offerInstallmentMaxMonths || offerInstallmentMaxMonths < 2) {
        return errorResponse('Installment offer has no valid installment_count', 400);
      }
      // Admin path: количество платежей всегда 2..12 (не ограничивается настройкой оффера).
      // Админ может создать индивидуальную ссылку с любым N вне зависимости от кнопки.
      const sel = Number(selected_installment_months);
      if (!Number.isInteger(sel) || sel < 2 || sel > 12) {
        return errorResponse('invalid_installment_months', 400);
      }
      // amount приходит в копейках = ПОЛНАЯ стоимость (UI всегда шлёт total).
      // B9. Backend SoT — calculate-installment-plan (shared helper).
      let plan;
      try {
        plan = calculateInstallmentPlan({
          total_amount_kopecks: amount,
          selected_cycles: sel,
        });
      } catch (e) {
        if (e instanceof InstallmentPlanError) {
          return errorResponse(e.code, 400);
        }
        throw e;
      }
      const totalByn = kopecksToDecimal(amount);
      const perPaymentByn = kopecksToDecimal(plan.per_payment_kopecks);
      const totalInstallmentByn = kopecksToDecimal(plan.effective_total_kopecks);
      const roundingDeltaByn = kopecksToDecimal(plan.rounding_delta_kopecks);
      if (perPaymentByn < 1) {
        return errorResponse('per_payment_too_small', 400);
      }
      const perPaymentKopecks = plan.per_payment_kopecks;

      // PATCH INSTALLMENT-RETRY-POLICY: интервал и попытки берутся из оффера.
      const rawInterval = resolvedOffer.installment_interval_days ?? 30;
      const intervalDays = Number(rawInterval);
      if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
        return errorResponse('invalid_installment_interval_days', 400);
      }
      const rawFirstDelay = resolvedOffer.first_payment_delay_days ?? 0;
      const firstDelayDays = Number(rawFirstDelay);
      if (!Number.isInteger(firstDelayDays) || firstDelayDays < 0 || firstDelayDays > 365) {
        return errorResponse('invalid_first_payment_delay_days', 400);
      }

      let retryPolicy;
      try {
        retryPolicy = resolveInstallmentRetryPolicy(
          resolvedOffer.meta?.installment?.max_charge_attempts,
        );
      } catch (_e) {
        return errorResponse('invalid_installment_max_charge_attempts', 400);
      }

      // P0.2 — Capability preflight ДО INSERT в payment_links.
      // Если оффер требует unlimited attempts, а bePaid capability не proven,
      // блокируем создание ссылки с понятной ошибкой.
      if (retryPolicy.mode === 'unlimited_requested') {
        const bepaidCreds = await getBepaidCredsStrict(supabase);
        if (isBepaidCredsError(bepaidCreds)) {
          return errorResponse(
            'Не удалось проверить конфигурацию bePaid для рассрочки. Обратитесь к администратору.',
            500,
          );
        }
        try {
          resolveBepaidAttemptsValue({
            retryPolicy,
            capability: bepaidCreds.subscription_attempts_capability,
          });
        } catch (e) {
          if (e instanceof ProviderUnlimitedAttemptsNotSupportedError) {
            const { error: auditError } = await supabase.from('audit_logs').insert({
              actor_type: 'user',
              actor_user_id: user.id,
              actor_label: 'admin-create-public-link',
              action: 'installment.retry_policy.preflight_blocked',
              meta: {
                product_id, tariff_id, offer_id: offer_id ?? null,
                reason: e.reason,
                source: 'admin-create-public-link',
              },
            });
            if (auditError) {
              console.error('[installment-preflight] audit insert failed', {
                error: auditError.message,
                offer_id: offer_id ?? null,
                source: 'admin-create-public-link',
              });
            }
            return jsonResponse({
              success: false,
              error_code: 'provider_unlimited_attempts_not_supported',
              error:
                'Настройка оффера «без ограничения попыток списания» не подтверждена платёжным провайдером. Задайте лимит от 1 до 10 в настройках оффера и повторите создание ссылки.',
            }, 400);
          }
          throw e;
        }
      }

      // B2. Snapshot charge_notifications policy at link creation time
      // (installment path). Precedence: live offer meta → legacy → defaults.
      const chargeNotifPolicy = resolveChargeNotificationSnapshotForWriter({
        offerMeta: resolvedOffer.meta,
      });
      const chargeNotifSnapshot = serializeChargeNotificationPolicy(chargeNotifPolicy);

      // Manual override detection: изменил ли админ N или сумму относительно оффера.
      // Resolve public cycles: installment_count > legacy meta.installment.max_months.
      const _metaMaxResolved = Number((resolvedOffer as any).meta?.installment?.max_months ?? 0);
      const sourceOfferPublicCycles: number | null =
        (Number.isInteger(offerInstallmentCountLegacy) &&
          (offerInstallmentCountLegacy as number) >= 2 &&
          (offerInstallmentCountLegacy as number) <= 12)
          ? (offerInstallmentCountLegacy as number)
          : (Number.isInteger(_metaMaxResolved) && _metaMaxResolved >= 2 && _metaMaxResolved <= 12
              ? _metaMaxResolved
              : null);
      const offerAmountByn = Number((resolvedOffer as any).amount ?? 0);
      const offerAmountKopecks = Math.round(offerAmountByn * 100);
      const overriddenFields: string[] = [];
      if (sourceOfferPublicCycles === null || sel !== sourceOfferPublicCycles) {
        overriddenFields.push('billing_cycles');
      }
      if (Math.round(amount) !== offerAmountKopecks) overriddenFields.push('amount');
      const manualOverride = overriddenFields.length > 0;

      installmentLinkAmountKopecks = perPaymentKopecks;
      installmentBlock = {
        payment_method: 'internal_installment',
        // Stage 1 canonical marker — internal installment via finite bePaid subscription.
        type: 'internal',
        provider: 'bepaid',
        model: 'bepaid_finite_subscription',
        infinite: false,
        max_installment_months: offerInstallmentMaxMonths,
        selected_installment_months: sel,
        interval_days: intervalDays,
        first_payment_delay_days: firstDelayDays,
        total_amount: totalByn,
        per_payment_amount: perPaymentByn,
        per_payment_amount_byn: perPaymentByn,
        total_installment_amount: totalInstallmentByn,
        requested_total_byn: totalByn,
        per_payment_byn: perPaymentByn,
        effective_total_byn: totalInstallmentByn,
        rounding_delta_byn: roundingDeltaByn,
        rounding_mode: plan.rounding_mode,
        as_finite_subscription: true,
        billing_cycles: sel,
        max_charge_attempts: retryPolicy.configured_value,
        retry_policy_mode: retryPolicy.mode,
        charge_notifications: chargeNotifSnapshot,
        charge_notifications_source: chargeNotifPolicy.source,
        // Manual override snapshot (см. .lovable/plan.md §6).
        source_offer_id: resolvedOffer.id,
        source_offer_public_cycles: sourceOfferPublicCycles,
        source_offer_amount_byn: offerAmountByn,
        manual_override: manualOverride,
        overridden_fields: overriddenFields,
      };
      payment_type = 'subscription';

      // Audit deferred until after payment_links INSERT succeeds (so we can
      // capture payment_link_id + url_token in the audit record).
      pendingInstallmentAudit = {
        contact_id: user_id ?? null,
        offer_id: resolvedOffer.id,
        public_cycles: sourceOfferPublicCycles,
        selected_cycles: sel,
        public_amount_byn: offerAmountByn,
        selected_amount_byn: totalByn,
        rounding_delta_byn: roundingDeltaByn,
        manual_override: manualOverride,
        overridden_fields: overriddenFields,
        source: 'AdminPaymentLinkDialog',
      };
    }

    // ── Phase 8 follow-up FIX — auto vs explicit recurring handling ──
    // Контракт (Core rule «Product Type SOT» + admin override):
    //
    //   provider_choice_source='auto'    → система следует SOT оффера.
    //                                       recurring offer + Stripe path + one_time →
    //                                       promote to subscription, audit
    //                                       `payment_link.payment_type_promoted_recurring`.
    //
    //   provider_choice_source='explicit' → админ — источник истины. payment_type НЕ форсится.
    //                                       Разрешена разовая оплата по recurring offer
    //                                       (mode=payment, без subscription). Audit
    //                                       `payment_link.payment_type_admin_override`.
    //
    // Installment отдельная ветка — payment_type уже форсится в subscription выше.
    // bePaid recurring не трогаем — legacy lifecycle сохраняется.
    let recurringPromoted = false;
    let recurringPromotedFromPaymentType: 'one_time' | 'subscription' | null = null;
    let adminOverrideRecurringOneTime = false;
    const stripePathSelected =
      (providerMode === 'fixed' && provider === 'stripe') ||
      (providerMode === 'customer_choice' && effectiveAllowedProviders.includes('stripe'));
    const recurringStripeEligible =
      offerIsRecurring === true &&
      !installmentBlock &&
      offerPaymentMethod !== 'internal_installment' &&
      stripePathSelected;

    if (recurringStripeEligible && payment_type === 'one_time') {
      if (providerChoiceSource === 'auto') {
        recurringPromotedFromPaymentType = 'one_time';
        payment_type = 'subscription';
        recurringPromoted = true;
      } else {
        // explicit override — уважаем выбор админа, payment_type остаётся one_time.
        adminOverrideRecurringOneTime = true;
      }
    }


    // ── Phase 7-EXEC — Canonical currency × provider validation ──
    // Источник истины: _shared/acquiring/currency-provider-resolver.ts.
    // STOP-логика: silent fallback BYN/EUR запрещён; несовместимые комбинации
    // currency × provider возвращают controlled 400 с reason_code,
    // payment_link при этом НЕ создаётся.
    //
    // Phase 4.1 inline-проверки (STRIPE_ALLOWED_CURRENCIES + capability snapshot)
    // унифицированы внутри resolver'а.
    let resolvedAccountCode: string | null = null;
    // PATCH-SUB-PRICE-3 (PATCH-B): snapshot для link.meta — заполняется в Stripe-subscription ветке.
    let linkMetaStripePriceMode: 'inline_override' | null = null;
    let linkMetaStripeRecurringSnapshot: { interval: string; interval_count: number } | null = null;
    const stripePathActive =
      provider === 'stripe' ||
      (providerMode === 'customer_choice' && effectiveAllowedProviders.includes('stripe'));
    // Для cc Stripe-валюта берётся из body.stripe_currency (link.currency остаётся bePaid-валютой).
    // Hotfix admin_provider_override_v1: НЕ подставляем EUR по умолчанию — fallback на валюту
    // ссылки/оффера. Это позволяет admin'у создать customer_choice ссылку с BYN для bePaid +
    // явно переданным stripe_currency=EUR/USD/PLN/BYN для Stripe-ветки.
    const stripeValidationCurrency = (
      providerMode === 'customer_choice'
        ? (rawStripeCurrency || currency)
        : currency
    ).toUpperCase();


    // ── Step 1: bePaid currency guard (P7-3) ──
    // Применяется к fixed=bepaid и к customer_choice со bePaid в allowed.
    const bepaidPathActive =
      provider === 'bepaid' ||
      (providerMode === 'customer_choice' && effectiveAllowedProviders.includes('bepaid'));
    if (bepaidPathActive) {
      const r = resolveAvailableProviders({
        currency,
        payment_type,
        candidate_providers: ['bepaid'],
        bepaid_shop_resolved: true,
      });
      if (!r.availableProviders.includes('bepaid')) {
        const reason = r.disabledProviders[0];
        return errorResponse(
          `bepaid_currency_unsupported:${currency}:${reason?.reason_code ?? 'unknown'}`,
          400,
        );
      }
    }

    // ── Step 2: Stripe path — account lookup + capability snapshot ──
    let stripeAccountSupportedCurrencies: string[] | null = null;
    if (stripePathActive) {
      const accountQuery = supabase
        .from('acquiring_connections')
        .select('account_code, status, test_mode, is_default, capabilities_snapshot')
        .eq('provider', 'stripe')
        .eq('status', 'active');
      const { data: acctRows, error: acctErr } = rawAccountCode
        ? await accountQuery.eq('account_code', rawAccountCode).limit(1)
        : await accountQuery.eq('is_default', true).limit(1);
      if (acctErr) {
        return errorResponse(`Stripe account lookup failed: ${acctErr.message}`, 500);
      }
      const acct = (acctRows ?? [])[0];
      if (!acct) {
        return errorResponse(rawAccountCode
          ? `Stripe account not found or inactive: ${rawAccountCode}`
          : 'no_active_default_stripe_account', 400);
      }
      resolvedAccountCode = (acct as any).account_code as string;

      const capSnapshot = (acct as any).capabilities_snapshot as Record<string, unknown> | null;
      const supportedCurrenciesRaw = Array.isArray((capSnapshot as any)?.supported_currencies)
        ? ((capSnapshot as any).supported_currencies as unknown[])
        : null;
      stripeAccountSupportedCurrencies = supportedCurrenciesRaw
        ? supportedCurrenciesRaw.map((c) => String(c).toLowerCase())
        : null;

      // Canonical resolver — business whitelist ∩ account capabilities ∩ installment guard.
      const r = resolveAvailableProviders({
        currency: stripeValidationCurrency,
        payment_type,
        candidate_providers: ['stripe'],
        stripe_account_supported_currencies: stripeAccountSupportedCurrencies,
        stripe_account_resolved: true,
        is_installment: !!installmentBlock,
      });
      if (!r.availableProviders.includes('stripe')) {
        const reason = r.disabledProviders[0];
        return errorResponse(
          `stripe_currency_unsupported:${stripeValidationCurrency}:${resolvedAccountCode}:${reason?.reason_code ?? 'unknown'}`,
          400,
        );
      }


      if (payment_type === 'subscription') {
        if (!offer_id) {
          return errorResponse('Stripe subscription requires offer_id', 400);
        }

        // PATCH-SUB-PRICE-3 (PATCH-B, 2026-06-09): payment-link amount/currency override parity.
        // Для link-based Stripe subscription цена/валюта берутся из payment_links.amount/currency,
        // а в Stripe Checkout передаются через line_items.price_data (inline override).
        // Глобальный tariff_offers.meta.stripe.price_id больше НЕ обязателен и НЕ provisioning-ится
        // на этапе создания ссылки — это исключает blocker billing_period_mode_not_supported
        // и сохраняет parity с bePaid/e-clearing/Pay (ссылка задаёт сумму).
        //
        // Если global price_id у оффера уже есть (legacy), он остаётся snapshot-only в meta
        // и не мешает inline-override в checkout (см. _shared/create-stripe-checkout.ts).
        const { data: offerForRecurring } = await supabase
          .from('tariff_offers')
          .select('meta')
          .eq('id', offer_id)
          .maybeSingle();
        const offerMetaRecurring = (offerForRecurring as any)?.meta ?? {};
        const recurringMeta = (offerMetaRecurring as any)?.recurring ?? {};
        const intervalRaw = String(recurringMeta?.interval ?? recurringMeta?.period ?? 'month').toLowerCase();
        const ALLOWED_INTERVALS = new Set(['day', 'week', 'month', 'year']);
        if (!ALLOWED_INTERVALS.has(intervalRaw)) {
          return errorResponse(
            `stripe_subscription_interval_not_supported:${intervalRaw}`,
            400,
          );
        }

        // Snapshot для трассировки — не источник истины (checkout всегда читает payment_links).
        linkMetaStripePriceMode = 'inline_override';
        linkMetaStripeRecurringSnapshot = {
          interval: intervalRaw,
          interval_count: Number(recurringMeta?.interval_count ?? 1) || 1,
        };
      }

    }



    // Финальная нормализация audit-полей.
    const auditRequestedType = requested_payment_type || payment_type;
    const auditMode: 'canonical' | 'override' =
      resolved_mode === 'canonical' || resolved_mode === 'override'
        ? resolved_mode
        : (offerIsRecurring === null
            ? 'canonical'
            : ((offerIsRecurring && payment_type === 'subscription') ||
               (!offerIsRecurring && payment_type === 'one_time')
                ? 'canonical'
                : 'override'));
    const auditCtaSource = cta_source || 'admin_manual';
    const auditContractVersion =
      typeof cta_contract_version === 'number' ? cta_contract_version : 1;

    // ── Canonical public URL host resolution ──
    // SINGLE SOURCE OF TRUTH: ВСЕ payment ссылки строятся на https://gorbova.by.
    // product.primary_domain НЕ используется для payment origin (только для
    // резолвинга лендинга). request origin / referer использовать нельзя —
    // админ может работать из Lovable preview.
    const CANONICAL_PUBLIC_HOST = 'https://gorbova.by';
    const FORBIDDEN_HOST_RE = /(lovable\.dev|lovable\.app|lovableproject\.com|localhost|127\.0\.0\.1)/i;

    // primary_domain читаем только для аудита в meta.
    const rawPrimaryDomain: string | null = (product as { primary_domain?: string | null })?.primary_domain ?? null;
    const primaryDomain = rawPrimaryDomain ? rawPrimaryDomain.trim().toLowerCase() : null;

    const canonicalOrigin = CANONICAL_PUBLIC_HOST;
    const originSource: 'canonical_gorbova_by' = 'canonical_gorbova_by';

    // STOP-guard: defence in depth (DB CHECK уже это enforce-ит, но явная ошибка лучше 500-ки).
    if (!/^https:\/\//.test(canonicalOrigin) || FORBIDDEN_HOST_RE.test(canonicalOrigin)) {
      console.error('[admin-create-public-link] Canonical origin rejected:', canonicalOrigin);
      return errorResponse('Internal: invalid canonical origin', 500);
    }

    // ── INSERT row in payment_links ──
    // public_url NOT NULL → генерируем url_token client-side, чтобы построить
    // canonical public_url до INSERT (single source of truth для домена).
    // DB CHECK constraint на public_url отвергнет preview-домен.
    const tokenBytes = new Uint8Array(16);
    crypto.getRandomValues(tokenBytes);
    const url_token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const public_url = `${canonicalOrigin}/pay/${url_token}`;

    // Для installment ссылка хранит per_payment в amount; полная сумма — в meta.installment.
    let canonicalComposableQuote: ResolvedComposableCheckout | null = null;
    if (rawComposableQuote && typeof rawComposableQuote === 'object') {
      const selectedAddonOfferIds = Array.isArray(rawComposableQuote.selected_addon_offer_ids)
        ? rawComposableQuote.selected_addon_offer_ids.map((id) => String(id))
        : [];
      try {
        const baseQuote = await resolveComposableCheckout(supabase, {
          parentOfferId: resolvedOffer.id,
          addonOfferIds: selectedAddonOfferIds,
        });
        const requestedTotal = amount / 100;
        canonicalComposableQuote = await resolveComposableCheckout(supabase, {
          parentOfferId: resolvedOffer.id,
          addonOfferIds: selectedAddonOfferIds,
          adjustmentAmount: Math.round((requestedTotal - baseQuote.subtotal) * 100) / 100,
          adjustmentReason: typeof rawComposableQuote.adjustment_reason === 'string'
            ? rawComposableQuote.adjustment_reason
            : null,
        });
      } catch (error) {
        if (error instanceof ComposableCheckoutError) {
          return errorResponse(error.code, error.status);
        }
        return errorResponse('composable_quote_validation_failed', 400);
      }
    }

    const linkAmountKopecks =
      installmentLinkAmountKopecks !== null ? installmentLinkAmountKopecks : amount;
    const linkMeta: Record<string, unknown> = {
      // New unassigned links are for any authenticated customer. Existing links
      // without this marker retain their legacy identity fallback.
      auth_policy: user_id ? 'recipient_prebound' : 'required',
    };
    if (canonicalComposableQuote) {
      linkMeta.composable_checkout = canonicalComposableQuote;
    }
    if (installmentBlock) {
      linkMeta.installment = installmentBlock;
      // Stage 1 canonical marker at link.meta root — не перезаписываем payment_flow.
      linkMeta.payment_method = 'internal_installment';
    }
    // Phase 5-C — snapshot allowed providers + stripe account для рантайма customer_choice.
    if (providerMode === 'customer_choice') {
      linkMeta.allowed_payment_providers = effectiveAllowedProviders;
      // Stripe account snapshot: при cc override приоритет — resolvedAccountCode (использовался для
      // price provisioning); иначе — account_code из offer.meta.
      const ccStripeAccount = resolvedAccountCode || offerStripeAccountCode;
      if (ccStripeAccount) linkMeta.stripe_account_code = ccStripeAccount;
      if (effectiveAllowedProviders.includes('stripe')) {
        linkMeta.stripe_currency = stripeValidationCurrency;
      }
      if (allowedProvidersOverride) {
        linkMeta.allowed_providers_override = {
          source: 'admin_explicit',
          offer_allowed_payment_providers: offerAllowedProviders,
          effective_allowed_payment_providers: effectiveAllowedProviders,
        };
      }
    }
    // PATCH-SUB-PRICE-3 (PATCH-B): Stripe-subscription link amount/currency override.
    if (linkMetaStripePriceMode) {
      linkMeta.stripe_price_mode = linkMetaStripePriceMode;
    }
    if (linkMetaStripeRecurringSnapshot) {
      linkMeta.stripe_recurring_snapshot = linkMetaStripeRecurringSnapshot;
    }

    // B2 corrective. Non-installment subscription (bePaid provider-managed recurring или
    // Stripe subscription) — snapshot canonical charge_notifications policy на
    // уровне payment_links.meta.recurring. Precedence: live offer meta → legacy → defaults.
    if (!installmentBlock && payment_type === 'subscription' && offer_id) {
      const { data: offerForNotif } = await supabase
        .from('tariff_offers')
        .select('meta')
        .eq('id', offer_id)
        .maybeSingle();
      const recurringPolicy = resolveChargeNotificationSnapshotForWriter({
        offerMeta: (offerForNotif as { meta?: unknown } | null)?.meta ?? null,
      });
      const recurringSnapshot = serializeChargeNotificationPolicy(recurringPolicy);
      const existingRecurring = (linkMeta.recurring as Record<string, unknown> | undefined) ?? {};
      linkMeta.recurring = {
        ...existingRecurring,
        charge_notifications: recurringSnapshot,
        charge_notifications_source: recurringPolicy.source,
      };
    }

    // Phase 5-C: для customer_choice payment_links.provider не может быть NULL
    // (DB CHECK + NOT NULL). Используем default_provider оффера = 'bepaid' как fallback,
    // фактический выбор делается в public-checkout по provider_choice от покупателя.
    const linkProviderForFixed = provider;
    const linkProviderColumn: 'bepaid' | 'stripe' =
      providerMode === 'customer_choice' ? 'bepaid' : linkProviderForFixed;
    const linkAccountCodeColumn: string | null =
      providerMode === 'customer_choice'
        ? null
        : (provider === 'stripe' ? resolvedAccountCode : null);

    const { data: link, error: insertErr } = await supabase
      .from('payment_links')
      .insert({
        product_id,
        tariff_id,
        offer_id: offer_id || null,
        amount: linkAmountKopecks,
        currency,
        payment_type,
        description,
        max_uses,
        expires_at,
        user_id,
        created_by: user.id,
        url_token,
        public_url,
        meta: linkMeta,
        // Phase 4.1 + 5-C — provider routing fields
        provider: linkProviderColumn,
        account_code: linkAccountCodeColumn,
        provider_mode: providerMode,
      })
      .select('id, url_token, status, current_uses, max_uses, expires_at, amount, currency, payment_type, product_id, tariff_id, offer_id, created_by, meta, provider, account_code, provider_mode')
      .single();

    if (insertErr || !link) {
      console.error('[admin-create-public-link] INSERT failed:', insertErr);
      return errorResponse(`Failed to create payment link: ${insertErr?.message}`, 500);
    }

    // Deferred installment audit — write only after payment_link exists.
    if (pendingInstallmentAudit) {
      const { error: installmentAuditError } = await supabase.from('audit_logs').insert({
        actor_type: 'user',
        actor_user_id: user.id,
        actor_label: 'admin-create-public-link',
        action: 'installment.admin_link_created',
        meta: {
          ...pendingInstallmentAudit,
          payment_link_id: link.id,
          url_token: link.url_token,
        },
      });
      if (installmentAuditError) {
        console.error('[installment-admin-link] audit insert failed', {
          payment_link_id: link.id,
          offer_id,
          error: installmentAuditError.message,
        });
      }
    }


    // ── Audit (proof contract: payment_type / mode / offer_id / tariff_id / cta_source) ──
    await supabase.from('audit_logs').insert({
      actor_type: 'user',
      actor_user_id: user.id,
      action: 'payment_link.created',
      actor_label: 'admin-create-public-link',
      meta: {
        payment_link_id: link.id,
        url_token: link.url_token,
        product_id, tariff_id, offer_id: offer_id || null,
        amount_input: amount,                 // что пришло с фронта (для installment — total kopecks)
        link_amount: linkAmountKopecks,       // что фактически записано в payment_links.amount
        currency,
        payment_type,                         // фактический payment_type ссылки
        requested_payment_type: auditRequestedType, // что просил источник CTA
        resolved_offer_id: offer_id || null,
        offer_is_recurring: offerIsRecurring, // null если offer не передан
        resolved_mode: auditMode,             // 'canonical' | 'override'
        cta_source: auditCtaSource,
        cta_contract_version: auditContractVersion,
        max_uses, expires_at,
        target_user_id: user_id,
        public_url,
        origin_source: originSource,
        primary_domain: primaryDomain,
        // Phase 4.1 + 5-C — provider routing proof
        provider: linkProviderColumn,
        account_code: linkAccountCodeColumn,
        provider_mode: providerMode,
        allowed_payment_providers: providerMode === 'customer_choice' ? effectiveAllowedProviders : [provider],
        allowed_providers_override: allowedProvidersOverride
          ? {
              offer_allowed_payment_providers: offerAllowedProviders,
              effective_allowed_payment_providers: effectiveAllowedProviders,
            }
          : null,
        stripe_account_code_snapshot:
          providerMode === 'customer_choice'
            ? (resolvedAccountCode || offerStripeAccountCode || null)
            : null,
        // Stage L: installment proof
        installment: installmentBlock
          ? {
              selected_installment_months: installmentBlock.selected_installment_months,
              max_installment_months: installmentBlock.max_installment_months,
              per_payment_amount: installmentBlock.per_payment_amount,
              total_installment_amount: installmentBlock.total_installment_amount,
              billing_cycles: installmentBlock.billing_cycles,
              as_finite_subscription: installmentBlock.as_finite_subscription,
              proof: 'public_link.installment_as_subscription',
            }
          : null,
      },
    });

    // ── Phase 8 follow-up audit: payment_type был промоутнут recurring-guard'ом (auto-mode) ──
    if (recurringPromoted) {
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        action: 'payment_link.payment_type_promoted_recurring',
        actor_label: 'admin-create-public-link',
        meta: {
          payment_link_id: link.id,
          offer_id: offer_id || null,
          tariff_id,
          product_id,
          requested_payment_type: recurringPromotedFromPaymentType,
          effective_payment_type: 'subscription',
          provider,
          provider_mode: providerMode,
          provider_choice_source: 'auto',
          reason: 'offer_is_recurring_auto_mode',
        },
      });
    }

    // ── Phase 8 follow-up audit: admin явно создал one_time по recurring offer (explicit override) ──
    if (adminOverrideRecurringOneTime) {
      await supabase.from('audit_logs').insert({
        actor_type: 'user',
        actor_user_id: user.id,
        action: 'payment_link.payment_type_admin_override',
        actor_label: 'admin-create-public-link',
        target_user_id: user_id ?? null,
        meta: {
          payment_link_id: link.id,
          offer_id: offer_id || null,
          tariff_id,
          product_id,
          requested_payment_type: 'one_time',
          effective_payment_type: 'one_time',
          provider,
          provider_mode: providerMode,
          provider_choice_source: 'explicit',
          offer_is_recurring: true,
          reason: 'admin_explicit_override',
        },
      });
    }


    // ── Phase 5-D: admin.payment_provider.override audit ──
    // Пишем только когда админ ЯВНО выбрал provider (provider_choice_source='explicit'),
    // даже если выбранный provider совпал с default оффера. Auto-выбор не аудируем.
    // actor_user_id — ТОЛЬКО из JWT, никогда из body.
    if (providerChoiceSource === 'explicit' && providerMode === 'fixed') {
      const defaultOfferProvider: 'bepaid' | 'stripe' =
        offerAllowedProviders.length === 1 ? offerAllowedProviders[0] : 'bepaid';
      await supabase.from('audit_logs').insert({
        actor_type: 'user',
        actor_user_id: user.id,
        action: 'admin.payment_provider.override',
        actor_label: 'admin-create-public-link',
        target_user_id: user_id ?? null,
        meta: {
          payment_link_id: link.id,
          offer_id: offer_id || null,
          tariff_id,
          product_id,
          default_provider: defaultOfferProvider,
          chosen_provider: provider,
          allowed_payment_providers: offerAllowedProviders,
          super_admin_bypass: superAdminBypass,
          stripe_account_code: provider === 'stripe' ? resolvedAccountCode : null,
          currency: provider === 'stripe' ? currency : null,
          reason: 'admin_explicit_override',
        },
      });
    }

    // «Клиент выбирает» — отдельный audit override allowed_payment_providers.
    if (allowedProvidersOverride) {
      await supabase.from('audit_logs').insert({
        actor_type: 'user',
        actor_user_id: user.id,
        action: 'admin.payment_provider.customer_choice_override',
        actor_label: 'admin-create-public-link',
        target_user_id: user_id ?? null,
        meta: {
          payment_link_id: link.id,
          offer_id: offer_id || null,
          tariff_id,
          product_id,
          offer_allowed_payment_providers: offerAllowedProviders,
          effective_allowed_payment_providers: effectiveAllowedProviders,
          stripe_account_code: effectiveAllowedProviders.includes('stripe')
            ? (resolvedAccountCode || offerStripeAccountCode || null)
            : null,
          stripe_currency: effectiveAllowedProviders.includes('stripe')
            ? stripeValidationCurrency
            : null,
          reason: 'admin_customer_choice_override',
        },
      });
    }


    return jsonResponse({
      success: true,
      payment_link_id: link.id,
      url_token: link.url_token,
      public_url,
      // Proof contract — клиент может мгновенно проверить, что link создан с нужным типом/режимом.
      payment_type: link.payment_type,
      resolved_mode: auditMode,
      offer_id: link.offer_id,
      tariff_id: link.tariff_id,
      cta_source: auditCtaSource,
      installment: installmentBlock,
      // Phase 4.1 + 5-C — provider routing fields в ответе
      provider: linkProviderColumn,
      account_code: linkAccountCodeColumn,
      provider_mode: providerMode,
      allowed_payment_providers: providerMode === 'customer_choice' ? effectiveAllowedProviders : [provider],
      currency,
      row: link,
    });
  } catch (e) {
    console.error('[admin-create-public-link] Unexpected error:', e);
    return errorResponse('Internal server error', 500);
  }
});
