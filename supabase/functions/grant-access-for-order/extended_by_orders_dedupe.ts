// PATCH H2: pure helper for idempotent append to meta.extended_by_orders.
// Race-safe atomic append вынесен в backlog PATCH H2b (требует RPC).
// Здесь — best-effort dedupe на уровне in-memory массива перед UPDATE.

export interface ExtendDedupeResult {
  next: string[];
  duplicate: boolean;
  normalized_existing: string[];
}

export function dedupeExtendedByOrders(
  existing: unknown,
  orderId: string,
): ExtendDedupeResult {
  const raw = Array.isArray(existing) ? (existing as unknown[]) : [];
  const cleaned: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v.length > 0 && !cleaned.includes(v)) {
      cleaned.push(v);
    }
  }
  if (cleaned.includes(orderId)) {
    return { next: cleaned, duplicate: true, normalized_existing: cleaned };
  }
  return { next: [...cleaned, orderId], duplicate: false, normalized_existing: cleaned };
}
