# План: ревизия PR413 (READ-ONLY, без исполнения)

## SHA

- Локальный HEAD = `ce9a63ac342754abfa859714a0fdb5daf9eb7ad7` (merge PR #413), head-commit `3f754d0a40e673e89380b318078032a357a56d70` — совпадение подтверждено.
- Диф PR413 затрагивает ровно: `grant-access-for-order/index.ts`, `telegram-grant-access/index.ts`, `telegram-grant-access/sync-replay-grant.ts`, два теста и один doc. Миграций в дифе нет.

## Проверка заявленных свойств — все PASS

1. **Ветка duplicate-DM.**
   - `syncReplayGrant` при отсутствии зеркала создаёт ровно одну строку `telegram_access_grants` для того же `user+club+source_id`, с `status='active'`, `meta.replay_without_duplicate_dm=true`, без флагов приглашений/сообщений.
   - Telegram API после дубликата не вызывается: ветка завершается `continue` до блоков `unbanUser` / `createInviteLink` / отправки DM.
   - Fail-closed: read → `telegram_replay_grant_read_failed`; insert → `..._insert_failed`; readback insert → `..._insert_readback_failed`; update → `..._update_failed`; CAS-конфликт по `updated_at` → `..._snapshot_changed`; readback update → `..._readback_failed`; отсутствие snapshot → `..._missing_snapshot`. Внешний `catch (dupErr) { throw dupErr; }` не даёт провалиться в путь повторного DM. Ошибки lookup `telegram_messages` (основной и legacy) также бросают.
   - Revoked exact source сохраняется: `status !== 'active'` → `telegram_replay_grant_not_active`, реактивации нет. Проекция `telegram_access` в этой ветке обновляет только `active_until` и `last_sync_at`, `state_chat/state_channel` не трогаются; revoked-проекция вообще не идёт в duplicate-ветку (`projectionNeedsRestore`).

2. **valid_until не укорачивается.**
   - `isUnlimited` → `activeUntil = null` (unlimited остаётся unlimited, ранее затирался конечной датой).
   - Иначе берётся `max(requested, effective)`; невалидные даты → `telegram_effective_access_invalid_end` (fail closed).
   - Для `is_manual` снимок вообще не применяется.

3. **actor_type.**
   - RBAC-матрица в `caller_auth.ts` работает по `caller.type` (`admin` не изменён; `adminManualAccessEdit` остаётся admin-only).
   - В `audit_logs` пишется маппинг `admin → user` (строка 276) и статическое `"user"` (строка 607). Проверено в production: `audit_logs_actor_type_check` допускает только `user | system | service` — то есть прежние вставки действительно падали, теперь совместимы.

4. **Миграции/деплой.**
   - Миграция не требуется (в дифе нет SQL; constraint уже существует).
   - Деплой нужен ровно двум функциям: `grant-access-for-order`, `telegram-grant-access`.

## Совместимость и конфигурация

- Импорты: `npm:@supabase/supabase-js@2`, относительные `_shared/*.ts`, локальный `./sync-replay-grant.ts` — всё в пределах `supabase/functions/`, деплоится вместе с функцией. Динамический `await import('../_shared/resolve-effective-access.ts')` валиден в Deno.
- `supabase/config.toml`: обе функции уже `verify_jwt = false` с in-function auth; изменений конфигурации не требуется.
- Локальные контрактные тесты PR413 (`telegramReplayGrant`, `grantAccessAuditActor`) — 17/17 PASS.

## Блокеров нет

Критических расхождений и несовпадений SHA не найдено. Замечание не-блокирующее: при `unlimited` вставляемое зеркало получает `end_at = null` — это соответствует контракту readback (`null ⇒ Infinity`).

## Минимальный план деплоя/проверки (на будущий EXECUTE, сейчас не выполняется)

1. Синхронизировать Lovable ровно на `ce9a63ac…`; убедиться, что рабочее дерево чистое.
2. Развернуть ровно две функции: `grant-access-for-order`, `telegram-grant-access`. Ничего больше, без Publish и без миграций.
3. Readback деплоя: версии/updated_at обеих функций, отсутствие 404 на OPTIONS.
4. Безопасный runtime-прогон без денег и сообщений:
   - существующий уже-исполненный заказ (например `a64743db…`) прогоняется только как чтение состояния: grant `ac1837b5…`, sub `37cb6139…`, entitlement `7a3cd953…`, проекция `telegram_access` — все ожидаются с `2026-09-30T03:01:53.529Z`;
   - никакого повторного grant, никакого execute очередей (`e52535ae…`, `58846a90…` — не трогать);
   - счётчики before/after по `telegram_messages`, `notification_outbox`, `payments_v2`, `orders_v2` — ожидаемая дельта 0.
5. Инварианты после деплоя: INV-25 = 0, INV-P0-1 = 0.
6. Любое расхождение (SHA, дельта в запрещённых таблицах, ненулевые счётчики сообщений) → STOP и отчёт.
