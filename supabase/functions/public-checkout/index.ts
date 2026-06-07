/**
 * public-checkout — Public payment checkout by url_token.
 * No JWT required. Validates payment_link, creates order + bePaid checkout.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createPaymentCheckout } from '../_shared/create-payment-checkout.ts';
import { resolveProviderChoice, isValidProviderChoice, type CustomerProvider } from '../_shared/resolve-provider-choice.ts';

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
      });
    }

    if (req.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    // POST — create checkout
    const body = await req.json();
    const { url_token, email, replacement_of_subscription_v2_id, provider_choice } = body as {
      url_token?: string;
      email?: string;
      replacement_of_subscription_v2_id?: string;
      provider_choice?: 'bepaid' | 'stripe';
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
      if (!provider_choice) {
        return errorResponse('provider_choice_required', 400);
      }
      if (!isValidProviderChoice(provider_choice, resolution)) {
        return errorResponse('invalid_provider_choice', 400);
      }
      effectiveProvider = provider_choice;
      // Resolve Stripe account on the fly when customer chose stripe.
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
    //   3) link.user_id absent + email only → lookup via admin API (paginated).
    //   4) Otherwise → 400 with identity-input hint (UI keeps inline-auth open).
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

    if (!userId && email) {
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

    // Determine origin for return URLs
    const reqOrigin = req.headers.get('origin');
    const reqReferer = req.headers.get('referer');
    const origin = reqOrigin || (reqReferer ? new URL(reqReferer).origin : null) || 'https://club.gorbova.by';

    // Delegate to shared checkout helper.
    // PATCH-PUBLIC-LINK-COUNTER: payment_link_id уходит в orders_v2.meta через канонический meta_extra
    // (никаких post-insert UPDATE на стороне public-checkout).
    // Счётчик payment_links.current_uses ИНКРЕМЕНТИРУЕТСЯ ТОЛЬКО webhook'ом по факту paid order
    // (через _shared/consume-payment-link.ts). Здесь мы счётчик не двигаем.
    //
    // Stage L3: пробрасываем installment-meta из payment_links.meta.installment в orders_v2.meta.
    // Webhook bepaid (LINK-ORDER) использует эти поля для материализации installment_payments.
    const linkMeta = (link.meta || {}) as Record<string, any>;
    const linkInstallment = (linkMeta.installment || null) as Record<string, any> | null;
    const installmentMetaExtra = linkInstallment && Number(linkInstallment.selected_installment_months) >= 2
      ? {
          installment_count: Number(linkInstallment.selected_installment_months),
          installment_per_payment_amount_byn: Number(linkInstallment.per_payment_amount_byn),
          installment_total_amount_byn: Number(linkInstallment.per_payment_amount_byn) * Number(linkInstallment.selected_installment_months),
          installment: {
            interval_days: Number(linkInstallment.interval_days ?? 30),
            first_payment_delay_days: Number(linkInstallment.first_payment_delay_days ?? 0),
            rounding_mode: String(linkInstallment.rounding_mode ?? 'round_half_up_byn'),
            max_installment_months: Number(linkInstallment.max_installment_months ?? linkInstallment.selected_installment_months),
            source: 'payment_link',
            // PATCH INSTALLMENT-PUBLIC-LINK: маркер для shared checkout — оформить как finite bePaid subscription.
            as_finite_subscription: true,
            billing_cycles: Number(linkInstallment.selected_installment_months),
          },
        }
      : {};

    const result = await createPaymentCheckout({
      supabase,
      user_id: userId,
      product_id: link.product_id,
      tariff_id: link.tariff_id,
      amount: link.amount,
      payment_type: link.payment_type as 'one_time' | 'subscription',
      description: link.description || undefined,
      offer_id: link.offer_id || undefined,
      origin,
      actor_type: 'system',
      replacement_of_subscription_v2_id: replacement_of_subscription_v2_id || undefined,
      meta_extra: { payment_link_id: link.id, ...installmentMetaExtra },
      // Phase 4.1 — provider routing. default 'bepaid' (полный бэк-компат для 113 legacy ссылок).
      provider: (link.provider as 'bepaid' | 'stripe' | null) ?? 'bepaid',
      account_code: link.account_code ?? null,
      currency: link.currency ?? 'BYN',
    });

    if (!result.success) {
      if (result.error === 'existing_subscription_conflict' && result.conflict) {
        return jsonResponse({
          success: false,
          error: 'existing_subscription_conflict',
          conflict: result.conflict,
        });
      }
      return jsonResponse({ success: false, error: result.error });
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
        amount: link.amount,
        payment_type: link.payment_type,
      },
    });

    return jsonResponse({
      success: true,
      redirect_url: result.redirect_url,
      order_id: result.order_id,
    });

  } catch (error) {
    console.error('[public-checkout] Unexpected error:', error);
    return errorResponse('Internal server error', 500);
  }
});
