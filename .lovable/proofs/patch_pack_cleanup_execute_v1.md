# Patch Pack Cleanup — EXECUTE PROOF (Scope A, расширенный)

Дата: 2026-06-09  
Статус: EXECUTE PASS  
План: `.lovable/proofs/patch_pack_cleanup_delete_plan_v1.md`

## Результаты DELETE (assert-protected)

| Таблица | План | Факт | Asserts |
|---|---:|---:|:---:|
| `access_grant_ledger` | 11 | 11 | OK |
| `entitlements` | 5 | 5 | OK |
| `provider_subscriptions` | 16 | 16 | OK |
| `subscriptions_v2` | 25 | 25 | OK |
| `payment_links` | 13 | 13 | OK |
| `provider_events` | 122 | 122 | OK |
| `payments_v2` | 22 | 22 | OK |
| `orders_v2` | 31 | 31 | OK |

Все DELETE выполнялись с `GET DIAGNOSTICS ROW_COUNT` и `RAISE EXCEPTION` при несовпадении — миграция атомарна, любая ошибка откатила бы транзакцию.

## Post-verify

| Проверка | Результат |
|---|---:|
| KEEP order `b464dc75…` существует | 1 |
| KEEP payment `2d40bc7e…` существует | 1 |
| KEEP subscription `6c3cd3a5…` существует | 1 |
| KEEP entitlement `fabd7e5a…` существует | 1 |
| `orders_v2` stripe-residue | **1** (KEEP) |
| `payments_v2` stripe-residue | **1** (KEEP) |
| `subscriptions_v2` meta-stripe | **0** |
| `payment_links` stripe | **0** |
| `provider_events` stripe | **1** (привязан к KEEP-payment) |
| `payments_v2` bePaid intact | **5686** ✓ |

## Backup tables

Созданы (RLS off, не в Data API):

- `_stripe_cleanup_2026_06_backup_orders` (31)
- `_stripe_cleanup_2026_06_backup_payments` (22)
- `_stripe_cleanup_2026_06_backup_subscriptions` (25)
- `_stripe_cleanup_2026_06_backup_provider_subs` (16)
- `_stripe_cleanup_2026_06_backup_entitlements` (5)
- `_stripe_cleanup_2026_06_backup_access_grant_ledger` (11)
- `_stripe_cleanup_2026_06_backup_payment_links` (13)
- `_stripe_cleanup_2026_06_backup_provider_events` (122)

Рекомендация: удалить backup-таблицы через ~30 дней (после 2026-07-09), если не зафиксировано инцидентов в админке / отчётах.

## Что НЕ затронуто

- bePaid: 5686 платежей, все подписки и orders bePaid — intact.
- profiles: 0 удалений.
- Live Stripe KEEP-chain: 4/4 intact.
- Stripe receipt `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` доступен через сохранённый event и payment row.

## Итог

Hard cleanup завершён.  
В `/admin/payments` остаётся ровно один Stripe-платёж — реальный live 5 BYN Сергея Федорчука.  
Тестовый Stripe-мусор полностью удалён из orders_v2 / payments_v2 / subscriptions_v2 / provider_subscriptions / entitlements / access_grant_ledger / payment_links / provider_events.
