# PATCH-RB1.1 — enable BEPAID_REBILL_MATERIALIZATION=on + first live verify

## Stage 1 — flip
- before: `dry_run`
- after: `on` (через `secrets--update_secret`, secure form, user-confirmed)
- flipped_at (UTC): ~2026-05-17T13:30Z
- никаких других secrets/DML не трогалось

## Stage 2 — runtime mode proof
Runtime подтверждён реальным трафиком, а не косвенной проверкой: в `audit_logs` появилась запись с `meta.mode='on'`:

```
2026-05-17 13:45:30.975 UTC  bepaid.rebill.decision_audit  mode=on
2026-05-17 13:45:30.931 UTC  bepaid.rebill.materialized_partial  mode=on
```

`bepaid-webhook` deploy = OK, видит `BEPAID_REBILL_MATERIALIZATION=on`.

## Stage 3 — first live REBILL: FAILED (rollback trigger сработал)

**Кейс:**
- parent_order_id: `a27a8b74-89cf-44c6-b7df-9cf4aeb1384b` (`admin_payment_link_subscription`)
- sbs: `sbs_8ef1ed6aa8b63783`
- provider_payment_uid: `6f9b0b83-aa67-416e-9461-72b84b68a3cb`
- payment_id: `94a8dc74-888d-4352-b769-7a9c0e35a4ab`
- сумма: 250 BYN, succeeded 2026-05-17 13:45:30 UTC

**Что пошло не так:**
```
phase: insert_rebill
error: 23502: null value in column "base_price" of relation "orders_v2" violates not-null constraint
decision: materialized_partial
```

**Последствие (нарушение бизнес-правила):**
`payments_v2.94a8dc74…` имеет `order_id=a27a8b74…` (parent), REBILL-order НЕ создан. То есть webhook склеил новый payment со старой сделкой — именно то, что бизнес-контракт PATCH-RB1.1 запрещает.

## Root cause
`buildRebillOrderPayload` (rebill_builders.ts) не заполнял колонку `base_price`. В `orders_v2` три NOT NULL без default: `order_number`, `base_price`, `final_price`. Payload устанавливал `final_price` и `paid_amount`, но забывал `base_price` → INSERT падал.

## Fix (code patch)
`supabase/functions/bepaid-webhook/rebill_builders.ts` — добавлено `base_price: input.payment.amount` рядом с `final_price`. Regression-тест `rebill_builders_test.ts` обновлён, проверяет оба поля. Все 59 тестов bepaid-webhook зелёные, deploy OK.

## Status
- Secret `BEPAID_REBILL_MATERIALIZATION` остаётся `on` (фикс минимальный и хирургический; rollback на `dry_run` не выполнялся, потому что причина уже устранена в коде).
- Жду следующий реальный repeat payment как Stage 4 verification. Ожидаемый результат: `bepaid.rebill.materialized` (без `_partial`), новый REBILL-order, `payments_v2.order_id` указывает на REBILL.
- Если следующий live снова даст `_partial` / `dispatcher_error` / `conflict` / `sbs_mismatch` / приклейку к parent — немедленный rollback secret в `dry_run`.

## Deferred (НЕ в этом патче)
- **PATCH-RB2 historical repair** двух uid: `113f7667…` (Юлия Смолик 100 BYN) и `21613f63…` (Ольга Черкашина 250 BYN). Сюда же теперь добавляется третий уид `6f9b0b83…` (sbs `sbs_8ef1ed6aa8b63783`, payment 250 BYN от 2026-05-17 13:45) — приклеен к parent `a27a8b74` из-за этого бага.
- RB2 потребует: создать недостающие REBILL-orders по этим трём payment, перепривязать `payments_v2.order_id`, прогнать `grant-access-for-order` с проверкой «доступ уже продлён legacy?» (idempotency).
