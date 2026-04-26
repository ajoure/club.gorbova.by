/**
 * Canonical builder for public payment URLs (/pay/:token, /pay?product=...).
 *
 * SOURCE OF TRUTH for the host of public payment links sent to clients:
 *   1) product.primary_domain (if present and valid)
 *   2) CANONICAL_PUBLIC_HOST  (fallback)
 *
 * Public payment URLs MUST NEVER be derived from window.location.origin
 * or req.headers.origin, because the admin может работать в Lovable preview
 * (id-preview--*.lovable.app, lovable.dev, *.lovableproject.com), и такая
 * ссылка приведёт клиента на экран Lovable «Access denied» вместо оплаты.
 *
 * Контракт зафиксирован в БД:
 *   payment_links.public_url NOT NULL
 *   CHECK public_url ~ '^https://' AND
 *         public_url !~* '(lovable\.dev|lovable\.app|lovableproject\.com|localhost|127\.0\.0\.1)'
 */

export const CANONICAL_PUBLIC_HOST = "https://club.gorbova.by";

const FORBIDDEN_HOST_FRAGMENTS = [
  "lovable.dev",
  "lovable.app",
  "lovableproject.com",
  "localhost",
  "127.0.0.1",
];

/** Lovable preview / editor / dev hostname (must NEVER appear in client-facing URLs). */
export function isForbiddenPublicHost(hostname: string | null | undefined): boolean {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  return FORBIDDEN_HOST_FRAGMENTS.some((bad) => h.includes(bad));
}

/** Validate a primary_domain string from products_v2.primary_domain. */
export function isValidProductDomain(domain: string | null | undefined): domain is string {
  if (!domain) return false;
  const d = domain.trim().toLowerCase();
  if (!d) return false;
  if (isForbiddenPublicHost(d)) return false;
  // hostname-only: letters/digits/dots/hyphens, with at least one dot
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d);
}

/** Resolve canonical origin (no trailing slash) for a public payment URL. */
export function resolveCanonicalPaymentOrigin(productPrimaryDomain?: string | null): string {
  if (isValidProductDomain(productPrimaryDomain)) {
    return `https://${productPrimaryDomain.trim().toLowerCase()}`;
  }
  return CANONICAL_PUBLIC_HOST;
}

/** Build canonical /pay/:token URL. */
export function buildPublicPayUrl(
  token: string,
  productPrimaryDomain?: string | null,
): string {
  const origin = resolveCanonicalPaymentOrigin(productPrimaryDomain);
  return `${origin}/pay/${token}`;
}

/** Build canonical /pay?product=<id> URL (legacy product CTA). */
export function buildProductPayUrl(
  productId: string,
  productPrimaryDomain?: string | null,
): string {
  const origin = resolveCanonicalPaymentOrigin(productPrimaryDomain);
  return `${origin}/pay?product=${productId}`;
}
