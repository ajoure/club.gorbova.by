# Patch Pack Cleanup — DELETE PLAN v2 (Scope A, corrected)

Дата: 2026-06-09  
Статус: APPROVED FOR EXECUTE  
Scope: Scope A — hard delete всего Stripe test/dev мусора, KEEP только один live-платёж 5 BYN Сергея.

## KEEP chain (НЕ ТРОГАТЬ)

| Сущность | ID |
|---|---|
| payment | `2d40bc7e-e69f-4633-88d5-102561e49a54` |
| order | `b464dc75-f295-419d-bede-10cd47fc299e` |
| subscription | `6c3cd3a5-75d0-4faa-9923-75bc2fa6b70a` |
| entitlement | `fabd7e5a-95b1-4bc3-89ad-a635f8ee8edc` |
| Stripe PI | `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` |
| Stripe checkout | `cs_live_a1zPxEw8wmMyELGazXbOkshlZ55NyoZNvY8c54fFpRQPCN5qEBZhrv6rnR` |

## Corrected DELETE counts (post-FK analysis)

| Таблица | Count | Метод выборки |
|---|---:|---|
| `access_grant_ledger` | 11 | `order_id IN test_orders` |
| `entitlements` | 5 | `order_id IN test_orders` (KEEP fabd7e5a исключён, не входит) |
| `provider_subscriptions` | 16 | `subscription_v2_id IN test_subs` |
| `subscriptions_v2` | **25** | 16 (meta-stripe) + 9 (FK по order_id) — union, **расширено с 16** |
| `payment_links` | **13** | `provider='stripe'` (скорректировано с 17) |
| `provider_events` | 122 | `provider='stripe' AND (related_payment_id IS NULL OR ≠ KEEP-payment)` |
| `payments_v2` | 22 | `(meta::text ILIKE '%stripe%' OR provider='stripe') AND id ≠ KEEP-payment` |
| `orders_v2` | 31 | `(meta::text ILIKE '%stripe%' OR provider='stripe') AND id ≠ KEEP-order` |
| `profiles` | 0 | все 4 связанных профиля — реальные |
| `bePaid*` | 0 | не трогаем |

KEEP-subscription `6c3cd3a5…` в наборе `test_subs` = 0 (verified).

## FK pre-flight (все hard-blockers = 0)

| FK | Action | Count |
|---|---|---:|
| `payment_reconcile_queue.processed_order_id` | NO ACTION | 0 |
| `payment_reconcile_queue.matched_order_id` | SET NULL | 0 |
| `site_form_submissions.order_id` | NO ACTION | 0 |
| `statement_lines.order_id` | NO ACTION | 0 |
| `statement_lines.payment_id` | NO ACTION | 0 |
| `product_reentry_pricing.source_subscription_id` | NO ACTION | 0 |
| `payments_v2.reference_payment_id` | NO ACTION | 0 |
| `installment_payments.order_id` | CASCADE | 0 |
| `generated_documents.order_id` | CASCADE | 0 |
| `telegram_access_queue.subscription_id` | SET NULL | 0 |
| `grace_notification_events.subscription_id` | CASCADE | 0 |

## Порядок DELETE (FK-safe)

1. `access_grant_ledger` (явный delete)
2. `entitlements` (явный delete; entitlement_orders → CASCADE)
3. `provider_subscriptions` (subscription_v2_id SET NULL не используем — удаляем явно)
4. `subscriptions_v2` (25; subscription_payment_credentials → CASCADE)
5. `payment_links` (13)
6. `provider_events` (122)
7. `payments_v2` (22; statement_lines pre-checked = 0)
8. `orders_v2` (31; payments_v2 children уже удалены, остальное CASCADE/SET NULL)

## Backup tables

Перед DELETE создаются `_stripe_cleanup_2026_06_backup_*` с полным снимком удаляемых строк, RETURNING-валидация через CTE-вставки в один migration.

## STOP-guards

Миграция прерывается через `RAISE EXCEPTION`, если:
- KEEP-id попал в выборку DELETE (assert после CTE);
- фактический count ≠ ожидаемому из таблицы выше;
- найдена строка с `cs_live_*` (кроме KEEP) или non-stripe provider.

## bePaid

Не затронут: все фильтры по `provider='stripe'` либо `meta ILIKE '%stripe%'`.
