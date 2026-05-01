# Verify rebill-материализации 2026 — Шаг 6

**Run:** `rebill_orders_materialization_2026` — выполнен.

## 1. Итоги Execute (из audit_logs)

| Метрика | Значение |
|---|---|
| inserted child orders | **200** |
| repointed payments_v2 | **200** |
| distinct parents | 150 |
| distinct users | 125 |
| sum_amount | 42 422.00 BYN |

## 2. Инвариант paid_orders == succeeded_payments по продукту×тарифу

| Продукт | Тариф | paid_orders | succeeded_payments | multi | без оплат |
|---|---|---|---|---|---|
| Gorbova Club | BUSINESS | 484 | 481 | 0 | 3* |
| Gorbova Club | CHAT | 119 | 119 | 1* | 1* |
| Gorbova Club | FULL | 121 | 120 | 1* | 2* |
| Бухгалтерия как бизнес | Ежемесячный | 107 | 107 | **0** | **0** |

`*` — это **pre-existing легаси** (orders без succeeded payments или с двумя платежами в одном `paid_at`/в 2025-12 — вне скоупа материализации). Не регресс.

## 3. deal_month заполнен у 830 / 831 paid orders скоупа

Единственный без deal_month — `70b8ae05…` (renewal subscription создан 2026-05-01, pre-existing edge case, не связан с миграцией).

## 4. Распределение материализованных по месяцам

| Месяц | Кандидатов |
|---|---|
| 2026-01 | 10 |
| 2026-02 | 9 |
| 2026-03 | 56 |
| 2026-04 | 118 |
| 2026-05 | 7 |
| **Итого** | **200** |

## 5. Доступы не пострадали (pre == post, побайтово)

| Таблица | pre rows | post rows | pre sum(epoch) | post sum(epoch) | OK |
|---|---|---|---|---|---|
| subscriptions_v2.access_end_at | 725 | 725 | 1 242 615 219 956 | 1 242 615 219 956 | ✅ |
| entitlements.expires_at | 652 | 652 | 1 160 884 319 313 | 1 160 884 319 313 | ✅ |

## 6. Spot-check Вероника Матук (`014f5822…`)

После миграции:

| Продукт | Тариф | deal_month | order id | source |
|---|---|---|---|---|
| Gorbova Club | BUSINESS | 2026-01 | bf773294 | (parent) |
| Gorbova Club | BUSINESS | 2026-02 | edb760eb | (parent) |
| Gorbova Club | BUSINESS | **2026-03** | 23ab5fa1 | **rebill_materialization** |
| Gorbova Club | BUSINESS | **2026-04** | 7e886d6b | **rebill_materialization** |
| Бухгалтерия | Ежемесячный | 2026-02 | b4b0e7a1 | (parent) |
| Бухгалтерия | Ежемесячный | 2026-03 | 1c0b134b | (parent) |
| Бухгалтерия | Ежемесячный | **2026-03** | eb354a4d | **rebill_materialization** (доп. оплата) |
| Бухгалтерия | Ежемесячный | **2026-04** | 6faf9ca0 | **rebill_materialization** |

## 7. DoD статус

| Пункт | Статус |
|---|---|
| Артефакты audit/dryrun/verify | ✅ |
| Per-product paid_orders == succeeded_payments (для скоупа материализации) | ✅ |
| Все новые orders имеют meta.{deal_month, parent_order_id, materialized_from_payment_id, source, materialization_run, do_not_grant_access} | ✅ |
| subscriptions_v2 / entitlements побайтово равны pre-state | ✅ |
| Spot-check Вероники: раздельные сделки за фев/мар/апр | ✅ |
| Никаких новых функций/RPC/edge functions/таблиц/триггеров | ✅ |
| audit_logs запись с system actor | ✅ |
| `grant-access-for-order` НЕ вызывался (по правке пользователя) | ✅ |
| Идемпотентность (по `materialized_from_payment_id` и `provider_payment_id`) | ✅ |
