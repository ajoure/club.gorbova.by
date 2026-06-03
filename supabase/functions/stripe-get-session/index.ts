// Phase 2 — stripe-get-session (read-only)
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { stripeGetCheckoutSession } from '../_shared/acquiring/stripe-client.ts';
import { resolveDefaultStripeAccount } from '../_shared/acquiring/default-account.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { supabase } = await requireSuperAdmin(req);
    const { session_id, account_code } = await req.json() as { session_id: string; account_code?: string };
    if (!session_id) return errorResponse('missing_session_id', 400);
    // MP-A2-1: SOT resolver instead of hardcoded 'stripe_poland' fallback.
    const acct = await resolveDefaultStripeAccount(supabase, account_code);
    const code = acct.account_code;
    const secret = await readAcquiringSecret('stripe', code, 'secret_key');
    const res = await stripeGetCheckoutSession(secret, session_id);
    if (!res.ok) return jsonResponse({ ok: false, error: res.error, status: res.status });
    return jsonResponse({ ok: true, account_code: code, session: res.data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
