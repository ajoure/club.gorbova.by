/**
 * Stage 5 — единый allowlist активных платёжных провайдеров.
 *
 * Используется во ВСЕХ UI-местах, где формируется/отображается canonical
 * платёжный feed: reader-hook, provider-фильтр, provider-badge, CSV,
 * ручной ввод. Серверные SQL/edge allowlist остаются независимыми и
 * поддерживаются отдельно.
 */
export const ACTIVE_PAYMENT_PROVIDERS = [
  "bepaid",
  "stripe",
  "rr",
  "bank",
] as const;

export type ActivePaymentProvider = typeof ACTIVE_PAYMENT_PROVIDERS[number];

export const PAYMENT_PROVIDER_LABELS: Record<ActivePaymentProvider, string> = {
  bepaid: "bePaid",
  stripe: "Stripe",
  rr: "Ресурс Развития",
  bank: "Банк",
};

export function isActivePaymentProvider(
  value: string | null | undefined,
): value is ActivePaymentProvider {
  if (!value) return false;
  return (ACTIVE_PAYMENT_PROVIDERS as readonly string[]).includes(value);
}
