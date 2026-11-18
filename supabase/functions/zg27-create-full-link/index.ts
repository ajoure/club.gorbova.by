import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { assertZg27Checkout, Zg27CheckoutError } from '../_shared/zg27-checkout-guard.ts';
import { ZG27_PRODUCT_ID } from '../_shared/zg27-policy.ts';

/** Scoped hosted checkout; does not enable any retired saved-card/MIT entry point. */
export async function handleZg27FullLink(req: Request, db: any): Promise<Response> {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  if (req.method !== 'POST') return errorResponse('method_not_allowed', 405);
  try {
    const token = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
    if (!token) throw new Zg27CheckoutError('zg27_login_required', 401);
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user?.id) throw new Zg27CheckoutError('zg27_login_required', 401);
    const body = await req.json();
    const quote = await assertZg27Checkout({ db, userId: data.user.id, productId: ZG27_PRODUCT_ID,
      tariffId: body.tariff_id, offerId: body.offer_id, installmentCount: 1, pageSlug: body.page_slug });
    if (!quote.applicable || quote.amounts.length !== 1) throw new Zg27CheckoutError('zg27_offer_invalid');
    const now = new Date().toISOString();
    const { data: reusable, error: reuseError } = await db.from('payment_links').select('url_token')
      .eq('user_id', data.user.id).eq('offer_id', body.offer_id).eq('product_id', ZG27_PRODUCT_ID)
      .eq('amount', quote.totalMinor).eq('currency', 'BYN').eq('payment_type', 'one_time').eq('status', 'active')
      .eq('current_uses', 0).gt('expires_at', now).contains('meta', { source: 'zg27_hosted_full' })
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (reuseError) throw new Zg27CheckoutError('zg27_link_creation_failed', 503);
    if (reusable?.url_token) return jsonResponse({ success: true, url_token: reusable.url_token });
    const urlToken = crypto.randomUUID();
    const { error: insertError } = await db.from('payment_links').insert({
      product_id: ZG27_PRODUCT_ID, tariff_id: body.tariff_id, offer_id: body.offer_id,
      amount: quote.totalMinor, currency: 'BYN', payment_type: 'one_time', status: 'active',
      user_id: data.user.id, created_by: data.user.id, max_uses: 1, current_uses: 0,
      url_token: urlToken, public_url: `https://gorbova.by/pay/${urlToken}`,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      meta: { source: 'zg27_hosted_full', auth_policy: 'required', zg27_policy_version: quote.policyVersion },
    });
    if (insertError) throw new Zg27CheckoutError('zg27_link_creation_failed', 503);
    return jsonResponse({ success: true, url_token: urlToken });
  } catch (error) {
    return errorResponse(error instanceof Zg27CheckoutError ? error.code : 'zg27_link_creation_failed', error instanceof Zg27CheckoutError ? error.status : 503);
  }
}

Deno.serve((req) => handleZg27FullLink(req, createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)));
