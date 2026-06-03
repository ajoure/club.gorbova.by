// Phase 2 — Stripe REST client (no SDK; thin fetch wrapper).
// All calls require an explicit secret key. The caller is responsible for
// resolving the key via readAcquiringSecret().

const STRIPE_BASE = 'https://api.stripe.com/v1';

export interface StripeFetchOptions {
  secret_key: string;
  method?: 'GET' | 'POST' | 'DELETE';
  formBody?: Array<[string, string]>;
  idempotencyKey?: string;
}

export async function stripeFetch<T = unknown>(
  path: string,
  opts: StripeFetchOptions,
): Promise<{ ok: boolean; status: number; data: T | null; error?: { code?: string; message?: string; type?: string } }> {
  const url = `${STRIPE_BASE}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${opts.secret_key}`,
    'Stripe-Version': '2024-06-20',
  };
  let body: string | undefined;
  if (opts.formBody && opts.formBody.length > 0) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams();
    for (const [k, v] of opts.formBody) params.append(k, v);
    body = params.toString();
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(url, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const err = (json && typeof json === 'object' && 'error' in json
      ? (json as { error: { code?: string; message?: string; type?: string } }).error
      : { message: text || `http_${res.status}` });
    return { ok: false, status: res.status, data: null, error: err };
  }
  return { ok: true, status: res.status, data: json as T };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers used by acquiring-test-connection / stripe-create-checkout / stripe-get-session

export async function stripeGetBalance(secret_key: string) {
  return stripeFetch<{ object: string }>('/balance', { secret_key, method: 'GET' });
}

export async function stripeGetAccount(secret_key: string) {
  return stripeFetch<{
    id: string;
    country: string;
    default_currency: string;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    business_profile?: { name?: string };
  }>('/account', { secret_key, method: 'GET' });
}

export async function stripeGetCountrySpec(secret_key: string, country: string) {
  return stripeFetch<{ id: string; supported_payment_currencies: string[] }>(
    `/country_specs/${encodeURIComponent(country)}`,
    { secret_key, method: 'GET' },
  );
}

export async function stripeGetCheckoutSession(secret_key: string, session_id: string) {
  return stripeFetch<Record<string, unknown>>(`/checkout/sessions/${encodeURIComponent(session_id)}`, {
    secret_key,
    method: 'GET',
  });
}
