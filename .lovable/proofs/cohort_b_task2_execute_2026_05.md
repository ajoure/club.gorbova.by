# Cohort B — Task 2 Execute (2026-05)

## Результат

Single transaction по frozen id-list (19 UUID).

| Метрика | Значение |
| ------- | -------- |
| backup_count | 19 ✅ |
| audit_count (`orders.cohort_b_orphan_delete_2026_05`) | 19 ✅ |
| deleted (orders_v2) | 19 ✅ |
| remaining (orders_v2 по 19 ID) | 0 ✅ |
| guard | passed (без ROLLBACK) |

Backup: `public._orders_cohort_b_cleanup_2026_05_backup` (полный snapshot строк).
Audit: `audit_logs.action = 'orders.cohort_b_orphan_delete_2026_05'`, по записи на каждый order, в `meta.snapshot` лежит `to_jsonb(o)`.

## Cohort B пересчёт (после Task 2)

| Подгруппа | Было (после Task 1) | Стало |
| --------- | ------------------- | ----- |
| total | 62 | **43** |
| has_subscription_ref | 42 | 42 |
| has_blocking_audit (без sub-ref) | 17 | **1** (только `5aa1c624` admin duplicate) |
| paid_without_payment | 2 | **0** |
| unclassified | 1 | 0 |

Совпадает с ожиданием dry-run.

## Side effects (diff = 0)

`payments_v2 / subscriptions_v2 / entitlements / access_grant_ledger` для 19 ID — не затронуты (guards подтверждены до и после).

## Остаток Cohort B (43)

- 42 × `has_subscription_ref` — past_due/active/canceled подписки, технический мусор без риска. Не трогаем.
- 1 × `5aa1c624` — `admin.create_deal_from_payment` дубль-сделка над чужим платежом. Требует ручного разбора админом.

## DoD

- [x] Execute по frozen id-list (19), не по пересчёту.
- [x] backup=audit=deleted=19, guard прошёл.
- [x] Идемпотентность: повторный DELETE = 0 (orders уже отсутствуют).
- [x] Cohort B пересчитан: **43**.
- [x] Доступы/подписки/entitlements не изменились.
