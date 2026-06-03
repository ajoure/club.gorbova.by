# D4. Stripe Subscription Lifecycle Contract (v1)

## Источник истины по подписке (обязательный раздел)

- **Stripe** — SOT по состоянию Stripe-подписки/расписания (`status`, `current_period_*`, `cancel_at_period_end`, `default_payment_method`).
- **Наша БД** — SOT по доступу пользователя (`entitlements`, `access_grant_ledger`, `subscriptions_v2.access_end_at`).
- **Правила разрешения конфликтов:**
  - Stripe `active` + доступ закрыт → восстановление доступа через `grant-access-for-order` по последнему оплаченному `Invoice` (или manual reissue).
  - Stripe `canceled` + доступ открыт → доступ сохраняется до `entitlements.expires_at` (GREATEST), новых продлений нет; по истечении — естественное закрытие.
  - Stripe `unpaid`/`past_due` + доступ открыт → grace по нашим правилам; revoke только после исчерпания grace.
  - Любая ситуация, не покрытая правилами выше (например, Schedule `released` без явной причины, чужой `customer_id` для нашего user_id) → HTTP 200 + `manual_review`, никаких автоматических действий.

## Жизненный цикл

### Create (infinite Subscription)
1. Pre-create `subscriptions_v2 (status=pending)` + `provider_subscriptions(status=pending, provider='stripe', meta.account_code, meta.tracking_id='stripe_sub:pending:order:<order_id>')`.
2. Stripe API: `customers.create_or_retrieve` per `account_code` → `subscriptions.create({customer, items:[{price}], payment_behavior:'default_incomplete', collection_method:'charge_automatically', metadata:{tracking_id, account_code, user_id, product_id, tariff_id, offer_id, order_id}})`.
3. Возвращаем клиенту `latest_invoice.payment_intent.client_secret` (Stripe Elements) либо открываем Checkout Session с `mode=subscription`.
4. Первый `invoice.paid` → webhook → `grant-access-for-order` → `subscriptions_v2.status=active`.
5. Tracking_id обновляется на `stripe_sub:{sub_id}:order:{first_order_id}`.

### Create (finite/installment Schedule)
1. Pre-create по той же схеме, плюс `meta.installment = {cycles_total:N, cycles_done:0}`.
2. Stripe API: `subscription_schedules.create({customer, start_date:'now', end_behavior:'cancel', phases:[{items:[{price, quantity:1}], iterations:N}], metadata:{tracking_id, account_code, ...}})`.
3. Каждый `invoice.paid` (включая первый) → `orders_v2` + `grant-access-for-order` + инкремент `meta.installment.cycles_done`.
4. После N-й итерации Stripe сам шлёт `subscription_schedule.completed` + `customer.subscription.deleted`.

### Renewal (infinite)
- `invoice.paid` → новый `orders_v2` (idempotent by `invoice.id`) → `grant-access-for-order` → extend `subscriptions_v2.access_end_at` через стандартный `provider-linked-extend-priority` + `extend-tariff-match-required`.

### Failure
- `invoice.payment_failed` → `subscriptions_v2.status=past_due`. Доступ НЕ отзывается в grace.
- Smart Retries управляются Stripe. По исчерпании — `customer.subscription.updated → status=unpaid` или `canceled` (по настройке Stripe → defaults).

### Cancel / Supersede
- **Self-cancel через Customer Portal:** webhook `customer.subscription.updated` с `cancel_at_period_end=true` → `subscriptions_v2.meta.cancel_at_period_end=true`, статус остаётся `active` до конца периода; затем `customer.subscription.deleted` → `status=canceled`.
- **Admin/cross-provider migration:** см. D9 — обязательный protocol `cancel → supersede → create new`.

### tracking_id mapping
- Subscription: `stripe_sub:{sub_id}:order:{order_id}`
- Schedule: `stripe_sched:{sched_id}:sub:{sub_id}:order:{order_id}`
- Идемпотентность webhook → `provider_events_idem_unique` по `event.id`.

## SOT
- См. раздел выше.

## Что хранится локально
- `subscriptions_v2`, `provider_subscriptions`, `orders_v2`, `payments_v2`, `entitlements`, `access_grant_ledger` — без изменений схемы; расширение только через `meta.stripe.*` / `meta.installment.*`.

## Что хранится в Stripe
- Customer, Subscription, Subscription Schedule, Invoice, PaymentIntent, Charge, Refund, PaymentMethod.

## Recovery
- См. D5 (webhook recovery) + `subscriptions-reconcile` Stripe-ветка.
- При материализации пропущенного `invoice.paid` reconcile должен использовать тот же канонический путь (orders_v2 → grant-access-for-order), без прямых INSERT в `entitlements`.

## Multi-account
- Каждый шаг lifecycle резолвит секреты Stripe и customer_id через `account_code` (D10).
- Conflict «event пришёл на endpoint аккаунта A, а `subscriptions_v2` принадлежит аккаунту B» → HTTP 200 + `manual_review`, никаких записей.
