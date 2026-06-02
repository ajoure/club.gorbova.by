# Discovery: полный inventory возможностей Stripe API

Дата: 2026-06-02. Источник: https://docs.stripe.com (API ref 2024-11-20). Статусы: `MVP` (Фаза 2), `Phase2` (Фаза 2 расширенная), `Backlog`, `NotUsed`.

## Платежи

| Возможность | API | Статус | Наша точка | UI место |
|---|---|---|---|---|
| Checkout Sessions | `POST /v1/checkout/sessions` | MVP | `stripe-create-checkout` | PaymentDialog, /pay/:token |
| Payment Intents | `POST /v1/payment_intents` | MVP | внутренний `stripe-charge-saved-pm` | — |
| Setup Intents | `POST /v1/setup_intents` | Phase2 | `stripe-create-setup` | "Сохранить карту" |
| Payment Methods | `POST /v1/payment_methods` | Phase2 | автогенерация на checkout | /settings/payment-methods |
| Saved Cards | `Customer.invoice_settings.default_payment_method` | Phase2 | через Customer | /settings/payment-methods |
| Off-session charges | `payment_intents.create(off_session=true, confirm=true)` | Phase2 | `stripe-charge-saved-pm` | admin-manual-charge stripe-вариант |
| Apple Pay | `payment_method_types: ['card']` + domain verification | MVP | автоматически в Checkout Session | — |
| Google Pay | то же | MVP | автоматически | — |

## Подписки

| Возможность | API | Статус | Наша точка | UI |
|---|---|---|---|---|
| Subscription | `POST /v1/subscriptions` | Phase2 | `stripe-create-subscription` | AdminSubscriptionsV2 |
| Subscription Schedule | `POST /v1/subscription_schedules` | Phase2 | finite installment | installment-ссылки |
| Trial | `subscriptions.create(trial_period_days)` | Backlog | tariff_offers.meta.trial | tariff editor |
| Pause | `subscriptions.update(pause_collection)` | Phase2 | `subscription-actions` (stripe) | AdminSubscriptionsV2 |
| Resume | `subscriptions.update(pause_collection=null)` | Phase2 | то же | то же |
| Proration | `subscriptions.update(proration_behavior)` | Backlog | при смене тарифа | — |
| Billing Cycles (finite) | `subscription_schedule.phases[].iterations` | Phase2 | installment | — |
| Metered Billing | `subscription_items.create_usage_record` | NotUsed | — | — |

## Каталог

| Возможность | API | Статус | Наша точка | UI |
|---|---|---|---|---|
| Products | `POST /v1/products` | MVP | provider_product_mappings (Phase2) | AdminProductsDocs |
| Prices | `POST /v1/prices` | MVP | tariff_offers.meta.stripe_price_id | tariff editor |
| Multi-price products | `prices.list(product=...)` | Phase2 | — | — |
| Tax behavior | `price.tax_behavior` ∈ inclusive/exclusive | MVP (=inclusive) | tariff_offers.meta | оффер |
| Currency behavior | `price.currency_options` | MVP | profile / tariff | profile editor |

## Налоги

| Возможность | API | Статус |
|---|---|---|
| Stripe Tax | `automatic_tax.enabled=true` per session | Backlog |
| Automatic Tax | то же | Backlog |
| Tax Registration | Dashboard only | Backlog |
| Tax Codes | `product.tax_code = txcd_*` | Backlog |

## Документы

| Возможность | API | Статус | UI |
|---|---|---|---|
| Receipts (email auto) | Dashboard setting | MVP | — (включается на аккаунте) |
| Invoices | `POST /v1/invoices` | Phase2 | для B2B EU |
| Hosted Invoice Page | `invoice.hosted_invoice_url` | Phase2 | — |
| Customer Email Receipts | auto | MVP | — |

ЭСЧФ / РБ-фискализация остаётся **bePaid-only**.

## Маркетинг

| Возможность | API | Статус |
|---|---|---|
| Coupons | `POST /v1/coupons` | Backlog (есть свой движок) |
| Promotion Codes | `POST /v1/promotion_codes` | Backlog |
| Discounts | `subscription.discount` | Backlog |

## Кабинет

| Возможность | API | Статус |
|---|---|---|
| Customer Portal | `POST /v1/billing_portal/sessions` | Backlog (memory: saved-card-client-policy) |

## Риски

| Возможность | API | Статус |
|---|---|---|
| Disputes | webhook `charge.dispute.created` | Phase2 (логирование в provider_events) |
| Chargebacks | то же | Phase2 |
| Fraud / Radar | Dashboard config | MVP (вкл. без UI у нас) |

## Интеграции

| Возможность | API | Статус | Наша точка |
|---|---|---|---|
| Webhooks | `webhook_endpoints` | MVP | `stripe-webhook` |
| Events | `events.list` | MVP | provider_events ledger |
| Event Replay | `webhook_endpoints.events.resend` | Phase2 | admin retry UI |
| Idempotency Keys | header `Idempotency-Key` | MVP | `${order_id}:${attempt}` |
| Metadata | per object | MVP | контракт `stripe_metadata_contract_v1.md` |

## MVP scope (резюме для Фазы 2)
1. Checkout Sessions (mode=payment), Apple/Google Pay автоматически.
2. Webhook (12 событий: см. stripe_api_capabilities_v1.md §7).
3. Receipts (email).
4. Refunds → `record_refund_atomic`.
5. Idempotency + Metadata-контракт.
6. Provider_events ledger.

## Phase 2 расширенный
1. Subscriptions + Subscription Schedule (finite installment).
2. Saved cards (SetupIntent + off-session charges).
3. Pause/Resume.
4. Disputes (logging only).
5. Invoices (по запросу B2B EU).

## Backlog
Trial, Proration, Coupons, Customer Portal, Stripe Tax, Tax Registrations, Adaptive Pricing, Sigma, multi-price products.

## NotUsed
Metered Billing, Connect, Issuing, Terminal, Treasury, Climate.
