/**
 * Русские подписи для статусов заказа orders_v2.status.
 * Используется в пикерах/списках, чтобы не показывать англ. коды (paid/pending/…).
 */
export const ORDER_STATUS_RU: Record<string, string> = {
  draft: "Черновик",
  pending: "Ожидает",
  awaiting_payment: "Ждём оплату",
  processing: "В обработке",
  paid: "Оплачена",
  partially_paid: "Частично оплачена",
  refunded: "Возврат",
  partially_refunded: "Частичный возврат",
  canceled: "Отменена",
  cancelled: "Отменена",
  failed: "Ошибка",
  expired: "Просрочена",
  active: "Активна",
  completed: "Завершена",
};

export function orderStatusRu(status: string | null | undefined): string {
  if (!status) return "—";
  return ORDER_STATUS_RU[status] ?? status;
}
