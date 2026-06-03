# Да, согласен, с учетом правок:

1. D10 (Multi-Account Stripe) нужно расширить.

Сейчас описан только Multi-Stripe.

Добавить обязательный раздел:

### **Multi-Business Stream**

Один Stripe-аккаунт может обслуживать несколько бизнес-направлений.

Пример:

- Консультации
- Клуб
- Обучение
- Подписки
- Будущие продукты

Поэтому Discovery должен описать:

- account_code ≠ business_stream;
- один account_code может обслуживать много business_stream;
- один business_stream в будущем может быть переведен на другой account_code;
- аналитика должна поддерживать одновременно:
  - provider
  - account_code
  - business_stream
  - product
  - tariff

Это важно для будущей финансовой аналитики.

---

2. D9 (Provider Migration Strategy) дополнить.

Сейчас описан только перенос подписок.

Добавить отдельный раздел:

### **Existing Payment Method Migration**

Сценарии:

- bePaid карта → Stripe карта
- Stripe карта → bePaid карта

Требование:

Никогда не пытаться переносить токены карты между провайдерами.

Новый провайдер всегда требует новую привязку карты.

Discovery должен явно зафиксировать это ограничение.

---

3. D11 (Stripe Feature Inventory) дополнить.

Добавить отдельный блок:

### **Возможности Stripe, которые желательно подготовить архитектурно уже сейчас**

Даже если они не входят в MVP:

- Checkout Session branding
- Customer Portal branding
- Promotion Codes
- Coupons
- Invoices
- Setup Intent
- Saved Payment Methods
- Multiple Payment Methods
- Apple Pay
- Google Pay
- SEPA
- BLIK
- Bancontact
- iDEAL

Для каждой возможности указать:

- поддерживается ли Stripe из коробки;
- требует ли изменений в нашей архитектуре;
- нужно ли резервировать место в модели данных.

---

4. D4 (Lifecycle Contract) дополнить.

Обязательный раздел:

### **Источник истины по подписке**

Зафиксировать заранее:

Stripe является источником истины по состоянию Stripe-подписки.

Наша БД является источником истины по доступам пользователя.

Если возникает конфликт:

- Stripe active + доступ закрыт → восстановление доступа;
- Stripe canceled + доступ открыт → анализ entitlement, затем отзыв доступа;
- любые конфликтные случаи → manual_review.

Это нужно описать до начала реализации.

---

5. D5 (Webhook Plan) дополнить.

Добавить обязательный раздел:

### **Lost Webhook Recovery**

Так как уже был найден реальный баг с отсутствующим webhook endpoint.

Необходимо заранее описать:

- webhook path;
- reconcile path;
- polling fallback path.

Система не должна зависеть исключительно от webhook.

Должен существовать план восстановления:

Stripe API → reconcile → восстановление состояния подписки и платежей.

---

6. D6 (Admin Inventory) дополнить.

Добавить инвентаризацию будущих пользовательских экранов:

- Мои подписки;
- Способ оплаты;
- Управление картой;
- Customer Portal;
- История списаний.

Даже если реализовываться будут позже.

Иначе Discovery получится только про админку.

---

7. Pilot Scope скорректировать.

Полностью согласен:

Первый пилот = «Платная консультация».

Но обязательно добавить:

После успешного завершения пилота консультаций повторно пройти весь Runtime Verification уже на клубе.

Именно клуб является основной нагрузкой системы.

Поэтому консультации = технический пилот.

Клуб = финальное подтверждение архитектуры.

---

8. Добавить новый документ.

### **D12. Stripe Data Ownership Matrix**

Таблица:


| **Сущность** | **Stripe** | **Наша БД** | **SOT** |
| ------------ | ---------- | ----------- | ------- |


Для:

- Customer
- Payment Method
- Checkout Session
- Subscription
- Subscription Schedule
- Invoice
- Refund
- PaymentIntent
- Access
- Entitlement
- Subscription Window

Это позволит избежать будущих конфликтов архитектуры.

---

9. Definition of Done расширить.

Discovery считается завершенным только если:

- созданы D1–D12;
- для каждого документа есть раздел:
  - Что является SOT;
  - Что хранится локально;
  - Что хранится в Stripe;
  - Как выполняется recovery;
  - Как работает multi-account.

Без этих разделов Discovery считать неполным.

После этих правок план выглядит достаточно полным для старта Discovery Phase 3. Новых архитектурных вопросов, которые блокируют начало Discovery, у меня сейчас нет. Основные решения по токенизации, Portal, рассрочкам, миграции между провайдерами, Multi-Stripe и пилоту консультаций уже приняты.

&nbsp;

План: Stripe Phase 3 — Subscriptions Discovery (v2, с утверждёнными решениями)

## Контекст и инварианты

- Phase 2 принята условно закрытой (10/10 runtime). Открытые micro-items — в deferred, Phase 3 не блокируют.
- Phase 3 = **только discovery + план**. Никакого кода, миграций, edge-функций, UI, live-режима.
- Все артефакты — на русском, в `.lovable/discovery/`.
- Жёсткие freeze:
  - bePaid recurring изолирован, не трогаем.
  - `subscriptions_v2` / `provider_subscriptions` — SOT, расширение только через `meta.*`, новых колонок не добавляем без отдельного approve.
  - `record_refund_atomic_multi`, `grant-access-for-order`, bePaid edge-функции — не модифицируются.

## Утверждённые архитектурные решения (зафиксированы пользователем)

1. **Токенизация карт.** Stripe = SOT для карт. Свой слой хранения токенов не строим. Используем нативные `Customer`, `PaymentMethod`, `SetupIntent`, `Subscription`. Локально храним только ссылки в `meta`.
2. **Customer Portal.** MVP управления картами/историей/документами/отменой подписки — нативный Stripe Billing Portal. Свой UI откладываем; в discovery описываем путь миграции на собственный кабинет через Stripe API.
3. **Бесконечные подписки vs рассрочки.** Клубы/членство/доступ → `Subscription`. Рассрочки/finite N платежей → `Subscription Schedule` (`iterations=N`, `end_behavior=cancel`). Маппинг Schedule → `subscriptions_v2/provider_subscriptions` описываем в D4.
4. **Миграция между эквайрингами.** На одном продукте — только одна активная подписка независимо от провайдера. Любая смена (bePaid↔Stripe, Stripe A↔Stripe B) = строго `cancel → supersede → create new`. Расширяем `duplicate-subscription-prevention-guard` на Stripe.
5. **Multi-Stripe.** Поддержка неограниченного числа Stripe-аккаунтов: `account_code` как SOT, `customer_id_by_account`, `provider_subscription_id_by_account`, фильтры/аналитика/webhook routing по `account_code`. Никаких предположений о единственности Stripe.
6. **Первый пилот = «Платная консультация».** Разовые платежи, нет риска массовых автосписаний, быстрый runtime proof. Subscriptions/Schedule подключаем после полного прохождения жизненного цикла на консультациях.

## Этап 3.0 — Discovery deliverables

Каждый файл — отдельный артефакт в `.lovable/discovery/`. Без кода.

### D1. `stripe_subscriptions_capabilities_v1.md`

Карта возможностей Subscriptions/Schedule: статусы, billing cycle anchor, `payment_behavior=default_incomplete`, dunning, grace, pause/resume, webhook-события (`customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`). Trial/proration — не MVP.

### D2. `stripe_subscriptions_object_mapping_v1.md`

Расширение `stripe_object_mapping_v1.md`:

- `subscriptions_v2` ↔ Stripe `Subscription` (1:1);
- `provider_subscriptions` ↔ `sub_*` (поле `provider_subscription_id`);
- `Invoice` + `PaymentIntent` + `Charge` ↔ цикл списания = отдельный `orders_v2`;
- `Subscription Schedule` ↔ `subscriptions_v2` с `meta.stripe.schedule_id` + `meta.installment.{cycles_total, cycles_done}`;
- таблица переходов статусов Stripe ↔ наши;
- хранение `customer_id` per account: `contacts.meta.stripe.customer_id_by_account = { <account_code>: 'cus_*' }`.

### D3. `stripe_vs_bepaid_subscription_parity_v1.md`

Матрица паритета и зоны несовместимости с memory:

- `duplicate-subscription-prevention-guard` — расширить на Stripe + cross-provider;
- `safe-replacement-flow` — explicit cancel→supersede обязателен в т.ч. для cross-provider миграции;
- `auto-renew-logic-standard-v2`, `extend-tariff-match-required`, `installment-public-link-finite-subscription` (Stripe-аналог через Schedule), `subscriptions-v2-schema-contract` (meta-only), `auto-renewals-cohort-sot`, `provider-linked-extend-priority`, `bepaid-active-to-overshoot-guard` (Stripe-аналог), `inv22-desync-resolution` (Stripe-аналог), `recurring-snapshot-resolver-sot`, `resume-three-level-eligibility`.

### D4. `stripe_subscription_lifecycle_contract_v1.md`

Жизненный цикл (включая Subscription Schedule):

- **Create (infinite):** pre-create `subscriptions_v2`+`provider_subscriptions(pending)` → Stripe `Subscription` (`payment_behavior=default_incomplete`) → первый `invoice.paid` → `grant-access-for-order`.
- **Create (finite/installment):** pre-create + Stripe `Subscription Schedule` с `phases[].iterations=N`, `end_behavior=cancel` → каждый `invoice.paid` материализуется как `orders_v2`, инкремент `meta.installment.cycles_done`.
- **Renewal:** `invoice.paid` → отдельный `orders_v2` → `grant-access-for-order` → extend по `tariff_match`.
- **Failure:** `invoice.payment_failed` → `past_due`, без revoke в grace; Smart Retries управляются Stripe.
- **Cancel/supersede:** канонический путь, разный для self-cancel (Portal) и admin/cross-provider миграции.
- **tracking_id:** `stripe_sub:{sub_id}:order:{order_id}` (parity с bePaid `subv2:...:order:...`).

### D5. `stripe_subscriptions_webhook_plan_v1.md`

План расширения `stripe-webhook`:

- список новых event-типов (включая Schedule, Portal, Invoice);
- идемпотентность через существующий `provider_events_idem_unique`;
- резолв `account_code` через signing secret эндпоинта;
- запрет прямых INSERT в `subscriptions_v2` мимо резолвера;
- conflict → HTTP 200 + `manual_review` (no order_id, tariff mismatch, sbs mismatch, foreign account).

### D6. `stripe_subscriptions_ui_admin_inventory_v1.md`

Инвентаризация затрагиваемых UI/edge-точек (без модификации): `PaymentDialog`, `/admin/payments/links`, `/admin/integrations/acquiring`, `subscription-actions`, `subscription-admin-actions`, `subscriptions-reconcile`, `subscription-renewal-reminders`, `subscription-grace-reminders`. Особый блок: интеграция Customer Portal (ссылка из кабинета пользователя, без собственного UI карт).

### D7. `stripe_subscriptions_open_questions_v1.md`

Открытые вопросы до execute (после Решений 1–6 многое снято):

- coexistence: одновременные подписки разных провайдеров на **разных** продуктах разрешены (по Решению 4 запрет только на одном продукте);
- dunning policy: Smart Retries defaults vs наш кастом;
- финальный список Stripe-аккаунтов под MVP пилота консультаций (предположительно один: `stripe_poland`);
- какие именно «документы Stripe» отдаём через Portal, не пересекаются ли с нашим documents-pipeline (ЭСЧФ остаётся bePaid-only).

### D8. `stripe_subscriptions_risk_register_v1.md`

Риски и mitigations: двойное списание, расхождение access window, зомби-подписки, ошибочный grant без матча, регрессия bePaid, рассинхрон Customer Portal vs наша БД.

### D9. `provider_migration_strategy_v1.md` (новый, по Решению 4)

Полная стратегия миграции:

- сценарии bePaid→Stripe, Stripe→bePaid, Stripe A→Stripe B;
- единый протокол: `cancel @ provider` (provider-managed cancel обязателен) → локальный `supersede` старой `subscriptions_v2` → `create new` под новым `account_code`/провайдером;
- запрет «двух активных» через расширенный `duplicate-subscription-prevention-guard` (cross-provider, cross-account);
- что делать с `entitlements`/access window (не уменьшаем, GREATEST);
- audit-actions: `provider_migration.cancel_old`, `provider_migration.supersede`, `provider_migration.create_new`, `provider_migration.blocked_active_exists`;
- rollback-сценарии и manual_review-кейсы.

### D10. `multi_account_stripe_architecture_v1.md` (новый, по Решению 5)

- `account_code` как SOT, схема резолвера (signing secret → account_code);
- хранение per-account ID: `contacts.meta.stripe.customer_id_by_account`, `provider_subscriptions.meta.account_code` + (опц.) `provider_subscription_id_by_account` snapshot;
- секреты по convention `STRIPE_*_<ACCOUNT_CODE>` с fallback на глобальные (см. `acquiring_accounts_model_v1.md`);
- webhook routing: отдельный endpoint per account_code;
- фильтры и аналитика в админке (фильтр по account_code, разрезы выручки/подписок);
- DoD: ни одна точка чтения секретов/ID не предполагает единственность Stripe.

### D11. `stripe_feature_inventory_full_v2.md` (новый, по Решению 6 + расширение существующего `stripe_feature_inventory_full.md`)

Полный реестр возможностей с категориями **MVP / Phase 4 / Future** и для каждой: что делает, зачем нужна, используем ли сейчас, преимущество для платформы.

- **MVP:** Checkout, Payment Links, Subscriptions, Subscription Schedules, Customer Portal, Setup Intents, Smart Retries, Automatic Card Updater.
- **Phase 4 (следующая очередь):** Coupons, Promotion Codes, Invoices, Billing Analytics.
- **Future / пока не нужно:** Tax, Connect, Revenue Recovery, Radar (при малых объёмах), Quotes, Sigma, Terminal, Issuing, Treasury, Climate.

Каждая строка — отдельный абзац с обоснованием. Документ заменяет существующий `stripe_feature_inventory_full.md` (старый остаётся как `v1` для истории).

## Этап 3.1 — Implementation Plan (после approve D1–D11)

Только список, без кода:

1. **Pilot scope «Платная консультация»** — разовый платёж через Stripe Checkout (используем уже работающий Phase-2 контур). Никаких Subscriptions/Schedule на пилоте. Цель — runtime proof полного жизненного цикла на отдельном бизнес-потоке.
2. **Multi-account готовность** (add-only): `payment_links.account_code` nullable, `payments_v2.meta.account_code`, `orders_v2.meta.account_code`, helper `_shared/acquiring/secrets.ts`. Без таблицы `acquiring_accounts`.
3. **Расширение duplicate-guard** на Stripe + cross-provider (Решение 4).
4. **Provider Migration helper** (`_shared/provider-migration.ts`) — единый протокол cancel→supersede→create.
5. **Subscriptions block** (после consult pilot): `stripe-create-subscription-checkout`, `stripe-create-schedule`, расширение `stripe-webhook`, `_shared/stripe-subscription-resolver.ts`, ветки в `subscription-actions/admin-actions`, подключение к существующим cron (`subscriptions-reconcile`, reminders).
6. **Customer Portal интеграция:** edge `stripe-create-portal-session`, кнопка в кабинете пользователя; никакого собственного UI карт.
7. **Tests/proofs:** test-mode 10-пунктовая верификация (parity с Phase 2), отчёты на русском в `.lovable/proofs/`.

## Этап 3.2 — Runtime verification (после approve 3.1)

Test-mode only. Сначала пилот «Платная консультация» (one-time через Stripe), затем расширение на Subscriptions + Schedule. Live-режим — отдельным решением после approve отчёта.

## Definition of Done для Phase 3 Discovery

- Approve этого плана.
- Создание D1–D11 в `.lovable/discovery/` (отдельной сессией build mode).
- Никаких изменений кода, миграций, edge-функций, UI, секретов.
- Memory `duplicate-subscription-prevention-guard` помечено как «требует расширения на Stripe в Phase 3 implementation», без правки кода.

## Deferred (из Phase 2, не блокируют Phase 3)

1. Inherited double-count в формуле `prior_refunded` RPC.
2. Follow-up runtime-проверка webhook refund-ветки без backfill после стабилизации деплоя.