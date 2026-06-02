# Discovery: gap-matrix bePaid ↔ Stripe

Дата: 2026-06-02.

| # | Возможность | bePaid (текущее состояние) | Stripe (план) | В MVP? | Замечания |
|---|---|---|---|---|---|
| 1 | One-time card payment | `bepaid-webhook` + `_shared/create-payment-checkout.ts` | `stripe-create-checkout` (mode=payment) + `stripe-webhook` (checkout.session.completed → payment_intent.succeeded) | ✅ | ключевой сценарий MVP |
| 2 | Recurring subscription | `bepaid-create-subscription*`, `bepaid-webhook` (recurring), `subscriptions_v2 + provider_subscriptions` | `stripe-create-subscription` (mode=subscription) + `Subscription`/`Price`/`Invoice` + webhook `invoice.paid/customer.subscription.*` | ✅ | требует `provider_product_mappings` |
| 3 | Finite installment (рассрочка) | bePaid `/subscriptions` с `billing_cycles=N` (memory: `installment-public-link-finite-subscription`) | Stripe `subscription_schedule` с `iterations=N`, `end_behavior=cancel` | ✅ | atomic в Stripe Dashboard |
| 4 | Saved card / MIT off_session | `direct-charge`, `admin-manual-charge`, token в `provider_subscriptions.card_token` | `stripe-charge-saved-pm` через PaymentIntent off_session, `pm_*` ID хранится в `provider_subscriptions.meta.stripe_payment_method_id` | ✅ | требует `SetupIntent` при первой подписке |
| 5 | Refund (full/partial) | `bepaid-process-refunds` → `record_refund_atomic` | `stripe-create-refund` → `record_refund_atomic` (refund_uid=`re_*`) | ✅ | shared канонический RPC |
| 6 | Webhook terminal status | `bepaid-webhook` (6058 строк) | `stripe-webhook` (новый, ~600 строк) + `provider_events` ledger | ✅ | идемпотентность по `event.id` |
| 7 | Receipt / fiscal docs (ЭСЧФ) | `bepaid-fetch-receipt`, `bepaid-get-receipt`, `bepaid-receipts-cron` | Stripe не выдаёт ЭСЧФ | ❌ | отдельный legal-спринт; в MVP — без чека для Stripe-оплат |
| 8 | ERIP | `bepaid-webhook` (ERIP branch), `meta.is_erip` | НЕ поддерживается | ❌ | ERIP остаётся в bePaid; Stripe не предлагается как альтернатива для BY-клиентов с ЕРИП |
| 9 | Apple Pay / Google Pay | bePaid: приходит как 'card' (memory: `derivePaymentChannel.ts`) | Stripe: явно в `payment_method.card.wallet.type` → точный маппинг | ✅ | улучшение vs bePaid |
| 10 | Public payment link | `admin-create-public-link` → `payment_links` (memory: `public-link-writer-standard`) | Тот же writer, но `payment_links.provider='stripe'` → `/pay/:token` POST → `stripe-create-checkout` | ✅ | наш writer остаётся каноном |
| 11 | Pre-checkout form (email, вопросы, контакт) | `PaymentDialog` + `/pay/:token` flow | Та же форма; provider роутится после сбора данных | ✅ | без изменений UX |
| 12 | Admin manual charge | `admin-manual-charge` (bepaid-only) | `stripe-charge-saved-pm` через admin UI | ✅ | параллельный path |
| 13 | Customer portal / saved-card UI | Memory `saved-card-client-policy`: provider rules UI | Тот же контракт: для Stripe — Stripe Customer Portal (BACKLOG, не MVP) | ⚪ | в MVP saved-card UI не показываем |
| 14 | Tax (НДС / VAT / sales tax) | Хардкод inclusive в цене | `automatic_tax=false`, `tax_behavior=inclusive` (MVP) → возможен Stripe Tax в backlog | ⚪ | MVP-default = как сейчас |
| 15 | Currencies | BYN (через bePaid + НБ РБ курс) | Зависит от Stripe-аккаунта (см. `open_questions_stripe_v1.md` #1) | ⚠️ | блокер — нужно подтвердить от пользователя |
| 16 | Customer portal | — | Stripe Billing Portal | ❌ | BACKLOG |
| 17 | Disputes / chargeback UI | bePaid: нет UI | Stripe: webhook `charge.dispute.created` логируется в `provider_events`, UI = BACKLOG | ⚪ | в MVP только лог |
| 18 | CSV statement import | `bepaid-archive-import`, `bepaid-report-import`, `admin-import-bepaid-statement-csv` | Stripe Sigma / Balance Report (другой формат) | ❌ | BACKLOG |
| 19 | Discrepancy alerts | `bepaid-discrepancy-alert` | — | ❌ | BACKLOG |
| 20 | CRM-routing per provider | `crm-routing.ts` provider-agnostic (читает offer + product) | то же — без изменений | ✅ | downstream не трогаем |
| 21 | Telegram-grant | `telegram-grant-access` provider-agnostic | то же — без изменений | ✅ | то же |
| 22 | Document auto-generate | `document-auto-generate` + `document-resolver-v2` | то же; маппинг provider→payment_channel расширяется (`_shared/document-render.ts:452`, `document-data-snapshot.ts:358`) | ✅ | минимальная правка |
| 23 | Access grant | `grant-access-for-order` provider-agnostic, провайдер берётся из payments_v2/orders_v2 | то же — без изменений | ✅ | то же |
| 24 | Idempotency webhook | `bepaid-webhook` отдельно реализует | `stripe-webhook` через unified `provider_events` ledger | ✅ | новый стандарт |
| 25 | Subscription cancellation flow (resume/cancel) | `subscription-actions` + `check-resume` (memory: `resume-three-level-eligibility`) | Stripe: `cancel_at_period_end=true` → state=canceled; resume через создание новой подписки | ✅ | контракт сохраняется |

## Сводка

- **В MVP (Фаза 2):** 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 20, 21, 22, 23, 24, 25.
- **Условно в MVP (deferred config):** 13, 14, 17 — карcass есть, UI/policy позже.
- **BACKLOG:** 7 (ЭСЧФ), 8 (ERIP — не нужно), 16, 18, 19.
- **БЛОКЕР:** 15 (валюта) — нужен ответ от пользователя до Фазы 2.
