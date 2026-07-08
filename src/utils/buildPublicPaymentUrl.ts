/**
 * Canonical builder for public payment URLs (/pay/:token, /pay?product=...).
 *
 * SINGLE SOURCE OF TRUTH:
 *   Все публичные payment-ссылки ВСЕГДА строятся на канoническом хосте
 *   `https://gorbova.by`, независимо от продукта.
 *
 *   Ранее origin брался из `products_v2.primary_domain` — это привязывало
 *   payment link к лендинговому домену продукта (напр. `cb.gorbova.by`).
 *   Такой подход хрупок: перенос лендинга на `gorbova.by/cb` требовал править
 *   БД, ссылки для новых продуктов уходили не туда, каждый новый продукт
 *   требовал ручной настройки. С этого патча payment origin — единая
 *   константа, а `primary_domain` продолжает использоваться ТОЛЬКО для
 *   резолвинга лендинга (не для оплаты).
 *
 * Public payment URLs MUST NEVER be derived from window.location.origin
 * or req.headers.origin, потому что админ может работать в Lovable preview
 * (id-preview--*.lovable.app, lovable.dev, *.lovableproject.com) и такая
 * ссылка приведёт клиента на экран Lovable «Access denied» вместо оплаты.
 *
 * Контракт зафиксирован в БД:
 *   payment_links.public_url NOT NULL
 *   CHECK public_url ~ '^https://' AND
 *         public_url !~* '(lovable\.dev|lovable\.app|lovableproject\.com|localhost|127\.0\.0\.1)'
 */

export const CANONICAL_PUBLIC_HOST = "https://gorbova.by";

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

/**
 * Validate a primary_domain string. Оставлено для обратной совместимости
 * (используется в лендинг-резолвере), но НЕ применяется для payment origin.
 */
export function isValidProductDomain(domain: string | null | undefined): domain is string {
  if (!domain) return false;
  const d = domain.trim().toLowerCase();
  if (!d) return false;
  if (isForbiddenPublicHost(d)) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d);
}

/**
 * Resolve canonical origin (no trailing slash) for a public payment URL.
 *
 * Всегда возвращает `CANONICAL_PUBLIC_HOST`. Параметр `productPrimaryDomain`
 * оставлен в сигнатуре только для обратной совместимости вызывающих —
 * значение игнорируется. НЕ используйте `products_v2.primary_domain`
 * для генерации payment URL.
 */
export function resolveCanonicalPaymentOrigin(_productPrimaryDomain?: string | null): string {
  return CANONICAL_PUBLIC_HOST;
}

/** Build canonical /pay/:token URL. */
export function buildPublicPayUrl(
  token: string,
  _productPrimaryDomain?: string | null,
): string {
  return `${CANONICAL_PUBLIC_HOST}/pay/${token}`;
}

/** Build canonical /pay?product=<id> URL (legacy product CTA). */
export function buildProductPayUrl(
  productId: string,
  _productPrimaryDomain?: string | null,
): string {
  return `${CANONICAL_PUBLIC_HOST}/pay?product=${productId}`;
}
