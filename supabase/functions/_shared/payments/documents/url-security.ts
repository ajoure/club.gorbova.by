// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B — URL security.
// https-only, boundary-safe hostname allowlist, no credentials, no js:/data:/file:/blob:.

const EXACT_HOSTS = new Set<string>([
  'pay.stripe.com',
  'invoice.stripe.com',
  'files.stripe.com',
  'bepaid.by',
]);

const SUFFIX_HOSTS: string[] = ['.bepaid.by'];

export type UrlSafetyVerdict =
  | { safe: true; host: string }
  | { safe: false; reason: 'invalid_url' | 'non_https' | 'credentials' | 'host_not_allowed' };

export function classifyProviderUrl(rawUrl: string | null | undefined): UrlSafetyVerdict {
  if (!rawUrl || typeof rawUrl !== 'string') return { safe: false, reason: 'invalid_url' };
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { safe: false, reason: 'invalid_url' }; }
  if (u.protocol !== 'https:') return { safe: false, reason: 'non_https' };
  if (u.username || u.password) return { safe: false, reason: 'credentials' };
  const host = u.hostname.toLowerCase();
  if (EXACT_HOSTS.has(host)) return { safe: true, host };
  for (const suf of SUFFIX_HOSTS) {
    if (host.endsWith(suf) && host.length > suf.length) return { safe: true, host };
  }
  return { safe: false, reason: 'host_not_allowed' };
}

export function isSafeSignedStorageUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    return true;
  } catch { return false; }
}
