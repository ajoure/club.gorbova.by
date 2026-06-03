// Phase 2 — Vault-backed secret reader for acquiring connections.
//
// SOT: vault.secrets, name pattern `acq:{provider}:{account_code}:{kind}`.
// Reads via SECURITY DEFINER RPC `get_acquiring_secret` (service_role only).
//
// Fallback order on miss:
//   1) Vault entry
//   2) Env var <KEY_NAME>_<ACCOUNT_CODE_UPPER> (legacy/dev)
//   3) Env var <KEY_NAME> (single-account dev)

import { createClient } from 'npm:@supabase/supabase-js@2';

type AcquiringSecretKind = 'secret_key' | 'webhook_signing_secret';

const ENV_KEY_PREFIX: Record<AcquiringSecretKind, string> = {
  secret_key: 'STRIPE_SECRET_KEY',
  webhook_signing_secret: 'STRIPE_WEBHOOK_SECRET',
};

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export async function readAcquiringSecret(
  provider: 'stripe' | 'bepaid',
  account_code: string,
  kind: AcquiringSecretKind,
): Promise<string> {
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc('get_acquiring_secret', {
    p_provider: provider,
    p_account_code: account_code,
    p_kind: kind,
  });
  if (!error && typeof data === 'string' && data.length > 0) {
    return data;
  }

  // Env fallbacks (dev/legacy only)
  const prefix = ENV_KEY_PREFIX[kind];
  const scoped = Deno.env.get(`${prefix}_${account_code.toUpperCase().replace(/-/g, '_')}`);
  if (scoped) return scoped;
  const global = Deno.env.get(prefix);
  if (global) return global;

  throw new Error(`acquiring_secret_not_found:${provider}:${account_code}:${kind}`);
}

export async function hasAcquiringVaultSecret(
  provider: 'stripe' | 'bepaid',
  account_code: string,
  kind: AcquiringSecretKind,
): Promise<boolean> {
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc('get_acquiring_secret', {
    p_provider: provider,
    p_account_code: account_code,
    p_kind: kind,
  });
  return !error && typeof data === 'string' && data.length > 0;
}
