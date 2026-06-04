// GAP-C.2–C.7 — admin-provision-stripe-price
//
// Admin-only edge function that idempotently provisions a Stripe Product +
// recurring Price for a single tariff_offer and writes the canonical
// `tariff_offers.meta.stripe.*` mapping (schema_version=1).
//
// Contract:
//   POST { tariff_offer_id, account_code, business_stream, execute? }
//   - execute !== true  → dry_run (no Stripe, no DB writes)
//   - execute === true  → real Stripe Product+Price create, then DB merge
//
// Hard rules:
//   • super_admin only (verify_jwt=true in config.toml)
//   • amount/currency SOT = active tariff_prices row (never offer.amount)
//   • GAP-A whitelist: currency ∈ {BYN, USD, EUR, PLN, RUB, KZT, UAH}
//   • GAP-B resolver: only month/1 + year/1 (interval_count > 1 → 422)
//   • Idempotency: if meta.stripe.price_id exists + retrieve PASS → return
//     idempotent_hit (no create). Drift → manual_review (no silent recreate).
//   • Stripe-Create-OK + DB-Write-FAIL → manual_review + 500 + audit
//   • bePaid tables NEVER touched
//   • No rotation in this patch (drift → parameter_drift_rotation_required)
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

const SCHEMA_VERSION = 1;
const CURRENCY_WHITELIST = ['BYN', 'USD', 'EUR', 'PLN', 'RUB', 'KZT', 'UAH'];
const PURPOSE = 'stripe_subscription_mvp';
const ENVIRONMENT = 'test';

type ManualReviewReason =
  | 'price_missing'
  | 'price_archived'
  | 'price_mismatch'
  | 'parameter_drift_rotation_required'
  | 'stripe_object_without_db_mapping'
  | 'db_write_failed_after_stripe_create'
  | 'foreign_stripe_mapping_detected';

interface ProvisionRequest {
  tariff_offer_id: string;
  account_code: string;
  business_stream: string;
  execute?: boolean;
}

interface StripeProduct {
  id: string;
  active: boolean;
  metadata: Record<string, string>;
  livemode: boolean;
}
interface StripePrice {
  id: string;
  product: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count: number } | null;
  metadata: Record<string, string>;
  livemode: boolean;
  billing_scheme?: string;
  tax_behavior?: string;
  created: number;
}

function svc() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

// ---- Stripe REST helpers ----
async function stripeReq<T>(
  method: 'GET' | 'POST',
  path: string,
  secret: string,
  body?: Record<string, string>,
  idempotencyKey?: string,
): Promise<{ ok: boolean; status: number; data: T | { error?: { message?: string; code?: string } } }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let init: RequestInit = { method, headers };
  if (body) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = form.toString();
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: JSON.parse(text) as T };
}

// ---- Audit helper ----
async function audit(
  action: string,
  actor_user_id: string | null,
  entity_id: string,
  meta: Record<string, unknown>,
): Promise<string | null> {
  const { data } = await svc()
    .from('audit_logs')
    .insert({
      action: `stripe_provision_${action}`,
      actor_user_id,
      actor_type: 'admin',
      entity_type: 'tariff_offer',
      entity_id,
      meta,
    })
    .select('id')
    .single();
  return (data as { id?: string } | null)?.id ?? null;
}

// ---- GAP-B resolver (minimal mirror) ----
function resolveBillingPeriod(meta: any): {
  ok: boolean;
  interval?: 'day' | 'week' | 'month' | 'year';
  interval_count?: number;
  reason?: string;
} {
  const r = meta?.recurring;
  if (!r || !r.is_recurring) return { ok: false, reason: 'not_recurring' };
  const mode = r.billing_period_mode;
  const days = Number(r.billing_period_days ?? 0);
  if (mode === 'days') {
    if (days === 30) return { ok: true, interval: 'month', interval_count: 1 };
    if (days === 365) return { ok: true, interval: 'year', interval_count: 1 };
    if ([60, 90, 180].includes(days)) return { ok: false, reason: `billing_period_not_supported:days:${days}` };
    if (days === 730) return { ok: false, reason: 'billing_period_not_supported:days:730' };
    return { ok: false, reason: `billing_period_not_supported:days:${days}` };
  }
  return { ok: false, reason: `billing_period_mode_not_supported:${mode}` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let actor_user_id: string | null = null;
  let tariff_offer_id = '';

  try {
    const { user } = await requireSuperAdmin(req);
    actor_user_id = user.user_id;

    const body = (await req.json()) as ProvisionRequest;
    tariff_offer_id = body.tariff_offer_id;
    const account_code = body.account_code;
    const business_stream = body.business_stream;
    const execute = body.execute === true;

    if (!tariff_offer_id || !account_code || !business_stream) {
      return json(400, {
        status: 'error',
        error: 'bad_request:missing tariff_offer_id|account_code|business_stream',
      });
    }

    // ---- Load offer + product + price ----
    const supabase = svc();
    const { data: offer } = await supabase
      .from('tariff_offers')
      .select('id, tariff_id, amount, meta, is_active')
      .eq('id', tariff_offer_id)
      .maybeSingle();
    if (!offer) return json(404, { status: 'error', error: 'offer_not_found' });
    if (!(offer as any).is_active) return json(422, { status: 'error', error: 'offer_inactive' });

    const { data: tariff } = await supabase
      .from('tariffs')
      .select('id, product_id, name')
      .eq('id', (offer as any).tariff_id)
      .maybeSingle();
    if (!tariff) return json(404, { status: 'error', error: 'tariff_not_found' });

    const { data: product } = await supabase
      .from('products_v2')
      .select('id, name')
      .eq('id', (tariff as any).product_id)
      .maybeSingle();
    if (!product) return json(404, { status: 'error', error: 'product_not_found' });

    const { data: price } = await supabase
      .from('tariff_prices')
      .select('id, final_price, currency, is_active')
      .eq('tariff_id', (tariff as any).id)
      .eq('is_active', true)
      .maybeSingle();
    if (!price) {
      await audit('manual_review', actor_user_id, tariff_offer_id, { reason: 'no_active_tariff_price' });
      return json(422, { status: 'manual_review', error: 'no_active_tariff_price' });
    }

    const currency = String((price as any).currency).toUpperCase();
    const amountDecimal = Number((price as any).final_price);
    const unit_amount = Math.round(amountDecimal * 100);

    if (!CURRENCY_WHITELIST.includes(currency)) {
      await audit('manual_review', actor_user_id, tariff_offer_id, { reason: 'currency_not_whitelisted', currency });
      return json(422, { status: 'manual_review', error: `currency_not_whitelisted:${currency}` });
    }

    const period = resolveBillingPeriod((offer as any).meta);
    if (!period.ok) {
      await audit('manual_review', actor_user_id, tariff_offer_id, { reason: period.reason });
      return json(422, { status: 'manual_review', error: period.reason });
    }

    // ---- Foreign mapping cross-check ----
    const foreign: string[] = [];
    const offerStripe = (offer as any).meta?.stripe ?? null;
    {
      const { data: pv2 } = await supabase
        .from('products_v2')
        .select('id, meta')
        .eq('id', (tariff as any).product_id)
        .maybeSingle();
      if ((pv2 as any)?.meta?.stripe) foreign.push('products_v2.meta.stripe');
    }

    // ---- Build plan ----
    const product_name = `${(product as any).name} — ${(tariff as any).name}`;
    const stripeMeta = {
      product_id: (tariff as any).product_id,
      tariff_id: (tariff as any).id,
      tariff_offer_id,
      account_code,
      business_stream,
      environment: ENVIRONMENT,
      purpose: PURPOSE,
    };
    const plan = {
      product: {
        name: product_name,
        metadata: stripeMeta,
        idempotency_key: `stripe-product:${tariff_offer_id}`,
      },
      price: {
        currency: currency.toLowerCase(),
        unit_amount,
        recurring: { interval: period.interval!, interval_count: period.interval_count! },
        metadata: stripeMeta,
        idempotency_key: `stripe-price:${tariff_offer_id}:${currency}:${unit_amount}:${period.interval}:${period.interval_count}`,
      },
      sot: {
        amount_source: 'tariff_prices.final_price',
        currency_source: 'tariff_prices.currency',
        tariff_price_id: (price as any).id,
        offer_amount_legacy_diagnostic: (offer as any).amount,
      },
      foreign_mappings_detected: foreign,
    };

    // ---- Resolve Stripe secret ----
    const secret = await readAcquiringSecret('stripe', account_code, 'secret_key');

    // ---- Idempotent retrieve path ----
    if (offerStripe?.price_id && offerStripe?.product_id) {
      const prodResp = await stripeReq<StripeProduct>('GET', `products/${offerStripe.product_id}`, secret);
      const priceResp = await stripeReq<StripePrice>('GET', `prices/${offerStripe.price_id}`, secret);

      if (priceResp.status === 404 || prodResp.status === 404) {
        await audit('manual_review', actor_user_id, tariff_offer_id, {
          reason: 'price_missing' satisfies ManualReviewReason,
          db_price_id: offerStripe.price_id,
          db_product_id: offerStripe.product_id,
        });
        return json(409, { status: 'manual_review', reason: 'price_missing', plan });
      }
      const sp = priceResp.data as StripePrice;
      if (!sp.active) {
        await audit('manual_review', actor_user_id, tariff_offer_id, {
          reason: 'price_archived' satisfies ManualReviewReason,
          price_id: sp.id,
        });
        return json(409, { status: 'manual_review', reason: 'price_archived', plan });
      }
      const driftReasons: string[] = [];
      if (sp.currency?.toUpperCase() !== currency) driftReasons.push('currency');
      if (sp.unit_amount !== unit_amount) driftReasons.push('unit_amount');
      if (sp.recurring?.interval !== period.interval) driftReasons.push('interval');
      if (sp.recurring?.interval_count !== period.interval_count) driftReasons.push('interval_count');
      if (sp.livemode !== false) driftReasons.push('livemode');
      if (driftReasons.length > 0) {
        await audit('manual_review', actor_user_id, tariff_offer_id, {
          reason: 'parameter_drift_rotation_required' satisfies ManualReviewReason,
          drift: driftReasons,
          stripe: { id: sp.id, currency: sp.currency, unit_amount: sp.unit_amount, recurring: sp.recurring, livemode: sp.livemode },
          db: { currency, unit_amount, recurring: { interval: period.interval, interval_count: period.interval_count } },
        });
        return json(409, { status: 'manual_review', reason: 'parameter_drift_rotation_required', drift: driftReasons, plan });
      }
      await audit('idempotent_existing', actor_user_id, tariff_offer_id, {
        product_id: offerStripe.product_id,
        price_id: offerStripe.price_id,
      });
      return json(200, {
        mode: 'idempotent_hit',
        status: 'ok',
        plan,
        stripe: { product_id: offerStripe.product_id, price_id: offerStripe.price_id, retrieve_proof: { product: prodResp.data, price: priceResp.data } },
        db_write: { applied: false, meta_stripe_after: offerStripe },
      });
    }

    // ---- DRY RUN ----
    if (!execute) {
      const aid = await audit('dry_run', actor_user_id, tariff_offer_id, { plan });
      return json(200, {
        mode: 'dry_run',
        status: 'ok',
        plan,
        stripe: null,
        db_write: { applied: false, meta_stripe_after: offerStripe ?? null },
        audit_event_ids: [aid],
      });
    }

    // ---- EXECUTE: drift re-check (compare with plan from DB right now) ----
    // (Re-read offer+price right before create to detect concurrent change.)
    const { data: offerNow } = await supabase
      .from('tariff_offers')
      .select('amount, meta')
      .eq('id', tariff_offer_id)
      .maybeSingle();
    const { data: priceNow } = await supabase
      .from('tariff_prices')
      .select('final_price, currency, is_active')
      .eq('tariff_id', (tariff as any).id)
      .eq('is_active', true)
      .maybeSingle();
    if (
      !priceNow ||
      !(priceNow as any).is_active ||
      String((priceNow as any).currency).toUpperCase() !== currency ||
      Math.round(Number((priceNow as any).final_price) * 100) !== unit_amount
    ) {
      return json(409, { status: 'error', error: 'configuration_changed:tariff_prices' });
    }
    const periodNow = resolveBillingPeriod((offerNow as any)?.meta);
    if (!periodNow.ok || periodNow.interval !== period.interval || periodNow.interval_count !== period.interval_count) {
      return json(409, { status: 'error', error: 'configuration_changed:recurring' });
    }

    await audit('started', actor_user_id, tariff_offer_id, { plan });

    // ---- Stripe Product create ----
    const metaForm: Record<string, string> = {};
    for (const [k, v] of Object.entries(stripeMeta)) metaForm[`metadata[${k}]`] = String(v);

    const prodCreate = await stripeReq<StripeProduct>(
      'POST',
      'products',
      secret,
      { name: product_name, ...metaForm },
      plan.product.idempotency_key,
    );
    if (!prodCreate.ok) {
      const errMsg = (prodCreate.data as any)?.error?.message ?? 'stripe_product_create_failed';
      await audit('error', actor_user_id, tariff_offer_id, { step: 'product_create', status: prodCreate.status, stripe_error: prodCreate.data });
      return json(502, { status: 'error', error: errMsg, step: 'product_create' });
    }
    const createdProduct = prodCreate.data as StripeProduct;
    await audit('product_created', actor_user_id, tariff_offer_id, { product_id: createdProduct.id });

    // ---- Stripe Price create ----
    const priceCreate = await stripeReq<StripePrice>(
      'POST',
      'prices',
      secret,
      {
        product: createdProduct.id,
        currency: currency.toLowerCase(),
        unit_amount: String(unit_amount),
        'recurring[interval]': period.interval!,
        'recurring[interval_count]': String(period.interval_count!),
        ...metaForm,
      },
      plan.price.idempotency_key,
    );
    if (!priceCreate.ok) {
      const errMsg = (priceCreate.data as any)?.error?.message ?? 'stripe_price_create_failed';
      await audit('error', actor_user_id, tariff_offer_id, { step: 'price_create', status: priceCreate.status, stripe_error: priceCreate.data, product_id: createdProduct.id });
      return json(502, { status: 'error', error: errMsg, step: 'price_create', product_id: createdProduct.id });
    }
    const createdPrice = priceCreate.data as StripePrice;
    await audit('price_created', actor_user_id, tariff_offer_id, { product_id: createdProduct.id, price_id: createdPrice.id });

    // ---- DB merge ----
    const metaStripe = {
      schema_version: SCHEMA_VERSION,
      product_id: createdProduct.id,
      price_id: createdPrice.id,
      account_code,
      business_stream,
      provisioned_at: new Date().toISOString(),
      provisioned_by: actor_user_id,
      price_snapshot: {
        price_id: createdPrice.id,
        product_id: createdProduct.id,
        currency: createdPrice.currency,
        unit_amount: createdPrice.unit_amount,
        interval: createdPrice.recurring?.interval,
        interval_count: createdPrice.recurring?.interval_count,
        livemode: createdPrice.livemode,
        billing_scheme: createdPrice.billing_scheme ?? null,
        tax_behavior: createdPrice.tax_behavior ?? null,
        created_at: new Date((createdPrice.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      },
      price_id_history: [],
      accounts: {
        [account_code]: { product_id: createdProduct.id, price_id: createdPrice.id },
      },
    };

    const mergedMeta = { ...((offerNow as any)?.meta ?? {}), stripe: metaStripe };
    const { error: updErr } = await supabase
      .from('tariff_offers')
      .update({ meta: mergedMeta })
      .eq('id', tariff_offer_id);

    if (updErr) {
      await audit('db_write_failed', actor_user_id, tariff_offer_id, {
        reason: 'db_write_failed_after_stripe_create' satisfies ManualReviewReason,
        product_id: createdProduct.id,
        price_id: createdPrice.id,
        db_error: updErr.message,
      });
      return json(500, {
        status: 'manual_review',
        reason: 'db_write_failed_after_stripe_create',
        stripe: { product_id: createdProduct.id, price_id: createdPrice.id },
        db_error: updErr.message,
      });
    }

    const aidDone = await audit('completed', actor_user_id, tariff_offer_id, {
      product_id: createdProduct.id,
      price_id: createdPrice.id,
      meta_stripe_after: metaStripe,
    });

    return json(200, {
      mode: 'execute',
      status: 'ok',
      plan,
      stripe: {
        product_id: createdProduct.id,
        price_id: createdPrice.id,
        retrieve_proof: { product: createdProduct, price: createdPrice },
      },
      db_write: { applied: true, meta_stripe_after: metaStripe },
      audit_event_ids: [aidDone],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('unauthorized') ? 401 : msg.startsWith('forbidden') ? 403 : 500;
    if (tariff_offer_id) {
      try { await audit('error', actor_user_id, tariff_offer_id, { error: msg }); } catch { /* ignore */ }
    }
    return json(status, { status: 'error', error: msg });
  }
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
