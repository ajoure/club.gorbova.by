# D10. Multi-Account Stripe Architecture (v1)

## Multi-Stripe

### account_code как SOT
- Уникальный код Stripe-аккаунта: `stripe_poland`, `stripe_eu`, `stripe_usa`, `stripe_<entity>`.
- SOT хранится в `provider_subscriptions.meta.account_code`, `payments_v2.meta.account_code`, `orders_v2.meta.account_code`, `payment_links.account_code` (add-only nullable колонка в Phase 3.1).
- Никакая точка кода не предполагает единственность Stripe.

### Резолв секретов
- Convention: `STRIPE_SECRET_KEY_<ACCOUNT_CODE_UPPER>`, `STRIPE_WEBHOOK_SECRET_<ACCOUNT_CODE_UPPER>`, `STRIPE_PUBLISHABLE_KEY_<ACCOUNT_CODE_UPPER>`.
- Fallback на глобальные `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` только при `account_code === null` (legacy/initial).
- Хелпер `_shared/acquiring/secrets.ts` (план в 3.1).

### Customer per account
- `contacts.meta.stripe.customer_id_by_account = { "<account_code>": "cus_*" }`.
- Один пользователь = разные `Customer` в разных аккаунтах. Никогда не пересчитываем/не сливаем.

### Webhook routing
- Рекомендация: **отдельный URL per account_code** — `https://.../functions/v1/stripe-webhook-<account_code>` (тонкая обёртка над общим резолвером), либо path-параметр `stripe-webhook/<account_code>`.
- Альтернатива (если URL ограничены): единый endpoint + перебор `STRIPE_WEBHOOK_SECRET_*` до первого successful verify → определяет `account_code`.

### Provider subscription id per account
- `provider_subscriptions.provider_subscription_id` — `sub_*` в рамках конкретного аккаунта.
- (Опционально) snapshot `meta.provider_subscription_id_by_account` для cross-account audit; не SOT.

### Аналитика и фильтры
- Все админ-списки имеют фильтр по `account_code`.
- Разрезы выручки и подписок: `account_code`, `business_stream`, `product`, `tariff`.

## Multi-Business Stream (обязательный раздел)

### Принцип
Один Stripe-аккаунт может обслуживать несколько бизнес-направлений (`business_stream`):
- `consultations` (пилот)
- `club`
- `education`
- `products` (future)

### Правила
- `account_code ≠ business_stream`.
- Один `account_code` может обслуживать много `business_stream`.
- Один `business_stream` со временем может переехать на другой `account_code` (через cancel→supersede→new на уровне подписок; см. D9).
- `business_stream` хранится в `payment_links.business_stream`, `orders_v2.meta.business_stream`, `subscriptions_v2.meta.business_stream`, `payments_v2.meta.business_stream`. (Add-only; уже частично существует — см. `business_stream_classification_v1.md`.)

### Аналитика (обязательная мульти-разрезность)
Финансовая аналитика поддерживает одновременно:
- `provider` (stripe / bepaid)
- `account_code` (stripe_poland / stripe_eu / ...)
- `business_stream` (consultations / club / ...)
- `product`
- `tariff`

Любой отчёт должен уметь группировать/фильтровать по комбинации этих измерений.

## SOT
- `account_code` и `business_stream` = наша БД (meta+payment_links).
- `customer_id`, `subscription_id` = Stripe per account.

## Что хранится локально
- `payment_links.account_code` (Phase 3.1 add-only), `*.meta.account_code`, `*.meta.business_stream`, `contacts.meta.stripe.customer_id_by_account`.

## Что хранится в Stripe
- Customer/Subscription/Invoice/PaymentMethod per account, изолированно.

## Recovery
- Reconcile параметризуется `account_code`; запуск per account.
- Список аккаунтов держим в коде/секретах (а не БД) — convention-driven.

## Multi-account
- Это и есть тема документа. См. правила выше.
