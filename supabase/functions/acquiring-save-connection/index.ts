// Phase 2 — acquiring-save-connection
// Self-service form submit: UPSERT non-sensitive metadata + write secrets to Vault.
//
// Secrets are NEVER stored in `acquiring_connections`. Empty secret value = "keep current".
// Audit (without secret value) is written from inside the admin_save_acquiring_secret RPC.

import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin, actorSupabase } from '../_shared/acquiring/auth-guard.ts';

interface SaveBody {
  id?: string;
  provider: 'stripe' | 'bepaid';
  account_code: string;
  account_name: string;
  is_default?: boolean;
  test_mode?: boolean;
  publishable_key?: string | null;
  secret_key?: string | null;          // write-only; empty = keep current
  webhook_signing_secret?: string | null; // write-only; empty = keep current
  success_url?: string | null;
  cancel_url?: string | null;
  locale?: string | null;
}

const FORBIDDEN_REDIRECT_FRAGMENTS = [
  'lovable.dev',
  'lovable.app',
  'lovableproject.com',
  'localhost',
  '127.0.0.1',
];

function isForbiddenRedirectUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = String(url).trim().toLowerCase();
  if (!u) return false;
  if (!/^https:\/\//.test(u)) return true;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    if (FORBIDDEN_REDIRECT_FRAGMENTS.some((bad) => host.includes(bad))) return true;
    if (host.endsWith('.supabase.co') && parsed.pathname.startsWith('/functions/v1/')) return true;
    return false;
  } catch {
    return true;
  }
}

function validatePrefixes(body: SaveBody): string | null {
  if (body.provider !== 'stripe') return null;
  // Phase 2: live mode disabled.
  if (body.test_mode === false) {
    return 'live_mode_disabled';
  }
  if (body.publishable_key && !/^pk_(test|live)_/.test(body.publishable_key)) {
    return 'invalid_publishable_key_prefix';
  }
  if (body.secret_key && !/^(sk|rk)_(test|live)_/.test(body.secret_key)) {
    return 'invalid_secret_key_prefix';
  }
  if (body.webhook_signing_secret && !/^whsec_/.test(body.webhook_signing_secret)) {
    return 'invalid_webhook_secret_prefix';
  }
  // Test mode requires pk_test_/sk_test_ when keys provided.
  const testMode = body.test_mode !== false;
  if (testMode) {
    if (body.publishable_key && !body.publishable_key.startsWith('pk_test_')) {
      return 'mode_mismatch';
    }
    if (body.secret_key) {
      const ok = body.secret_key.startsWith('sk_test_') || body.secret_key.startsWith('rk_test_');
      if (!ok) return 'mode_mismatch';
    }
  }
  if (isForbiddenRedirectUrl(body.success_url) || isForbiddenRedirectUrl(body.cancel_url)) {
    return 'forbidden_redirect_host';
  }
  return null;
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { supabase } = await requireSuperAdmin(req);
    const body = (await req.json()) as SaveBody;

    if (!body.provider || !body.account_code || !body.account_name) {
      return errorResponse('missing_required_fields:provider/account_code/account_name', 400);
    }
    if (!['stripe', 'bepaid'].includes(body.provider)) {
      return errorResponse('invalid_provider', 400);
    }
    const prefixErr = validatePrefixes(body);
    if (prefixErr) return errorResponse(prefixErr, 400);

    // UPSERT non-sensitive metadata (never includes secret_key / webhook_signing_secret).
    const upsertRow = {
      id: body.id,
      provider: body.provider,
      account_code: body.account_code,
      account_name: body.account_name,
      is_default: body.is_default ?? false,
      test_mode: body.test_mode ?? true,
      publishable_key: body.publishable_key ?? null,
      success_url: body.success_url ?? null,
      cancel_url: body.cancel_url ?? null,
      locale: body.locale ?? null,
    };

    let conn;
    if (body.id) {
      const { data, error } = await supabase
        .from('acquiring_connections')
        .update(upsertRow)
        .eq('id', body.id)
        .select()
        .single();
      if (error) return errorResponse(error.message, 500);
      conn = data;
    } else {
      const { data, error } = await supabase
        .from('acquiring_connections')
        .upsert(upsertRow, { onConflict: 'provider,account_code' })
        .select()
        .single();
      if (error) return errorResponse(error.message, 500);
      conn = data;
    }

    // Persist secrets via SECURITY DEFINER RPC (writes to Vault + audit).
    // Use actor client so auth.uid() inside the RPC resolves to the admin.
    const actor = actorSupabase(req);
    const secretWrites: Array<{ kind: 'secret_key' | 'webhook_signing_secret'; value: string }> = [];
    if (body.secret_key && body.secret_key.trim().length > 0) {
      secretWrites.push({ kind: 'secret_key', value: body.secret_key });
    }
    if (body.webhook_signing_secret && body.webhook_signing_secret.trim().length > 0) {
      secretWrites.push({ kind: 'webhook_signing_secret', value: body.webhook_signing_secret });
    }
    for (const w of secretWrites) {
      const { error: rpcErr } = await actor.rpc('admin_save_acquiring_secret', {
        p_connection_id: conn.id,
        p_kind: w.kind,
        p_value: w.value,
      });
      if (rpcErr) return errorResponse(`secret_save_failed:${w.kind}:${rpcErr.message}`, 500);
    }

    return jsonResponse({ ok: true, connection_id: conn.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
