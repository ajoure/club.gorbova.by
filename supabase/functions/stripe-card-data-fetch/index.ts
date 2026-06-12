// ============================================================================
// PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 — Approve A
// stripe-card-data-fetch (thin wrapper over shared enrichment writer).
//
// Single-PI targeted card-data fetch for super_admin.
// Все Stripe-fetch и DB-update — в _shared/stripe/card-enrichment.ts.
//
// Hard constraints:
// - super_admin only (requireSuperAdmin)
// - one payment_intent per call (no batch mode here — use *-bulk)
// - never creates rows, never deletes
// - PCI: forbidden fields never reach DB / audit (sanitizer + post-condition)
// ============================================================================

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { enrichStripePaymentCardData } from '../_shared/stripe/card-enrichment.ts';

interface Body {
  payment_intent: string;           // pi_*
  account_code?: string;            // default 'stripe_poland'
  force_refresh?: boolean;          // super_admin only; default false
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
  if (!body.payment_intent || !/^pi_[A-Za-z0-9_]+$/.test(body.payment_intent)) {
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

  // Resolve payment row to derive paymentId and account_code default from meta.
  const { data: payment, error: pErr } = await supabase
    .from('payments_v2')
    .select('id, meta')
    .eq('provider', 'stripe')
    .eq('provider_payment_id', body.payment_intent)
    .gt('amount', 0)
    .maybeSingle();
  if (pErr) return json({ error: 'db_error', detail: pErr.message }, 500);
  if (!payment) return json({ error: 'payment_not_found', payment_intent: body.payment_intent }, 404);

  const accountCode = body.account_code
    || (payment.meta as any)?.stripe?.account_code
    || (payment.meta as any)?.account_code
    || 'stripe_poland';

  const result = await enrichStripePaymentCardData({
    supabase,
    paymentId: payment.id,
    paymentIntentId: body.payment_intent,
    accountCode,
    source: 'targeted_fetch',
    actor: { type: 'user', user_id: actor.user_id, label: 'admin single fetch' },
    forceRefresh: body.force_refresh === true,
    fetchStripeSecret: (code) => readAcquiringSecret('stripe', code, 'secret_key').catch(() => null),
  });

  return json({ ok: true, ...result });
});
