# да, согласен, с учетом правок:

1. **Не включать** `BYN` **и** `RUB` **в архитектурный whitelist как гарантированно поддерживаемые валюты Stripe.**
  &nbsp;
  Формулировка должна быть:
  - поддерживаемые бизнесом валюты: EUR, PLN, USD, BYN, RUB;
  - фактическая поддержка Stripe определяется discovery через API аккаунта;
  - если Stripe не поддерживает валюту, система автоматически предлагает bePaid для этой валюты.
  Иначе получится ложное предположение, что Stripe сможет принимать BYN/RUB.
2. **Убрать** `restricted API key` **из открытых вопросов.**
  Discovery не должен требовать создания новых ключей заранее.
  Сначала реализовать подключение Stripe через стандартный Secret Key.
  Отдельно в discovery описать:
  - какие scopes реально нужны;
  - нужен ли Restricted Key;
  - нужен ли отдельный Webhook Secret.
3. **Добавить обязательный артефакт:**
  &nbsp;
  `.lovable/discovery/stripe_object_mapping_v1.md`
  Нужно заранее описать соответствие:


| **Наша система**      | **Stripe**               |
| --------------------- | ------------------------ |
| Product               | Product                  |
| Tariff                | Price                    |
| Payment Link          | Checkout Session         |
| Order                 | PaymentIntent + metadata |
| Subscription          | Subscription             |
| Provider Subscription | Subscription             |
| Payment               | Charge / PaymentIntent   |
| Refund                | Refund                   |


3. Это сильно снизит риск архитектурных ошибок в Фазе 1 и Фазе 2.
4. **Добавить discovery по metadata contract.**
  &nbsp;
  Сейчас metadata перечислена в нескольких местах.
  Нужен отдельный документ:
  `.lovable/discovery/stripe_metadata_contract_v1.md`
  Зафиксировать обязательные поля:
  - order_id
  - product_id
  - tariff_id
  - business_stream
  - account_code
  - payment_link_id
  - contact_id
  - provider
  И указать:
  - обязательное;
  - опциональное;
  - immutable после создания;
  - используется downstream или нет.
5. **В** `payment_provider_profiles_model_v1.md` **убрать профили** `stripe_standard_byn` **и** `stripe_standard_rub`**.**
  &nbsp;
  Пока нет подтверждения поддержки этих валют Stripe Poland.
  Оставить:
  - stripe_standard_eur
  - stripe_standard_pln
  - stripe_standard_usd
  - stripe_subscription_eur
  BYN/RUB добавить только после discovery.
6. **Добавить обязательный раздел в** `stripe_admin_configuration_matrix.md`**:**
  &nbsp;
  “Что нельзя настраивать из нашей админки”.
  Например:
  - payouts;
  - банковские счета;
  - KYC;
  - verification;
  - ownership;
  - tax registrations;
  - account settings.
  Чтобы потом не пытаться тащить весь Stripe Dashboard внутрь системы.

В остальном план выглядит корректным.

После внесения этих 6 правок discovery можно считать закрытым и автоматически переходить к Фазе 1 без дополнительного согласования.

&nbsp;

План: Stripe Integration v1.1 — Discovery-патчи перед Фазой 1

Расширение согласованного плана Stripe v1. Цель — закрыть пробелы discovery (multi-account readiness, business_stream, полный feature inventory, admin configuration matrix, профили настроек, валюты), после чего без отдельного согласования перейти к Фазе 1 (provider abstraction, payment_links расширение, adapter layer, раздел Integrations → Acquiring).

Все изменения этой фазы — **только документы в `.lovable/discovery/**`. Никаких миграций, edge functions, кода. bePaid не трогаем.

---

## Принципы (применяются ко всем артефактам)

1. **Add-only**. Никаких переименований, никаких изменений семантики существующих полей.
2. **Future-ready, не future-built**. Проектируем структуры (acquiring_accounts, business_stream, payment_provider_profiles) — НЕ создаём таблицы на этом этапе.
3. **Один Stripe-аккаунт сейчас** (Stripe Poland), но архитектура читает `account_code` из конфигурации, а не из ENV хардкода.
4. **bePaid остаётся каноном** для ЕРИП, ЭСЧФ, Belkart, BY-fiscal сценариев. Stripe — параллельный канал.
5. **Все артефакты — на русском**, в `.lovable/discovery/`, версия `_v2` поверх существующего v1.

---

## Артефакты для создания

### 1. `.lovable/discovery/acquiring_accounts_model_v1.md`

Проектирование сущности `acquiring_accounts` (на будущее, без миграции):

- Поля: `id`, `provider` (text: bepaid|stripe), `account_code` (unique, например `stripe_poland`, `stripe_company_a`, `bepaid_main`), `account_name`, `is_default` (bool), `status` (active|disabled|test), `metadata` (jsonb), `currency_whitelist`, `country`, `created_at`, `updated_at`.
- Контракт чтения секретов: `getAcquiringSecret(account_code, key_name)` → читает `STRIPE_SECRET_KEY_<ACCOUNT_CODE>` с fallback на `STRIPE_SECRET_KEY` (для текущего single-account режима).
- Контракт записи: `provider_subscriptions.account_code`, `payments_v2.meta.account_code`, `payment_links.account_code` (nullable, на будущее).
- Карта мест, где хардкод `provider='stripe'` должен сразу читать `(provider, account_code)`-пару из конфигурации:
  - `_shared/acquiring/index.ts` (resolveAdapter)
  - `create-payment-checkout.ts`
  - `stripe-*` функции (Фаза 2)
  - `payment_links` writer/reader
- Раздел "Что НЕ делаем сейчас": таблицу не создаём, UI multi-account не строим. Только: account_code как опциональное поле в metadata + adapter принимает `account_code` параметром (default = текущий единственный).
- DoD проектирования: список всех точек чтения секретов с пометкой "single-account-safe" vs "needs account_code".

### 2. `.lovable/discovery/business_stream_classification_v1.md`

- Перечень потоков: `accounting_school`, `consulting`, `documents`, `club`, `marketplace` + правила добавления новых.
- Источники определения `business_stream` (приоритет):
  1. `tariff_offers.meta.business_stream` (explicit)
  2. `products.meta.business_stream` (fallback по продукту)
  3. `orders_v2.meta.business_stream` (snapshot на момент заказа — обязательное поле для всех новых заказов после Фазы 1)
  4. Дефолт-резолвер по `product_id` (mapping table в коде на старте).
- Связь с CRM: какие воронки/этапы попадают в какой stream (источник: memory `product-pipeline-mapping-canon`).
- Контракт: Stripe metadata в Checkout Session ОБЯЗАН содержать `business_stream`, `product_id`, `tariff_id`, `account_code`, `order_id`, `payment_link_id?`.
- Аналитический ракурс: будущие отчёты `/admin/payments/by-stream`, `/admin/payments/by-account` (только проектирование, не реализация).
- Backfill для существующих заказов — отдельным backlog-итемом.

### 3. `.lovable/discovery/stripe_feature_inventory_full.md`

Полный inventory всех Stripe-возможностей с пометкой `MVP | Phase2 | Backlog | NotUsed` + место в UI. Структура по разделам (из патча):


| Раздел     | Возможность                             | Статус                                | UI место                            |
| ---------- | --------------------------------------- | ------------------------------------- | ----------------------------------- |
| Платежи    | Checkout Sessions                       | MVP                                   | PaymentDialog, /pay/:token          |
| Платежи    | Payment Intents                         | MVP                                   | внутренний (charge-saved-pm)        |
| Платежи    | Setup Intents                           | Phase 2                               | "Сохранить карту"                   |
| Платежи    | Payment Methods / Saved Cards           | Phase 2                               | /settings/payment-methods           |
| Платежи    | Off-session charges                     | Phase 2                               | admin-manual-charge stripe-вариант  |
| Платежи    | Apple Pay / Google Pay                  | MVP (вкл. на уровне Checkout Session) | автоматически                       |
| Подписки   | Subscription                            | Phase 2                               | AdminSubscriptionsV2                |
| Подписки   | Subscription Schedule (finite N циклов) | Phase 2                               | installment-ссылки                  |
| Подписки   | Trial                                   | Backlog                               | tariff_offers.meta.trial            |
| Подписки   | Pause/Resume                            | Phase 2                               | subscription-actions stripe-вариант |
| Подписки   | Proration                               | Backlog                               | при смене тарифа                    |
| Подписки   | Billing Cycles                          | Phase 2                               | finite installment                  |
| Подписки   | Metered Billing                         | NotUsed                               | —                                   |
| Каталог    | Products                                | MVP (через provider_product_mappings) | AdminProductsDocs                   |
| Каталог    | Prices                                  | MVP                                   | tariff_offers.meta.stripe_price_id  |
| Каталог    | Multi-price products                    | Phase 2                               | —                                   |
| Каталог    | Tax behavior (inclusive/exclusive)      | MVP (=inclusive)                      | оффер                               |
| Каталог    | Currency behavior                       | MVP                                   | profile/account                     |
| Налоги     | Stripe Tax / Automatic Tax              | Backlog                               | —                                   |
| Налоги     | Tax Registration / Codes                | Backlog                               | —                                   |
| Документы  | Receipts (email)                        | MVP (включить на аккаунте)            | —                                   |
| Документы  | Invoices / Hosted Invoice Page          | Phase 2                               | для B2B EU                          |
| Документы  | Customer Email Receipts                 | MVP                                   | автоматически                       |
| Маркетинг  | Coupons / Promotion Codes / Discounts   | Backlog (есть свой движок промокодов) | —                                   |
| Кабинет    | Customer Portal                         | Backlog                               | (memory: saved-card-client-policy)  |
| Риски      | Disputes / Chargebacks                  | Phase 2 (webhook логирование)         | provider_events                     |
| Риски      | Fraud / Radar                           | MVP (вкл. в Dashboard, без UI)        | —                                   |
| Интеграции | Webhooks / Events / Replay              | MVP                                   | stripe-webhook + provider_events    |
| Интеграции | Idempotency keys                        | MVP                                   | обязательно                         |
| Интеграции | Metadata                                | MVP                                   | контракт из п.2                     |


Для каждой строки — короткое описание API endpoint + наша точка интеграции + ссылка на canonical write-path, если применимо.

### 4. `.lovable/discovery/stripe_admin_configuration_matrix.md`

Карта "что админ настраивает у нас vs в Stripe Dashboard". Цель — минимизировать заходы в Dashboard.

Разделы:

1. **Глобальные настройки интеграции** (`/admin/integrations/acquiring`): аккаунт (account_code, ключи), webhook URL+secret, список валют, список payment_method_types, дефолтный профиль.
2. **Настройки продукта** (`AdminProductsDocs` → вкладка "Эквайринг"): mapping → Stripe `Product` (auto-create при первой публикации), product metadata (`business_stream`, `account_code` override), tax_code (для будущего).
3. **Настройки тарифа** (`tariff_offers` editor → вкладка "Эквайринг"): mapping → Stripe `Price`, recurring (interval/interval_count), tax_behavior (inclusive default), валюта.
4. **Настройки платёжной кнопки/ссылки** (`CreatePublicLinkDialog` + Pricing block): провайдер (bepaid|stripe, default из продукта), валюта (default из tariff), payment_method_types (наследуется из профиля), профиль настроек.
5. **Настройки подписки**: trial period (Backlog), recurring (из tariff), finite cycles (installment), pause/resume actions (Phase 2).
6. **Настройки документов**: receipt email (default on для Stripe), invoice (per-tariff opt-in, Phase 2). ЭСЧФ остаётся bePaid-only.

Для каждой строки: где настраивается у нас, что улетает в Stripe API, что остаётся только в Dashboard (минимум — banking, payouts, KYC).

### 5. `.lovable/discovery/payment_provider_profiles_model_v1.md`

Проектирование сущности `payment_provider_profiles`:

- Поля: `id`, `code` (unique, например `stripe_standard`, `stripe_subscription_eu`, `stripe_documents`), `name`, `provider`, `account_code`, `default_currency`, `payment_method_types[]`, `mode` (`payment`|`subscription`|`setup`), `tax_behavior`, `locale`, `metadata`, `is_active`, `created_at`.
- Use-cases: create / clone / assign to payment_link / assign to tariff_offer.default_profile_code.
- Резолвер на checkout: `tariff_offer.profile_code` → `payment_link.profile_code` override → fallback на дефолтный профиль аккаунта.
- На MVP — НЕ создаём таблицу. Вместо неё `tariff_offers.meta.stripe_profile = {...inline...}` + helper `resolveProfile(tariff, link, account)`. Таблица появляется в Фазе 3, когда профилей станет 5+.
- Шаблоны inline-профилей на старт: `stripe_standard_byn`, `stripe_standard_eur`, `stripe_subscription_eur`, `stripe_documents_eur`.

### 6. `.lovable/discovery/stripe_currency_support_v1.md`

- Архитектурный whitelist: `EUR`, `PLN`, `USD`, `BYN`, `RUB`.
- Discovery-задача (выполняется в начале Фазы 1 через тест-вызов Stripe API): запросить у Stripe Poland аккаунта `account.capabilities` + `country_specs/PL` — получить фактически поддерживаемые `presentment_currencies` и `payment_method_types`.
- Результат фиксируется в этом файле как таблица `currency × payment_method × supported_by_account`.
- UI всегда показывает полный whitelist, недоступные валюты — disabled с tooltip "не поддерживается аккаунтом Stripe Poland".
- Конверсионная логика: settlement currency аккаунта (вероятно EUR/PLN) + presentment в выбранной валюте через Stripe `Adaptive Pricing` (если доступно) либо через ручной `unit_amount` в minor units.
- BYN/RUB — почти наверняка недоступны на Stripe Poland → флаг "stripe_unavailable" → fallback на bePaid в UI.

### 7. `.lovable/discovery/open_questions_stripe_v2.md`

Обновлённый список открытых вопросов (заменяет v1):

- Q1: подтвердить, что Stripe Poland — единственный аккаунт на старте; `account_code = 'stripe_poland'`.
- Q2: список products/tariffs для пилота Фазы 2.
- Q3: какие 4-5 стартовых профилей нужны (предложения в файле, ждём ✓).
- Q4: получены ли webhook secret + restricted API key с правами `checkout_sessions:write, payment_intents:read, subscriptions:write, refunds:write, webhook_endpoints:read`?
- Q5: business_stream mapping для существующих 18 продуктов — приложить таблицу.

---

## Структура работ (порядок)

1. Создать 7 артефактов выше (один turn, параллельно).
2. Обновить `.lovable/plan.md`: пометить Discovery v1 как `superseded → v2`, добавить ссылки на новые файлы.
3. Обновить `.lovable/discovery/acquiring_map_v1.md` дельта-блоком "v1.1 patches applied": ссылки на 6 новых артефактов + правка раздела "Поля-крючки" (добавить `account_code`, `business_stream`, `profile_code` как опциональные поля meta).
4. Ответить пользователю: discovery v1.1 закрыт, переходим к Фазе 1 без дополнительного согласования (как требует патч "Не блокировать Фазу 1").

---

## DoD discovery v1.1

- ✅ 7 новых markdown-артефактов в `.lovable/discovery/`.
- ✅ `acquiring_map_v1.md` дополнен дельтой v1.1.
- ✅ `.lovable/plan.md` отражает переход v1 → v1.1 → Фаза 1.
- ✅ Никаких изменений в коде, миграциях, edge functions, БД, frontend, RLS, audit.
- ✅ bePaid флоу не затронут — ноль diff'ов в `bepaid-*`, `create-payment-checkout.ts`, `payment_links` schema.
- ✅ Build green (нет изменений кода).
- ✅ Все артефакты содержат явные пометки `MVP | Phase2 | Backlog` и `single-account-now / multi-account-ready`.

После этого — автоматический переход к Фазе 1 (provider abstraction + payment_links.provider/account_code/profile_code/business_stream + adapter layer + Integrations → Acquiring UI), описанной в исходном плане Stripe v1.