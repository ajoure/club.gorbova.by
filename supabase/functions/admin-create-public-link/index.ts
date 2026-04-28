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
}

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
      currency = 'BYN',
      payment_type = 'one_time',
      description = null, max_uses = null, expires_at = null, user_id = null,
      requested_payment_type, resolved_mode, cta_source, cta_contract_version,
    } = body;

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
    if (offer_id) {
      const { data: offer } = await supabase
        .from('tariff_offers')
        .select('id, tariff_id, is_active, offer_type, meta')
        .eq('id', offer_id).maybeSingle();
      if (!offer) return errorResponse('Offer not found', 400);
      if (offer.tariff_id !== tariff_id) return errorResponse('Offer does not belong to tariff', 400);
      if (!offer.is_active) return errorResponse('Offer is not active', 400);
      if (offer.offer_type !== 'pay_now') return errorResponse('Offer is not a pay_now offer', 400);
      offerIsRecurring = !!(offer as any).meta?.recurring?.is_recurring;
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

    const { data: link, error: insertErr } = await supabase
      .from('payment_links')
      .insert({
        product_id,
        tariff_id,
        offer_id: offer_id || null,
        amount,
        currency,
        payment_type,
        description,
        max_uses,
        expires_at,
        user_id,
        created_by: user.id,
        url_token,
        public_url,
      })
      .select('id, url_token, status, current_uses, max_uses, expires_at, amount, currency, payment_type, product_id, tariff_id, offer_id, created_by')
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
        amount, currency,
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
      },
    });

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
      row: link,
    });
  } catch (e) {
    console.error('[admin-create-public-link] Unexpected error:', e);
    return errorResponse('Internal server error', 500);
  }
});
