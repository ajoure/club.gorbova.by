/**
 * Возвращает количество успешных списаний по подписке.
 *
 * Приоритет:
 * 1) Явное поле из meta провайдера (charge_count / charges_count / successful_charges)
 * 2) Детерминированный расчёт по lifecycle-полям подписки
 * 3) null — только для реально битых записей без данных
 */

interface ChargeCountInput {
  meta?: Record<string, unknown> | null;
  created_at?: string | null;
  last_charge_at?: string | null;
  next_charge_at?: string | null;
  interval_days?: number | null;
  state?: string | null;
}

export function getSubscriptionChargeCount(sub: ChargeCountInput): number | null {
  // 1. Exact value from provider meta
  const meta = sub.meta as Record<string, unknown> | null;
  if (meta) {
    const exact = meta.charge_count ?? meta.charges_count ?? meta.successful_charges;
    if (typeof exact === "number" && exact >= 0) {
      return exact;
    }
  }

  // 2. Deterministic lifecycle calculation
  const createdAt = sub.created_at ? new Date(sub.created_at).getTime() : null;
  if (!createdAt || isNaN(createdAt)) return null;

  const intervalDays = sub.interval_days;
  const lastChargeAt = sub.last_charge_at ? new Date(sub.last_charge_at).getTime() : null;
  const isActive = sub.state === "active" || sub.state === "pending";

  // Has last_charge_at and valid interval — calculate cycles
  if (lastChargeAt && !isNaN(lastChargeAt) && intervalDays && intervalDays > 0) {
    const diffMs = lastChargeAt - createdAt;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const cycles = Math.floor(diffDays / intervalDays) + 1;
    return Math.max(cycles, 1);
  }

  // Has last_charge_at but no interval — at least 1 successful charge
  if (lastChargeAt && !isNaN(lastChargeAt)) {
    return 1;
  }

  // No last_charge_at, but active subscription with next_charge_at — initial payment succeeded
  if (isActive && sub.next_charge_at) {
    return 1;
  }

  // Active subscription with created_at — initial payment succeeded
  if (isActive) {
    return 1;
  }

  // Truly broken record
  return null;
}
