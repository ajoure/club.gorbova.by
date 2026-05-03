# Orphan-сделки Cohort A — execute proof (2026-05)

## Скоуп
- Gorbova Club (`11c9f1b8-0355-4753-bd74-40b42aa53616`)
- Бухгалтерия как бизнес (`85046734-2282-4ded-b0d3-8c66c8f5bc2b`)

## Критерий Cohort A
`orders_v2` без записей в `payments_v2`, статус ∈ (`pending`,`failed`,`canceled`),
без ссылок в `subscriptions_v2` / `entitlements` / `access_grant_ledger`
и без блокирующих audit-actions (grant/access/entitlement/subscription/fulfillment/revoke/payment-paid/order-paid/admin.create_deal/bepaid.checkout).

Игнорируемые audit-actions: `system.payment_link.created`, `payment_checkout.token_expired`,
`crm_routing_snapshot_negative`, `system.payment_link.viewed`, `system.payment_link.opened`.

## Транзакция (single migration)
1. Создан backup `public._orders_orphan_cleanup_2026_05_backup` с полным snapshot строк.
2. Записан `audit_logs.action = 'orders.cohort_a_orphan_delete_2026_05'` на каждую строку.
3. `DELETE FROM orders_v2` строго по id из backup.
4. Гард: при backup_count ≠ 572 / audit_count ≠ 572 / deleted ≠ 572 → `RAISE EXCEPTION` (rollback).

## Verify (пост-commit)

| Метрика | Значение |
| ------- | -------- |
| backup_count | **572** |
| audit_count | **572** |
| deleted_count (≡ still_present=0) | **572** |
| Cohort A remaining (повторный dry-run) | **0** |

## Не затронуто
- `payments_v2`, `subscriptions_v2`, `entitlements`, `access_grant_ledger` — diff = 0.
- Cohort B (63 строки: 42 sub-ref, 18 blocking audits, 3 paid-без-payment) — не тронуты, остаются для ручного разбора.
- Другие продукты — вне скоупа.

## Откат
Полный snapshot доступен в `public._orders_orphan_cleanup_2026_05_backup` (включая колонку `snapshot jsonb` с исходным `orders_v2.*`). Восстановление возможно `INSERT INTO orders_v2 SELECT ... FROM _orders_orphan_cleanup_2026_05_backup`.

## DoD
- [x] Cohort A удалён транзакционно с гардами.
- [x] Audit на каждую строку.
- [x] Backup сохранён.
- [x] Повторный dry-run = 0.
- [x] Доступы пользователей не изменились.
- [x] Cohort B не тронут.
