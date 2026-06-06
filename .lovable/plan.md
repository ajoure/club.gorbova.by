да, согласен, с учетом правок:

1. **Не создавать Billing Portal Configuration лениво внутри runtime-запроса**

Пункт C сейчас содержит риск:

```text
при первом запуске создать configuration
```

Лучше разделить:

- Discovery фиксирует существующую configuration.
- Если configuration отсутствует — отдельный PATCH внутри Phase 3.3.
- `stripe-create-customer-portal-session` не должен менять конфигурацию Stripe во время пользовательского запроса.

Иначе обычный пользовательский вызов начинает выполнять административную настройку.

---

2. **Усилить ownership-проверку**

В B добавить:

Проверять не только:

```text
subscriptions_v2.user_id = auth.uid()
```

но и:

```text
profiles.id = auth.uid()
```

через актуальную модель профиля проекта.

Цель — исключить старые подписки с неконсистентным user_id.

---

3. **Уточнить G28**

Сейчас:

```text
customer.subscription.updated
```

не всегда приходит при смене карты.

&nbsp;

Добавить:

```text
payment_method.attached
customer.updated
```

как допустимые подтверждающие события.

DoD:

Подтверждаем обновление `default_payment_method`, а не конкретный тип webhook.

---

4. **Не хранить last4/brand как Source of Truth**

В E изменить формулировку:

Показывать:

```text
meta.stripe.default_payment_method snapshot
```

только как кэш.

&nbsp;

Источник истины:

```text
Stripe Customer Portal
```

Если snapshot отсутствует — UI не должен падать.

---

5. **Добавить G32.1**

Отдельная проверка после всех тестов:


| **Проверка**    | **Ожидание** |
| --------------- | ------------ |
| entitlements    | Δ = 0        |
| access_rules    | Δ = 0        |
| Telegram access | Δ = 0        |


Это критично, потому что весь смысл Portal — управление биллингом без вмешательства в доступы.

---

6. **Добавить audit для открытия Portal**

Сейчас есть:

```text
stripe.portal.session_created
```

Добавить отдельно:

```text
stripe.portal.session_opened
```

если событие можно подтвердить через return flow или webhook-косвенно.

Если нельзя достоверно определить открытие — зафиксировать в discovery и оставить только `session_created`.

---

7. **Backlog после Phase 3.3**

Сразу сохранить в backlog:

```text
Phase 3.4
Stripe Dunning + Smart Retries + Failed Payment Recovery
```

Но не включать в текущий scope.

---

После этих дополнений план соответствует мастер-спринту, не нарушает add-only и не создаёт скрытых побочных эффектов через Customer Portal.

&nbsp;

План: Phase 3.3 — Stripe Customer Portal + Self-Service Subscription Management

## Цель

Дать клиенту самообслуживание по Stripe-подписке через нативный Stripe Customer Portal. Свой billing UI не строим — Portal является SOT для карты/инвойсов/cancel.

## Жёсткие границы (add-only)

- bePaid не трогаем. PaymentDialog/Checkout/webhook lifecycle/grant-access-for-order не меняем.
- PCI guard в силе: никаких raw card данных, никаких helper edge functions.
- Live mode выключен. Только test.
- Никаких новых таблиц/колонок. Все ссылки через `meta`.

## Этап A. Discovery (read-only)

Подтвердить и зафиксировать в `.lovable/discovery/stripe_customer_portal_inventory_v1.md`:

- `customer_id` хранится в `profiles.meta.stripe.customers[<account_code>].customer_id` (подтверждено `stripe-webhook/index.ts` стр. 166–195).
- `subscription_id` и `account_code` — в `subscriptions_v2.meta.stripe.{subscription_id, account_code}` + `provider_subscriptions.{provider_subscription_id, meta.account_code}`.
- Текущих обращений к Billing Portal в коде нет (grep по `customer_portal/billing_portal/portal-session` пуст).
- Карта (customer → subscription → account_code → portal session) фиксируется в файле discovery.
DoD: документ создан, код не менялся.

## Этап B. Edge function `stripe-create-customer-portal-session`

Канонический и единственный путь открытия Portal.

Контракт:

```
POST /stripe-create-customer-portal-session
Auth: JWT обязателен
Body: { "subscription_v2_id": "uuid", "return_url"?: "string" }
200:  { "url": "https://billing.stripe.com/..." }
4xx:  { "error": "<code>", "message": "..." }
```

Поведение:

1. Достаём `auth.uid()` из JWT. Без JWT → 401.
2. Читаем `subscriptions_v2` по id. Проверяем `user_id = auth.uid()` (владелец). Иначе 403 `not_subscription_owner`.
3. Проверяем `provider_subscriptions.provider = 'stripe'`. Иначе 400 `provider_not_stripe`.
4. Достаём `account_code` из `provider_subscriptions.meta.account_code` (fallback на `subscriptions_v2.meta.stripe.account_code`). Если нет → 400 `account_code_missing`.
5. Достаём `customer_id` из `profiles.meta.stripe.customers[account_code].customer_id`. Fallback — `subscriptions_v2.meta.stripe.customer_id`. Если нет → 400 `customer_id_missing`.
6. Получаем Stripe secret через `readAcquiringSecret('stripe', account_code, 'secret_key')` (как в `stripe-subscription-action`).
7. `POST https://api.stripe.com/v1/billing_portal/sessions` с `customer=<cus_*>` и `return_url=<return_url ∥ default>`.
8. Default `return_url` = `${PUBLIC_APP_URL}/account/subscription?sub=<subscription_v2_id>`.
9. Логирование audit (см. этап F). При Stripe error → 502 `stripe_api_error` + audit `portal_session_failed`.

PCI guard входа (как в 3.2): scan body на запрещённые ключи → 400 `pci_violation`. Никаких полей карты в input/output.

Stop-gates (HTTP 4xx + audit `portal_session_blocked_<reason>`):

- provider != stripe
- customer_id отсутствует
- subscription_id отсутствует
- account_code отсутствует
- пользователь не владелец
- portal configuration mismatch (Stripe вернул `configuration_invalid`)

## Этап C. Self-Service Access Rules (Stripe Portal configuration)

Через Stripe API сконфигурировать default Billing Portal Configuration на каждом test-аккаунте:

Разрешено:

- `payment_method_update.enabled = true`
- `invoice_history.enabled = true`
- `subscription_cancel.enabled = true`, `mode = at_period_end`, `proration_behavior = none`
- `subscription_cancel.cancellation_reason.enabled = true` (опц.)
- Resume отменённой подписки (Portal делает это автоматически, пока not yet ended).

Запрещено:

- `subscription_update.enabled = false` (нет смены продукта/тарифа/цены)
- `subscription_pause.enabled = false`
- Никаких promotion codes/coupons.

Реализация — одноразовый admin-CLI-style вызов в edge `stripe-create-customer-portal-session` при первом запуске на аккаунте (lazy create) ИЛИ через discovery-скрипт в B. Конфиг писать через `billing_portal/configurations` API. Configuration id кэшировать в `acquiring_connections.meta.stripe.portal_configuration_id` (add-only в meta).

## Этап D. Resume Cancellation

Webhook `customer.subscription.updated` уже обрабатывается (Phase 3.2 G21). Проверить и при необходимости расширить (add-only):

- Если приходит `cancel_at_period_end=false` после ранее `true` → снимаем `meta.stripe.cancel_at_period_end`, чистим `meta.stripe.cancel_requested_at`, добавляем `meta.stripe.cancel_resumed_at`.
- `subscriptions_v2.status` остаётся `active`, `entitlements` не трогаем, `access_grant_ledger` не пишем.
- Audit: `stripe.subscription.cancel_resumed_via_portal`.

## Этап E. Return Flow

- Default `return_url` → `/account/subscription?sub=<id>`.
- На странице `/account/subscription` (если её нет — план только в части кнопки, без редизайна) добавить read-only блок состояния подписки: статус, `current_period_end`, last4/brand карты из `meta.stripe.default_payment_method` snapshot, бейдж `cancel_at_period_end`.
- Кнопка «Управлять в Stripe» → вызывает `stripe-create-customer-portal-session` и `window.location = url`.

Если страницы `/account/subscription` нет — план Phase 3.3 ограничивается кнопкой в существующем кабинете подписок (точное место уточнить в discovery A). Никакого нового билинг-кабинета не строим.

## Этап F. Audit (через `audit_logs`, схема как в 3.2)

Actions:

- `stripe.portal.session_created`
- `stripe.portal.session_blocked_<reason>`
- `stripe.portal.payment_method_updated` (из webhook `customer.subscription.updated` при изменении `default_payment_method`)
- `stripe.portal.cancel_at_period_end_enabled`
- `stripe.portal.cancel_at_period_end_disabled`
Поля meta: `subscription_v2_id, stripe_customer_id, stripe_subscription_id, account_code, action, result, source: 'customer_portal'`.
Actor: `actor_type='user'`, `actor_user_id=auth.uid()` для session_created; `actor_type='system'` для webhook-производных.

## Этап G. Configuration verification

Edge function вернёт audit `portal_configuration_snapshot` с id конфигурации и discovery-документ зафиксирует разрешённый/запрещённый набор.

## Runtime Proof G26–G32

Прогон самостоятельно через browser automation + Stripe Hosted Portal (карта вводится только в Stripe UI). Фикстуры — две новые active Stripe-подписки по канону Phase 3.2 (Hosted Checkout → webhook → active).

- G26 Portal Session Create: вызов edge → URL начинается с `https://billing.stripe.com/`.
- G27 Portal Open: navigate, скриншот, подписка отображается, видны её current period и карта.
- G28 Payment Method Update: добавить новую test-карту `4242…` в Portal → webhook `customer.subscription.updated` пришёл → `meta.stripe.default_payment_method` обновился → audit `payment_method_updated`.
- G29 Enable cancel_at_period_end через Portal → webhook → `meta.stripe.cancel_at_period_end=true`, `entitlements.expires_at` НЕ изменён.
- G30 Disable (resume) → webhook → флаг снят, `status=active`, доступы целы.
- G31 Invoice History: страница инвойсов в Portal открывается, видим минимум 1 invoice (от активации).
- G32 bePaid Freeze: SQL diff по `subscriptions_v2 where provider='bepaid' updated_at > test_start` = 0.

Отчёт `.lovable/proofs/stripe_phase_3_3_customer_portal_v1.md` с `subscription_v2_id`, `cus_*`, `sub_*`, event_id, SQL before/after, скриншотами Portal.

## Файлы

- Создать: `supabase/functions/stripe-create-customer-portal-session/index.ts`
- Создать: `.lovable/discovery/stripe_customer_portal_inventory_v1.md`
- Создать: `.lovable/proofs/stripe_phase_3_3_customer_portal_v1.md`
- Изменить (add-only): `supabase/functions/stripe-webhook/index.ts` — обработка resume и payment_method updated в рамках уже существующей ветки `customer.subscription.updated`.
- Изменить: `supabase/functions.registry.txt` — регистрация новой функции (P1).
- Изменить: `.lovable/plan.md` — отметка Phase 3.3.
- Изменить: страница подписки в кабинете — кнопка «Управлять в Stripe» (точный файл подтвердить в A).

## Stop-Gates / Что НЕ делаем

- Свой billing UI, pause/resume schedules, dunning, reconcile, миграция bePaid→Stripe, live mode, multi-account UI, изменения access logic.

## DoD

- Customer Portal открывается, карта меняется, cancel/resume работают, инвойсы доступны, webhook lifecycle совместим, G26–G32 PASS, bePaid не затронут.
---

## Phase 3.3 — STATUS: CODE COMPLETE (runtime G26–G32 ожидает прогона)

Реализовано:
- Edge `stripe-create-customer-portal-session` (JWT + owner-check `subv2.user_id = auth.uid()` ∧ `profiles.id = auth.uid()`, PCI guard, без service_role bypass, без write Portal Configuration).
- Resolver `_shared/stripe-subscription-resolver.ts` → `onSubscriptionUpdated` add-only: эмит `stripe.portal.cancel_at_period_end_{enabled,disabled}` и `stripe.portal.payment_method_updated` по diff'у prev/next в `subv2.meta.stripe.*`.
- UI: `StripePortalButton` подключена в `SubscriptionDetailSheet` (виден только при `provider='stripe'`); return_url → `/purchases?sub={id}`.
- Discovery: `.lovable/discovery/stripe_customer_portal_inventory_v1.md`.
- Proof skeleton: `.lovable/proofs/stripe_phase_3_3_customer_portal_v1.md` (заполнить после G26–G32).
- Registry: `supabase/functions.registry.txt` (P1).

bePaid не затронут. grant-access-for-order не тронут. Webhook lifecycle не сломан (изменения внутри уже существующей ветки `customer.subscription.updated`, post-update, в виде дополнительных audit-записей).

Portal Configuration настраивается отдельным admin-инструментом (НЕ во время пользовательского запроса) — задача отдельного PATCH в рамках 3.3, не реализуется внутри runtime функции.

Backlog: Phase 3.4 — Stripe Dunning + Smart Retries + Failed Payment Recovery.
