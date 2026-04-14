/**
 * Canonical URL builder for product pricing pages.
 *
 * Source of truth: page slug from site builder.
 * Fallback: product primary_domain (legacy).
 * Anchor: always #tariffs (canonical), never #prices.
 */

const MAIN_DOMAIN = "gorbova.by";

export function getCanonicalPricingUrl(
  pageSlug?: string | null,
  primaryDomain?: string | null,
): string {
  if (pageSlug) return `https://${MAIN_DOMAIN}/${pageSlug}#tariffs`;
  if (primaryDomain) return `https://${primaryDomain}/#tariffs`;
  return "";
}

export function getCanonicalPageUrl(
  pageSlug?: string | null,
  primaryDomain?: string | null,
): string {
  if (pageSlug) return `https://${MAIN_DOMAIN}/${pageSlug}`;
  if (primaryDomain) return `https://${primaryDomain}`;
  return "";
}
