# D5. Stripe Subscriptions — Webhook Plan + Lost Webhook Recovery (v1)

## Расширение `stripe-webhook`
Add-only ветки поверх Phase 2:

### Subscriptions
- `customer.subscription.created` → если pre-created `provider_subscriptions(pending)` с tracking_id найден → bind `provider_subscription_id`, status → `active|past_due|canceled` по `subscription.status`. Если pre-created нет → `manual_review` (no_pre_created_sub).
- `customer.subscription.updated` → обновление `meta.stripe.*` (period, cancel_at_period_end, default_payment_method), синхронизация status.
- `customer.subscription.deleted` → `subscriptions_v2.status=canceled`, `cancel_reason='stripe_subscription_deleted'`. Доступ не трогаем (GREATEST).
- `customer.subscription.paused | resumed` → not-MVP, audit only.

### Invoices
- `invoice.paid` → idempotent INSERT `orders_v2` по `invoice.id` → `grant-access-for-order`. Цена/период из invoice lines.
- `invoice.payment_failed` → `subscriptions_v2.status=past_due` + audit, без revoke.
- `invoice.payment_action_required` → audit + (опц.) email-нотификация через Portal-link.
- `invoice.voided | marked_uncollectible` → audit only.

### Schedules
- `subscription_schedule.created | updated` → snapshot `meta.installment.schedule_status`.
- `subscription_schedule.completed` → `subscriptions_v2.meta.installment.completed=true`, ожидание `customer.subscription.deleted`.
- `subscription_schedule.canceled | released` → audit + status sync.

### PaymentMethods / Customer
- `payment_method.attached | detached | updated` → snapshot `meta.stripe.default_payment_method`; **не** строим свой кабинет карт.
- `customer.updated` → опционально обновляем email-snapshot в `contacts.meta.stripe`.

### Billing Portal
- `billing_portal.session.created` → audit only.

## Идемпотентность
- Используется существующий `provider_events_idem_unique` на `(provider, event_id)`. Никаких новых таблиц.

## Резолв account_code
- Каждый Stripe-аккаунт = отдельный endpoint `stripe-webhook-<account_code>` ИЛИ единый endpoint + множество `STRIPE_WEBHOOK_SECRET_<ACCOUNT_CODE>`; первый успешный verify подписи определяет `account_code`. Решение в D10.
- INSERT в `subscriptions_v2`/`provider_subscriptions` мимо резолвера запрещён.

## Conflict policy → HTTP 200 + manual_review
- `no_pre_created_sub`
- `tariff_mismatch`
- `sbs_mismatch` (foreign customer_id / foreign account_code на known subscription)
- `foreign_account` (event прилетел на endpoint, чья `account_code` не совпадает с `subscriptions_v2.meta.account_code`)
- `unknown_invoice_no_subscription` (one-time invoice без subscription — пока не поддерживаем)

## Lost Webhook Recovery (обязательный раздел)
Система не должна зависеть исключительно от webhook (Phase 2 опыт: уже находили реальный баг с отсутствующим endpoint).

### Три пути восстановления состояния
1. **Webhook path** — основной realtime.
2. **Reconcile path** — `subscriptions-reconcile` (cron, существует) дополняется Stripe-ветками:
   - per `account_code` → `subscriptions.list({status:'all', limit:100, expand:['data.latest_invoice']})` для известных `customer_id`.
   - сверка `meta.stripe.*` + материализация пропущенных `invoice.paid` через канонический `grant-access-for-order`.
3. **Polling/event-replay fallback** — на случай длительного простоя:
   - `events.list({type:'invoice.paid', created:{gte:...}})` per account → проигрываем через тот же resolver.
   - admin-кнопка «Replay Stripe events for account_code X since T» (отдельный edge `stripe-events-replay`, в discovery — только спецификация).

### Гарантии
- Reconcile и replay идут через **тот же** `stripe-webhook`-резолвер (общий `_shared/stripe-subscription-resolver.ts`), чтобы поведение совпадало 1-в-1.
- Идемпотентность общая (`provider_events_idem_unique`).
- Никаких прямых INSERT в `entitlements`/`subscriptions_v2` мимо резолвера.

## SOT
- События = Stripe; материализация = наша БД через резолвер.

## Что хранится локально
- `provider_events` (как сейчас), `orders_v2`, `subscriptions_v2.meta.stripe.*`.

## Что хранится в Stripe
- Полный event-log (доступен через `events.list` в окне retention).

## Recovery
- Описан выше (Lost Webhook Recovery).

## Multi-account
- Резолвер endpoint→account_code; запрет cross-account записи; reconcile/replay параметризуется `account_code`.
