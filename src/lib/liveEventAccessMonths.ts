const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isLiveAccessMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_RE.test(value);
}

/**
 * Returns the explicit multi-month allowlist, or the historic single content
 * month when an older event has not stored the new metadata field yet.
 */
export function normalizeLiveAccessPurchaseMonths(
  purchaseMonths: unknown,
  contentMonth: unknown,
): string[] {
  const explicit = Array.isArray(purchaseMonths)
    ? [...new Set(purchaseMonths.filter(isLiveAccessMonthKey))]
    : [];

  if (explicit.length > 0) return explicit.sort();
  return isLiveAccessMonthKey(contentMonth) ? [contentMonth] : [];
}
