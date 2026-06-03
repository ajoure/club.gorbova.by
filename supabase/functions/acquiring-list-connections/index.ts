// Phase 2 — acquiring-list-connections
// Returns connections + capability snapshot. NEVER returns secret values.
// Augments each row with has_secret_key / has_webhook_secret booleans by checking Vault.

import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { hasAcquiringVaultSecret } from '../_shared/acquiring/vault.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { supabase } = await requireSuperAdmin(req);
    const { data, error } = await supabase
      .from('acquiring_connections')
      .select('*')
      .order('provider', { ascending: true })
      .order('account_code', { ascending: true });
    if (error) return errorResponse(error.message, 500);

    const enriched = await Promise.all(
      (data ?? []).map(async (row) => ({
        ...row,
        has_secret_key: await hasAcquiringVaultSecret(row.provider, row.account_code, 'secret_key'),
        has_webhook_secret: await hasAcquiringVaultSecret(row.provider, row.account_code, 'webhook_signing_secret'),
      })),
    );
    return jsonResponse({ ok: true, connections: enriched });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
