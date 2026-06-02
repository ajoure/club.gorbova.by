да, согласен, с учетом правок:

- **Не вводить SQL enum provider сразу.** Лучше text + CHECK или справочник payment_providers, иначе будущие провайдеры потребуют рискованных миграций.
- **Stripe Checkout должен идти через checkout.session.completed**, а не только payment_intent.succeeded, чтобы надежно связать client_reference_id / metadata.order_id. Stripe прямо использует Checkout Session для reconciliation.
- **Налоги вынести в отдельный блок Stripe Tax Settings.** В Checkout есть automatic_tax.enabled, но нужны настройки налоговых регистраций, tax codes и поведение при отсутствии адреса.
- **Добавить Stripe Product/Price mapping**, а не создавать продукты хаотично из нашей системы. Нужна таблица provider_product_mappings.
- **Не хранить Stripe-секреты в БД.** Только Cloud secrets; в UI — статус, инструкции, проверка подключения.
- **Webhook должен быть идемпотентным** по stripe_event_id, иначе будут дубли платежей.
- **Добавить таблицу/ledger provider events**, чтобы Stripe webhooks не писали сразу хаотично в downstream.
- **MVP лучше ограничить:** one-time + subscription + refund + public link. Customer Portal, dispute, invoice, tax settings, product sync — отдельные подфазы.
- **ЭСЧФ/чеки по Stripe не считать решенными.** Это отдельный blocker/legal backlog.
- **BYN обязательно проверить в discovery.** Stripe поддерживает много валют, но доступность валют и payout зависит от страны аккаунта.

Копируемый спринт для Lovable:

План: Stripe v.1 — безопасное добавление Stripe как второго эквайринга рядом с bePaid

План должен быть составлен на русском языке.  
Отчет о выполненной работе должен быть составлен на русском языке.  
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

**0. Жёсткие правила исполнения**

1. Ничего не ломать в bePaid.
2. Все текущие платежи, подписки, webhooks, recurring, refunds, чеки, public links, документы, Telegram-доступы и CRM-routing должны продолжить работать без изменений.
3. Порядок работы: DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY.
4. Add-only: не удалять и не переписывать рабочие bePaid-пути.
5. Stripe добавляется как новый provider-adapter перед каноническими путями:
  - orders_v2
  - payments_v2
  - subscriptions_v2
  - entitlements
  - provider_subscriptions
  - payment_links
  - grant-access-for-order
  - record_refund_atomic
6. Никаких связей по email/name/slug. Только UUID / provider IDs / public_id для UI.
7. Все Stripe webhook events должны быть идемпотентны.
8. Все критические действия должны писать audit_logs с meta.provider=‘stripe’.
9. Cloud secrets only. Stripe secrets не хранить в БД.
10. Любое место с hardcode ‘bepaid’ должно быть найдено и классифицировано до начала реализации.

**Фаза 0. Discovery без миграций и без изменений кода**

Создать артефакты:

**0.1. .lovable/discovery/acquiring_map_[v1.md](http://v1.md)**

Описать текущую платежную архитектуру:

- one-time checkout
- admin payment links
- public payment links
- recurring
- token charge / MIT
- refunds
- receipts/docs
- webhooks
- cron/backfill
- downstream:
  - grant-access-for-order
  - record_refund_atomic
  - consume-payment-link
  - entitlement-sync
  - access-resolver
  - crm-routing
  - telegram-grant-access
  - document-auto-generate

**0.2. .lovable/discovery/bepaid_hardcodes.csv**

Найти все hardcode ‘bepaid’:

- edge functions
- frontend
- RPC
- migrations
- filters
- helpers
- payment stats
- payment channel resolver

Для каждого места указать:

- файл
- строка
- контекст
- read-only или write-path
- трогать сейчас / не трогать
- риск

**0.3. .lovable/discovery/stripe_api_capabilities_[v1.md](http://v1.md)**

По официальной Stripe API документации описать:

- Checkout Session
- PaymentIntent
- Customer
- PaymentMethod
- SetupIntent
- Subscription
- Subscription Schedule
- Product
- Price
- Tax Settings
- Tax Registration
- Automatic Tax
- Refund
- Invoice
- Customer Portal
- Webhooks
- Disputes
- Payment Links

Отдельно указать, что входит в MVP, а что переносится в backlog.

**0.4. .lovable/discovery/stripe_vs_bepaid_gap_[matrix.md](http://matrix.md)**

Сравнить bePaid и Stripe:

- one-time card payment
- recurring
- finite installment
- saved card / MIT
- refund
- webhook terminal status
- receipt / fiscal docs
- ERIP
- public links
- admin manual charge
- Apple Pay / Google Pay
- tax settings
- currencies
- customer portal

**0.5. .lovable/discovery/open_questions_stripe_[v1.md](http://v1.md)**

Зафиксировать открытые вопросы:

1. Какие валюты принимает Stripe-аккаунт: BYN / EUR / USD / PLN?
2. Какие продукты включаем в Stripe первыми?
3. Какой налоговый режим использовать: automatic_tax on/off?
4. Нужны ли Stripe Tax registrations?
5. Что делать с ЭСЧФ/чеками по Stripe?
6. Нужен ли customer portal в MVP?
7. Нужны ли disputes в MVP?
8. Нужно ли давать пользователю выбор bePaid/Stripe на странице оплаты или выбор делает админ в продукте/ссылке?

**Фаза 1. Provider abstraction без Stripe write-path**

**1.1. Не вводить SQL enum provider**

Не использовать SQL enum для provider.

Вариант безопаснее:

- оставить provider как text;
- добавить CHECK constraint или справочник payment_providers;
- поддержать значения:
  - bepaid
  - stripe
  - admin
  - admin_test
  - admin_test_direct

Причина: SQL enum усложнит добавление новых провайдеров.

**1.2. Добавить provider abstraction**

Создать:

- supabase/functions/_shared/acquiring/types.ts
- supabase/functions/_shared/acquiring/index.ts
- supabase/functions/_shared/acquiring/bepaid-adapter.ts

Adapter interface должен покрывать:

- createCheckout
- createSubscription
- createRefund
- createSavedPaymentMethodCharge
- parseWebhookEvent
- getPaymentDetails
- listSubscriptions
- cancelSubscription

На этой фазе Stripe adapter пока не пишет платежи.

**1.3. Расширить payment_links**

Добавить:

- provider text NOT NULL DEFAULT ‘bepaid’
- provider_mode text NOT NULL DEFAULT ‘fixed’

Допустимые provider_mode:

- fixed — выбран один провайдер;
- customer_choice — выбор провайдера на странице оплаты.

MVP использует fixed.  
customer_choice подготовить как future-compatible, но UI можно не включать до Фазы 3.

**1.4. UI админки**

Добавить фильтр provider:

- All
- bePaid
- Stripe

Разделы:

- /admin/payments
- /admin/payments/links
- payment stats cards
- payment details drawer

Нельзя ломать текущие фильтры bePaid.

**1.5. Новый раздел**

Создать:

/admin/integrations/acquiring

Карточки:

- bePaid — connected
- Stripe — not connected / test mode / live mode

Для Stripe показать:

- статус секретов
- инструкцию подключения
- webhook URL
- кнопку проверки подключения

Секреты не хранить в БД.

**Фаза 2. Stripe sandbox adapter**

**2.1. Stripe secrets**

Использовать только Cloud secrets:

- STRIPE_SECRET_KEY
- STRIPE_PUBLISHABLE_KEY
- STRIPE_WEBHOOK_SECRET

В UI показывать только статус наличия секретов.

**2.2. Новые edge functions**

Создать:

- stripe-create-checkout
- stripe-create-subscription
- stripe-webhook
- stripe-get-payment-details
- stripe-list-subscriptions
- stripe-cancel-subscription
- stripe-create-refund
- stripe-charge-saved-pm

**2.3. Stripe webhook ledger**

Добавить таблицу или использовать существующий event ledger:

- provider_events

Поля:

- id uuid
- provider text
- provider_event_id text unique
- event_type text
- raw_payload jsonb
- processing_status text
- processed_at timestamptz
- error text
- created_at timestamptz

Stripe webhook сначала пишет event ledger, затем обрабатывает downstream.

**2.4. Обязательные webhook events**

Обработать минимум:

- checkout.session.completed
- checkout.session.async_payment_succeeded
- checkout.session.async_payment_failed
- payment_intent.succeeded
- payment_intent.payment_failed
- invoice.paid
- invoice.payment_failed
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- charge.refunded
- charge.dispute.created

MVP может не делать dispute UI, но event должен логироваться.

**2.5. Checkout metadata**

Каждая Stripe Checkout Session должна получать:

- client_reference_id = order_id или payment_link_id
- metadata.order_id
- metadata.payment_link_id
- metadata.product_id
- metadata.tariff_id
- [metadata.contact](http://metadata.contact)_id
- metadata.provider=‘stripe’

Без metadata downstream запрещен.

**2.6. Stripe Tax**

В MVP добавить настройки:

- automatic_tax_enabled boolean
- tax_behavior:
  - exclusive
  - inclusive
  - unspecified
- tax_code
- collect_tax_id boolean
- billing_address_collection:
  - auto
  - required

Налоговая логика должна быть provider-specific config, а не общая бизнес-логика.

**2.7. Product / Price mapping**

Добавить таблицу:

provider_product_mappings

Поля:

- id uuid
- provider text
- internal_product_id uuid
- internal_tariff_id uuid
- provider_product_id text
- provider_price_id text
- currency text
- unit_amount integer
- recurring_interval text
- tax_code text
- active boolean
- metadata jsonb
- created_at timestamptz
- updated_at timestamptz

Не создавать Stripe Product/Price без записи mapping.

**Фаза 3. Public links и выбор провайдера**

**3.1. Admin create payment link**

В диалог создания payment link добавить:

- provider:
  - bePaid
  - Stripe
  - customer choice

Default: bePaid.

**3.2. /pay/:token**

Логика:

- если provider=‘bepaid’ → текущий путь без изменений;
- если provider=‘stripe’ → stripe-create-checkout;
- если provider_mode=‘customer_choice’ → показать выбор:
  - оплатить через bePaid
  - оплатить через Stripe

Если доступен только один провайдер, выбор не показывать.

**3.3. Existing pre-checkout form**

Сохранить текущий pre-checkout flow:

- email
- login/password
- вопросы
- данные клиента

После сбора данных:

- создать/обновить contact/order/payment_link context;
- затем направить в выбранный provider checkout.

**Фаза 4. Admin payments: единая выписка**

Stripe платежи должны появляться в общем разделе «Платежи».

Обязательно:

- provider badge
- provider_payment_id
- provider_customer_id
- provider_subscription_id
- card brand / last4
- wallet type: apple_pay / google_pay / card
- tax amount, если есть
- net/gross amount, если Stripe возвращает
- refund status
- webhook event trace

Нельзя создавать отдельную страницу «Stripe payments» как основной источник истины.

**Фаза 5. Regression и proof**

**5.1. Матрица проверки**

Проверить:

- bePaid one-time
- bePaid recurring
- bePaid ERIP
- bePaid refund
- bePaid public link
- Stripe one-time
- Stripe subscription
- Stripe refund
- Stripe public link
- Stripe webhook duplicate delivery
- Stripe failed payment
- Stripe subscription canceled
- payment stats All / bePaid / Stripe
- CRM-routing
- Telegram access
- document generation

**5.2. Proof files**

Создать:

- .lovable/proofs/stripe_discovery_[v1.md](http://v1.md)
- .lovable/proofs/stripe_sandbox_payment_[v1.md](http://v1.md)
- .lovable/proofs/stripe_webhook_idempotency_[v1.md](http://v1.md)
- .lovable/proofs/bepaid_regression_after_stripe_[v1.md](http://v1.md)
- .lovable/proofs/payments_ui_provider_filter_[v1.md](http://v1.md)

**5.3. DoD**

Спринт считается выполненным только если:

1. bePaid работает без регрессии.
2. Stripe sandbox payment создает payments_v2 provider=‘stripe’.
3. Stripe webhook повторно не создает дубли.
4. Stripe payment появляется в общей выписке платежей.
5. Stripe payment проходит downstream до order/access/CRM/Telegram/documents, если это применимо.
6. Все Stripe events имеют audit_logs / provider_events trace.
7. Нет новых hardcode ‘bepaid’ в provider-agnostic коде.
8. Build зеленый.
9. Финальный отчет содержит:
  - список измененных файлов;
  - список миграций;
  - SQL proof;
  - UI proof;
  - webhook proof;
  - regression proof по bePaid;
  - known limitations.

**Не делать в этом спринте**

1. Не отключать bePaid.
2. Не переносить bePaid на Stripe.
3. Не переписывать bepaid-webhook.
4. Не удалять legacy поля.
5. Не делать глобальный рефакторинг 50+ bePaid-функций.
6. Не включать live Stripe без sandbox proof.
7. Не обещать ЭСЧФ/фискализацию Stripe без отдельного legal/fiscal спринта.
8. Не хранить Stripe secrets в БД.
9. Не создавать отдельный параллельный платежный модуль.
10. Не давать Stripe доступы напрямую, минуя canonical downstream.

Главная правка: **сначала discovery + provider abstraction, потом только Stripe sandbox**. Иначе высокий риск задеть bePaid.

&nbsp;

# План: добавление Stripe как второго эквайринга рядом с bePaid

## Принципы (ENGINEERING_RULES)

- **Diagnose → Plan → Dry run → Execute → Verify** на каждой фазе.
- **Не ломаем bePaid.** Текущие 5627 платежей, подписки, webhooks, recurring, refund-recording, чеки, инсталменты, public links, документы — всё остаётся работать как есть.
- **Никаких параллельных write-path.** Канонические пути сохраняются (`orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `grant-access-for-order`, `record_refund_atomic`, `payment_links`, `consume-payment-link`, CRM-routing). Stripe встраивается как ещё один **provider-адаптер** перед этими каноническими путями, а не вместо них.
- **ID-first, provider-agnostic.** Бизнес-логика читает `provider`, `provider_payment_id`, `provider_subscription_id` — не делает хардкод `'bepaid'`.
- **Default-deny, audit-first.** Все новые edge-функции — JWT-verified или super_admin guard, все ветки логируются.

---

## Фаза 0. Discovery (обязательно, без миграций)

### 0.1. Карта текущей платёжной системы

Артефакт: `.lovable/discovery/acquiring_map_v1.md`. Должен покрыть:

**Write-paths (создание заказов/подписок/платежей):**

- `_shared/create-payment-checkout.ts` — единая точка one-time checkout (сайт CTA, тарифы).
- `admin-create-payment-link` — direct checkout админа.
- `admin-create-public-link` → `payment_links` → `public-checkout` (при `/pay/:token`).
- `bepaid-create-subscription-checkout`, `bepaid-create-subscription`, `bepaid-admin-create-subscription-link` — recurring.
- `bepaid-create-token`, `direct-charge`, `admin-manual-charge` — token / MIT charge.

**Webhook / sync:**

- `bepaid-webhook` (6058 строк — terminal status, recurring, refund, ERIP, инсталменты).
- `bepaid-auto-process`, `bepaid-polling-backfill`, `bepaid-receipts-cron`, `bepaid-queue-cron`, `bepaid-get-subscription-details`, `bepaid-list-subscriptions`, `bepaid-process-refunds`.

**Документы/чеки:**

- `bepaid-fetch-receipt`, `bepaid-get-receipt`, `bepaid-get-payment-docs`, `bepaid-receipts-backfill`.

**Канонические downstream-точки (НЕ трогаем):**

- `grant-access-for-order` (+ `provider_linked_subscription_resolver`).
- `record_refund_atomic` RPC + `admin-repair-refund-recording`.
- `consume-payment-link`, `entitlement-sync`, `access-resolver`, `crm-routing`, `telegram-grant-access`, `document-auto-generate`.

**Таблицы и поля, на которых уже опирается мультипровайдерность:**

- `payments_v2.provider` (text), `provider_payment_id`, `payment_token`, `card_last4/brand/holder`, `meta.payment_method`, `meta.payment_channel`, `refunds[]`.
- `provider_subscriptions.provider` (text), `provider_subscription_id`, `card_token`, `state`.
- `subscriptions_v2.meta` (provider-snapshot).
- `payment_links.meta` (нет колонки `provider` — кандидат на расширение).
- `orders_v2.provider`, `provider_payment_id`, `bepaid_subscription_id` (legacy-имя).

### 0.2. Inventory хардкодов `'bepaid'`

Артефакт: `.lovable/discovery/bepaid_hardcodes.csv` со списком всех мест (frontend + edge + RPC + миграции), где провайдер захардкожен. Каждая запись: файл:строка, контекст (UI-фильтр / write-path / read-only filter / migration), нужен ли apuntрефакторинг.

Из быстрого scan уже видно: 50+ файлов в `supabase/functions/`, фронтовые `derivePaymentChannel.ts`, `usePaymentsServerStats({ p_provider: 'bepaid' })`, `bepaid-helpers.ts`, `extractProviderToken.ts` (bePaid-структура).

### 0.3. Inventory секретов и доменов

- `BEPAID_SECRET_KEY`, `BEPAID_*` — проверить через `fetch_secrets`.
- Stripe потребует: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`. **Решение по storage пользователь подтверждает в Фазе 1** (через домен «Интеграции» в админке, как просит — UI поверх Cloud secrets).

### 0.4. Inventory бизнес-возможностей bePaid, которые нужно покрыть в Stripe


| Возможность bePaid                                                          | Эквивалент Stripe                                                                               | Замечание                                                                                                         |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| One-time card checkout                                                      | PaymentIntent + Checkout Session                                                                | прямой аналог                                                                                                     |
| Recurring subscription (server-initiated, `billing_cycles=N` для рассрочки) | Subscription + Price (`recurring`) + `cancel_at` для finite                                     | finite installment ↔ Stripe `subscription_schedule`                                                               |
| Token charge / MIT (`direct-charge`, `admin-manual-charge`)                 | `off_session=true` PaymentIntent с saved PM                                                     | требует SetupIntent при первой оплате                                                                             |
| ERIP                                                                        | Stripe не поддерживает (BY-only)                                                                | **Stripe не заменяет ERIP; ERIP остаётся в bePaid**                                                               |
| Refund (полный/частичный)                                                   | `refunds.create`                                                                                | через `record_refund_atomic`                                                                                      |
| Webhook terminal status                                                     | `payment_intent.succeeded/failed`, `charge.refunded`, `invoice.paid`, `customer.subscription.*` | новый endpoint                                                                                                    |
| Receipt / чек (54-ФЗ / РБ ЭСЧФ)                                             | Stripe не выдаёт ЭСЧФ                                                                           | **Чек продолжает выдавать bePaid; Stripe-платежи получают другой шаблон чека или внешний фискалайзер — обсудить** |
| Public payment link                                                         | Stripe Payment Links                                                                            | в нашей системе остаётся свой `payment_links` writer, downstream — Stripe Checkout                                |
| Saved card list / customer portal                                           | Stripe Customer + PaymentMethods                                                                | политика `saved-card-client-policy` остаётся: provider rules the UI                                               |


### 0.5. DoD фазы 0

- Все 5 артефактов в `.lovable/discovery/` созданы.
- Список открытых вопросов (ЭСЧФ для Stripe-оплат, валюты, география плательщиков, как админу выбирать провайдер при создании ссылки) — оформлен и согласован с пользователем перед Фазой 1.
- Никаких изменений в коде/БД на этой фазе.

---

## Фаза 1. Provider abstraction (без Stripe ещё)

Цель: подготовить кодовую базу так, чтобы добавление Stripe в Фазе 2 было аддитивным.

1. **Enum-канон provider:** ввести SQL-enum `payment_provider` (`'bepaid' | 'stripe' | 'admin' | 'admin_test' | 'admin_test_direct'`). Миграция: `ALTER COLUMN provider TYPE` для `payments_v2`, `provider_subscriptions`, `orders_v2`. Default `'bepaid'` — обратная совместимость.
2. **Adapter-интерфейс** в `supabase/functions/_shared/acquiring/`:
  - `types.ts` — `CheckoutRequest`, `CheckoutResponse`, `WebhookEvent`, `RefundRequest`, `TokenChargeRequest`, `SubscriptionRequest`.
  - `bepaid-adapter.ts` — обёртка над уже существующим кодом (без рефакторинга bePaid-функций, только фасад).
  - `index.ts` — `resolveAdapter(provider)`.
3. **Рефакторинг `_shared/create-payment-checkout.ts`:** добавить параметр `provider` (default `'bepaid'`), внутри роутить в adapter. **Все существующие вызовы** продолжают работать (provider не передан → bepaid).
4. **Расширение `payment_links`:** добавить колонку `provider payment_provider NOT NULL DEFAULT 'bepaid'`. UI создания ссылки добавляет селектор провайдера (default bePaid). RLS/grants без изменений.
5. **UI:** `derivePaymentChannel.ts`, `usePaymentsServerStats`, фильтры в `/admin/payments/*` и `/admin/payments/links` — добавить поддержку фильтра по provider (toggle: All / bePaid / Stripe). **Никакого редизайна**, только опциональный фильтр.
6. **Канонический admin-домен «Интеграции» → «Эквайринг»:** новая страница `/admin/integrations/acquiring`, две карточки: bePaid (status: connected, secrets: ✓), Stripe (status: not connected). Кнопка «Подключить Stripe» открывает диалог с инструкцией и триггерит `add_secret` для `STRIPE_*`.
7. **DoD:** build зелёный, все существующие платежи проходят, ни одна bePaid-функция не изменила поведение (regression e2e: `e2e/admin-unlinked-payments.spec.ts` + ручной dry-run `bepaid-webhook` на тестовом payload).

---

## Фаза 2. Stripe-adapter (read-only / sandbox)

1. **Секреты:** через UI Фазы 1.6 запрашиваем `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (Cloud secrets, не в .env).
2. **Новые edge-функции** (минимальный набор, mirror bepaid-канона):
  - `stripe-create-checkout` — one-time Checkout Session.
  - `stripe-create-subscription` — recurring + finite (`subscription_schedule` для рассрочки).
  - `stripe-webhook` — единый endpoint, signature verification через `STRIPE_WEBHOOK_SECRET`, маршрутизация на canonical downstream:
    - `payment_intent.succeeded` → INSERT в `payments_v2` (provider=`'stripe'`) → `grant-access-for-order`.
    - `customer.subscription.updated/deleted` → sync `subscriptions_v2` + `provider_subscriptions`.
    - `charge.refunded` → `record_refund_atomic`.
  - `stripe-get-payment-details`, `stripe-list-subscriptions`, `stripe-cancel-subscription` — для admin UI.
  - `stripe-charge-saved-pm` — аналог `direct-charge` / `admin-manual-charge` (off_session).
3. **Webhook URL:** регистрируем в Stripe Dashboard на `https://<project>.supabase.co/functions/v1/stripe-webhook`. **Verify_jwt=false** в `supabase/config.toml` для этой функции.
4. **Receipt / документы:** Stripe-платежи получают document-resolver-v2 с тем же scenario-резолвером — поле `payment_channel='card'`, ЭСЧФ-логика выносится в отдельный backlog (см. Фаза 0.4).
5. **DoD:** sandbox-платёж в Stripe → попадает в `payments_v2` с provider='stripe' → создаётся `orders_v2` paid → `grant-access-for-order` отрабатывает → CRM/Telegram/документы работают идентично bePaid. Proof: `.lovable/proofs/stripe_e2e_sandbox.md`.

---

## Фаза 3. Public links и UX выбора провайдера

1. **CreatePublicLinkDialog** (`src/components/admin/payments/links/`): селект «Провайдер» — bePaid / Stripe, default bePaid.
2. `**/pay/:token`:** при `link.provider='stripe'` вызывает `stripe-create-checkout` вместо `public-checkout` (или единый `public-checkout` роутит по `link.provider`).
3. **Опционально (backlog):** дать плательщику выбор — карточка показывает «Оплатить через Stripe» / «Оплатить через bePaid» если линк создан с `provider='any'`. **На MVP не делаем**, чтобы не плодить пути.
4. **DoD:** ссылка Stripe оплачивается, бэкенд-эффект идентичен bePaid-ссылке.

---

## Фаза 4. Финальная regression-проверка

- Полный прогон `e2e/` + ручной матрица: bePaid one-time / bePaid recurring / bePaid ERIP / bePaid refund / Stripe one-time / Stripe recurring / Stripe refund / public link (оба провайдера) / admin-manual-charge (оба).
- Audit-логи: каждая ветка пишет `audit_logs` с `meta.provider`.
- Memory: новый файл `mem://architecture/payments/multi-provider-acquiring-standard` + обновление core: «`provider` enum SOT; никакого хардкода `'bepaid'` в новых артефактах».

---

## Технические заметки

- **Не делаем** глобальный рефакторинг 50+ bePaid-функций — они остаются `bepaid-*` namespace. Stripe — параллельный `stripe-*` namespace. Общим становится только `_shared/acquiring/` и canonical downstream.
- `**extractProviderToken` / `bepaid-helpers**` — bePaid-specific, не трогаем. Stripe-helper создаётся отдельно (`stripe-helpers.ts`).
- `**payment-channel.ts` резолвер** — расширяется: для Stripe `card`/`apple_pay`/`google_pay` приходят явно в `payment_method.card.wallet`, маппим в наш канон.
- **Валюта:** Stripe требует ISO currency lowercase, у нас `BYN`. Уточнить: Stripe-аккаунт пользователя поддерживает BYN или только USD/EUR/PLN? — **открытый вопрос Фазы 0**.
- **PCI/3DS:** Stripe Checkout полностью off-site, поэтому PCI scope не растёт. Saved-card UI policy сохраняется.

---

## Открытые вопросы перед стартом Фазы 1

1. Какие валюты планируем принимать через Stripe (BYN / USD / EUR)?
2. Какие продукты/тарифы изначально подключаем к Stripe — все или только подмножество (например, иностранные клиенты)?
3. Чек/ЭСЧФ для Stripe-платежей — пока выключаем, или подключаем сторонний фискалайзер?
4. Подключаем ли recurring через Stripe в Фазе 2, или MVP = только one-time + public link, recurring — Фаза 3+?

Ответы на эти 4 вопроса нужны до Фазы 1, чтобы корректно спроектировать enum, scenarios и UI селектор.