# Open questions: Stripe integration v2 (заменяет v1)

Дата: 2026-06-02. Список открытых вопросов перед Фазой 1/2.

## Q1 — Аккаунты
Подтвердить:
- единственный аккаунт на старте = **Stripe Poland**, `account_code='stripe_poland'`;
- multi-account реализация НЕ требуется на старте, но архитектура future-ready;
- per-account env-naming convention: `STRIPE_SECRET_KEY` (single-account fallback) + `STRIPE_SECRET_KEY_<ACCOUNT_CODE>` в будущем.

## Q2 — Pilot scope (Фаза 2)
Список products/tariffs для пилота Stripe. Предложение:
- 1× one-time digital product (например, документ из «Идеология») в EUR;
- 1× recurring (Club) в EUR — отложить до Phase 2 расширенной.

Ждём решение пользователя.

## Q3 — Стартовые профили
Подтвердить набор inline-профилей (из `payment_provider_profiles_model_v1.md`):
- `stripe_standard_eur`
- `stripe_standard_pln`
- `stripe_standard_usd`
- `stripe_subscription_eur`

Удалены из v1: `stripe_standard_byn`, `stripe_standard_rub` — до подтверждения discovery валют.

## Q4 — Ключи и webhook
Discovery v1.1 НЕ требует создания Restricted Key заранее. Старт через стандартный Secret Key.

Открытые подвопросы (для отдельного решения):
- Какие именно scopes нужны на post-MVP (для Restricted Key)?
- Нужен ли отдельный Webhook Signing Secret per environment (test/live)?
- На какой URL регистрировать webhook (наш домен gorbova.by? edge function url?) — фиксируется в Фазе 2 при настройке `stripe-webhook`.

На старте достаточно: `STRIPE_SECRET_KEY` (live), `STRIPE_PUBLISHABLE_KEY` (live), `STRIPE_WEBHOOK_SECRET` (после регистрации endpoint).

## Q5 — business_stream mapping
Приложить итоговую таблицу `product_id → business_stream` для всех 18 продуктов (черновик в `business_stream_classification_v1.md` §3). Ждём подтверждения/правок от пользователя.

## Q6 — Валюты (зависит от discovery API)
Discovery в Фазе 1 покажет, какие валюты реально доступны на Stripe Poland (см. `stripe_currency_support_v1.md`). Решение:
- если EUR/PLN/USD доступны — активируем профили в Фазе 2;
- если BYN/RUB недоступны — UI автоматически предлагает bePaid для этих валют, профили не создаём.

## Q7 — Receipt language / branding
В каком языке Stripe email receipts? PL/EN/RU? — решается в `/admin/integrations/acquiring` UI Фазы 1 (поле `locale`).

## Снято с обсуждения (закрыто discovery v1.1)
- ~~Restricted Key обязателен сразу~~ — нет, отложено в backlog.
- ~~Stripe Tax включать в MVP~~ — нет, backlog.
- ~~Customer Portal в MVP~~ — нет, backlog.
- ~~ЭСЧФ для Stripe-платежей~~ — нет, остаётся bePaid-only.
