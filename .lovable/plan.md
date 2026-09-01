# PLAN-ONLY ревизия PR #417

Head SHA: `6cc94f7339878f9a46951b09c350d45ff58cc6fd`
База: current main `2d7f71813613baa25d8a776143fc409ad2c0d60a`
Режим: read-only. Ничего не изменено, не задеплоено, не отправлено.

## Контекст инцидента
Rollout PR #416 отправил одну и ту же ссылку дважды (десктоп + мобильный тест кликнули resend отдельно): `payment_links` не вырос, но `notification_outbox` и `telegram_logs` получили по 2 строки `sent`. Текущая дедупликация — bucket 1 секунда (`Math.floor(Date.now()/1000)`), anti-doubleclick only, поэтому повторные отправки через минуты не блокируются.

## Что меняет патч (по описанию)
1. Клиентский shared helper: SHA-256 от канонического URL → `idempotency_key = payment-link:<64hex>`; сырой URL/токен не попадает в outbox/audit.
2. Auth-пользовательские custom-уведомления принимают только строгую форму ключа; service-role custom остаётся запрещён.
3. Сервер: в unique-ключ outbox добавлены `user_id` и серверный 10-минутный bucket.
4. Повтор в окне со статусом sent → `success=true, skipped=true, idempotent_replay=true`, Telegram не вызывается.
5. failed/blocked сохраняют retry-семантику (PATCH 10G).
6. Применяется и к обычным manual-ссылкам, и к рассрочным (shared helper `sendPaymentLinkToTelegram`).
7. Без миграций/схемы/платежей.

## Проверки против текущего кода
- **Авторизация** — PASS. Custom с idempotency-ключом остаётся в ветке authenticated user; service-role custom запрещён (`SERVICE_ROLE_ALLOWED_MESSAGE_TYPES` без custom, строки 33/132). Строгая форма ключа сужает поверхность.
- **Key spoofing / cross-user** — PASS. Ключ — хеш отправляемого URL; подделка ключа другого пользователя нейтрализуется добавлением `user_id` в unique-ключ — коллизии между пользователями исключены. Самостоятельный «spoof» своего ключа лишь дедуплицирует собственные отправки.
- **Утечка URL/токена** — PASS. В outbox/audit уходит только `payment-link:<sha256>`; канонизация URL до хеша (текущий helper уже нормализует через `new URL().toString()`).
- **Предотвращение дублей Telegram** — PASS. 10-мин серверный bucket + user_id + hash закрывают сценарий двойного resend из PR #416; повтор возвращает skipped/idempotent_replay без вызова Telegram API.
- **Retry после failed/blocked** — PASS. Существующая ветка 23505 → retry (attempt_count+1, статус queued) сохранена; новый ключ не ломает её, т.к. bucket/user_id входят в тот же unique-ключ.
- **Граница 10 минут** — PASS. После ротации bucket создаётся новая строка outbox и повторная отправка допустима — осознанное поведение окна, согласовано с описанием.
- **Регрессии других типов уведомлений** — PASS с одним условием подтверждения. Другие custom-отправители (`SendNotificationDialog`, `PreregistrationDetailSheet`) **не передают** idempotency_key и полагаются на серверный default bucket. Условие: строгая валидация должна применяться только когда ключ передан; обязательность ключа для всех custom сломала бы эти два потока. 361 Edge-контракт PASS указывает, что семантика «валидация при наличии» сохранена; подтвердить по диффу при merge-ревью. Типы card_* и crm-pipeline сохраняют свои ключи (ветки строк 324–335 не затронуты).

## Вердикт
**PLAN-ONLY PASS** для head SHA `6cc94f7339878f9a46951b09c350d45ff58cc6fd`.

## Execute-лист (после одобрения)
1. Merge exact head; sync merge SHA; доказать clean/byte-identical дерево.
2. Миграции: 0. Записи в БД: 0.
3. Деплой ТОЛЬКО `telegram-send-notification`.
4. Build + Publish; отчёт URL/версия/SHA.
5. Верификация БЕЗ реальной отправки Telegram: контрактные тесты, read-only проверка кода ответа (skipped/idempotent_replay), инспекция логов функции post-deploy. Никаких новых строк в outbox/telegram_logs от верификации.
