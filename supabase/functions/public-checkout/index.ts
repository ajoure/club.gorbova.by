/**
 * public-checkout — Public payment checkout by url_token.
 * JWT is required for new unassigned admin links (meta.auth_policy='required').
 * Legacy and recipient-prebound links retain their historical behaviour.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createPaymentCheckout } from '../_shared/create-payment-checkout.ts';
import { resolveProviderChoice, isValidProviderChoice, type CustomerProvider } from '../_shared/resolve-provider-choice.ts';
import { materializeComposableOrderGroup } from '../_shared/materialize-composable-order-group.ts';
import { buildFiniteInstallmentOrderMeta } from './installment-meta.ts';
import { resolvePublicReturnOrigin } from '../_shared/access-alias-origin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (req.method === 'GET') {
      // GET /public-checkout?token=xxx — fetch payment link info (public, no auth)
      const url = new URL(req.url);
      const urlToken = url.searchParams.get('token');

      if (!urlToken) {
        return errorResponse('Missing token parameter', 400);
      }

      const { data: link, error: linkErr } = await supabase
        .from('payment_links')
        .select(`
          id, url_token, user_id, amount, currency, payment_type, description, status,
          max_uses, current_uses, expires_at, meta, provider, provider_mode, account_code, offer_id,
          products_v2!payment_links_product_id_fkey ( id, name, description, category ),
          tariffs!payment_links_tariff_id_fkey ( id, name, code, access_days )
        `)
        .eq('url_token', urlToken)
        .maybeSingle();

      if (linkErr) {
        console.error('[public-checkout] DB error:', linkErr);
        return errorResponse('Internal error', 500);
      }

      if (!link) {
        return errorResponse('Payment link not found', 404);
      }

      if (link.status !== 'active') {
        return errorResponse('Payment link is no longer active', 410);
      }

      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return errorResponse('Payment link has expired', 410);
      }

      if (link.max_uses && link.current_uses >= link.max_uses) {
        return errorResponse('Payment link usage limit reached', 410);
      }

      const product = (link as any).products_v2;
      const tariff = (link as any).tariffs;
      const linkMetaGet = (link as any).meta || {};
      const installment = linkMetaGet.installment ?? null;
      const requiresAuth = !link.user_id && linkMetaGet.auth_policy === 'required';

      // Phase 5-C: surface allowed providers + provider_mode для UI выбора.
      // Источник истины: payment_links.meta.allowed_payment_providers (зеркалит offer.meta.acquiring
      // на момент создания ссылки). Если отсутствует — берём из offer.meta.acquiring как fallback.
      let allowedPaymentProviders: ('bepaid' | 'stripe')[] | null =
        Array.isArray(linkMetaGet.allowed_payment_providers)
          ? linkMetaGet.allowed_payment_providers.filter((p: any) => p === 'bepaid' || p === 'stripe')
          : null;
      if ((!allowedPaymentProviders || allowedPaymentProviders.length === 0) && (link as any).offer_id) {
        const { data: offerRow } = await supabase
          .from('tariff_offers')
          .select('meta')
          .eq('id', (link as any).offer_id)
          .maybeSingle();
        const fromOffer = (offerRow as any)?.meta?.acquiring?.allowed_payment_providers;
        if (Array.isArray(fromOffer)) {
          allowedPaymentProviders = fromOffer.filter((p: any) => p === 'bepaid' || p === 'stripe');
        }
      }

      return jsonResponse({
        product_id: link.product_id,
        product_name: product?.name || 'Продукт',
        product_description: product?.description || null,
        product_category: product?.category || null,
        tariff_name: tariff?.name || null,
        access_days: tariff?.access_days || null,
        amount: link.amount,
        currency: link.currency,
        description: link.description,
        payment_type: link.payment_type,
        // Canonical: payment_links.user_id = recipient of result, NOT a payer guard.
        // UI uses these flags to decide whether to ask for email / show inline auth.
        has_target_user: !!link.user_id,
        requires_identity_input: !link.user_id,
        requires_auth: requiresAuth,
        // Saved-card flow ownership hint (PAY-C):
        //   null → public link, any authenticated user can pay with their own saved card.
        //   uuid → personal link, only owner sees the saved-card button.
        link_user_id: link.user_id,
        // Stage L: installment summary (read-only для UI, срок зафиксирован админом).
        installment,
        // Phase 4.1 — provider indicator (UI badge / saved-card gating).
        provider: (link as any).provider ?? 'bepaid',
        account_code: (link as any).account_code ?? null,
        // Phase 5-C — provider_mode + allowed_payment_providers для пользовательского выбора.
        provider_mode: (link as any).provider_mode ?? 'fixed',
        allowed_payment_providers: allowedPaymentProviders ?? null,
        composable_checkout: linkMetaGet.composable_checkout ?? null,
      });
    }

    if (req.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    // POST — create checkout
    const body = await req.json();
    const { url_token, email, replacement_of_subscription_v2_id, provider_choice, customer_credit_requested_minor, customer_credit_checkout_key, partner_bonus_requested_minor, partner_bonus_checkout_key } = body as {
      url_token?: string;
      email?: string;
      replacement_of_subscription_v2_id?: string;
      provider_choice?: 'bepaid' | 'stripe';
      customer_credit_requested_minor?: number;
      customer_credit_checkout_key?: string;
      partner_bonus_requested_minor?: number;
      partner_bonus_checkout_key?: string;
    };

    if (!url_token) {
      return errorResponse('Missing url_token', 400);
    }

    // Load and validate payment link
    const { data: link, error: linkErr } = await supabase
      .from('payment_links')
      .select('*')
      .eq('url_token', url_token)
      .maybeSingle();

    if (linkErr || !link) {
      return errorResponse('Payment link not found', 404);
    }

    if (link.status !== 'active') {
      return errorResponse('Payment link is no longer active', 410);
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return errorResponse('Payment link has expired', 410);
    }

    if (link.max_uses && link.current_uses >= link.max_uses) {
      return errorResponse('Payment link usage limit reached', 410);
    }

    // ── Phase 5-C — Provider choice resolution ──
    // Source of truth:
    //   1) payment_links.meta.allowed_payment_providers (snapshot taken at link creation)
    //   2) fallback → tariff_offers.meta.acquiring.allowed_payment_providers
    // provider_mode='fixed'           → ignore provider_choice; if provided and != link.provider
    //                                   → 400 provider_choice_not_allowed (no silent behaviour)
    // provider_mode='customer_choice' → require provider_choice; must be in allowed list
    const linkMetaPre = (link.meta || {}) as Record<string, any>;
    let allowedProvidersPre: CustomerProvider[] = Array.isArray(linkMetaPre.allowed_payment_providers)
      ? linkMetaPre.allowed_payment_providers.filter((p: any) => p === 'bepaid' || p === 'stripe')
      : [];
    let stripeAccountFromMeta: string | null = linkMetaPre.stripe_account_code ?? null;
    if (allowedProvidersPre.length === 0 && link.offer_id) {
      const { data: offerRow } = await supabase
        .from('tariff_offers')
        .select('meta')
        .eq('id', link.offer_id)
        .maybeSingle();
      const acq = (offerRow as any)?.meta?.acquiring;
      if (Array.isArray(acq?.allowed_payment_providers)) {
        allowedProvidersPre = acq.allowed_payment_providers.filter(
          (p: any) => p === 'bepaid' || p === 'stripe'
        );
      }
      if (!stripeAccountFromMeta && acq?.stripe?.account_code) {
        stripeAccountFromMeta = String(acq.stripe.account_code);
      }
    }

    const providerMode: 'fixed' | 'customer_choice' =
      link.provider_mode === 'customer_choice' ? 'customer_choice' : 'fixed';

    const resolution = resolveProviderChoice({
      allowed_payment_providers: allowedProvidersPre.length > 0 ? allowedProvidersPre : undefined,
      default_provider: (link.provider as CustomerProvider | null) ?? undefined,
    });

    let effectiveProvider: CustomerProvider =
      (link.provider as CustomerProvider | null) ?? 'bepaid';
    let effectiveAccountCode: string | null = link.account_code ?? null;

    if (providerMode === 'fixed') {
      if (provider_choice && provider_choice !== effectiveProvider) {
        return errorResponse('provider_choice_not_allowed', 400);
      }
    } else {
      // customer_choice
      // HOTFIX provider_choice_required:
      //   • allowed.length === 0  → конфигурационная ошибка, понятный код.
      //   • allowed.length === 1  → авто-выбор, provider_choice не обязателен.
      //   • allowed.length  >  1 → требуем явный provider_choice из allowed.
      // Это синхронизирует backend с UI-резолвером resolveProviderChoice (зеркало),
      // который для single allowed скрывает CustomerProviderChoice.
      if (resolution.providers.length === 0) {
        return errorResponse('no_allowed_payment_providers', 400);
      }

      let chosen: CustomerProvider;
      if (resolution.mode === 'single') {
        chosen = resolution.providers[0];
        if (provider_choice && provider_choice !== chosen) {
          return errorResponse('invalid_provider_choice', 400);
        }
      } else {
        if (!provider_choice) {
          return errorResponse('provider_choice_required', 400);
        }
        if (!isValidProviderChoice(provider_choice, resolution)) {
          return errorResponse('invalid_provider_choice', 400);
        }
        chosen = provider_choice;
      }

      effectiveProvider = chosen;
      // Resolve Stripe account on the fly when effective provider is stripe.
      if (effectiveProvider === 'stripe') {
        effectiveAccountCode = stripeAccountFromMeta || effectiveAccountCode;
        if (!effectiveAccountCode) {
          const { data: defAcct } = await supabase
            .from('acquiring_connections')
            .select('account_code')
            .eq('provider', 'stripe')
            .eq('status', 'active')
            .eq('is_default', true)
            .maybeSingle();
          effectiveAccountCode = (defAcct as any)?.account_code ?? null;
          if (!effectiveAccountCode) {
            return errorResponse('no_active_default_stripe_account', 400);
          }
        }
      } else {
        // bepaid: account_code irrelevant
        effectiveAccountCode = null;
      }
    }

    // Canonical target-user resolution for public payment links (CONTRACT):
    //   1) link.user_id present  → ALWAYS use it (recipient pre-bound).
    //      JWT/email are IGNORED for recipient selection — anyone can pay for that user.
    //   2) link.user_id absent + Authorization Bearer token → use auth.uid() (trusted).
    //      This covers inline-login on /pay/:token and already-authenticated users.
    //      If both Authorization and email are provided and disagree, JWT WINS.
    //   3) New unassigned admin link with meta.auth_policy='required' and no
    //      valid Bearer JWT → 401. Email-only must never bypass this boundary.
    //   4) Legacy unassigned link + email only → lookup via admin API (paginated).
    //   5) Otherwise → 400 with identity-input hint (UI keeps inline-auth open).
    let userId: string | null = link.user_id || null;
    let resolvedVia: 'link' | 'jwt' | 'email' | null = userId ? 'link' : null;

    if (!userId) {
      // Try JWT from Authorization header
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      if (authHeader?.toLowerCase().startsWith('bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) {
          const { data: userData, error: userErr } = await supabase.auth.getUser(token);
          if (!userErr && userData?.user?.id) {
            userId = userData.user.id;
            resolvedVia = 'jwt';
          }
        }
      }
    }

    const requiresAuth = !link.user_id && (link.meta as Record<string, unknown> | null)?.auth_policy === 'required';
    if (requiresAuth && !userId) {
      return errorResponse('authentication_required', 401);
    }

    if (!userId && !requiresAuth && email) {
      // Paginated lookup — admin.listUsers() returns max 50 per page by default
      const normalizedEmail = email.trim().toLowerCase();
      let page = 1;
      const perPage = 1000;
      while (page <= 50 && !userId) {
        const { data, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage });
        if (listErr || !data?.users?.length) break;
        const found = data.users.find((u: any) => u.email?.toLowerCase() === normalizedEmail);
        if (found) {
          userId = found.id;
          resolvedVia = 'email';
          break;
        }
        if (data.users.length < perPage) break;
        page++;
      }
      if (!userId) {
        return errorResponse('identity_required', 400);
      }
    }

    if (!userId) {
      return errorResponse('identity_required', 400);
    }

    console.log('[public-checkout] target_user_resolved', { userId, resolvedVia, link_id: link.id });

    // Canonical by default; only the exact alternate access contour may keep
    // its own origin for the provider return URL.
    const origin = resolvePublicReturnOrigin(req.headers.get('origin'));

    // Delegate to shared checkout helper.
    // PATCH-PUBLIC-LINK-COUNTER: payment_link_id уходит в orders_v2.meta через канонический meta_extra
    // (никаких post-insert UPDATE на стороне public-checkout).
    // Счётчик payment_links.current_uses ИНКРЕМЕНТИРУЕТСЯ ТОЛЬКО webhook'ом по факту paid order
    // (через _shared/consume-payment-link.ts). Здесь мы счётчик не двигаем.
    //
    // Stage L3: пробрасываем installment-meta из payment_links.meta.installment в orders_v2.meta.
    // Webhook bepaid (LINK-ORDER) использует эти поля для материализации installment_payments.
    const linkMeta = (link.meta || {}) as Record<string, any>;
    const composableCheckout =
      linkMeta.composable_checkout && typeof linkMeta.composable_checkout === 'object'
        ? linkMeta.composable_checkout as Record<string, any>
        : null;
    const linkInstallment = (linkMeta.installment || null) as Record<string, any> | null;
    const hasInstallment = !!linkInstallment && Number(linkInstallment.selected_installment_months) >= 2;
    // PATCH INSTALLMENT-RETRY-POLICY: legacy-ссылки могли быть созданы с payment_type='one_time',
    // но фактически содержат installment meta → защитно повышаем до 'subscription'.
    const effectivePaymentType = hasInstallment ? 'subscription' : (link.payment_type as 'one_time' | 'subscription');
    const installmentMetaExtra = buildFiniteInstallmentOrderMeta(linkInstallment);

    // B2 corrective. Non-installment subscription: явный transfer recurring.charge_notifications.
    const linkRecurring = (linkMeta.recurring || null) as Record<string, any> | null;
    const recurringMetaExtra =
      !hasInstallment && linkRecurring?.charge_notifications
        ? {
            recurring: {
              charge_notifications: linkRecurring.charge_notifications,
              charge_notifications_source:
                linkRecurring.charge_notifications_source ?? 'link',
            },
          }
        : {};


    const result = await createPaymentCheckout({
      supabase,
      user_id: userId,
      product_id: link.product_id,
      tariff_id: link.tariff_id,
      amount: link.amount,
      payment_type: effectivePaymentType,
      description: link.description || undefined,
      offer_id: link.offer_id || undefined,
      origin,
      actor_type: 'system',
      replacement_of_subscription_v2_id: replacement_of_subscription_v2_id || undefined,
      meta_extra: {
        payment_link_id: link.id,
        ...installmentMetaExtra,
        ...recurringMetaExtra,
        ...(composableCheckout ? { composable_checkout: composableCheckout } : {}),
        // Phase 5-C — фиксируем фактический выбор в audit-trail order'а.
        provider_choice_resolution: {
          mode: providerMode,
          chosen: effectiveProvider,
          provider_choice_param: provider_choice ?? null,
          allowed_payment_providers: allowedProvidersPre.length > 0 ? allowedProvidersPre : null,
        },
      },
      // Phase 5-C — effective provider после customer_choice / fixed.
      provider: effectiveProvider,
      account_code: effectiveAccountCode,
      currency: link.currency ?? (effectiveProvider === 'stripe' ? 'EUR' : 'BYN'),
      customer_credit_requested_minor:
        effectivePaymentType === 'one_time' || hasInstallment
          ? Math.max(0, Math.round(Number(customer_credit_requested_minor ?? 0)))
          : 0,
      customer_credit_checkout_key:
        typeof customer_credit_checkout_key === 'string' && customer_credit_checkout_key.length <= 200
          ? customer_credit_checkout_key
          : undefined,
      partner_bonus_requested_minor:
        effectivePaymentType === 'one_time' || hasInstallment
          ? Math.max(0, Math.round(Number(partner_bonus_requested_minor ?? 0)))
          : 0,
      partner_bonus_checkout_key:
        typeof partner_bonus_checkout_key === 'string' && partner_bonus_checkout_key.length <= 200
          ? partner_bonus_checkout_key
          : undefined,
    });

    if (!result.success) {
      if (result.error === 'already_has_active_subscription' && result.conflict) {
        return jsonResponse({
          success: false,
          error: 'already_has_active_subscription',
          conflict: result.conflict,
        });
      }
      if (result.error === 'existing_subscription_conflict' && result.conflict) {
        return jsonResponse({
          success: false,
          error: 'existing_subscription_conflict',
          conflict: result.conflict,
        });
      }
      // PATCH P0.1 — публично не показываем машинные коды.
      // Внутренний error сохраняем как error_code (для логов/аналитики),
      // а в error/message выводим понятный русский текст без слов
      // provider/capability/native_zero.
      const internalCode = String(result.error || 'checkout_failed');
      const PUBLIC_MESSAGES: Record<string, string> = {
        provider_unlimited_attempts_not_supported:
          'Оплата по этой ссылке временно недоступна из-за настроек рассрочки. Обратитесь к менеджеру для получения новой ссылки.',
        invalid_installment_max_charge_attempts:
          'Оплата по этой ссылке временно недоступна из-за настроек рассрочки. Обратитесь к менеджеру для получения новой ссылки.',
        installment_retry_policy_resolution_failed:
          'Оплата по этой ссылке временно недоступна из-за настроек рассрочки. Обратитесь к менеджеру для получения новой ссылки.',
        bepaid_not_configured:
          'Оплата временно недоступна. Обратитесь к менеджеру.',
        invalid_installment_months:
          'Оплата временно недоступна. Обратитесь к менеджеру.',
        checkout_create_failed:
          'Не удалось оформить оплату. Попробуйте позже или обратитесь к менеджеру.',
        link_expired: 'Срок действия ссылки истёк. Обратитесь к менеджеру.',
        link_exhausted: 'Ссылка уже была использована. Обратитесь к менеджеру.',
        link_inactive: 'Ссылка недействительна. Обратитесь к менеджеру.',
      };
      // PATCH P0.1 corrective — allowlist. НЕ echo сырого result.message.
      const publicMessage =
        PUBLIC_MESSAGES[internalCode] ||
        'Не удалось оформить оплату. Попробуйте позже или обратитесь к менеджеру.';
      return jsonResponse({
        success: false,
        error_code: internalCode,
        error: publicMessage,
        message: publicMessage,
      });
    }

    let orderGroupId: string | null = null;
    if (composableCheckout && Array.isArray(composableCheckout.items) && composableCheckout.items.length > 0) {
      try {
        orderGroupId = await materializeComposableOrderGroup(supabase, {
          primaryOrderId: result.order_id,
          quote: composableCheckout,
          source: 'admin_payment_link',
          idempotencyKey: `payment_link:${link.id}:order:${result.order_id}`,
        });
      } catch (groupError) {
        console.error('[public-checkout] composable group materialization failed', {
          payment_link_id: link.id,
          order_id: result.order_id,
          error: (groupError as Error).message,
        });
        return errorResponse('composable_order_materialization_failed', 500);
      }
      await supabase.from('payment_links').update({ order_group_id: orderGroupId }).eq('id', link.id);
    }

    // Audit log (создание checkout-сессии). Счётчик НЕ инкрементируем здесь — это делает webhook.
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      action: 'public_checkout.created',
      actor_label: 'public-checkout',
      target_user_id: userId,
      meta: {
        payment_link_id: link.id,
        order_id: result.order_id,
        order_group_id: orderGroupId,
        amount: link.amount,
        payment_type: link.payment_type,
      },
    });

    return jsonResponse({
      success: true,
      redirect_url: result.redirect_url,
      order_id: result.order_id,
      order_group_id: orderGroupId,
    });

  } catch (error) {
    console.error('[public-checkout] Unexpected error:', error);
    return errorResponse('Internal server error', 500);
  }
});
