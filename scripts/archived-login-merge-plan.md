# G9: объединение архивного логина с активной карточкой

Продолжение общего объединения архивных дублей. Пользователь разрешил совпадение
по email ИЛИ телефону и сохранение email активной карточки. В этой паре у активной
карточки нет Auth, а архивный Auth содержит другой свободный адрес.

Миграция создаёт только service_role RPC для одной фиксированной пары и журнал
состояния до Auth-запроса. Edge-функция доступна только с точным managed service key.
Порядок: preflight → prepare journal → Admin API email update → Auth read-back →
атомарное завершение переноса profiles.user_id → read-back/replay.
Никакого password, email_confirm, создания/удаления пользователей, платежей или доступа.
При ошибке SQL после Auth-update выполняется обратный Admin API update, кроме случая
когда статус подтверждает уже завершённую транзакцию. Неопределённый статус — STOP.
Все ответы обезличены; старый/новый email остаются только внутри managed RPC/Admin API
и защищённого журнала БД. Banned-кандидат не участвует и не разблокируется.

Перед execute Lovable проверяет текущие guard-условия, побочные Auth/profile-триггеры
и отключённость уведомлений о смене email (Admin API не должен отправить сообщение).
Сначала GitHub checks и exact merged SHA, managed migration, deploy только
admin-merge-archived-login, dry-run, затем execute и read-back. Нельзя использовать
users-admin-actions change_email: там auto-confirm и orphan deletion.

Локальные проверки: 4 теста PGlite/Node PASS — service-only ACL, подготовка до Auth,
атомарное завершение/повтор, отказ при новых покупках, отсутствие PII в ответе,
компенсация при ошибке и сохранение нового email при неопределённом, но завершённом SQL.
Production пока не изменён.
