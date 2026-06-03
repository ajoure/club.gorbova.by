# да, согласен, с учетом правок:

1. **Не создавать таблицу** `stripe_accounts` **в Phase 3.1**
  - Сейчас уже есть модель acquiring accounts и `account_code`.
  - Сначала сделать discovery фактического использования существующих таблиц/настроек.
  - Новая таблица допустима только если доказано, что существующая модель не покрывает multi-account Stripe.
  - Иначе получим дублирование SOT.
2. **Customer Portal не ограничивать только подписками**
  - В Phase 3.1 сразу проверить сценарии:
    - сохраненная карта;
    - история платежей;
    - обновление карты;
    - отмена подписки;
    - смена карты на активной подписке.
  - В proof приложить фактический перечень возможностей Portal для нашего аккаунта Stripe.
3. **Пилот “Платная консультация” расширить**
  - Проверить:
    - разовый платеж;
    - повторный платеж того же клиента;
    - сохранение карты;
    - оплата другой консультации той же картой.
  - Это позволит проверить Customer → PaymentMethod → повторное использование карты еще до подписок.
4. **Добавить отдельный этап Discovery перед реализацией подписок**
  - Проверить фактическую совместимость текущих:
    - `subscriptions_v2`
    - `provider_subscriptions`
    - `subscription-actions`
    - `subscriptions-reconcile`
    - `nightly-access-reconcile`
    - `grant-access-for-order`
  - Сформировать карту:
  - Только после этого переходить к C1–C6.
5. **Provider Migration усилить**
  - Добавить обязательный dry-run.
  - Добавить блокировку массовых миграций.
  - Добавить proof:
6. **Multi-account**
  - В каждом runtime proof обязательно показывать:
    - account_code;
    - business_stream;
    - Stripe customer;
    - Stripe subscription;
    - Stripe payment.
  - Нужно доказать, что код реально account-aware, а не просто хранит поле.
7. **Добавить обязательный PATCH**
  - Проверить весь текущий Stripe-код на хардкод:
  - Сформировать отдельный отчет:
  - До начала live-фазы все подобные места должны быть устранены или внесены в backlog с явным планом замены.
8. **Phase 3.1 завершать только после дополнительного proof**
  - Реальный цикл:
  - Если хотя бы одно звено не подтверждено фактами — Phase 3.1 не закрывать.

В остальном план выглядит корректным и соответствует ранее утвержденным решениям по:

- Stripe как SOT по картам;
- Customer Portal как MVP;
- cross-provider duplicate guard;
- cancel → supersede → create new;
- multi-account архитектуре;
- пилоту через продукт «Платная консультация».
- &nbsp;
- План: Stripe Phase 3.1 — Implementation Plan

## Принципы (фиксируются на всю фазу)

1. **Пилот сначала.** Сначала one-time Stripe Checkout на продукте «Платная консультация». Подписки/Schedule не включаются до закрытия пилота.
2. **bePaid заморожен.** Никаких изменений в `bepaid-*` edge functions, `subscriptions_v2` для bePaid, `provider_subscriptions` bePaid-веток, RPC `record_refund_atomic_multi` за пределами add-only расширений Stripe-веток.
3. **Test-mode only.** Live-ключи не подключаются, live webhook endpoint не создаётся. Все proof — на test-mode объектах.
4. **Stripe = SOT по картам.** Локального хранилища PAN/токенов не появляется. Карты живут в Stripe (`Customer` + `PaymentMethod`), наши ссылки — в `meta.stripe.*` и `provider_subscriptions`.
5. **Customer Portal — MVP для self-service.** Управление картами и отменой подписок в MVP делается через нативный Billing Portal Stripe. Свой UI карт/отмен не строим.
6. **Multi-account и business_stream сразу.** Все новые таблицы/поля/ключи хранят `account_code` (nullable, default — основной аккаунт), резолвер ключей — через `account_code`. Никаких допущений «Stripe один».
7. **Add-only.** Никаких rename/drop колонок, никаких изменений семантики существующих полей, никаких ломающих миграций. Все новые поля — nullable, все новые таблицы — отдельные, существующие RPC расширяются только через новые параметры с default.
8. **Все proof и отчёты — на русском**, в `.lovable/proofs/` и `.lovable/discovery/`.

---

## Этап A. Подготовка инфраструктуры (общая для пилота и подписок)

### A1. Secrets и multi-account резолвер

- Не вводим новые секреты на этом этапе сверх уже подключённых `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` для основного аккаунта.
- Создаём `supabase/functions/_shared/stripe-account-resolver.ts`:
  - Вход: `account_code?: string | null`.
  - Выход: `{ secretKey, webhookSecret, accountCode }`.
  - MVP: один аккаунт (`default`). Архитектурно подготовлено к мульти: маппинг `account_code → ENV name` в одном месте, без хардкода в бизнес-логике.
- Документируем шаблон имён будущих секретов: `STRIPE_SECRET_KEY__<ACCOUNT_CODE>`, `STRIPE_WEBHOOK_SECRET__<ACCOUNT_CODE>`. Сами секреты добавятся только когда появится второй аккаунт.

### A2. Add-only миграция: расширения метаданных

Одна миграция, только add-only:

- `orders_v2`: ничего не меняем структурно; продолжаем писать `meta.stripe.{checkout_session_id, payment_intent_id, charge_id, customer_id, account_code, business_stream}`.
- `subscriptions_v2`: ничего не меняем структурно; для Stripe всё в `meta.stripe.*` (см. discovery D2).
- `provider_subscriptions`: ничего структурно; используем существующие колонки, плюс `meta.stripe.{subscription_id, schedule_id, customer_id, account_code, business_stream, latest_invoice_id, current_period_start, current_period_end}`.
- Новая таблица `stripe_accounts` (опционально, не блокирует пилот; решаем после A1):
  - `account_code text PK`, `display_name text`, `business_stream text null`, `is_active bool default true`, `created_at`, `updated_at`.
  - GRANT по стандарту, RLS: SELECT для `authenticated` (без PII), полный доступ `service_role`.
  - Если не успеваем — выносим в B-этап, MVP читает hardcoded `default`.

### A3. Регистрация edge-функций

- Добавляем записи в `edge_functions_registry` для всех новых функций пилота (см. ниже) с описанием на русском.

DoD этапа A: резолвер работает, миграция применена, существующие Stripe one-time платежи (Phase 2) не сломаны.

---

## Этап B. Пилот «Платная консультация» (one-time Stripe Checkout)

Цель: провести минимум 1 реальный test-mode заказ через Stripe на продукте «Платная консультация», с полным циклом: checkout → payment → webhook → `payments_v2` → `orders_v2` → `grant-access-for-order` → entitlement → UI.

### B1. Выбор пилотного продукта

- Продукт «Платная консультация» (consultation.gorbova.by).
- Выбираем один активный one-time `tariff_offer` (pay_now). Никаких массовых изменений тарифов: помечаем оффер `meta.stripe_pilot = true` (add-only).
- bePaid-оффер остаётся параллельно живым; пилот идёт на отдельном test-mode флоу.

### B2. Edge function `stripe-create-checkout` (consultation pilot)

- Если уже существует обобщённая функция Phase 2 (см. репозиторий) — расширяем её только добавлением необязательного параметра `business_stream`, `account_code` (default — основной аккаунт). Никакого rename.
- Если функции нет под consultation use-case — создаём `stripe-create-checkout-consultation` (тонкая обёртка над общим helper). Без дублирования бизнес-логики.
- Вход: `offer_id`, `user_id?`/guest contact, `success_url`, `cancel_url`, `account_code?`, `business_stream?`.
- Поведение:
  - Резолвит `account_code` → секрет (через A1).
  - Создаёт/находит Stripe `Customer` (см. B3).
  - Создаёт `Checkout Session` (`mode=payment`, `payment_method_types=[card]`, `customer`).
  - Pre-creates `orders_v2` в статусе `pending` с `meta.stripe = { account_code, business_stream, checkout_session_id, customer_id }`, `tracking_id = stripe:cs_test_...`.
  - Возвращает `url` Checkout Session.

### B3. Customer resolver

- Helper `_shared/stripe-customer-resolver.ts`:
  - По паре `(account_code, user_id|email)` ищет существующий `meta.stripe.customers[account_code].customer_id` в `profiles.meta` (add-only, через JSON merge) или создаёт новый.
  - Никогда не считает Stripe customer уникальным глобально: всегда per-account.

### B4. Webhook расширение (test-mode)

- Расширяем существующий `stripe-webhook` (add-only ветки):
  - `checkout.session.completed` (mode=payment): подтверждаем pre-created `orders_v2`, апдейтим `payments_v2`, дёргаем `grant-access-for-order`. Идемпотентность — по `provider_events.event_id`.
  - `payment_intent.succeeded`/`charge.refunded` — уже покрыты Phase 2.
- Конфликт (mismatch `order_id`/`customer`/`amount`) → HTTP 200 + `manual_review` audit, без INSERT.
- Все события резолвят `account_code` через webhook secret (в MVP — один, но код не делает допущений).

### B5. UI пилота

- На странице продукта «Платная консультация» в `PaymentDialog` появляется выбор провайдера, **только если** оффер помечен `meta.stripe_pilot = true` И флаг `stripe_pilot_enabled` в `app_settings` = true.
- По умолчанию (`stripe_pilot_enabled = false`) UI не меняется — bePaid остаётся единственным видимым провайдером.
- Никаких изменений в guest-checkout контракте (`guest-checkout-standard`).

### B6. Customer Portal (MVP self-service)

- Edge function `stripe-billing-portal-session`:
  - Принимает `user_id` (JWT) и `account_code?`.
  - Резолвит `customer_id` пользователя для этого аккаунта.
  - Создаёт `BillingPortal.Session` и возвращает `url`.
- В `/cabinet` (раздел «Платежи и подписки») добавляется кнопка «Управление картами и подписками (Stripe)» — показывается, только если у пользователя есть Stripe `customer_id` хотя бы в одном аккаунте.
- Свой UI карт/отмены не строим.

### B7. Runtime verification пилота (10 пунктов, аналог Phase 2)

Проводим в test-mode на реальной Checkout-сессии. Проверяем:

1. Checkout Session создан, `account_code` корректный.
2. Карта в Stripe сохранена в правильном `Customer` (per-account).
3. `provider_events` записан без дублей (idempotency).
4. `payments_v2` обновлён (status, amount, currency, provider_payment_id).
5. `orders_v2` переведён в `paid` через `grant-access-for-order`, без manual INSERT прав.
6. Entitlement выдан, `expires_at` рассчитан по `tariff_offers`.
7. UI кабинета показывает покупку и доступ.
8. Customer Portal открывается, карта видна, отмена доступна (для one-time — только просмотр карты).
9. Refund через `stripe-admin-refund` корректно прокидывается до `record_refund_atomic_multi` и `orders_v2.status = refunded` (или partial).
10. bePaid-флоу на других продуктах в test-mode не сломан (smoke по 1 заказу bePaid).

Proof: `.lovable/proofs/stripe_phase_3_1_pilot_consultation_runtime.md` (русский).

DoD этапа B: 10/10 PASS, пилот принят, флаг `stripe_pilot_enabled` оставляем в OFF до отдельного решения о расширении на другие one-time продукты.

---

## Этап C. Подписки (Stripe Subscriptions + Subscription Schedule)

Этап C **не начинается**, пока этап B не закрыт.

### C1. Резолверы и helper'ы

- `_shared/stripe-subscription-resolver.ts`:
  - Маппит `subscriptions_v2 ↔ Stripe Subscription` через `meta.stripe.subscription_id`.
  - Маппит finite installment через `meta.stripe.schedule_id` + `meta.installment.{cycles_total, cycles_done}`.
  - Per-account aware.
- Расширение `duplicate-subscription-prevention-guard` (add-only): проверка активной подписки по продукту независимо от провайдера (Stripe или bePaid).
- Helper `_shared/provider-migration.ts`: реализация контракта `cancel → supersede → create new` (см. discovery D9). Никаких автоматических миграций — только публичные функции для будущих admin-операций.

### C2. Edge functions подписок

- `stripe-create-subscription-checkout`: создание Checkout Session `mode=subscription` (для infinite) или Subscription через API + `setup_future_usage` (если потребуется), per-account, pre-create `subscriptions_v2` + `provider_subscriptions` в `pending`/`past_due`-аналоге.
- `stripe-create-subscription-schedule`: создание `Subscription Schedule` с `iterations=N`, `end_behavior=cancel` для finite installment.
- `subscription-actions` / `admin-actions`: add-only ветки `provider=stripe`:
  - `cancel` → `stripe.subscriptions.update(..., { cancel_at_period_end: true })` или `cancel_at` под установленный контракт.
  - `pause`/`resume` — только если поддерживается выбранной моделью (см. D4); иначе блокируем с понятной ошибкой.
  - `replace` → строго `cancel → supersede → create new`, без in-place изменений Stripe Subscription.

### C3. Webhook расширение для подписок

- Добавляем ветки `customer.subscription.{created,updated,deleted}`, `invoice.{created,paid,payment_failed,finalized}`, `customer.subscription.trial_will_end` (если применимо).
- Все события:
  - Резолвят `account_code` по webhook secret.
  - Идемпотентны через `provider_events`.
  - Конфликты → HTTP 200 + `manual_review`, без INSERT.
  - `invoice.paid` → создаёт/апдейтит `orders_v2` (renewal), дёргает `grant-access-for-order`, который extend'ит существующую подписку по `tariff_id` (см. Extend ↔ Tariff Match SOT) или создаёт новую при mismatch — поведение строго совпадает с bePaid-контрактом.
- `bepaid-webhook` не трогаем.

### C4. Reconcile и reminders

- `nightly-access-reconcile` расширяется add-only веткой Stripe: pull `subscription.status` для активных `subscriptions_v2` с `meta.stripe.subscription_id`, без перезаписи `access_end_at`, если Stripe `current_period_end` уезжает дальше SOT (аналог bePaid overshoot guard).
- Reminders (7/3/1) читают `subscription_reminder_*` без изменений; ничего провайдер-специфичного.

### C5. UI/Admin

- Кнопка «Управление подпиской» в кабинете → Customer Portal (B6) для Stripe-подписок.
- В `/admin/payments/links` — read-only badge провайдера (`stripe`/`bepaid`) рядом с записью; никаких новых writer-функций.
- В `/admin` карточки подписки — провайдер-агностичная отрисовка, действия `cancel/replace` идут через `subscription-actions` (C2).

### C6. Runtime verification подписок (10 пунктов)

Test-mode. Покрывает: infinite create, renewal (`invoice.paid`), failure (`invoice.payment_failed`), cancel-at-period-end, replace (cancel→supersede→create new), finite installment (`Subscription Schedule` с `iterations=2` для скорости), Customer Portal — отмена, Customer Portal — смена карты, duplicate guard (попытка создать вторую подписку на тот же продукт), reconcile overshoot guard.

Proof: `.lovable/proofs/stripe_phase_3_1_subscriptions_runtime.md` (русский).

DoD этапа C: 10/10 PASS, отчёт принят, live-режим **не включается** (отдельным решением Phase 3.2).

---

## Этап D. Закрытие Phase 3.1

- Итоговый отчёт `.lovable/proofs/stripe_phase_3_1_final.md` (русский):
  - Что прошло / что не прошло.
  - Какие баги нашли и как закрыли.
  - Список deferred-микропунктов.
  - Готовность к Phase 3.2 (live-режим, расширение пилота на другие продукты).
- Memory обновляем только после явного approve пользователя (новые правила: Stripe SOT по картам, multi-account резолвер, Customer Portal как MVP self-service, провайдер-агностичный duplicate-guard).

---

## Технические детали (для разработчика)

### Затрагиваемые сущности (только add-only)

- **Новые edge functions**: `stripe-billing-portal-session`, `stripe-create-subscription-checkout`, `stripe-create-subscription-schedule` (C-этап). Возможно `stripe-create-checkout-consultation` (если общий helper не покрывает).
- **Новые shared helpers**: `_shared/stripe-account-resolver.ts`, `_shared/stripe-customer-resolver.ts`, `_shared/stripe-subscription-resolver.ts`, `_shared/provider-migration.ts`.
- **Расширения существующих** (add-only ветки/параметры): `stripe-webhook`, `stripe-admin-refund`, `subscription-actions`, `admin-actions`, `duplicate-subscription-prevention-guard`, `nightly-access-reconcile`, `grant-access-for-order` (только через существующий контракт расширения метаданных, без изменения SOT-логики).
- **Миграции**: одна add-only миграция этапа A; опциональная `stripe_accounts` таблица.
- **UI**: `PaymentDialog` (флаг-гейт), `/cabinet` (Customer Portal button), `/admin/payments/links` (badge провайдера).

### Что **не** меняется

- `bepaid-*` функции, `bepaid_*` таблицы.
- `record_refund_atomic_multi` (используем как есть).
- `subscriptions_v2`/`orders_v2`/`provider_subscriptions` schema (только `meta.*`).
- `src/integrations/supabase/client.ts`, `types.ts`, `.env`.
- Существующие политики RLS на старых таблицах.

### Риски и митигации

- **Mis-routing webhook между аккаунтами**: резолвинг строго по webhook secret; при unknown secret → HTTP 200 + `provider_webhook_orphans`.
- **Customer ID коллизии**: customers per-account, никогда не глобально.
- **Конфликт duplicate-guard со старыми bePaid-подписками**: guard расширяется add-only, существующая bePaid-логика не трогается.
- **Случайное создание live-объектов**: только test-mode секреты в Lovable Cloud Test environment; live секреты не добавляются в Phase 3.1.

---

## Definition of Done всей Phase 3.1

1. Этапы A, B, C пройдены, runtime proof по 10 пунктов на каждом из B и C.
2. bePaid ничего не сломано (smoke-проверка в test-mode).
3. Customer Portal работает self-service для карт и отмены подписок Stripe.
4. Multi-account и business_stream учтены в коде, даже если в проде один аккаунт.
5. Все изменения add-only, никаких rename/drop.
6. Все proof и отчёты — на русском, в `.lovable/proofs/` и `.lovable/discovery/`.
7. Live-режим **не** включён; решение по live откладывается до Phase 3.2.