# Аудит rebill-платежей 2026 — Шаг 1

**Run:** `rebill_orders_materialization_2026`
**Скоуп:** Gorbova Club (`11c9f1b8…`) + Бухгалтерия как бизнес (`85046734…`), `[2026-01-01; 2027-01-01)`, `paid` orders, `succeeded` payments, исключая synthetic (rule_engine).

## 1. Сводка по продукту × тарифу

| Продукт | Тариф | paid_orders | succeeded_payments | Δ |
|---|---|---|---|---|
| Gorbova Club | BUSINESS | 362 | 481 | +119 |
| Gorbova Club | CHAT | 92 | 119 | +27 |
| Gorbova Club | FULL | 97 | 120 | +23 |
| Бухгалтерия как бизнес | Ежемесячный доступ | 80 | 107 | +27 |
| **ИТОГО** | | **631** | **827** | **+196** |

## 2. Финальное правило отбора rebill-кандидатов

Для каждого `orders_v2`:
- ранжируем все `payments_v2` со `status='succeeded'` по `paid_at, id`;
- `rn=1` — **первый платёж**, остаётся на parent;
- `rn>1` — **rebill-кандидаты** на материализацию в child-orders;
- дополнительный фильтр: `paid_at` в 2026-м году (страховка от легаси).

## 3. Кандидаты к материализации (после идемпотентности)

| Метрика | Значение |
|---|---|
| Всего к материализации | **200** |
| Уже материализовано (skip) | 0 |
| Без provider_payment_id (admin manual) | 18 |
| С provider_payment_id (bePaid rebill) | 182 |
| Уникальных parent-orders | 126 |
| Уникальных пользователей | 112 |

### Распределение по deal_month (Europe/Minsk)

| Месяц | Кандидатов |
|---|---|
| 2026-01 | 10 |
| 2026-02 | 9 |
| 2026-03 | 56 |
| 2026-04 | 118 |
| 2026-05 | 7 |

### Pipeline/stage у parent-ордеров

- 126 / 126 имеют `pipeline_id` и `pipeline_stage_id` → копируем в child-orders.

## 4. Pre-state контрольные суммы (для сверки на Шаге 6)

Юзеры в скоупе rebill-кандидатов (112 users):

| Таблица | Rows | sum(epoch even-time) |
|---|---|---|
| subscriptions_v2 (access_end_at) | 660 | 1129125365741 |
| entitlements (expires_at) | 595 | 1059390108283 |

Эти суммы НЕ должны измениться после Execute.

## 5. Spot-check: Вероника Матук (`014f5822…`)

| Продукт | Tariff | parent.deal_month | parent_order | payment.paid_at (UTC) | pay_month (Minsk) | action |
|---|---|---|---|---|---|---|
| Gorbova Club | BUSINESS | 2025-10 | a2c67bf6 | 2025-10-13 19:45 | 2025-10 | KEEP_ON_PARENT |
| Gorbova Club | BUSINESS | 2025-11 | 106f80aa | 2025-11-10 19:45 | 2025-11 | KEEP_ON_PARENT |
| Gorbova Club | BUSINESS | 2025-12 | 29a33aa7 | 2025-12-08 19:45 | 2025-12 | KEEP_ON_PARENT |
| Gorbova Club | BUSINESS | 2026-01 | bf773294 | 2026-01-09 07:30 | 2026-01 | KEEP_ON_PARENT |
| Gorbova Club | BUSINESS | 2026-02 | edb760eb | 2026-02-09 15:18 | 2026-02 | KEEP_ON_PARENT |
| Gorbova Club | BUSINESS | 2026-02 | edb760eb | 2026-03-11 15:30 | **2026-03** | **MATERIALIZE** |
| Gorbova Club | BUSINESS | 2026-02 | edb760eb | 2026-04-10 15:30 | **2026-04** | **MATERIALIZE** |
| Бухгалтерия | Ежемесячный | 2026-02 | b4b0e7a1 | 2026-02-04 18:18 | 2026-02 | KEEP_ON_PARENT |
| Бухгалтерия | Ежемесячный | 2026-03 | 1c0b134b | 2026-03-01 20:33 | 2026-03 | KEEP_ON_PARENT |
| Бухгалтерия | Ежемесячный | 2026-03 | 1c0b134b | 2026-03-31 20:45 | 2026-03 | **MATERIALIZE (доп. оплата)** |
| Бухгалтерия | Ежемесячный | 2026-03 | 1c0b134b | 2026-04-30 20:45 | **2026-04** | **MATERIALIZE** |

После материализации Вероника увидит:
- Gorbova Club / BUSINESS: отдельные сделки за 2026-03 и 2026-04;
- Бухгалтерия: доп. сделка за март (двойное списание) и сделка за 2026-04.

## 6. STOP-условия для Шага 3 (Execute)

- Любая запись в `subscriptions_v2.access_end_at` или `entitlements.expires_at` уменьшилась → ROLLBACK.
- COUNT новых orders ≠ 200 → ROLLBACK.
- Дубль `(provider, provider_payment_id)` в orders_v2 → ROLLBACK.
- Любой child-order имеет `tariff_id`, не входящий в множество tariff_id parent-ов → ROLLBACK.
- Любой `meta.deal_month` пуст или невалиден → ROLLBACK.
