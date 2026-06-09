// PATCH-STRIPE-CARD-DATA-V1 (2026-06-09)
// Targeted utility: fetch card_brand/card_last4/card_holder for a single
// existing Stripe payment in payments_v2 and write them back.
//
// Hard constraints:
// - super_admin only (requireSuperAdmin)
// - one payment_intent per call (no batch mode)
// - only updates card fields + meta.card_data_fetched_at + meta.card_data_source
// - never touches status, amount, refunded_amount, lifecycle, access, refunds
// - never creates rows, never deletes
// - audit_logs row per call

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

interface Body {
  payment_intent: string;            // pi_*
  account_code?: string;             // default 'stripe_poland'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const body = raw as Partial<Body>;
  if (!body.payment_intent || !/^pi_[A-Za-z0-9]+$/.test(body.payment_intent)) {
    return json({ error: 'invalid_payment_intent' }, 400);
  }

  let actor: { user_id: string; email: string | null };
  let supabase: any;
  try {
    const guard = await requireSuperAdmin(req);
    actor = guard.user;
    supabase = guard.supabase;
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg.startsWith('forbidden') ? 'forbidden' : 'unauthorized', detail: msg }, msg.startsWith('forbidden') ? 403 : 401);
  }

  // Find the local payment row by provider_payment_id (must exist).
  const { data: payment, error: pErr } = await supabase
    .from('payments_v2')
    .select('id, provider, provider_payment_id, card_brand, card_last4, card_holder, meta')
    .eq('provider', 'stripe')
    .eq('provider_payment_id', body.payment_intent)
    .maybeSingle();
  if (pErr) return json({ error: 'db_error', detail: pErr.message }, 500);
  if (!payment) return json({ error: 'payment_not_found', payment_intent: body.payment_intent }, 404);

  const meta = (payment.meta as any) || {};
  const accountCode = body.account_code
    || meta?.stripe?.account_code
    || meta?.account_code
    || 'stripe_poland';

  let sk: string;
  try {
    sk = await readAcquiringSecret('stripe', accountCode, 'secret_key');
  } catch (e) {
    return json({ error: 'stripe_secret_unavailable', detail: (e as Error).message }, 200);
  }

  // Fetch PaymentIntent with expanded latest_charge.
  const piUrl = `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(body.payment_intent)}?expand[]=latest_charge`;
  const resp = await fetch(piUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${sk}` },
  });
  const piData: any = await resp.json();
  if (!resp.ok) {
    return json({ error: 'stripe_api_error', status: resp.status, stripe_error: piData?.error || piData }, 200);
  }

  const latestCharge = piData?.latest_charge && typeof piData.latest_charge === 'object'
    ? piData.latest_charge
    : null;
  const card = latestCharge?.payment_method_details?.card ?? null;
  const billing = latestCharge?.billing_details ?? null;

  const cardBrand: string | null = card?.brand ?? null;
  const cardLast4: string | null = card?.last4 ?? null;
  const cardHolder: string | null = billing?.name ?? null;

  if (!cardBrand && !cardLast4 && !cardHolder) {
    await supabase.from('audit_logs').insert({
      actor_user_id: actor.user_id,
      action: 'admin.stripe.card_data_fetch_empty',
      meta: {
        payment_intent: body.payment_intent,
        account_code: accountCode,
        payment_id: payment.id,
        note: 'PATCH-STRIPE-CARD-DATA-V1 — Stripe returned no card details',
      },
    });
    return json({
      ok: true,
      updated: false,
      reason: 'no_card_data_from_stripe',
      payment_intent: body.payment_intent,
    });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    meta: {
      ...meta,
      card_data_fetched_at: new Date().toISOString(),
      card_data_source: 'stripe_targeted_fetch_v1',
    },
  };
  if (cardBrand) updates.card_brand = cardBrand;
  if (cardLast4) updates.card_last4 = cardLast4;
  if (cardHolder) updates.card_holder = cardHolder;

  const { error: updErr } = await supabase
    .from('payments_v2')
    .update(updates)
    .eq('id', payment.id);
  if (updErr) return json({ error: 'db_update_failed', detail: updErr.message }, 500);

  await supabase.from('audit_logs').insert({
    actor_user_id: actor.user_id,
    action: 'admin.stripe.card_data_fetch_ok',
    meta: {
      payment_intent: body.payment_intent,
      account_code: accountCode,
      payment_id: payment.id,
      before: {
        card_brand: payment.card_brand,
        card_last4: payment.card_last4,
        card_holder: payment.card_holder,
      },
      after: {
        card_brand: cardBrand,
        card_last4: cardLast4,
        card_holder: cardHolder,
      },
      note: 'PATCH-STRIPE-CARD-DATA-V1 — targeted single-PI fetch',
    },
  });

  return json({
    ok: true,
    updated: true,
    payment_intent: body.payment_intent,
    card_brand: cardBrand,
    card_last4: cardLast4,
    card_holder: cardHolder,
  });
});
