// STRIPE-FINAL-CLOSURE-SPRINT-V1 / Workstream D — canonical test-fixture marker.
//
// SOT: payments_v2.meta.fixture === true  (Variant A из бэклога).
//
// Жёсткие правила:
//   - Marker ставится ТОЛЬКО на server-side / admin-side write-paths.
//   - Клиент не может прокинуть произвольный fixture=true.
//   - Запрещено эвристически выводить fixture по сумме (2 USD, 5 BYN),
//     email, дате, валюте, провайдеру, account_code, названию продукта.
//   - Чтение marker — pure: один путь, никаких fallback на «похожие» поля.
//   - Помечать исторические rows ТОЛЬКО по exact UUID, через dry-run + audit.
//
// Read-side single source of truth.

export interface PaymentLike {
  meta?: Record<string, unknown> | null;
}

/**
 * Каноническая проверка marker'а. Возвращает true ТОЛЬКО при явном
 * `meta.fixture === true`. Любые другие значения (string 'true', 1, null,
 * вложенные пути) НЕ считаются fixture — чтобы исключить случайное срабатывание.
 */
export function isTestFixturePayment(payment: PaymentLike | null | undefined): boolean {
  if (!payment) return false;
  const meta = payment.meta;
  if (!meta || typeof meta !== 'object') return false;
  return (meta as Record<string, unknown>).fixture === true;
}

/**
 * Каноническая запись marker'а для write-paths.
 * Возвращает новый объект `meta` с marker и audit-полями.
 * НЕ выполняет UPDATE — это делает caller через свой ORM/клиент.
 */
export function withFixtureMarker(
  currentMeta: Record<string, unknown> | null | undefined,
  source: 'admin_manual' | 'stripe_runtime_probe' | 'bepaid_runtime_probe' | 'historical_dry_run_backfill',
  actorUserId: string | null,
): Record<string, unknown> {
  return {
    ...(currentMeta ?? {}),
    fixture: true,
    fixture_marked_at: new Date().toISOString(),
    fixture_source: source,
    fixture_marked_by: actorUserId,
  };
}
