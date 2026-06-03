// Phase 2 — acquiring-test-connection
// Validates a stored Stripe connection end-to-end (no live charge):
//   1) secret_key valid (GET /balance)
//   2) account accessible (GET /account)
//   3) webhook signing secret present in Vault
//   4) currency discovery (GET /country_specs/{country})
//
// Writes capabilities snapshot, status, last_verified_at, last_error.
//
// MODE-DERIVED-FROM-KEYS PATCH: there is no `mode_mismatch` — connection mode
// is derived from the secret_key prefix and persisted as `test_mode` on the row.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret, hasAcquiringVaultSecret } from '../_shared/acquiring/vault.ts';
import { stripeGetAccount, stripeGetBalance, stripeGetCountrySpec } from '../_shared/acquiring/stripe-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { supabase } = await requireSuperAdmin(req);
    const { connection_id } = await req.json() as { connection_id: string };
    if (!connection_id) return errorResponse('missing_connection_id', 400);

    const { data: conn, error: connErr } = await supabase
      .from('acquiring_connections')
      .select('*')
      .eq('id', connection_id)
      .maybeSingle();
    if (connErr || !conn) return errorResponse('connection_not_found', 404);
    if (conn.provider !== 'stripe') return errorResponse('only_stripe_supported_in_phase_2', 400);

    const updateStatus = async (
      status: string,
      last_error: string | null,
      capabilities: Record<string, unknown>,
      patch: Record<string, unknown> = {},
    ) => {
      await supabase
        .from('acquiring_connections')
        .update({
          status,
          last_error,
          last_verified_at: new Date().toISOString(),
          capabilities_snapshot: capabilities,
          ...patch,
        })
        .eq('id', connection_id);
    };

    let secret_key: string;
    try {
      secret_key = await readAcquiringSecret('stripe', conn.account_code, 'secret_key');
    } catch {
      await updateStatus('invalid', 'secret_key_missing', conn.capabilities_snapshot ?? {});
      return jsonResponse({ ok: false, code: 'secret_key_missing' });
    }

    const isTestKey = secret_key.startsWith('sk_test_') || secret_key.startsWith('rk_test_');
    const keyMode: 'test' | 'live' = isTestKey ? 'test' : 'live';

    // 1) balance
    const bal = await stripeGetBalance(secret_key);
    if (!bal.ok) {
      const code = bal.status === 401 ? 'invalid_secret_key' : `balance_error_${bal.status}`;
      await updateStatus('invalid', code, conn.capabilities_snapshot ?? {});
      return jsonResponse({ ok: false, code, detail: bal.error });
    }
    // 2) account
    const acc = await stripeGetAccount(secret_key);
    if (!acc.ok || !acc.data) {
      await updateStatus('invalid', 'account_unreachable', conn.capabilities_snapshot ?? {});
      return jsonResponse({ ok: false, code: 'account_unreachable', detail: acc.error });
    }
    // 3) webhook secret
    const hasWebhook = await hasAcquiringVaultSecret('stripe', conn.account_code, 'webhook_signing_secret');
    if (!hasWebhook) {
      await updateStatus('invalid', 'webhook_secret_missing', {
        ...(conn.capabilities_snapshot ?? {}),
        account: { id: acc.data.id, country: acc.data.country, key_mode: keyMode },
      });
      return jsonResponse({ ok: false, code: 'webhook_secret_missing' });
    }
    // 4) currencies
    const spec = await stripeGetCountrySpec(secret_key, acc.data.country);
    const currencies = spec.ok && spec.data ? spec.data.supported_payment_currencies : [];

    const snapshot = {
      account: {
        id: acc.data.id,
        country: acc.data.country,
        default_currency: acc.data.default_currency,
        charges_enabled: acc.data.charges_enabled,
        payouts_enabled: acc.data.payouts_enabled,
        business_name: acc.data.business_profile?.name ?? null,
        key_mode: keyMode,
      },
      supported_currencies: currencies,
      verified_at: new Date().toISOString(),
    };
    // Normalize test_mode on the row to match the actual key family.
    await updateStatus('active', null, snapshot, { test_mode: isTestKey });
    return jsonResponse({ ok: true, capabilities: snapshot, connection_mode: keyMode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
