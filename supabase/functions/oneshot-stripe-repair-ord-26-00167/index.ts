// _one_shot_trigger_stripe_repair_ord_26_00167 — ONE-SHOT
// Public trigger (verify_jwt=false) that invokes the canonical
// `admin-stripe-repair-refund-recording` for ORD-26-00167 only, using the
// server-side CRON_SECRET header. Hardcoded payment_intent — refuses any other.
// To be deleted after the refund recording is verified.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';

const PI = 'pi_3TgMkD6UYJj2vm0G1ZUpRzvH';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const url = new URL(req.url);
    const dry = url.searchParams.get('dry_run') === '1';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const cron = Deno.env.get('CRON_SECRET')!;
    if (!cron) return errorResponse('cron_secret_missing_in_env', 500);

    const r = await fetch(`${supabaseUrl}/functions/v1/admin-stripe-repair-refund-recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': cron },
      body: JSON.stringify({ payment_intent: PI, dry_run: dry }),
    });
    const text = await r.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    return jsonResponse({ ok: r.ok, status: r.status, body }, r.ok ? 200 : 500);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : String(e), 500);
  }
});
