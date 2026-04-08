/**
 * Возвращает точное количество успешных списаний по подписке.
 *
 * Источник: только явное поле из meta провайдера
 * (charge_count / charges_count / successful_charges).
 *
 * Если точного значения нет — возвращает null, бейдж не рендерится.
 * Приблизительный fallback по датам НЕ используется,
 * чтобы не показывать пользователю оценку как факт.
 */

interface ChargeCountInput {
  meta?: Record<string, unknown> | null;
}

export function getSubscriptionChargeCount(sub: ChargeCountInput): number | null {
  const meta = sub.meta as Record<string, unknown> | null;
  if (!meta) return null;

  const exact = meta.charge_count ?? meta.charges_count ?? meta.successful_charges;
  if (typeof exact === "number" && exact >= 0) {
    return exact;
  }

  return null;
}
