/**
 * Вычисляет отображаемое количество списаний по подписке.
 *
 * Приоритет источников:
 * 1. Точное значение из meta провайдера (charge_count / charges_count)
 * 2. Fallback-расчёт по created_at + last_charge_at + interval_days
 * 3. null — данных недостаточно для надёжного расчёта
 *
 * Возвращает { count, isExact }:
 *   count  — число списаний или null (данных нет)
 *   isExact — true если взято из точного источника провайдера
 */

interface ChargeCountInput {
  created_at: string | null;
  last_charge_at: string | null;
  interval_days?: number | null;
  meta?: Record<string, unknown> | null;
}

interface ChargeCountResult {
  count: number | null;
  isExact: boolean;
}

export function getSubscriptionChargeCount(sub: ChargeCountInput): ChargeCountResult {
  // 1. Точный источник из meta провайдера
  const meta = sub.meta as Record<string, unknown> | null;
  if (meta) {
    const exact = meta.charge_count ?? meta.charges_count ?? meta.successful_charges;
    if (typeof exact === "number" && exact >= 0) {
      return { count: exact, isExact: true };
    }
  }

  // 2. Fallback по датам
  if (!sub.last_charge_at) {
    // Нет подтверждённого списания — данных недостаточно
    return { count: null, isExact: false };
  }

  const intervalDays = sub.interval_days;
  if (!intervalDays || intervalDays <= 0 || !sub.created_at) {
    // Есть last_charge_at, но нет интервала → минимум 1 списание
    return { count: 1, isExact: false };
  }

  const created = new Date(sub.created_at).getTime();
  const lastCharge = new Date(sub.last_charge_at).getTime();
  const intervalMs = intervalDays * 86_400_000;

  if (lastCharge < created) {
    return { count: 1, isExact: false };
  }

  const estimated = Math.floor((lastCharge - created) / intervalMs) + 1;
  return { count: Math.max(1, estimated), isExact: false };
}
