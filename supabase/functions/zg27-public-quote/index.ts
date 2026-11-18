import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCorsPreflightRequest, jsonResponse, errorResponse, corsHeaders } from '../_shared/cors.ts';
import { assertZg27Checkout, Zg27CheckoutError } from '../_shared/zg27-checkout-guard.ts';
import { ZG27_PRODUCT_ID, ZG27_TIERS, ZG27_ACCESS_END_EXCLUSIVE } from '../_shared/zg27-policy.ts';

/** Read-only quote. Identity and category are never accepted from the browser. */
export async function handleZg27Quote(req: Request, db: any): Promise<Response> {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  if (req.method !== 'POST') return errorResponse('method_not_allowed', 405);
  try {
    const token = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
    if (!token) throw new Zg27CheckoutError('zg27_login_required', 401);
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user?.id) throw new Zg27CheckoutError('zg27_login_required', 401);
    const body = await req.json();
    if (!['zg27pervoe', 'zg27povtor'].includes(body.page_slug)) throw new Zg27CheckoutError('zg27_wrong_page');
    if (Date.now() >= Date.parse(ZG27_ACCESS_END_EXCLUSIVE)) throw new Zg27CheckoutError('zg27_sale_closed');
    const { data: eligibility, error: eligibilityError } = await db.rpc('zg27_purchase_eligibility_v1', {
      p_user_id: data.user.id, p_product_id: ZG27_PRODUCT_ID,
    });
    if (eligibilityError || eligibility?.policy_version !== 'zg27-v1'
      || !['first', 'repeat', 'not_eligible'].includes(eligibility?.category)
      || eligibility.eligible !== ['first', 'repeat'].includes(eligibility.category)) throw new Zg27CheckoutError('zg27_eligibility_unavailable', 503);
    if (!eligibility.eligible) throw new Zg27CheckoutError('zg27_not_eligible');
    const tier = ZG27_TIERS[eligibility.category as 'first' | 'repeat'];
    if (tier.page !== body.page_slug) return jsonResponse({ status: 'wrong_page', page_slug: tier.page });
    const { data: offers, error: offersError } = await db.from('tariff_offers')
      .select('id,tariff_id,payment_method,installment_count,is_active').eq('tariff_id', tier.tariffId).eq('is_active', true);
    if (offersError || !Array.isArray(offers)) throw new Zg27CheckoutError('zg27_configuration_unavailable', 503);
    const quotes = [];
    for (const offer of offers.filter((o: any) => ['full_payment', 'internal_installment'].includes(o.payment_method))) {
      const quote = await assertZg27Checkout({ db, userId: data.user.id, productId: ZG27_PRODUCT_ID,
        tariffId: tier.tariffId, offerId: offer.id, pageSlug: body.page_slug });
      if (!quote.applicable) throw new Zg27CheckoutError('zg27_configuration_unavailable', 503);
      quotes.push({ offer_id: offer.id, tariff_id: tier.tariffId, total_minor: quote.totalMinor,
        amounts_minor: quote.amounts.map((amount: number) => Math.round(amount * 100)), interval_days: 30 });
    }
    quotes.sort((a, b) => a.amounts_minor.length - b.amounts_minor.length);
    if (quotes.length !== 3 || quotes.some((quote, i) => quote.amounts_minor.length !== i + 1)) throw new Zg27CheckoutError('zg27_configuration_unavailable', 503);
    return new Response(JSON.stringify({ status: 'ready', product_id: ZG27_PRODUCT_ID, category: eligibility.category,
      policy_version: 'zg27-v1', access_end_exclusive: ZG27_ACCESS_END_EXCLUSIVE, offers: quotes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error instanceof Zg27CheckoutError ? error.code : 'zg27_quote_unavailable', error instanceof Zg27CheckoutError ? error.status : 503);
  }
}

Deno.serve((req) => handleZg27Quote(req, createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)));
