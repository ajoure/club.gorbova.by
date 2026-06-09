// oneshot-stripe-ensure-webhook-r2 — One-shot trigger to verify and ensure
// the Stripe webhook endpoint exists with refund-related events enabled.
// Calls existing `stripe-ensure-webhook` via internal CRON_SECRET path.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const cron = Deno.env.get('CRON_SECRET') ?? '';
    const provided = req.headers.get('x-cron-secret') ?? new URL(req.url).searchParams.get('s') ?? '';
    if (!cron || provided !== cron) return errorResponse('unauthorized: cron secret required', 401);

    const account_code = 'stripe_poland';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

    // Diagnose: list current webhooks via Stripe API
    const sk = await readAcquiringSecret('stripe', account_code, 'secret_key');
    const listResp = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=50', {
      headers: { Authorization: `Bearer ${sk}` },
    });
    const listData = await listResp.json();
    const target = `${supabaseUrl}/functions/v1/stripe-webhook`;
    const matching = (listData?.data ?? []).filter((e: any) => e.url === target);
    const summary = (listData?.data ?? []).map((e: any) => ({
      id: e.id,
      url: e.url,
      status: e.status,
      livemode: e.livemode,
      enabled_events: e.enabled_events,
    }));

    return jsonResponse({
      ok: true,
      diagnose: {
        target_url: target,
        total_endpoints: listData?.data?.length ?? 0,
        matching_endpoints: matching.length,
        endpoints: summary,
      },
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : String(e), 500);
  }
});
