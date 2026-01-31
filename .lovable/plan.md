# Nightly мониторинг — Статус выполнения

## ✅ ЗАВЕРШЕНО (2026-01-31)

### Выполненные патчи

| # | Патч | Статус | Изменённые файлы |
|---|------|--------|------------------|
| 1 | PATCH-1: classifyPayment() — amount, currency, failed_purchase | ✅ | `_shared/paymentClassification.ts` |
| 2 | PATCH-2: Data-fix рекласификация | ✅ | SQL migrations |
| 3 | PATCH-3: INV-2B-WARN passed:true | ✅ | `nightly-payments-invariants/index.ts` |
| 4 | PATCH-4: backfill передаёт amount/currency | ✅ | `backfill-payment-classification/index.ts` |
| 5 | Origin normalization (68 записей) | ✅ | SQL migrations |
| 6 | RPC get_business_orphan_payments | ✅ | SQL migration |

---

## DoD Proofs (все проверки = 0)

```sql
-- 1. unclassified_2026 = 0 ✅
-- 2. orphan_with_order_2026 = 0 ✅
-- 3. business_orphans_INV2A = 0 ✅
```

### Classification Distribution 2026+

| Classification | Count |
|----------------|-------|
| orphan_technical | 2492 |
| card_verification | 285 |
| regular_purchase | 278 |
| refund | 111 |
| failed_purchase | 37 |
| subscription_renewal | 25 |

---

## Audit Logs (SYSTEM ACTOR proof)

```
action: data_fix.reclassify_payments_v2
actor_type: system
actor_label: nightly-monitoring-patch
created_at: 2026-01-31 21:12:32

action: data_fix.origin_normalization
actor_type: system
actor_label: nightly-monitoring-patch
created_at: 2026-01-31 16:31:50

action: backfill.payment_classification_complete
actor_type: system
actor_label: sql-migration-backfill
created_at: 2026-01-31 16:30:06
```

---

## Ключевые изменения

### 1. PaymentClassification — новый тип `failed_purchase`
- Платежи с `order_id` и `status='failed'` теперь классифицируются как `failed_purchase`
- Добавлена поддержка `amount` и `currency` в интерфейс

### 2. Правило 1 BYN → card_verification
- Только при `currency='BYN'`, `amount <= 1`, `order_id IS NULL`, `status='succeeded'`
- Refund'ы на 1 BYN правильно остаются как `refund`

### 3. INV-2A/2B разделение
- **INV-2A (STRICT FAIL)**: business payments без order = FAIL
- **INV-2B (CONTROL)**: technical orphans — только метрика
- **INV-2B-WARN**: threshold warning с `passed: true` (не ломает summary)

### 4. INV-8 строгий режим
- `passed = (unclassifiedCount === 0)` — FAIL если есть хотя бы 1 unclassified

---

## RLS Warnings (INFO-level, существующие)

3 таблицы с RLS enabled но без policies — это существующие warnings, не связанные с данной миграцией.
