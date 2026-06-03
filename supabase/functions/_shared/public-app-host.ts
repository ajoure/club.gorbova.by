// MP-A2-1 — server-side canonical public host for customer-facing redirects.
//
// Mirrors src/utils/publicAppHost.ts but is safe to import from edge functions
// (no `import.meta.env`, no React, no `src/` dependency). Single source of
// truth on the server is the env var PUBLIC_APP_HOST; default falls back to
// the canonical production domain `https://gorbova.by`.
//
// NEVER use this for /pay/:token links — those use product.primary_domain via
// the buildPublicPaymentUrl helper. This host is for:
//   - Stripe Checkout success/cancel URL fallback (when acquiring_connections
//     does not have explicit URLs configured)
//   - sandbox-return redirect for admin Stripe sandbox checkout
//   - other admin/customer-facing redirects originating from edge functions.
//
// FORBIDDEN: lovable preview, supabase functions URL, localhost.

const FORBIDDEN_FRAGMENTS = [
  'lovable.dev',
  'lovable.app',
  'lovableproject.com',
  'localhost',
  '127.0.0.1',
];

const DEFAULT_PUBLIC_APP_HOST = 'https://gorbova.by';

function readEnv(): string | null {
  const raw = Deno.env.get('PUBLIC_APP_HOST');
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(trimmed)) return null;
  const host = trimmed.replace(/^https:\/\//, '').split('/')[0].toLowerCase();
  if (FORBIDDEN_FRAGMENTS.some((bad) => host.includes(bad))) return null;
  return trimmed;
}

/** Canonical app host for redirects (without trailing slash). */
export const PUBLIC_APP_HOST: string = readEnv() ?? DEFAULT_PUBLIC_APP_HOST;

export interface StripeRedirectUrls {
  success_url: string;
  cancel_url: string;
  source: 'connection' | 'public_app_host_fallback' | 'sandbox_fallback';
}

/**
 * Resolve Stripe Checkout success/cancel URLs.
 * Priority:
 *   1) acquiring_connections.success_url / cancel_url (per-account)
 *   2) PUBLIC_APP_HOST + conventional paths
 *   3) sandbox fallback (only if `sandbox=true` AND test_mode=true)
 *
 * Throws only if all 3 are unavailable (which should never happen for
 * test_mode connections — PUBLIC_APP_HOST always has a deterministic default).
 */
export function resolveStripeCheckoutUrls(args: {
  connection_success_url: string | null | undefined;
  connection_cancel_url: string | null | undefined;
  test_mode: boolean;
  sandbox?: boolean;
}): StripeRedirectUrls {
  const cs = (args.connection_success_url ?? '').trim();
  const cc = (args.connection_cancel_url ?? '').trim();
  if (cs && cc) {
    return { success_url: cs, cancel_url: cc, source: 'connection' };
  }

  // Public app host fallback
  if (PUBLIC_APP_HOST) {
    if (args.sandbox && args.test_mode) {
      return {
        success_url: `${PUBLIC_APP_HOST}/admin/payments/sandbox-return?status=success`,
        cancel_url: `${PUBLIC_APP_HOST}/admin/payments/sandbox-return?status=cancel`,
        source: 'sandbox_fallback',
      };
    }
    return {
      success_url: `${PUBLIC_APP_HOST}/payment/success`,
      cancel_url: `${PUBLIC_APP_HOST}/payment/cancel`,
      source: 'public_app_host_fallback',
    };
  }

  throw new Error('no_redirect_url_configured');
}
