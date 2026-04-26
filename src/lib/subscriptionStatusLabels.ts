// Канонические русские лейблы для статусов подписок (subscriptions_v2.status)
// Источник: bePaid / внутренние статусы. Английские значения никогда не показываем клиентам.

export type SubscriptionStatusKind = "active" | "warning" | "danger" | "neutral" | "trial";

export interface SubscriptionStatusLabel {
  label: string;
  kind: SubscriptionStatusKind;
}

const MAP: Record<string, SubscriptionStatusLabel> = {
  active: { label: "Активна", kind: "active" },
  trial: { label: "Пробный период", kind: "trial" },
  trialing: { label: "Пробный период", kind: "trial" },
  past_due: { label: "Ожидает оплаты", kind: "warning" },
  unpaid: { label: "Не оплачена", kind: "danger" },
  incomplete: { label: "Не завершена", kind: "warning" },
  incomplete_expired: { label: "Истёк срок оплаты", kind: "danger" },
  paused: { label: "Приостановлена", kind: "neutral" },
  canceled: { label: "Отменена", kind: "neutral" },
  cancelled: { label: "Отменена", kind: "neutral" },
  expired: { label: "Истекла", kind: "neutral" },
  pending: { label: "В обработке", kind: "warning" },
};

export function getSubscriptionStatusLabel(status: string | null | undefined): SubscriptionStatusLabel {
  if (!status) return { label: "Неизвестно", kind: "neutral" };
  const key = String(status).toLowerCase().trim();
  return MAP[key] ?? { label: "Неизвестно", kind: "neutral" };
}
