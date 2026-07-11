# Migration scope manifest — Gate A.1 v3.1a (draft)

Фиксирует scope draft-миграции, чтобы при переходе в runtime можно было проверить, что реализация не расширилась и не сузилась.

## Файл

- Путь: `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1_v3_1a/draft/migration_gate_a1_v3_1a.sql`
- Размер: 474 строки
- SHA-256: `5da444ab11ff6391236abc85c19314621e86eaa5dc772881035c0284362444bc`

При любом изменении файла контрольная сумма должна быть пересчитана и этот manifest обновлён в том же коммите. Runtime-миграция считается соответствующей draft'у только если её SHA-256 совпадает с указанной здесь либо приложен diff с обоснованием.

## Полный список функций, которые изменяет миграция

Все — `CREATE OR REPLACE FUNCTION` в схеме `public`. Никаких `DROP FUNCTION`. Никаких изменений сигнатур существующих RPC (запрет из поправки).

| # | Функция | Тип изменения | Строка в draft |
|---|---|---|---|
| 1 | `public.rr_is_safe_payment_url(_url text)` | новая (immutable helper) | 15 |
| 2 | `public.rr_finalize_created_order_internal(...)` | hardened (allowlist `_source`, guards, REVOKE от anon/authenticated/service_role) | 51 |
| 3 | `public.rr_finalize_created_order(...)` | использование `rr_is_safe_payment_url`, делегирование в internal | 155 |
| 4 | `public.rr_reconcile_confirm_created(...)` | использование `rr_is_safe_payment_url`, делегирование в internal | 174 |
| 5 | `public.rr_mark_upstream_unknown(...)` | нормализация legacy markers в `meta.rr` | 200 |
| 6 | `public.rr_mark_local_persist_failed(...)` | нормализация legacy markers в `meta.rr` | 246 |
| 7 | `public.rr_get_or_create_pending_order(...)` | синхронизация candidate priority с edge (A4) | 342 |
| 8 | `public.rr_finalize_order_rejected(...)` | расширение `already_*` payload compatibility (A5) | 433 |

Итого: **8 функций** (1 новая + 7 replace).

## Prospective schema diff (ожидаемый)

Проверяется в runtime через `pg_get_functiondef` до и после (`functiondef_before.txt` / `functiondef_after.txt`).

### Таблицы
- `orders_v2` — **без изменений** структуры. Backfill правит только строки, где `meta->'rr'` содержит legacy markers `upstream_unknown` / `local_persist_failed` в устаревшем плоском виде; scope ограничен `provider='rr' AND meta ? 'rr'`. Точный `WHERE`-фильтр и counter `rows_updated` фиксируются в `legacy_backfill_before.txt` / `legacy_backfill_after.txt`.

### Индексы / constraints
- Не создаются, не удаляются.

### Triggers
- Не создаются, не изменяются.

### Enums / types
- Не создаются, не изменяются.

### Grants / revokes
- `rr_is_safe_payment_url` — `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE TO service_role`.
- `rr_finalize_created_order_internal` — `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` (internal-only). Runtime подтверждается `internal_helper_privileges.txt`.
- Публичные RPC (`rr_finalize_created_order`, `rr_reconcile_confirm_created`, `rr_mark_upstream_unknown`, `rr_mark_local_persist_failed`, `rr_get_or_create_pending_order`, `rr_finalize_order_rejected`) — гранты не расширяются относительно текущего prod. Матрица подтверждается `privilege_matrix.txt`.

### Данные
- Единственная data-mutation — контролируемый backfill legacy markers в `meta.rr` (см. таблицу выше). Не трогает `payment_url`, `provider_order_id`, `initiation_status`, `reconciliation_status` в терминальных состояниях. Backfill идемпотентен: повторное применение → 0 обновлённых строк.

## Что миграция **не** делает (anti-scope)

- Не переименовывает и не удаляет функции.
- Не меняет сигнатуры существующих RPC.
- Не добавляет колонки в `orders_v2` / `provider_events`.
- Не добавляет новые enums / статусы.
- Не создаёт reconciler-функций и cron-jobs (это Gate A.2).
- Не деплоит edge (это отдельный шаг после runtime PASS миграции).
- Не активирует fault injection (только hook, но `RR_TEST_FAULT_MODE` пустой в production навсегда).

## Идемпотентность

Все `CREATE OR REPLACE FUNCTION` — идемпотентны. Backfill — `UPDATE ... WHERE <legacy marker>` — при повторном запуске условие `false`, 0 строк. Runtime-доказательство: двойное применение миграции → второй раз `rows_updated = 0`.
