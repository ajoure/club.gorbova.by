---
name: Partial Refund State (writer + classifier)
description: Canonical refund-row format в payments_v2, расчёт partial vs full по paidSum/refundedSum, поддержка legacy формата в UI
type: feature
---

## Writer (subscription-admin-actions[refund]) — atomic via RPC

После успешного refund в bePaid вся DB-часть выполняется в одной транзакции через RPC `public.record_refund_atomic(order_id, parent_payment_id, amount, refund_uid, reason, actor_uid, target_uid, bepaid_response)`:

1. **Идемпотентность**: refund-row с тем же `provider_payment_id=refund_uid` и `transaction_type='refund'` уже существует → RPC возвращает `{idempotent:true}`, ничего не пишет повторно. parent.refunded_amount НЕ инкрементируется второй раз.
2. **Lock**: `FOR UPDATE` на `payments_v2` (parent) и `orders_v2`.
3. **Refund-row** в `payments_v2`: `transaction_type='refund'`, `status='refunded'`, `amount=-actualRefundAmount`, `provider='bepaid'`, `provider_payment_id=refund_uid`; `meta`: `type='refund'`, `parent_payment_id`, `parent_payment_uid`, `reason`, `refund_status`, `bepaid_response`.
4. **Parent payment**: `refunded_amount = COALESCE(refunded_amount,0) + amount`.
5. **`orders_v2`**: `status='paid'` если partial, `'refunded'` если full. `meta` дополняется `partial_refund_total`, `paid_sum`, `refund_status`, `refund_amount`, `refund_reason`, `refunded_at`, `refunded_by`, `bepaid_refund`.
6. **Audit**: `admin.subscription.refund_recorded` пишется в той же транзакции.

**Hard error policy**: если RPC вернул error — edge function НЕ считает refund записанным, пишет audit `admin.subscription.refund_db_recording_failed` (с `bepaid_refund_uid` и `requires_manual_repair:true`) и возвращает HTTP 500.

`parentBumpError as non-fatal` — **запрещено**. Раздельные TS-операции `insert refund-row` + `update parent` + `update order` после bePaid refund — **запрещено**. Только атомарный RPC.

**Fallback (no-bepaid path)**: если parent не имеет `provider_payment_id` (bePaid пропущен), обновляем только `orders_v2` с `meta.no_bepaid_payment=true`. Hard error если update упал.

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
