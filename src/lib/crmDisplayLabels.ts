/**
 * Централизованная локализация технических enum/action/status
 * для всех CRM-поверхностей (Contact/Company/Deal).
 *
 * Правило: если raw code не найден — возвращаем безопасный русский fallback,
 * НИКОГДА не показываем dotted/snake_case/English код пользователю в основной
 * ленте, badges, tooltips, empty/error states. Raw допустим только в скрытых
 * «Технических данных».
 *
 * Бренды Telegram, Instagram, SMS, Email, bePaid допускаются как есть.
 */

const REASON_LABELS: Record<string, string> = {
  manual_stage_change: "изменена вручную",
  manual_pipeline_change: "воронка изменена вручную",
  pipeline_changed_manually: "воронка изменена вручную",
  stage_changed_manually: "стадия изменена вручную",
  pipeline_null_anomaly: "воронка не задана",
  pipeline_id_null_anomaly: "воронка не задана",
  no_snapshot: "нет закреплённой маршрутизации",
  no_snapshot_in_order_meta: "нет закреплённой маршрутизации",
  invalid_config: "некорректная конфигурация",
  order_not_found: "заказ не найден",
  update_error: "ошибка обновления",
  update_failed: "ошибка обновления",
  idempotent: "уже в целевой стадии",
  idempotent_already_at_target: "уже в целевой стадии",
  target_stage_missing: "целевая стадия не найдена",
  target_stage_wrong_pipeline: "целевая стадия не в этой воронке",
};

export function localizeReasonCode(code: string | null | undefined): string {
  if (!code) return "";
  const key = String(code).toLowerCase().trim();
  return REASON_LABELS[key] || "штатная причина";
}

const AUDIT_LABELS: Record<string, string> = {
  "crm.deal.stage_reassigned": "Стадия сделки изменена",
  "crm.deal.stage_changed": "Стадия сделки изменена",
  "crm.deal.reassigned": "Сделка переназначена",
  "crm.deal.created": "Сделка создана",
  "crm.deal.updated": "Сделка обновлена",
  "crm.deal.deleted": "Сделка удалена",
  "crm.deal.restored": "Сделка восстановлена",
  "crm.deal.moved": "Сделка перемещена",
  "deal.sales_manager_changed": "Изменён менеджер продажи",
  deal_sales_manager_assigned_on_create: "Назначен менеджер продажи",
  crm_stage_applied_success: "Сделка перемещена в успешную стадию",
  crm_stage_applied_failed: "Сделка перемещена в стадию отказа",
  crm_stage_applied_pending: "Сделка поставлена в ожидание оплаты",
  crm_stage_apply_skipped_manual_override: "Автоматическое перемещение сделки пропущено",
  crm_stage_apply_skipped_invalid_config: "Автоматическое перемещение сделки пропущено",
  crm_routing_snapshot_negative: "Маршрутизация сделки не настроена",
  crm_routing_snapshot_created: "Маршрутизация сделки закреплена",
  order_created: "Заказ создан",
  order_updated: "Заказ обновлён",
  payment_received: "Платёж получен",
  payment_failed: "Платёж не прошёл",
  payment_refunded: "Возврат средств",
  payment_canceled: "Платёж отменён",
  access_granted: "Доступ выдан",
  access_revoked: "Доступ отозван",
  access_expired: "Доступ истёк",
};

const SALES_MANAGER_SOURCE_LABELS: Record<string, string> = {
  manual_reassignment: "Ручное назначение",
  bulk_reassignment: "Массовое назначение",
  backfill: "Историческое назначение",
  admin_manual: "При создании сделки",
  payment_link: "Платёжная ссылка",
  platform_send: "Отправка из платформы",
};

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function managerName(meta: Record<string, unknown>, nameKey: string, idKey: string): string {
  const name = textValue(meta[nameKey]);
  if (name) return name;
  return meta[idKey] ? "Сотрудник" : "Без менеджера";
}

/**
 * Человекочитаемые строки для аудита менеджера продажи. Возвращает null для
 * остальных событий, чтобы их существующая локализация не менялась.
 */
export function formatSalesManagerAuditDetails(
  action: string | null | undefined,
  meta: Record<string, unknown> | null | undefined,
): string[] | null {
  const key = String(action || "").trim();
  const values = meta ?? {};

  if (key === "deal.sales_manager_changed") {
    const lines = [
      `Менеджер: ${managerName(values, "old_responsible_name", "old_responsible_user_id")} → ${managerName(values, "new_responsible_name", "new_responsible_user_id")}`,
    ];
    const changedPaymentCount = Number(values.changed_payment_count);
    if (Number.isFinite(changedPaymentCount) && changedPaymentCount >= 0) {
      lines.push(`Связанных платежей обновлено: ${changedPaymentCount}`);
    }
    const reason = textValue(values.reason);
    if (reason) lines.push(`Причина: ${reason}`);
    const source = textValue(values.source);
    if (source) lines.push(`Источник: ${SALES_MANAGER_SOURCE_LABELS[source] || "Системное назначение"}`);
    return lines;
  }

  if (key === "deal_sales_manager_assigned_on_create") {
    const responsibleName = textValue(values.responsible_name_snapshot) || "Сотрудник";
    const lines = [`Менеджер: ${responsibleName}`];
    const source = textValue(values.source);
    if (source) lines.push(`Источник: ${SALES_MANAGER_SOURCE_LABELS[source] || "Системное назначение"}`);
    return lines;
  }

  return null;
}

export function localizeAuditAction(action: string | null | undefined): string {
  if (!action) return "Системное событие";
  const key = String(action).trim();
  if (AUDIT_LABELS[key]) return AUDIT_LABELS[key];
  const lower = key.toLowerCase();
  if (AUDIT_LABELS[lower]) return AUDIT_LABELS[lower];
  if (/stage.*reassign|stage.*change|stage.*moved/.test(lower)) return "Стадия сделки изменена";
  if (/deal.*create/.test(lower)) return "Сделка создана";
  if (/deal.*update/.test(lower)) return "Сделка обновлена";
  if (/deal.*delete/.test(lower)) return "Сделка удалена";
  if (/payment.*success|payment.*paid|payment.*captured/.test(lower)) return "Платёж получен";
  if (/payment.*fail|payment.*declin|payment.*error/.test(lower)) return "Платёж не прошёл";
  if (/payment.*refund/.test(lower)) return "Возврат средств";
  if (/payment.*cancel|payment.*void/.test(lower)) return "Платёж отменён";
  if (/access.*grant/.test(lower)) return "Доступ выдан";
  if (/access.*revoke/.test(lower)) return "Доступ отозван";
  if (/access.*expir/.test(lower)) return "Доступ истёк";
  if (/delete|remove|удал/.test(lower)) return "Удаление данных";
  if (/create|insert|добав/.test(lower)) return "Добавление данных";
  if (/update|change|reset|измен/.test(lower)) return "Изменение данных";
  if (/payment|bepaid|stripe/.test(lower)) return "Платёжная операция";
  // Если raw похож на технический код — не показываем сам код,
  // отдаём безопасный fallback.
  if (/[._-]/.test(key) || /^[a-z]/i.test(key)) return "Системное событие";
  return key;
}

const PAYMENT_LABELS: Record<string, string> = {
  paid: "Оплачено",
  succeeded: "Оплачено",
  success: "Оплачено",
  successful: "Оплачено",
  captured: "Оплачено",
  completed: "Оплачено",
  processed: "Оплачено",
  failed: "Оплата не прошла",
  fail: "Оплата не прошла",
  error: "Ошибка",
  declined: "Оплата не прошла",
  canceled: "Отменено",
  cancelled: "Отменено",
  void: "Отменено",
  voided: "Отменено",
  refunded: "Возврат",
  refund: "Возврат",
  pending: "Ожидает",
  processing: "Обрабатывается",
  expired: "Истёк",
  stale: "Требует проверки",
  active: "Активен",
  revoked: "Отозван",
};

export function localizePaymentStatus(status: string | null | undefined): string {
  if (!status) return "Неизвестный статус";
  const key = String(status).toLowerCase().trim();
  if (PAYMENT_LABELS[key]) return PAYMENT_LABELS[key];
  if (/succe|paid|success|captur|complet/.test(key)) return "Оплачено";
  if (/fail|declin|error/.test(key)) return "Оплата не прошла";
  if (/cancel|void/.test(key)) return "Отменено";
  if (/refund/.test(key)) return "Возврат";
  if (/pend/.test(key)) return "Ожидает";
  if (/process/.test(key)) return "Обрабатывается";
  if (/expir/.test(key)) return "Истёк";
  if (/stale/.test(key)) return "Требует проверки";
  return "Неизвестный статус";
}

const ACCESS_LABELS: Record<string, string> = {
  active: "Активен",
  granted: "Выдан",
  revoked: "Отозван",
  expired: "Доступ истёк",
  pending: "Ожидает",
  queued: "В очереди",
  failed: "Ошибка",
  error: "Ошибка",
  stale: "Требует проверки",
  suspended: "Приостановлен",
  denied: "Отклонён",
};

export function localizeAccessStatus(status: string | null | undefined): string {
  if (!status) return "Неизвестный статус";
  const key = String(status).toLowerCase().trim();
  if (ACCESS_LABELS[key]) return ACCESS_LABELS[key];
  if (/active|grant/.test(key)) return "Активен";
  if (/revoke/.test(key)) return "Отозван";
  if (/expir/.test(key)) return "Доступ истёк";
  if (/pend|queue/.test(key)) return "Ожидает";
  if (/fail|error/.test(key)) return "Ошибка";
  if (/stale/.test(key)) return "Требует проверки";
  return "Неизвестный статус";
}

const CRM_STATUS_LABELS: Record<string, string> = {
  new: "Новая",
  open: "Открыта",
  in_progress: "В работе",
  pending: "Ожидает",
  paid: "Оплачено",
  succeeded: "Успешно",
  won: "Успешно",
  closed_won: "Успешно",
  failed: "Оплата не прошла",
  lost: "Отказ",
  closed_lost: "Отказ",
  canceled: "Отменено",
  cancelled: "Отменено",
  refunded: "Возврат",
  expired: "Истёк",
  archived: "В архиве",
  draft: "Черновик",
  active: "Активна",
  trial: "Пробный период",
};

export function localizeCrmStatus(status: string | null | undefined): string {
  if (!status) return "Неизвестный статус";
  const key = String(status).toLowerCase().trim();
  if (CRM_STATUS_LABELS[key]) return CRM_STATUS_LABELS[key];
  return localizePaymentStatus(status);
}

const ENTITY_LABELS: Record<string, string> = {
  order: "Сделка",
  orders_v2: "Сделка",
  deal: "Сделка",
  payment: "Платёж",
  payments_v2: "Платёж",
  profile: "Клиент",
  profiles: "Клиент",
  contact: "Контакт",
  company: "Компания",
  companies: "Компания",
  subscription: "Подписка",
  subscriptions_v2: "Подписка",
  access_grant: "Доступ",
  entitlement: "Доступ",
  tariff: "Тариф",
  product: "Продукт",
  invoice: "Счёт",
};

export function localizeEntityType(entity: string | null | undefined): string {
  if (!entity) return "";
  const key = String(entity).toLowerCase().trim();
  return ENTITY_LABELS[key] || "";
}
