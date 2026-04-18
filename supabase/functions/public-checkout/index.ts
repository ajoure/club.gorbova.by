/**
 * public-checkout — Public payment checkout by url_token.
 * No JWT required. Validates payment_link, creates order + bePaid checkout.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createPaymentCheckout } from '../_shared/create-payment-checkout.ts';

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
          id, url_token, amount, currency, payment_type, description, status,
          max_uses, current_uses, expires_at,
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
      });
    }

    if (req.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    // POST — create checkout
    const body = await req.json();
    const { url_token, email } = body;

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

    // Canonical target-user resolution for public payment links:
    //   1) link.user_id present  → ALWAYS use it (recipient pre-bound, no login required)
    //   2) link.user_id absent + email provided → find user by email
    //   3) link.user_id absent + no email → ask UI to collect email/identity (NOT a login requirement)
    let userId: string | null = link.user_id || null;

    if (!userId && email) {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const found = existingUsers?.users?.find(
        (u: any) => u.email?.toLowerCase() === email.toLowerCase()
      );
      userId = found?.id || null;
      if (!userId) {
        return errorResponse('Пользователь с таким email не найден. Завершите регистрацию и повторите оплату.', 400);
      }
    }

    if (!userId) {
      // Only reached when link has no target user AND no email was provided.
      // Login is NEVER required — UI must collect email/inline-auth.
      return errorResponse('Укажите email для оформления оплаты', 400);
    }

    // Determine origin for return URLs
    const reqOrigin = req.headers.get('origin');
    const reqReferer = req.headers.get('referer');
    const origin = reqOrigin || (reqReferer ? new URL(reqReferer).origin : null) || 'https://club.gorbova.by';

    // Delegate to shared checkout helper
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
    });

    if (!result.success) {
      return errorResponse(result.error, 500);
    }

    // Increment current_uses
    const { error: updateErr } = await supabase
      .from('payment_links')
      .update({ current_uses: link.current_uses + 1, updated_at: new Date().toISOString() })
      .eq('id', link.id);

    if (updateErr) {
      console.error('[public-checkout] Failed to increment current_uses:', updateErr);
    }

    // Audit log
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
