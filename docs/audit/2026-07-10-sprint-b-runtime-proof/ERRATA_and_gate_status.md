# Sprint B — Errata и статус после review

Дата ревью: 2026-07-10
Автор: Lovable engineer

## Статус спринта: **FAIL** — требуется follow-up validation и UI-wiring

Ревьюер идентифицировал **6 замечаний** (в предыдущей формулировке ошибочно записано 5):

| # | Замечание | Категория | Gate |
|---|-----------|-----------|------|
| 1 | Public E2E выполнен не на согласованном URL (`gorbova.by/cb`), а на `cb.gorbova.by`. | UI wiring | B |
| 2 | Negative runtime proofs неполные (inactive offer, real createOrder failure, valid-signature duplicate/unknown/foreign — не покрыты). | Runtime | A→B |
| 3 | Honeypot раскрывает причину блокировки полем `skipped:"honeypot"`. Нарушает согласованный контракт. | Backend | **A — исправлено** |
| 4 | Persistence hardening отсутствует — ошибки INSERT/UPDATE после успешного `createOrder` в РР могут привести ко второй заявке при повторе. | Backend | **A — исправлено** |
| 5 | Изоляция тестовой среды нарушена — 8 production-строк `orders_v2` на боевом РР-оффере. Test fixture не создан. | Инфраструктура | A |
| 6 | Неверное имя миграции в отчёте (`20260710085555_*` вместо `20260710085550_3d877fb1-...sql`). | Документация | **A — исправлено** |

## Errata по имени миграции

Фактическое имя миграции concurrency-фикса:

```
supabase/migrations/20260710085550_3d877fb1-215b-4219-a311-d84952134c83.sql
```

В `REPORT.md` §2b, §8 и §7-инвентаре указано `20260710085555_...` — это опечатка. Файл на диске один, его SHA-сумма стабильна, никакой второй миграции не существовало.

## Gate A / Gate B план

- **Gate A (текущий шаг, без изменения UI):**
  1. Backend persistence hardening через атомарный RPC `rr_finalize_created_order`.
  2. Honeypot контракт: только `{ success: true }`, без provider_events insert.
  3. Discovery для test fixture (см. `test_fixture_discovery.md`).
  4. Discovery для UI-wiring (см. `ui_wiring_discovery.md`).
  5. Cleanup-скрипт для test-orders (см. `cleanup_test_fixture.sql`) — dry-run only, не выполняется автоматически.
- **Gate B (отдельное согласование):**
  1. Минимальный UI patch на страницу `gorbova.by/cb`.
  2. Deploy.
  3. Public E2E прогон.
  4. Полный runtime negative proof по 5 сценариям с реальными Sprint B webhook-контрактами.
  5. Финальная приёмка Sprint B.

Sprint C до Gate B PASS не начинать.
