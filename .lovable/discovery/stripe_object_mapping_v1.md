# Discovery: маппинг сущностей нашей системы ↔ Stripe

Дата: 2026-06-02. Цель — снизить риск архитектурных ошибок Фазы 1/2 за счёт раннего фиксирования соответствий.

## 1. Таблица соответствий

| Наша система | Stripe | Связь | Где хранится Stripe ID |
|---|---|---|---|
| `products` (1 запись) | `Product` (`prod_*`) | 1:1 per (product, account_code) | `provider_product_mappings.stripe_product_id` (Phase 2) |
| `tariff_offers` (1 запись) | `Price` (`price_*`) | 1:1 per (offer, currency, account_code) | `tariff_offers.meta.stripe.price_id` |
| `payment_links` | `Checkout Session` (`cs_*`) — создаётся при каждом клике | 1:N (одна ссылка → много сессий) | `payments_v2.meta.stripe.checkout_session_id` |
| `orders_v2` | `PaymentIntent` (`pi_*`) + `metadata.order_id` | 1:1 | `orders_v2.provider_payment_id` (существующее поле) |
| `subscriptions_v2` | `Subscription` (`sub_*`) | 1:1 | `provider_subscriptions.provider_subscription_id` (существующее) |
| `provider_subscriptions` | `Subscription` (`sub_*`) | 1:1 | `provider_subscription_id` |
| `payments_v2` (одна запись) | `Charge` (`ch_*`) + `PaymentIntent` (`pi_*`) | 1:1 | `payments_v2.provider_payment_id` + `meta.stripe.charge_id` |
| `payments_v2.refunds[]` | `Refund` (`re_*`) | 1:N per payment | `refunds[].refund_uid = re_*` |
| Customer (внутренний contact_id) | `Customer` (`cus_*`) | 1:1 per (contact, account_code) | `contacts.meta.stripe.customer_id_by_account` (Phase 2) |

## 2. Особенности

### 2.1. Product 1:1 per account
Один и тот же наш `product_id` мапится на разные Stripe `Product` в разных аккаунтах. Поэтому Phase-2 таблица `provider_product_mappings` имеет уникальный ключ `(product_id, provider, account_code)`.

### 2.2. Price иммутабелен в Stripe
Stripe `Price` нельзя изменить (только архивировать и создать новый). При смене суммы/валюты в `tariff_offers` — создаём новый Stripe Price и переключаем `tariff_offers.meta.stripe.price_id`. Старый помечается `archived` в Stripe.

### 2.3. PaymentIntent ↔ Order
`PaymentIntent.metadata.order_id = orders_v2.id`. Это primary lookup при webhook-ingest. Гарантия уникальности достигается idempotency-key `${order_id}:${attempt}`.

### 2.4. Subscription vs Subscription Schedule
- Бесконечная recurring → обычный `Subscription`.
- Finite (installment N циклов) → `Subscription Schedule` с фазой `iterations=N, end_behavior=cancel`.
- В обоих случаях запись в `provider_subscriptions.provider_subscription_id = sub_*`.

### 2.5. Refund
Каждый `Refund` (`re_*`) от Stripe идёт через canonical `record_refund_atomic(refund_uid='re_*')`. Memory: `refund-canonical-write-path`. Никаких прямых INSERT в `payments_v2.refunds`.

### 2.6. Customer
Один Stripe Customer на пару (contact_id, account_code). Хранится в `contacts.meta.stripe.customer_id_by_account = { stripe_poland: 'cus_xxx' }`. Создаётся lazy при первой подписке/сохранении карты.

## 3. Mismatch-точки (риски)

| Риск | Как избежать |
|---|---|
| Один наш `product_id` → разные Stripe Products в разных аккаунтах путаются | unique ключ `(product_id, account_code)` + audit на mismatch |
| Stripe `Price` имеет другую валюту, чем `tariff_offers.amount` | резолвер блокирует checkout с явной ошибкой `price_currency_mismatch` |
| `PaymentIntent` без `order_id` в metadata | webhook отвечает 200 + audit `stripe_intent_no_order_id` + manual_review |
| Дубль `re_*` в record_refund | idempotency by `refund_uid` (уже есть) |
| Subscription создан в одном аккаунте, charge приходит из другого | webhook резолвит `account_code` по signing secret эндпоинта, не доверяет metadata |

## 4. DoD
- ✅ Все 8 ключевых сущностей замаплены.
- ✅ Особенности (immutable Price, 1:1 per account) зафиксированы.
- ✅ Mismatch-риски с mitigations описаны.
