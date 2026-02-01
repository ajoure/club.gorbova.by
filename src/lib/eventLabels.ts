/**
 * Централизованный словарь человекочитаемых названий событий на русском языке
 * Используется в ContactDetailSheet, ContactTelegramChat, AccessHistorySheet и др.
 */

export const EVENT_LABELS: Record<string, string> = {
  // ===== Telegram привязка =====
  LINK_SUCCESS: "Привязал Telegram",
  RELINK_SUCCESS: "Перепривязал Telegram",
  UNLINK: "Отвязал Telegram",
  link_token_created: "Создана ссылка привязки",
  link_token_expired: "Ссылка привязки истекла",
  user_linked: "Telegram привязан",
  user_unlinked: "Telegram отвязан",
  
  // ===== Доступ =====
  AUTO_GRANT: "Автоматическая выдача доступа",
  MANUAL_GRANT: "Ручная выдача доступа",
  MANUAL_EXTEND: "Продление доступа",
  AUTO_REVOKE: "Автоматический отзыв доступа",
  MANUAL_REVOKE: "Ручной отзыв доступа",
  AUTO_KICK_VIOLATOR: "Исключён из группы",
  access_granted: "Доступ выдан",
  access_revoked: "Доступ отозван",
  regrant_access: "Доступ восстановлен",
  "admin.grant_access": "Выдача доступа",
  "admin.revoke_access": "Отзыв доступа",
  "telegram.access_granted": "Доступ в Telegram",
  "telegram.access_revoked": "Отзыв доступа в Telegram",
  
  // ===== Telegram regrant =====
  "telegram.regrant_dry_run": "Проверка восстановления доступов",
  "telegram.regrant_wrongly_revoked_completed": "Доступы восстановлены",
  "telegram.mass_revoke": "Массовый отзыв доступов",
  
  // ===== Уведомления =====
  manual_notification: "Уведомление отправлено",
  system_notification: "Системное уведомление",
  legacy_card_notification: "Уведомление об устаревшей карте",
  MASS_NOTIFICATION: "Массовая рассылка",
  ADMIN_NOTIFY_SENT: "Уведомление админов",
  ADMIN_NOTIFY_SKIPPED: "Уведомление пропущено",
  ADMIN_NOTIFY_FAILED: "Ошибка уведомления админов",
  "notifications.send_success": "Уведомление отправлено",
  "notifications.send_error": "Ошибка отправки уведомления",
  "notifications.send_blocked": "Уведомление заблокировано",
  "notifications.outbox_sent": "Уведомление доставлено",
  "notifications.outbox_failed": "Ошибка доставки уведомления",
  "notifications.outbox_skipped": "Уведомление пропущено (дубль)",
  "notifications.outbox_retry": "Повторная отправка уведомления",
  
  // ===== Напоминания о подписке =====
  SEND_REMINDER: "Напоминание о подписке",
  SEND_NO_CARD_WARNING: "Предупреждение: нет карты",
  subscription_reminder_7d: "Напоминание (7 дней)",
  subscription_reminder_3d: "Напоминание (3 дня)",
  subscription_reminder_1d: "Напоминание (1 день)",
  subscription_no_card_warning: "Предупреждение: нет карты",
  
  // ===== Сообщения =====
  ADMIN_CHAT_MESSAGE: "Сообщение от администратора",
  ADMIN_CHAT_FILE: "Файл от администратора",
  ADMIN_DELETE_MESSAGE: "Сообщение удалено администратором",
  ADMIN_EDIT_MESSAGE: "Сообщение отредактировано",
  BOT_START: "Запустил бота",
  
  // ===== Подписки =====
  SUBSCRIPTION_EXPIRED: "Подписка истекла",
  SUBSCRIPTION_ACTIVATED: "Подписка активирована",
  subscription_created: "Подписка создана",
  subscription_renewed: "Подписка продлена",
  subscription_canceled: "Подписка отменена",
  "subscription.purchased": "Покупка подписки",
  "subscription.created": "Подписка создана",
  "subscription.activated": "Подписка активирована",
  "subscription.canceled": "Подписка отменена",
  "subscription.expired": "Подписка истекла",
  "admin.subscription.refund": "Возврат средств",
  "admin.subscription.extend": "Продление доступа",
  "admin.subscription.cancel": "Отмена подписки",
  "admin.subscription.auto_renew_enabled": "Автопродление включено",
  "admin.subscription.auto_renew_disabled": "Автопродление отключено",
  "admin.subscription.update": "Обновление подписки админом",
  "admin.subscription.create": "Создание подписки админом",
  "admin.subscription.delete": "Удаление подписки админом",
  
  // ===== Grace Period (72ч ценовой период) =====
  grace_started: "Grace-период начат (72ч)",
  grace_24h_left: "Grace-период: осталось 48ч",
  grace_48h_left: "Grace-период: осталось 24ч",
  grace_expired: "Grace-период истёк",
  charge_will_run: "Предстоящее списание",
  "subscription.grace_started": "Запуск grace-периода",
  "subscription.grace_expired": "Grace-период истёк (возврат только по новой цене)",
  "subscription.grace_reminders_cron_completed": "Cron grace-напоминаний выполнен",
  grace_notification: "Уведомление grace-периода",
  
  // ===== Платежи =====
  PAYMENT_SUCCESS: "Платёж успешен",
  PAYMENT_FAILED: "Платёж не прошёл",
  payment_successful: "Платёж успешен",
  payment_failed: "Платёж не прошёл",
  "payment.success": "Успешная оплата",
  "payment.failed": "Ошибка оплаты",
  
  // ===== Предзаписи =====
  preregistration_tomorrow_charge: "Уведомление о завтрашнем списании",
  preregistration_no_card: "Уведомление: нет карты",
  preregistration_payment_success: "Успешное списание предзаписи",
  preregistration_payment_failed: "Неудачное списание предзаписи",
  buh_business_tomorrow_charge: "Уведомление о завтрашнем списании",
  buh_business_no_card: "Уведомление: нет карты",
  
  // ===== Биллинг =====
  "billing.charge_date_aligned": "Дата списания выровнена",
  "billing.charge_date_auto_corrected": "Дата списания автоисправлена",
  "billing.auto_charge_success": "Автосписание успешно",
  "billing.auto_charge_failed": "Автосписание не прошло",
  "billing.alignment_dry_run": "Проверка выравнивания биллинга",
  "subscription.charge_cron_completed": "Автосписание завершено",
  "subscription.charge_amount_calculated": "Сумма списания рассчитана",
  
  // ===== Платёжные методы =====
  "payment_methods.legacy_cards_revoked": "Устаревшие карты отозваны",
  "payment_methods.3ds_pre_fix_revoked": "Карта отозвана (3DS)",
  card_revoked: "Карта отвязана",
  card_added: "Карта добавлена",
  
  // ===== Верификация карт =====
  "card.reverify.requested": "Перепроверка карты запрошена (админ)",
  "card.verification.queued": "Карта добавлена в очередь верификации",
  "card.verification.verified": "Карта подтверждена для автосписаний",
  "card.verification.rejected": "Карта отклонена для автосписаний",
  "card.verification.failed": "Ошибка проверки карты",
  "card.verification.started": "Проверка карты начата",
  "card.verification.refunded": "Тестовый платёж возвращён",
  
  // ===== Триал =====
  "trial.started": "Начало триала",
  "trial.ended": "Окончание триала",
  
  // ===== Контакты =====
  CONTACT_MERGED: "Объединены контакты",
  CONTACT_UNMERGED: "Контакты разъединены",
  
  // ===== Admin actions =====
  "admin.create_deal_with_access_from_payment": "Создание сделки из платежа",
  "admin.create_deal": "Создание сделки вручную",
  "admin.update_deal": "Обновление сделки",
  "admin.delete_deal": "Удаление сделки",
  "admin.link_payment": "Привязка платежа к сделке",
  "admin.telegram.grant_access": "Выдача Telegram доступа",
  "admin.telegram.revoke_access": "Отзыв Telegram доступа",
  
  // ===== Sync/cron =====
  bepaid_fetch_transactions_cron: "Синхронизация транзакций bePaid",
  payments_autolink_by_card: "Автопривязка платежей по карте",
  queue_materialize_to_payments_v2: "Обработка очереди платежей",
  
  // ===== Система =====
  "system.cleanup_orphaned_mappings": "Очистка orphan-записей",
  ghost_tokens_cleanup: "Очистка ghost-токенов",
  delete_ghost_orders_20260120: "Удаление ghost-заказов",
  rollback_ghost_orders: "Откат ghost-заказов",
  
  // ===== Reconciliation =====
  "reconcile.payment_linked": "Платёж привязан к клиенту",
  "reconcile.order_created": "Заказ создан из платежа",
  
  // ===== Payment Diagnostics =====
  "payments.diagnostics.generated": "Сформирован отчёт диагностики платежей",
  "payments.diagnostics.exported": "Экспортирован отчёт диагностики",
};

/**
 * Получить человекочитаемое название события
 * @param action - код события из базы данных
 * @returns русское название или оригинальный код, если перевод не найден
 */
export function getEventLabel(action: string): string {
  return EVENT_LABELS[action] || action;
}
