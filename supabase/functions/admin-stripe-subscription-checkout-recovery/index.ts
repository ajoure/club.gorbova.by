// One-off recovery: materialize Stripe subscription checkout for a hardcoded session.
// Hardcoded session_id + idempotent helper => safe to call.
// Will return already_materialized on subsequent calls.
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { stripeGetCheckoutSession } from '../_shared/acquiring/stripe-client.ts';
import { activateStripeSubscriptionCheckout } from '../_shared/stripe-checkout-materialize.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_SESSIONS = new Set<string>([
  'cs_live_a1Div6ZmYLt6VOpbmdE6VdDOKqXKP9aP3VOVF7HotCokKoQqGZTvjroZHV',
]);

function svc() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const body = await req.json().catch(() => ({})) as { session_id?: string; account_code?: string };
    const session_id = body.session_id;
    if (!session_id || !ALLOWED_SESSIONS.has(session_id)) {
      return jsonResponse({ ok: false, error: 'session_not_in_allowlist' }, 403);
    }
    const supabase = svc();
    const { resolveDefaultStripeAccount } = await import('../_shared/acquiring/default-account.ts');
    const acct = await resolveDefaultStripeAccount(supabase, body.account_code ?? 'stripe_poland');
    const code = acct.account_code;
    const sk = await readAcquiringSecret('stripe', code, 'secret_key');
    const res = await stripeGetCheckoutSession(sk, session_id);
    if (!res.ok) return jsonResponse({ ok: false, step: 'stripe_get_session', error: res.error });
    const out = await activateStripeSubscriptionCheckout(supabase, {
      session: res.data as Record<string, unknown>,
      account_code: code,
      source_event_id: `admin_recovery_${session_id}`,
      source: 'admin.stripe.subscription.checkout.recovery',
    });
    return jsonResponse({ ok: true, account_code: code, result: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return errorResponse(msg, 500);
  }
});
