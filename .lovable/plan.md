# READ-ONLY capability check: provider GET без вывоза секретов

Статус: READ-ONLY. Ничего не установлено, не вызвано, не изменено. Provider GET — NOT VERIFIED.

## Проверено (pg_available_extensions, pg_proc)

| Канал | Статус |
|---|---|
| `pg_net` (`net.http_get` / `net.http_post`, `net._http_response`) | YES — установлен 0.19.5, функции существуют |
| `extensions.http` (синхронный HTTP GET) | NO — доступен в каталоге (1.6), но НЕ установлен; требуется CREATE EXTENSION (DDL) |

## Допустимый канал после exact-SHA deploy readonly-функции

1. Codex мерджит PR386 head 47b8af5092, деплой ровно одной функции `bepaid-readonly-pull` (service-role gate рядом с admin RBAC, allowlist exact subscription_ids / transaction_uids, безопасные поля ответа).
2. Узкий managed SQL (execute только после отдельного разрешения):
   - ВНУТРИ production SQL читает существующий Vault-секрет `email_queue_service_role_key` (только его existence проверен; значение не SELECT-ится наружу).
   - `net.http_post(url := <edge function URL>, headers := jsonb_build_object('Authorization', 'Bearer ' || <vault secret>, 'Content-Type','application/json'), body := jsonb_build_object('subscription_ids', <allowlist>))`.
   - Ответ читается из `net._http_response`; возвращаются только безопасные поля (state, active_to, renew_at, last_transaction.status, tracking_id префикс).
3. Альтернатива (Basic из integration_instances, внутри БД) требует `CREATE EXTENSION http` — не выполняется без отдельного разрешения на DDL.

## Границы

- Никаких SELECT значений секретов наружу, никаких charge/refund/cancel — только GET.
- До deploy + разрешения: provider-факты по 7 подпискам INV-P0-1 и транзакции INV-25 остаются NOT VERIFIED.
- Порядок из прошлой сверки сохранён: migration (cron header) → deploy processors/gates; запуск cron вручную не производится.
