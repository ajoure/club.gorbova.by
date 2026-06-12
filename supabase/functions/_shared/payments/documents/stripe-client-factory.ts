// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B.1
// Canonical account+mode-aware Stripe client factory.
//
// Hard rules:
//   - NO global default Stripe client.
//   - NO fallback live↔test on account miss.
//   - NO account selection by currency/product/offer/email/customer.
//   - NO direct Deno.env.get('STRIPE_SECRET_KEY*'); secret reaches us ONLY via
//     injected readSecret (production wiring uses _shared/acquiring/vault.ts).
//   - Exact retrieve only; resource enum + ID regex pre-flight (0 network on mismatch).
//   - Stripe-Version pinned to the same value as _shared/acquiring/stripe-client.ts
//     ('2024-06-20'); update both sites together if ever bumped.
//   - Secrets / vault errors / Stripe body / Authorization header NEVER returned.

import type { StripeClientResolutionError } from './types.ts';
import type { StripeRetrieve } from './stripe-documents.ts';

export type { StripeRetrieve } from './stripe-documents.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2024-06-20';
const DEFAULT_TIMEOUT_MS = 15_000;

export const STRIPE_RESOURCES = [
  'payment_intents',
  'charges',
  'invoices',
  'refunds',
  'credit_notes',
  'subscriptions',
] as const;
export type StripeResource = typeof STRIPE_RESOURCES[number];

const ID_PATTERNS: Record<StripeResource, RegExp> = {
  payment_intents: /^pi_[A-Za-z0-9]+$/,
  charges:         /^ch_[A-Za-z0-9]+$/,
  invoices:        /^in_[A-Za-z0-9]+$/,
  refunds:         /^re_[A-Za-z0-9]+$/,
  credit_notes:    /^cn_[A-Za-z0-9]+$/,
  subscriptions:   /^sub_[A-Za-z0-9]+$/,
};

// ── Pure helpers (unit-testable, no IO) ─────────────────────────────────────

export function resolveStripeAccountCode(meta: {
  stripeAccountCode: string | null | undefined;
  rootAccountCode: string | null | undefined;
}): { ok: true; accountCode: string } | { ok: false; code: 'STRIPE_ACCOUNT_NOT_RESOLVED' | 'STRIPE_ACCOUNT_CODE_CONFLICT' } {
  const a = (meta.stripeAccountCode ?? '').trim() || null;
  const b = (meta.rootAccountCode ?? '').trim() || null;
  if (a && b && a !== b) return { ok: false, code: 'STRIPE_ACCOUNT_CODE_CONFLICT' };
  const chosen = a ?? b;
  if (!chosen) return { ok: false, code: 'STRIPE_ACCOUNT_NOT_RESOLVED' };
  return { ok: true, accountCode: chosen };
}

export function normalizeStripeMode(args: {
  livemode: boolean | null | undefined;
  testMode: boolean | null | undefined;
}): { ok: true; mode: 'test' | 'live' } | { ok: false; code: 'STRIPE_MODE_NOT_RESOLVED' | 'STRIPE_MODE_CONFLICT' } {
  const lm = typeof args.livemode === 'boolean' ? args.livemode : null;
  const tm = typeof args.testMode === 'boolean' ? args.testMode : null;
  if (lm === null && tm === null) return { ok: false, code: 'STRIPE_MODE_NOT_RESOLVED' };
  if (lm !== null && tm !== null && tm !== !lm) return { ok: false, code: 'STRIPE_MODE_CONFLICT' };
  const live = lm !== null ? lm : !(tm as boolean);
  return { ok: true, mode: live ? 'live' : 'test' };
}

// ── HTTP Stripe retrieve (whitelist, exact, sanitized) ──────────────────────

export type FetchImpl = typeof fetch;

export function makeStripeRetrieveOverHttp(
  secret: string,
  opts: { fetchImpl?: FetchImpl; timeoutMs?: number } = {},
): StripeRetrieve {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async retrieve(resource, id) {
      if (!(STRIPE_RESOURCES as readonly string[]).includes(resource)) {
        return { ok: false, status: 0, data: null, error: { code: 'INVALID_STRIPE_RESOURCE' } };
      }
      const pattern = ID_PATTERNS[resource as StripeResource];
      if (!pattern.test(id)) {
        return { ok: false, status: 0, data: null, error: { code: 'INVALID_STRIPE_ID' } };
      }
      const safeId = encodeURIComponent(id);
      const url = `${STRIPE_API_BASE}/${resource}/${safeId}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${secret}`,
            'Stripe-Version': STRIPE_API_VERSION,
          },
          signal: controller.signal,
        });
        let json: Record<string, unknown> | null = null;
        try {
          const text = await res.text();
          if (text) json = JSON.parse(text) as Record<string, unknown>;
        } catch { /* swallow parse error → null */ }
        if (!res.ok) {
          const errCode = (json && typeof json === 'object' && 'error' in json
            && typeof (json as { error?: { code?: unknown } }).error?.code === 'string')
            ? (json as { error: { code: string } }).error.code
            : 'STRIPE_HTTP_ERROR';
          return { ok: false, status: res.status, data: null, error: { code: errCode } };
        }
        return { ok: true, status: res.status, data: json };
      } catch (e) {
        const isAbort = (e as { name?: string })?.name === 'AbortError';
        return {
          ok: false,
          status: 0,
          data: null,
          error: { code: isAbort ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR' },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Connection lookup contract (DI for tests) ───────────────────────────────

export interface ConnectionRow {
  id: string;
  provider: 'stripe';
  account_code: string;
  test_mode: boolean;
  status: string;
}

export interface ConnectionLookup {
  /** Returns rows for (provider='stripe', account_code).
   *  Production query MUST filter by provider='stripe' and status='active'. */
  list(account_code: string): Promise<ConnectionRow[]>;
}

export interface ReadSecret {
  (provider: 'stripe', account_code: string, kind: 'secret_key'): Promise<string>;
}

// ── Factory result (discriminated; no `null` ambiguity) ─────────────────────

export type StripeClientResolution =
  | { ok: true; client: StripeRetrieve; accountCode: string; mode: 'test' | 'live'; connectionId: string }
  | { ok: false; code: StripeClientResolutionError; retryable: boolean };

export interface CreateStripeClientArgs {
  accountCode: string | null;
  livemode: boolean | null;
  testMode: boolean | null;
}

export interface CreateStripeClientDeps {
  lookupConnection: ConnectionLookup;
  readSecret: ReadSecret;
  makeRetrieve: (secret: string) => StripeRetrieve;
}

export async function createStripeClientForPayment(
  args: CreateStripeClientArgs,
  deps: CreateStripeClientDeps,
): Promise<StripeClientResolution> {
  if (!args.accountCode) {
    return { ok: false, code: 'STRIPE_ACCOUNT_NOT_RESOLVED', retryable: false };
  }
  const mode = normalizeStripeMode({ livemode: args.livemode, testMode: args.testMode });
  if (!mode.ok) return { ok: false, code: mode.code, retryable: false };

  let rows: ConnectionRow[];
  try {
    rows = await deps.lookupConnection.list(args.accountCode);
  } catch {
    return { ok: false, code: 'STRIPE_ACCOUNT_NOT_RESOLVED', retryable: true };
  }
  const active = rows.filter((r) =>
    r.provider === 'stripe' && r.account_code === args.accountCode && r.status === 'active'
  );
  if (active.length === 0) return { ok: false, code: 'STRIPE_ACCOUNT_NOT_RESOLVED', retryable: false };
  if (active.length > 1)  return { ok: false, code: 'STRIPE_CONNECTION_AMBIGUOUS',  retryable: false };
  const conn = active[0];

  const expectedTestMode = mode.mode === 'test';
  if (conn.test_mode !== expectedTestMode) {
    return { ok: false, code: 'STRIPE_MODE_MISMATCH', retryable: false };
  }

  let secret: string;
  try {
    secret = await deps.readSecret('stripe', conn.account_code, 'secret_key');
  } catch {
    return { ok: false, code: 'STRIPE_SECRET_UNAVAILABLE', retryable: true };
  }
  if (!secret) return { ok: false, code: 'STRIPE_SECRET_UNAVAILABLE', retryable: true };

  return {
    ok: true,
    client: deps.makeRetrieve(secret),
    accountCode: conn.account_code,
    mode: mode.mode,
    connectionId: conn.id,
  };
}
