# План: переиспользование уведомлений

`order_notification_deliveries` существует, но привязанность к order должна быть проверена live. Referral уведомления не должны ломать начисление. Решение: emitting event + существующий email/Telegram adapter + отдельный idempotent delivery key; новую параллельную систему шаблонов не создавать.
