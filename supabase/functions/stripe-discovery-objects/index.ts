// GAP-C.1 — Read-only discovery of existing Stripe Product/Price objects
// per account_code. NO mutations. super_admin only. Used to prevent
// duplicate Product/Price creation in admin-provision-stripe-price.
//
// Diagnose → Plan → Dry run → Execute → Verify: this function is the
// "Diagnose" tool for GAP-C provisioning.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

interface StripeListResponse<T> { data: T[]; has_more: boolean; }
interface StripeProduct { id: string; name: string; active: boolean; metadata: Record<string, string>; created: number; }
interface StripePrice { id: string; product: string; active: boolean; currency: string; unit_amount: number | null; recurring: { interval: string; interval_count: number } | null; metadata: Record<string, string>; created: number; livemode: boolean; }

async function stripeGet<T>(path: string, secret: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`stripe_api_error:${res.status}:${text}`);
  return JSON.parse(text) as T;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    await requireSuperAdmin(req);

    const url = new URL(req.url);
    const account_code = url.searchParams.get('account_code') ?? 'stripe_poland';
    const tariff_offer_id = url.searchParams.get('tariff_offer_id');

    const secret = await readAcquiringSecret('stripe', account_code, 'secret_key');

    // List products (test mode) + their prices.
    const products = await stripeGet<StripeListResponse<StripeProduct>>(
      'products?limit=100&active=true',
      secret,
    );
    const productsAll = await stripeGet<StripeListResponse<StripeProduct>>(
      'products?limit=100',
      secret,
    );
    const prices = await stripeGet<StripeListResponse<StripePrice>>(
      'prices?limit=100&active=true&expand[]=data.product',
      secret,
    );
    const pricesAll = await stripeGet<StripeListResponse<StripePrice>>(
      'prices?limit=100',
      secret,
    );

    // Match candidates for pilot offer (metadata.tariff_offer_id).
    const filterByOffer = (arr: { metadata: Record<string, string> }[]) =>
      tariff_offer_id
        ? arr.filter((x) => x.metadata?.tariff_offer_id === tariff_offer_id)
        : [];

    const matchingProducts = filterByOffer(productsAll.data);
    const matchingPrices = filterByOffer(pricesAll.data);

    // DB cross-check for this offer.
    let dbOffer: any = null;
    if (tariff_offer_id) {
      const svc = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { data } = await svc
        .from('tariff_offers')
        .select('id, tariff_id, meta')
        .eq('id', tariff_offer_id)
        .maybeSingle();
      dbOffer = data;
    }

    return new Response(
      JSON.stringify({
        account_code,
        tariff_offer_id,
        summary: {
          products_active_total: products.data.length,
          products_all_total: productsAll.data.length,
          products_has_more: productsAll.has_more,
          prices_active_total: prices.data.length,
          prices_all_total: pricesAll.data.length,
          prices_has_more: pricesAll.has_more,
          matching_products_for_offer: matchingProducts.length,
          matching_prices_for_offer: matchingPrices.length,
        },
        matching_products: matchingProducts,
        matching_prices: matchingPrices,
        db_offer_meta_stripe: dbOffer?.meta?.stripe ?? null,
        all_products_preview: productsAll.data.map((p) => ({ id: p.id, name: p.name, active: p.active, metadata: p.metadata, created: p.created })),
        all_prices_preview: pricesAll.data.map((p) => ({ id: p.id, product: typeof p.product === 'string' ? p.product : (p.product as any)?.id, active: p.active, currency: p.currency, unit_amount: p.unit_amount, recurring: p.recurring, metadata: p.metadata, livemode: p.livemode })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('unauthorized') ? 401 : msg.startsWith('forbidden') ? 403 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    });
  }
});
