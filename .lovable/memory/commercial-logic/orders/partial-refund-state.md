---
name: Partial Refund State (writer + classifier)
description: Canonical refund-row format в payments_v2, расчёт partial vs full по paidSum/refundedSum, поддержка legacy формата в UI
type: feature
---

## Writer (subscription-admin-actions[refund])

При успешном refund в bePaid:

1. **Refund-row в `payments_v2`** (canonical):
   - `transaction_type='refund'`
   - `status='refunded'`
   - `amount = -actualRefundAmount`
   - `meta.type='refund'`
   - `meta.parent_payment_id` — внутренний `payments_v2.id` родителя
   - `meta.parent_payment_uid` — `provider_payment_id` родителя (для bePaid links)
   - `meta.refund_status` — `'partial' | 'full'`
   - `provider_payment_id` — `uid` refund-транзакции в bePaid

2. **Parent payment**:
   - `refunded_amount = COALESCE(refunded_amount, 0) + actualRefundAmount`

3. **`orders_v2`**:
   - Если `totalRefundedAfter < paidSum`: `status='paid'` (не `refunded`!)
   - Если `totalRefundedAfter >= paidSum`: `status='refunded'`
   - В `meta`: `partial_refund_total`, `paid_sum`, `refund_status='partial'|'full'`

4. **Audit**: `admin.subscription.refund_recorded` с `refund_status`, `paid_sum`, `total_refunded_after`, `parent_payment_id`, `new_order_status`.

## Classifier (UI: DealDetailSheet)

`isPartialRefund` / `isFullRefund` считается коммерчески, **не зависит от `orders_v2.status`**:

- `paidSum = Σ amount` где `amount > 0` И НЕ refund-row И `status ∈ {paid, succeeded, refunded}`
- `refundedSum = parentRefundedSum + legacyRefundedSum`, где:
  - `parentRefundedSum = Σ p.refunded_amount` по non-refund payments (canonical, Patch 2)
  - `legacyRefundedSum = Σ |amount|` по refund-rows, у которых parent НЕ найден ИЛИ `parent.refunded_amount <= 0`
- **НИКОГДА** не суммировать одновременно `parent.refunded_amount` и `|refund-row.amount|` за один и тот же refund — это double-count. Canonical writer (Patch 2) пишет ОБА признака; legacy писал только refund-row.
- refund-row детектируется по: `transaction_type` содержит `refund`/`возврат`, ИЛИ `meta.type='refund'`, ИЛИ `amount < 0`
- parent резолвится через `meta.parent_payment_id` (внутренний id) или `meta.parent_payment_uid` (provider id)
- `isPartialRefund = refundedSum > 0 && paidSum > 0 && refundedSum + 0.01 < paidSum` → amber «Частичный возврат»
- `isFullRefund = refundedSum > 0 && paidSum > 0 && refundedSum + 0.01 >= paidSum` → red «Возврат»

## Multi-payment-per-deal (rebill контекст)

Внутри одной `orders_v2` допустимы несколько `payments_v2` rows:
- recurring rebills (исторически — все prikолочены к исходному link-order; см. open future-sprint про «1 платёж = 1 сделка»)
- refund-rows как пара к parent payment

Правило «1 платёж = 1 сделка» отложено в отдельный sprint, требует переработки связи `subscriptions_v2.order_id ↔ grant-access-for-order`. Не реализовывать спонтанно — сломает extend-логику подписок.

## Legacy compatibility

Существующие сделки до 2026-05 могут содержать refund-row в формате:
- `amount=-X`, `status='succeeded'`, `transaction_type='payment'`, `meta.type='refund'`

Classifier обязан корректно их распознавать и показывать «Частичный возврат» / «Возврат» по той же формуле paidSum/refundedSum.

## Why

`subscription-admin-actions` ранее писал refund как `status='succeeded'` без `refunded_amount` на родителе и без `transaction_type='refund'`. UI считал refundedSum=0 и показывал «Возврат» даже когда возврат был частичным. Кейс `#SUB-LINK-MNIQS4P0` — refund 80 BYN из 250+250 paid → должен был быть amber «Частичный возврат», вместо этого показывался красный «Возврат».
