# D12. Stripe Data Ownership Matrix (v1)

## Матрица владения

| Сущность | Stripe | Наша БД | SOT |
|---|---|---|---|
| Customer | `cus_*` (email, name, payment_methods, default_pm) | `contacts.meta.stripe.customer_id_by_account` (ссылка per account) | **Stripe** |
| Payment Method (карта) | `pm_*` (brand, last4, exp, fingerprint, country) | (опц.) snapshot `last4/brand` в `contacts.meta.stripe.payment_methods_by_account` | **Stripe** |
| Setup Intent | `seti_*` (статус привязки) | audit only | **Stripe** |
| Checkout Session | `cs_*` (статус сессии, success/cancel) | `payment_links.meta.stripe.checkout_session_id` + `orders_v2.meta.stripe.checkout_session_id` | **Stripe** (по сессии); **наша БД** — по факту оплаты (orders_v2) |
| Subscription | `sub_*` (status, periods, default_pm, cancel_at_period_end) | `subscriptions_v2 + provider_subscriptions` (статус-кэш + meta.stripe.*) | **Stripe** (состояние); **наша БД** (бизнес-смысл, tariff, продукт) |
| Subscription Schedule | `sub_sched_*` (phases, iterations, end_behavior) | `subscriptions_v2.meta.stripe.schedule_id` + `meta.installment.{cycles_total,cycles_done}` | **Stripe** (расписание); **наша БД** (commercial wrapping) |
| Invoice | `in_*` (lines, amount, status, hosted_invoice_url, invoice_pdf) | `orders_v2.meta.stripe.invoice_id` (одна строка orders_v2 = один paid invoice) | **Stripe** (документ); **наша БД** (commercial order) |
| PaymentIntent | `pi_*` (status, charges, next_action) | `payments_v2.meta.stripe.payment_intent_id` | **Stripe** |
| Charge | `ch_*` (статус, метод, refunds) | `payments_v2.provider_payment_id = ch_*` | **Stripe** (платёжный объект); **наша БД** (commercial payment) |
| Refund | `re_*` (amount, status, reason) | refund-row через `record_refund_atomic_multi` (refund_uid = re_*) | **Stripe** (объект); **наша БД** (commercial recording) |
| Access (доступ пользователя к продукту) | — | `entitlements`, `access_grant_ledger`, `subscriptions_v2.access_end_at` | **Наша БД** |
| Entitlement (технический рендер access) | — | `entitlements` | **Наша БД** |
| Subscription Window (access_start_at/access_end_at) | (Stripe знает current_period_end, но это **не** SOT для нашего access) | `subscriptions_v2.access_start_at/end_at`, рассчитывается через `grant-access-for-order` (GREATEST) | **Наша БД** |

## Принципы разрешения конфликтов
- Любой конфликт между Stripe и нашей БД по **состоянию подписки** → доверяем Stripe; синхронизируем нашу БД, доступ не уменьшаем (GREATEST).
- Любой конфликт по **доступу** → доверяем нашей БД; Stripe не отзывает entitlements автоматически.
- Любой конфликт по **commercial wrapping** (tariff, product, order_id) → доверяем нашей БД; если Stripe metadata расходится — manual_review.

## SOT (обязательный раздел)
- См. колонку SOT матрицы.

## Что хранится локально
- См. колонку «Наша БД».

## Что хранится в Stripe
- См. колонку «Stripe».

## Recovery
- Восстановление состояния подписки: Stripe → reconcile → наша БД (D5).
- Восстановление доступа: наша БД самодостаточна; Stripe не источник для access.

## Multi-account
- Каждая ссылка из «Наша БД» → Stripe квалифицируется `account_code` (см. D10).
- Один пользователь может иметь несколько `cus_*` (по одному per account); они **не сливаются**.
