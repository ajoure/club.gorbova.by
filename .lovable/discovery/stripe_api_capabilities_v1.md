# Discovery: Stripe API capabilities (для нашего use-case)

Дата: 2026-06-02. Источник: https://docs.stripe.com (API ref 2024-11-20). Цель: зафиксировать, что входит в MVP, что — в backlog.

## 1. Checkout Session (MVP)
- `POST /v1/checkout/sessions` — основной hosted checkout.
- Ключевые поля: `mode` (`payment` | `subscription` | `setup`), `line_items`, `client_reference_id`, `metadata`, `success_url`, `cancel_url`, `customer` / `customer_email`, `payment_method_types`, `automatic_tax.enabled`, `billing_address_collection`, `tax_id_collection`, `locale`.
- **Обязательные metadata в нашем флоу:** `order_id`, `payment_link_id` (если из public link), `product_id`, `tariff_id`, `contact_id`, `provider='stripe'`. `client_reference_id` дублирует `order_id` для admin-видимости.
- Webhook к финализации: `checkout.session.completed` + `checkout.session.async_payment_succeeded/failed` (для асинхронных PM типа SEPA).
- Возврат: `redirect.url` — отдаём фронту вместо bePaid `checkout.redirect_url`.

## 2. PaymentIntent (MVP)
- `POST /v1/payment_intents` — низкоуровневый flow (custom UI), MIT (off_session).
- Поля: `amount` (в minor units), `currency`, `customer`, `payment_method`, `off_session`, `confirm`, `metadata`.
- Используем для **MIT/saved-card зарядов** (`stripe-charge-saved-pm`) — аналог `direct-charge`/`admin-manual-charge`.
- Webhook: `payment_intent.succeeded` / `payment_intent.payment_failed`.

## 3. Customer + PaymentMethod + SetupIntent (MVP)
- `Customer` — один на наш `profiles.id` (хранится в `provider_subscriptions.meta.stripe_customer_id` или новая колонка).
- `SetupIntent` — токенизация карты без заряда (нужно для первой подписки и для будущих MIT).
- `PaymentMethod` — конкретная карта, `pm_*` ID, `card.last4`, `card.brand`, `card.wallet` (apple_pay/google_pay).

## 4. Subscription + Price + Product (MVP)
- `Product` (`prod_*`) + `Price` (`price_*`, recurring) — каноническая модель Stripe для recurring.
- `Subscription` (`sub_*`) — состояние биллинга, `current_period_end`, `cancel_at`, `cancel_at_period_end`, `default_payment_method`, `latest_invoice`.
- `Invoice` (`in_*`) — каждый цикл = invoice; webhook `invoice.paid` / `invoice.payment_failed` — основная синхронизация состояния подписки.
- **Mapping наш→Stripe:** `tariff_offers (recurring=true)` → 1×Stripe Product + 1×Stripe Price. Хранится в новой таблице `provider_product_mappings` (Фаза 2.7).

## 5. Subscription Schedule (MVP-расширенно)
- `subscription_schedule` — для **finite installment** (аналог bePaid `billing_cycles=N`): фаза с фиксированным `iterations`, затем `end_behavior='cancel'`.
- Альтернатива в Фазе 2: обычный `Subscription` + `cancel_at` через N циклов. Schedule предпочтительнее (атомарно создаётся в Stripe).

## 6. Refund (MVP)
- `POST /v1/refunds` — `payment_intent` или `charge`, `amount` (для частичного).
- Webhook: `charge.refunded`.
- Идёт через canonical `record_refund_atomic` (memory: `refund-canonical-write-path`). `refund_uid` = Stripe `re_*` ID.

## 7. Webhooks (MVP — обязательные)
| Событие | Действие |
|---|---|
| `checkout.session.completed` | связать session → order_id, дождаться `payment_intent.succeeded` для terminal |
| `checkout.session.async_payment_succeeded` | terminal для async PM |
| `checkout.session.async_payment_failed` | order_v2.status=failed |
| `payment_intent.succeeded` | INSERT payments_v2(provider='stripe') → `grant-access-for-order` |
| `payment_intent.payment_failed` | payments_v2.status=failed, error_message |
| `invoice.paid` | recurring → `grant-access-for-order` на следующий цикл |
| `invoice.payment_failed` | subscriptions_v2 → past_due / dunning |
| `customer.subscription.created` | INSERT/UPDATE `provider_subscriptions` |
| `customer.subscription.updated` | sync state, next_charge_at |
| `customer.subscription.deleted` | state=canceled, без отзыва доступа (тот же контракт что bePaid) |
| `charge.refunded` | `record_refund_atomic(refund_uid='re_*')` |
| `charge.dispute.created` | provider_events log + audit (UI на dispute → backlog) |

Идемпотентность: `Stripe-Signature` верификация + `stripe_event_id` уникален в `provider_events` (Фаза 2.3).

## 8. Tax (MVP — конфиг, не функциональность)
- `automatic_tax.enabled` per Checkout Session.
- Требует `Tax Registrations` в Stripe Dashboard (US/EU). Для BY/RU/KZ — Stripe Tax не работает; используем `automatic_tax=false` по умолчанию.
- `tax_behavior` per Price: `inclusive` (наша цена уже с НДС, как сейчас) vs `exclusive`.
- `tax_code` per Product (`txcd_*`) — нужен только если включаем automatic_tax.

**MVP-решение:** `automatic_tax=false`, `tax_behavior='inclusive'`. Stripe Tax — отдельный спринт.

## 9. Payment Links — Stripe native (BACKLOG)
- `POST /v1/payment_links` — Stripe-сторонние ссылки.
- **НЕ используем для MVP.** Наш собственный `payment_links` writer (`admin-create-public-link`) остаётся каноном — он содержит pre-checkout (контакт, вопросы, контекст), который Stripe Payment Links не воспроизводит.

## 10. Customer Portal (BACKLOG)
- `POST /v1/billing_portal/sessions` — Stripe-hosted portal для отмены/смены карты.
- В MVP не подключаем; saved-card UI остаётся как есть (memory: `saved-card-client-policy`).

## 11. Disputes / Connect / Sigma (BACKLOG)
- Disputes: только webhook-логирование в Фазе 2, UI — отдельно.
- Connect (multi-merchant): не нужно.
- Sigma (SQL отчёты): bePaid-эквивалент — `bepaid-fetch-transactions`; в MVP не подключаем.

## 12. Валюты и страны (открытый вопрос)
- Stripe поддерживает 135+ валют, но **доступность зависит от страны Stripe-аккаунта**.
- `BYN` поддерживается как `presentment_currency` только если аккаунт зарегистрирован в BY (Stripe в BY работает ограниченно).
- Если аккаунт пользователя в US/EU/UK — settlement в USD/EUR/GBP, presentment может быть в BYN через `Adaptive Pricing`, но cross-border конверсия = +2% к Stripe-комиссии.
- **Точный ответ — в `open_questions_stripe_v1.md` вопрос #1.**

## 13. Idempotency
- Все мутирующие запросы поддерживают header `Idempotency-Key`. Используем `${order_id}:${attempt}` для checkout creation и `${webhook_event.id}` для downstream.

## 14. Что Stripe НЕ умеет (vs bePaid)
- ЕРИП (BY-only).
- ЭСЧФ / РБ-фискальные чеки.
- Belkart (национальная карта BY) — частично через локальные методы, но не гарантировано.
- CSV-выписка в формате bePaid Statement.

## Резюме: MVP scope (Фаза 2)
1. `stripe-create-checkout` (mode=payment).
2. `stripe-create-subscription` (mode=subscription + опционально schedule).
3. `stripe-webhook` (12 событий из таблицы выше).
4. `stripe-create-refund` через `record_refund_atomic`.
5. `stripe-charge-saved-pm` (off_session PaymentIntent).
6. `stripe-list-subscriptions`, `stripe-get-payment-details`, `stripe-cancel-subscription` для admin UI.
7. `provider_events` ledger (idempotency).
8. `provider_product_mappings` (mapping наш↔Stripe Product/Price).
9. Cloud secrets: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.

## Backlog (после MVP)
- Stripe Tax / Tax Registrations / automatic_tax.
- Customer Portal.
- Disputes UI.
- Stripe Payment Links (native).
- Sigma / Balance Reports CSV import.
- ЭСЧФ для Stripe-оплат (отдельный legal/fiscal спринт).
- Adaptive Pricing / multi-currency presentment.
