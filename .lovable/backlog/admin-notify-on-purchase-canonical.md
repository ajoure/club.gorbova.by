# Admin DM про оплаты — перенос в canonical notify-order-purchased

## Проблема
Сейчас админ-уведомления о покупках шлёт `bepaid-webhook` напрямую (несколько мест: строки ~886, 937, 1864, 3627, 4327, 4469, 4529, 5066). Каждое место — отдельная ветка, разный формат, легко получить дубли или пропуск.

## Что сделать
1. Добавить в `notify-order-purchased` третий канал `telegram_admin` (или несколько получателей admin/superadmin):
   - Список получателей — из `roles` / `user_roles_v2` (роли `admin`, `super_admin`), у которых заполнен `profiles.telegram_user_id`.
   - Идемпотентность — та же таблица `order_notification_deliveries`, `channel='telegram_admin'`, `recipient=<telegram_user_id>` (одна строка на пару order+admin).
   - Mirror в `telegram_messages` для чата админа (по существующему паттерну).
2. Убрать все прямые вызовы `telegram-notify-admins` из `bepaid-webhook` в контексте «оплата пришла».
3. Оставить `telegram-notify-admins` только для реально системных событий (диагностика, ошибки, sync-runs).

## DoD
- Одна каноническая точка отправки уведомлений о покупке — `notify-order-purchased`.
- Клиент и админы получают уведомления детерминированно, идемпотентно, аудируются в `order_notification_deliveries`.
- `bepaid-webhook` больше не отвечает за business-уведомления.

## Границы
Не переносить дунинг, sync-error, диагностические уведомления — это отдельные сценарии.
