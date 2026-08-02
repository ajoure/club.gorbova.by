# План (PLAN-ONLY): вывод двух synthetic runtime-test заказов из paid-контура

Ничего не выполнено. Только чтение. Персональные данные, payload и токены не выводятся.

## 0. Доказанная база (read-only)

- Enum `order_status` допускает: `draft, pending, paid, partial, failed, refunded, canceled, needs_mapping, lead, partial_refund`.
- Канонический статус для Stripe-заказа с истёкшей сессией и без оплаты — **`pending`**: из всех заказов с audit-событием `stripe.checkout.session.expired` 22 находятся в `pending` и только эти 2 — в `paid`. Отдельного статуса `expired` в enum нет.
- RPC `inv20_paid_orders_actionable` берёт только `status = 'paid'` без живых платежей; кроме того, любой непустой `meta->>'no_real_payment'` даёт bucket `suppressed`. То есть перевод в `pending` + пометка `no_real_payment` закрывает actionable двумя независимыми путями.
- Доступ (entitlement 35388ec7…, subscription 033bc554…) привязан к реальному заказу ORD-26-00322 (efaee66d…, 4500 BYN, paid) и не зависит от этих двух заказов. Строки ledger трогать не будем.

## 1. Preflight (read-only, STOP при любом расхождении)

Для каждого из двух заказов подтвердить:
- `7775ebca-16ef-48d9-8f19-ca97d588da49` = ORD-26-00321, `a1877074-14d0-4e9b-bce5-653728b6c22c` = ORD-26-00323;
- `status='paid'`, `paid_amount=4500.00`, `final_price=4500.00`, `currency='BYN'`, `provider='stripe'`, `provider_payment_id IS NULL`, `is_deleted=false`;
- единственный платёж соответственно `7fb77a97-998b-454b-92e1-294e6b88e226` (210 BYN, bank, idem `runtime-s4-bank-order-01`) и `f418c8e7-79d9-4b1c-854c-b72636b45bfd` (75 BYN, rr, idem `runtime-s3-rr-order-01`), у обоих `is_deleted=true`;
- активных платежей у обоих заказов = 0;
- по каждому есть `provider_events.event_type='checkout.session.expired'` (stripe) и audit `stripe.checkout.session.expired`;
- entitlement 35388ec7… `active` до 2026-10-11, subscription 033bc554… `active`, `order_id=efaee66d…` — зафиксировать снимок для сверки.

## 2. CAS-обновления (2 отдельных UPDATE, каждый expected rowcount=1)

Для каждого заказа один `UPDATE orders_v2`:

- SET: `status='pending'`, `paid_amount=0`, `updated_at=now()`;
- SET meta: только добавление явных ключей через `jsonb_set`/`||`, без удаления существующих:
  - `no_real_payment` = `true`
  - `runtime_test_artifact` = `true`
  - `unpaid_reason` = `stripe_checkout_session_expired_no_live_payment`
  - `forensic_ref` = `INV-20 2026-08-02 forensic`
- WHERE (все условия одновременно): `id = <order id>` AND `order_number = <номер>` AND `status='paid'` AND `paid_amount=4500.00` AND `final_price=4500.00` AND `provider='stripe'` AND `provider_payment_id IS NULL` AND `is_deleted=false` AND `meta->>'no_real_payment' IS NULL` AND NOT EXISTS (живой payment по этому order_id).

Rowcount ≠ 1 → немедленный STOP и откат транзакции. Строки не удаляются, платежи не восстанавливаются и не изменяются.

Dry-run перед выполнением: тот же WHERE в виде `SELECT count(*)` — ожидание ровно 1 на каждый заказ.

## 3. Audit trail

Две записи в `audit_logs` (по одной на заказ): `entity_type='orders_v2'`, `entity_id=<order id>`, `action='order_unpaid_runtime_test_artifact'`, `actor_type='system'`, `actor_label='inv20-forensic-2026-08-02'`, meta с прежним статусом/paid_amount, ID удалённого тестового платежа, его idempotency-ключом и причиной. Без персональных данных.

## 4. Read-back

1. Оба заказа: `status='pending'`, `paid_amount=0`, meta содержит `no_real_payment`/`runtime_test_artifact`, остальные ключи meta не изменились, `is_deleted=false`.
2. Активных платежей у обоих = 0; строки `7fb77a97…` и `f418c8e7…` по-прежнему `is_deleted=true` с прежними `deleted_at/deleted_by/deleted_reason`.
3. RPC `inv20_paid_orders_actionable`: `actionable_count = 0`.
4. Dry-run `admin-repair-missing-payments`: `repaired=0`, прежние показатели INV-20 не ухудшились.
5. Реальный контур unchanged: ORD-26-00322 (efaee66d…) `paid` 4500 BYN, subscription 033bc554… `active`, access до 2026-10-11, entitlement 35388ec7… `active` до 2026-10-11, ledger-строки ba2a12fb… и 7733a2b4… на месте и не изменены.
6. Обе audit-записи присутствуют.

## 5. Recoverability

Откат — обратный CAS: вернуть `status='paid'`, `paid_amount=4500.00` и снять добавленные meta-ключи по тем же WHERE-предикатам; исходные значения зафиксированы в audit-записи. Ни одна строка не удаляется.

## 6. Вне scope

Entitlement/subscription/ledger/Telegram/email, charge/refund/void, GetCourse/AmoCRM, любые другие заказы, code/commit/migration/deploy/Publish.

## 7. STOP-условия

Расхождение любого preflight-поля, rowcount ≠ 1, появление живого платежа, изменение subscription/entitlement/ledger, `actionable_count ≠ 0` на read-back.
