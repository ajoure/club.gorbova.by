# Partial Refund Classifier v2 — proof (no double-count)

## Формула
- paidSum = Σ amount где amount>0 И НЕ refund-row И status∈{paid,succeeded,refunded}
- parentRefundedSum = Σ refunded_amount по non-refund payments
- legacyRefundedSum = Σ |amount| по refund-rows, у которых parent не найден ИЛИ parent.refunded_amount ≤ 0
- refundedSum = parentRefundedSum + legacyRefundedSum

## Кейсы

### 1) Legacy `#SUB-LINK-MNIQS4P0`
Payments:
- p1: amount=250, status=paid, refunded_amount=0
- p2: amount=250, status=paid, refunded_amount=0
- r1 (legacy): amount=-80, meta.type='refund', meta.parent_payment_id=null/нет parent

Расчёт:
- paidSum = 250+250 = **500**
- parentRefundedSum = 0
- legacyRefundedSum = 80 (parent не найден → fallback)
- refundedSum = **80**
- 80 < 500 → **«Частичный возврат»** ✅

### 2) New canonical partial refund
Payments:
- p1: id=A, amount=250, refunded_amount=80
- r1: amount=-80, transaction_type='refund', meta.parent_payment_id=A

Расчёт:
- paidSum = **250**
- parentRefundedSum = 80
- legacyRefundedSum = 0 (parent A найден, refunded_amount=80>0 → пропуск)
- refundedSum = **80** (НЕ 160) ✅
- 80 < 250 → **«Частичный возврат»** ✅

### 3) New canonical full refund
Payments:
- p1: id=A, amount=250, refunded_amount=250
- r1: amount=-250, transaction_type='refund', meta.parent_payment_id=A

Расчёт:
- paidSum = 250
- parentRefundedSum = 250
- legacyRefundedSum = 0
- refundedSum = **250**
- 250 ≥ 250 → **«Возврат»** (red) ✅

### 4) Mixed (canonical + orphan legacy)
Payments:
- p1: id=A, amount=200, refunded_amount=50
- r1: amount=-50, meta.parent_payment_id=A (canonical pair)
- r2: amount=-30, meta.type='refund', без parent_payment_id (orphan legacy)

Расчёт:
- paidSum = 200
- parentRefundedSum = 50
- legacyRefundedSum = 30 (orphan)
- refundedSum = **80** ✅
- 80 < 200 → «Частичный возврат» ✅

## DoD
- ✅ Legacy `#SUB-LINK-MNIQS4P0`: amber badge
- ✅ Новый partial: refundedSum не задвоен
- ✅ Full refund: red badge
- ✅ Memory rule обновлён: запрет double-count
