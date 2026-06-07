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
 * AUTH: JWT обязателен. Требуется роль admin или super_admin.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';

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
}

// PATCH 4.1.1 — Stripe currencies whitelist (SOT, must mirror frontend).
// Сужено до 4 валют по бизнес-требованию: BYN, EUR, USD, PLN. GBP/CHF/CZK/RON удалены.
// Defence-in-depth: backend отвергнет любой иной код даже если фронт когда-нибудь его подаст.
const STRIPE_ALLOWED_CURRENCIES = new Set(['BYN', 'EUR', 'USD', 'PLN']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── AUTH: JWT + role admin/super_admin ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Not authorized', 401);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return errorResponse('Invalid token', 401);

    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    const { data: isSuper } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'super_admin' });
    if (!isAdmin && !isSuper) {
      return errorResponse('Access denied: admin role required', 403);
    }

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
    if (offer_id) {
      const { data: offer } = await supabase
        .from('tariff_offers')
        .select('id, tariff_id, is_active, offer_type, payment_method, installment_count, meta')
        .eq('id', offer_id).maybeSingle();
      if (!offer) return errorResponse('Offer not found', 400);
      if (offer.tariff_id !== tariff_id) return errorResponse('Offer does not belong to tariff', 400);
      if (!offer.is_active) return errorResponse('Offer is not active', 400);
      if (offer.offer_type !== 'pay_now') return errorResponse('Offer is not a pay_now offer', 400);
      offerIsRecurring = !!(offer as any).meta?.recurring?.is_recurring;
      offerPaymentMethod = (offer as any).payment_method ?? null;
      offerInstallmentCountLegacy = Number((offer as any).installment_count ?? 0) || null;
      const metaMax = Number((offer as any).meta?.installment?.max_months ?? 0);
      offerInstallmentMaxMonths =
        metaMax >= 2 ? metaMax : (offerInstallmentCountLegacy && offerInstallmentCountLegacy >= 2 ? offerInstallmentCountLegacy : null);
      const acq = (offer as any).meta?.acquiring;
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

    // ── Phase 5-C / 5-D: validation per provider_mode ──
    // Phase 5-D: super_admin может оверрайдить provider, не входящий в offer.allowed_payment_providers.
    // Для всех остальных admin'ов — провайдер обязан быть в allowed_payment_providers.
    let superAdminBypass = false;
    if (providerMode === 'fixed') {
      if (!offerAllowedProviders.includes(provider)) {
        if (isSuper) {
          superAdminBypass = true;
        } else {
          return errorResponse(`provider_not_allowed_by_offer:${provider}`, 400);
        }
      }
    } else {
      // customer_choice
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

    // ── Stage L: installment validation + расчёт сумм ──
    // Контракт:
    //   • installment_offer=true ↔ offer.payment_method='internal_installment'.
    //   • selected_installment_months: integer, 2..max_months.
    //   • payment_type ссылки ВСЕГДА 'one_time' (первый платёж = bePaid checkout).
    //   • amount ссылки = per_payment_kopecks; total — в meta.installment.
    let installmentBlock: Record<string, unknown> | null = null;
    let installmentLinkAmountKopecks: number | null = null;
    if (installment_offer || offerPaymentMethod === 'internal_installment') {
      if (offerPaymentMethod !== 'internal_installment') {
        return errorResponse('Offer is not an installment offer', 400);
      }
      if (!offerInstallmentMaxMonths || offerInstallmentMaxMonths < 2) {
        return errorResponse('Installment offer has no valid max_months', 400);
      }
      const sel = Number(selected_installment_months);
      if (!Number.isInteger(sel) || sel < 2 || sel > offerInstallmentMaxMonths) {
        return errorResponse('invalid_installment_months', 400);
      }
      // amount приходит в копейках = ПОЛНАЯ стоимость (UI всегда шлёт total).
      const totalByn = amount / 100;
      // round half-up до целых BYN (Math.round в JS — half away from zero для положительных = round half-up).
      const perPaymentByn = Math.round(totalByn / sel);
      if (perPaymentByn < 1) {
        return errorResponse('per_payment_too_small', 400);
      }
      const perPaymentKopecks = perPaymentByn * 100;
      const totalInstallmentByn = perPaymentByn * sel;

      installmentLinkAmountKopecks = perPaymentKopecks;
      installmentBlock = {
        payment_method: 'internal_installment',
        max_installment_months: offerInstallmentMaxMonths,
        selected_installment_months: sel,
        interval_days: 30,
        first_payment_delay_days: 0,
        total_amount: totalByn,
        per_payment_amount: perPaymentByn,
        // Canonical key для public-checkout (читает per_payment_amount_byn).
        per_payment_amount_byn: perPaymentByn,
        total_installment_amount: totalInstallmentByn,
        rounding_mode: 'round_half_up_byn',
        // PATCH INSTALLMENT-PUBLIC-LINK: installment теперь оформляется как finite bePaid subscription.
        // billing_cycles = N, провайдер сам списывает оставшиеся N-1 платежей.
        as_finite_subscription: true,
        billing_cycles: sel,
      };
      // PATCH INSTALLMENT-PUBLIC-LINK: installment-link теперь = finite subscription (billing_cycles=N).
      payment_type = 'subscription';
    }

    // ── Phase 4.1 — Stripe validations ──
    // 1) installment + Stripe — запрещено (рассрочка реализована только через bePaid finite subscription).
    // 2) валюта — whitelist.
    // 3) acquiring_connections должен иметь активный Stripe-аккаунт указанного account_code.
    // 4) subscription Stripe требует tariff_offers.meta.stripe.price_id на выбранном оффере
    //    (раннее 400, чтобы админ не создал «мёртвую» ссылку).
    let resolvedAccountCode: string | null = null;
    // Stripe-валидации запускаются и для fixed=stripe, и для customer_choice со stripe в allowed.
    const stripePathActive =
      provider === 'stripe' ||
      (providerMode === 'customer_choice' && effectiveAllowedProviders.includes('stripe'));
    // Для cc Stripe-валюта берётся из body.stripe_currency (link.currency остаётся BYN).
    const stripeValidationCurrency = (
      providerMode === 'customer_choice'
        ? (rawStripeCurrency || 'EUR')
        : currency
    ).toUpperCase();
    if (stripePathActive) {
      if (installmentBlock) {
        return errorResponse('installment_not_supported_on_stripe', 400);
      }
      if (!STRIPE_ALLOWED_CURRENCIES.has(stripeValidationCurrency)) {
        return errorResponse(`Stripe: unsupported currency ${stripeValidationCurrency}`, 400);
      }
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

      // PATCH 4.1.1 — capability check против фактических supported_currencies аккаунта.
      // Источник: acquiring_connections.capabilities_snapshot.supported_currencies (array of lowercase ISO).
      // Если snapshot отсутствует/пустой — продолжаем по статическому whitelist (R1 fallback в плане).
      const capSnapshot = (acct as any).capabilities_snapshot as Record<string, unknown> | null;
      const supportedCurrenciesRaw = Array.isArray((capSnapshot as any)?.supported_currencies)
        ? ((capSnapshot as any).supported_currencies as unknown[])
        : null;
      if (supportedCurrenciesRaw && supportedCurrenciesRaw.length > 0) {
        const supportedSet = new Set(
          supportedCurrenciesRaw.map((c) => String(c).toLowerCase())
        );
        if (!supportedSet.has(stripeValidationCurrency.toLowerCase())) {
          return errorResponse(
            `stripe_currency_not_supported_by_account:${stripeValidationCurrency}:${resolvedAccountCode}`,
            400,
          );
        }
      }

      if (payment_type === 'subscription') {
        if (!offer_id) {
          return errorResponse('Stripe subscription requires offer_id', 400);
        }

        // BLOCKER FIX (Phase 6-G/7 boundary): отсутствие meta.stripe.price_id больше НЕ
        // блокирует создание ссылки. Если price_id отсутствует — вызываем
        // admin-provision-stripe-price (идемпотентно), затем ПЕРЕЧИТЫВАЕМ tariff_offers.meta
        // из БД и продолжаем. Если price_id всё ещё нет после provision — controlled error,
        // ссылка НЕ создаётся (защита от частичного успеха).
        const { data: offerStripe } = await supabase
          .from('tariff_offers')
          .select('meta')
          .eq('id', offer_id)
          .maybeSingle();
        let priceId = (offerStripe as any)?.meta?.stripe?.price_id as string | undefined;

        if (!priceId) {
          // Резолвим business_stream так же, как frontend (offer.meta → product.meta).
          const offerMeta = (offerStripe as any)?.meta ?? {};
          let businessStream: string | null =
            (offerMeta?.business_stream as string | undefined) ?? null;
          if (!businessStream) {
            const { data: tariffRow } = await supabase
              .from('tariff_offers')
              .select('tariff_id, tariffs:tariff_id(product_id, products_v2:product_id(meta))')
              .eq('id', offer_id)
              .maybeSingle();
            businessStream =
              ((tariffRow as any)?.tariffs?.products_v2?.meta?.business_stream as
                | string
                | undefined) ?? null;
          }
          if (!businessStream) {
            return errorResponse(
              'stripe_price_provision_failed:business_stream_not_resolved',
              422,
            );
          }

          // Forward caller's JWT — admin-provision-stripe-price требует super_admin.
          const provInvoke = await fetch(
            `${supabaseUrl}/functions/v1/admin-provision-stripe-price`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader,
              },
              body: JSON.stringify({
                tariff_offer_id: offer_id,
                account_code: resolvedAccountCode,
                business_stream: businessStream,
                execute: true,
              }),
            },
          );
          const provJson: any = await provInvoke.json().catch(() => ({}));

          if (!provInvoke.ok || provJson?.status === 'error' || provJson?.status === 'manual_review') {
            const reason =
              provJson?.reason ||
              provJson?.error ||
              `http_${provInvoke.status}`;
            // Audit controlled failure (no partial link created).
            await supabase.from('audit_logs').insert({
              action: 'admin_create_public_link.stripe_price_provision_failed',
              actor_user_id: user.id,
              actor_type: 'user',
              actor_label: 'super_admin:admin-create-public-link',
              entity_type: 'tariff_offer',
              entity_id: offer_id,
              meta: { reason, account_code: resolvedAccountCode, business_stream: businessStream, http_status: provInvoke.status, provision_response: provJson },
            });
            return errorResponse(`stripe_price_provision_failed:${reason}`, 502);
          }

          // Re-read meta from DB — НЕ полагаемся только на ответ функции.
          const { data: offerAfter } = await supabase
            .from('tariff_offers')
            .select('meta')
            .eq('id', offer_id)
            .maybeSingle();
          priceId = (offerAfter as any)?.meta?.stripe?.price_id as string | undefined;

          if (!priceId) {
            await supabase.from('audit_logs').insert({
              action: 'admin_create_public_link.stripe_price_provision_failed',
              actor_user_id: user.id,
              actor_type: 'user',
              actor_label: 'super_admin:admin-create-public-link',
              entity_type: 'tariff_offer',
              entity_id: offer_id,
              meta: { reason: 'no_price_id_after_provision', provision_response: provJson },
            });
            return errorResponse(
              'stripe_price_provision_failed:no_price_id_after_provision',
              502,
            );
          }
        }
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
    // ИСТОЧНИК ИСТИНЫ: product.primary_domain → fallback CANONICAL_PUBLIC_HOST.
    // request origin / referer ИСПОЛЬЗОВАТЬ НЕЛЬЗЯ — админ может работать
    // из Lovable preview, и ссылка для клиента не должна указывать на preview.
    const CANONICAL_PUBLIC_HOST = 'https://club.gorbova.by';
    const FORBIDDEN_HOST_RE = /(lovable\.dev|lovable\.app|lovableproject\.com|localhost|127\.0\.0\.1)/i;
    const VALID_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

    const rawPrimaryDomain: string | null = (product as { primary_domain?: string | null })?.primary_domain ?? null;
    const primaryDomain = rawPrimaryDomain ? rawPrimaryDomain.trim().toLowerCase() : null;
    const primaryDomainValid =
      !!primaryDomain &&
      VALID_DOMAIN_RE.test(primaryDomain) &&
      !FORBIDDEN_HOST_RE.test(primaryDomain);

    const canonicalOrigin = primaryDomainValid
      ? `https://${primaryDomain}`
      : CANONICAL_PUBLIC_HOST;
    const originSource: 'product_primary_domain' | 'fallback_canonical' =
      primaryDomainValid ? 'product_primary_domain' : 'fallback_canonical';

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
    const linkAmountKopecks =
      installmentLinkAmountKopecks !== null ? installmentLinkAmountKopecks : amount;
    const linkMeta: Record<string, unknown> = {};
    if (installmentBlock) linkMeta.installment = installmentBlock;
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
        primary_domain: primaryDomainValid ? primaryDomain : null,
        // Phase 4.1 + 5-C — provider routing proof
        provider: linkProviderColumn,
        account_code: linkAccountCodeColumn,
        provider_mode: providerMode,
        allowed_payment_providers: providerMode === 'customer_choice' ? offerAllowedProviders : [provider],
        stripe_account_code_snapshot: providerMode === 'customer_choice' ? offerStripeAccountCode : null,
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
      allowed_payment_providers: providerMode === 'customer_choice' ? offerAllowedProviders : [provider],
      currency,
      row: link,
    });
  } catch (e) {
    console.error('[admin-create-public-link] Unexpected error:', e);
    return errorResponse('Internal server error', 500);
  }
});
