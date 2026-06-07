// Phase 5-B — admin-stripe-price-lookup
//
// Thin read-only Stripe Price lookup for the Offer Acquiring Settings UI.
// Resolves { price_id, account_code } → { product_id, currency, mode, active }.
//
// Hard rules:
//   - super_admin only (verify_jwt=true in config.toml).
//   - NO writes anywhere (no DB, no Stripe mutations).
//   - Pure Stripe REST `GET /v1/prices/{id}`.
//   - Does NOT touch tariff_offers / payment_links / orders / webhooks / grant-access.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ReqBody {
  price_id: string;
  account_code: string;
}

interface StripePrice {
  id: string;
  product: string;
  active: boolean;
  currency: string;
  livemode: boolean;
  unit_amount: number | null;
  recurring: { interval: string; interval_count: number } | null;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  try {
    await requireSuperAdmin(req);
  } catch (e) {
    return json(401, { error: String(e instanceof Error ? e.message : e) });
  }

  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const price_id = (body.price_id || '').trim();
  const account_code = (body.account_code || '').trim();
  if (!price_id) return json(400, { error: 'missing_price_id' });
  if (!account_code) return json(400, { error: 'missing_account_code' });
  if (!/^price_[A-Za-z0-9]+$/.test(price_id)) {
    return json(400, { error: 'invalid_price_id_format' });
  }

  // Verify account exists & is Stripe
  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: acc, error: accErr } = await svc
    .from('acquiring_connections')
    .select('account_code, provider, status, test_mode')
    .eq('account_code', account_code)
    .eq('provider', 'stripe')
    .maybeSingle();
  if (accErr || !acc) {
    return json(404, { error: 'account_not_found', account_code });
  }
  if (acc.status !== 'active') {
    return json(400, { error: 'account_inactive', account_code, status: acc.status });
  }

  let secret: string;
  try {
    secret = await readAcquiringSecret('stripe', account_code, 'secret_key');
  } catch (e) {
    return json(500, { error: 'secret_not_found', detail: String(e instanceof Error ? e.message : e) });
  }

  // Stripe REST GET /v1/prices/{id}?expand[]=product
  const resp = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(price_id)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Stripe-Version': '2024-06-20',
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* noop */ }
    return json(resp.status === 404 ? 404 : 502, {
      error: resp.status === 404 ? 'price_not_found_in_stripe' : 'stripe_error',
      status: resp.status,
      detail: parsed?.error?.message || text.slice(0, 500),
    });
  }
  const price = (await resp.json()) as StripePrice;

  return json(200, {
    ok: true,
    price_id: price.id,
    product_id: price.product,
    currency: price.currency.toUpperCase(),
    mode: price.livemode ? 'live' : 'test',
    active: price.active,
    account_code,
    account_mode_hint: acc.test_mode ? 'test' : 'live',
    recurring: price.recurring,
    unit_amount: price.unit_amount,
  });
});
