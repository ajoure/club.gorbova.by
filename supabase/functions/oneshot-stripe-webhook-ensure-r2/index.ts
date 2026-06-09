// oneshot-stripe-webhook-ensure-r2 — Idempotent ensure of full enabled_events
// set on the existing live Stripe webhook endpoint. No new endpoint created.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

const ENABLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'charge.dispute.created',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const account_code = 'stripe_poland';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const sk = await readAcquiringSecret('stripe', account_code, 'secret_key');
    const target = `${supabaseUrl}/functions/v1/stripe-webhook`;

    const listResp = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=50', {
      headers: { Authorization: `Bearer ${sk}` },
    });
    const listData = await listResp.json();
    const matching = (listData?.data ?? []).filter((e: any) => e.url === target && e.livemode);
    if (matching.length === 0) return jsonResponse({ ok: false, error: 'no_matching_live_endpoint' });
    if (matching.length > 1) return jsonResponse({ ok: false, error: 'multiple_matching_endpoints', matching });

    const ep = matching[0];
    const before = ep.enabled_events ?? [];
    const missing = ENABLED_EVENTS.filter((e) => !before.includes(e));
    if (missing.length === 0) {
      return jsonResponse({ ok: true, idempotent: true, endpoint_id: ep.id, enabled_events: before });
    }

    const merged = Array.from(new Set([...before, ...ENABLED_EVENTS]));
    const form = new URLSearchParams();
    for (const e of merged) form.append('enabled_events[]', e);
    const upd = await fetch(`https://api.stripe.com/v1/webhook_endpoints/${ep.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const updData = await upd.json();
    if (!upd.ok) return jsonResponse({ ok: false, stripe_error: updData?.error ?? updData, status: upd.status });

    return jsonResponse({
      ok: true,
      endpoint_id: ep.id,
      before: before,
      after: updData?.enabled_events ?? merged,
      added: missing,
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : String(e), 500);
  }
});
