да, согласен, с учетом правок:

План принят. Scope корректный: это не новая фаза Stripe, а bug-fix materialization + UI cleanup после реальной Stripe subscription оплаты.

# **Approve на выполнение**

Можно выполнять PATCH:

```text
Stripe subscription checkout materialization + provider-clean UI + unified subscriptions
```

---

# **Обязательные правки перед Execute**

## **1. Не называть это fallback как основной путь**

Формулировка должна быть точной:

```text
checkout.session.completed materialization = recovery/safety path для subscription checkout, если invoice.paid не пришёл или не обработался.
```

Основной canonical lifecycle для подписок остаётся:

```text
invoice.paid / invoice.payment_failed / subscription.updated / subscription.deleted
```

Но если Checkout Session уже `complete + paid`, то бизнес-материализация должна быть восстановлена идемпотентно.

---







## **2. В**

`checkout.session.completed` **не создавать дубль, если позже придёт** `invoice.paid`

Это главный риск.

В helper `activateStripeSubscriptionCheckout()` обязательно добавить idempotency keys:

```text
checkout_session_id
invoice_id
stripe_subscription_id
subscription_v2_id
provider_subscription_row_id
payment_link_id
```

Если позже придёт `invoice.paid`, он должен увидеть already materialized state и не создать второй order/payment/access.

---





## **3.**

`provider_payment_id` **лучше не делать invoice-only, если можно достать PaymentIntent**

Для Stripe subscription Session часто `payment_intent` может быть `null`, а платёж живёт в invoice/payment_intent.

Поэтому helper должен по возможности достать invoice из Stripe API и взять:

```text
invoice.payment_intent
```

Priority:

```text
1. invoice.payment_intent
2. session.payment_intent
3. invoice.id
4. session.id
```

В `payments_v2.meta.stripe` сохранить все идентификаторы:

```text
checkout_session_id
invoice_id
payment_intent_id
subscription_id
charge_id, если доступен
payment_link_id
account_code
materialized_from = checkout.session.completed
```

---

## **4. Payment link counter должен быть строго idempotent**

`consumePaymentLinkForOrder` вызывать только если:

```text
orders_v2.meta.payment_link_counted != true
```

или если существующая функция сама гарантирует идемпотентность.

После вызова записать marker:

```text
orders_v2.meta.payment_link_counted = true
```

Если такой marker уже есть — не увеличивать `current_uses`.

---

## **5. Pending subscriptions в карточке контакта**

Подтверждаю правило:

```text
pending drafts не показывать в карточке контакта как реальные подписки.
```

Карточка контакта должна показывать только подписки, где:

```text
provider_subscription_id starts with sub_
```

и есть реальный provider lifecycle.

Pending drafts могут отображаться только:

```text
Платежи → Ссылки
диагностика
технический аудит
```

---

# **PATCH 1 — Backend materialization**

Выполнять через общий helper:

```text
activateStripeSubscriptionCheckout()
```

Подключить:

```text
stripe-webhook → checkout.session.completed
stripe-reconcile-session → manual recovery
```

## **Required guards**

Перед write:

```text
session.mode = subscription
session.status = complete
session.payment_status = paid
session.subscription starts with sub_
metadata.subscription_v2_id exists
metadata.provider_subscription_row_id exists
metadata.payment_link_id exists
metadata.account_code matches resolved account_code
local subscriptions_v2 row exists
local provider_subscriptions row exists
provider_subscriptions.provider = stripe
payment_links.provider = stripe
```

При mismatch:

```text
manual_review
no business writes
audit
```

## **Required writes**

После successful activation:

```text
orders_v2.status = paid
payments_v2.status = succeeded
subscriptions_v2.status = active
provider_subscriptions.state = active
orders_v2.meta.payment_link_id = c5f28396...
payment_links.current_uses incremented once
grant-access-for-order called
```

Никаких direct writes в `entitlements`.

---

# **PATCH 2 — Recovery текущей оплаты $2**

После деплоя helper:

Выполнить точечный reconcile только для:

```text
cs_live_a1Div6ZmYLt6VOpbmdE6VdDOKqXKP9aP3VOVF7HotCokKoQqGZTvjroZHV
```

Нельзя делать:

```text
manual INSERT
mass repair
bulk reconcile
```

После recovery подтвердить:

```text
orders_v2.status = paid
payments_v2.status = succeeded
subscriptions_v2.status = active
provider_subscriptions.state = active
entitlement/access granted
payment_links.current_uses = 1
paid_orders_count обновился
```

---

# **PATCH 3 — PublicPayPage provider-clean UI**

Для:

```text
provider = stripe
payment_type = subscription
```

убрать:

```text
disabled saved bePaid card
bePaid text
сохранённые карты bePaid
белорусская карта
```

Показать:

```text
Перейти к оплате картой / Apple Pay
```

Текст:

```text
Для оформления подписки вы будете перенаправлены на защищённую страницу Stripe, где можно ввести новую карту или использовать Apple Pay, если он доступен.
```

One-time saved-card selector оставить только там, где provider совместим.

---

# **PATCH 4 — AdminPaymentLinkDialog texts**

Исправить тексты, чтобы Stripe не выглядел как fallback в bePaid.

Для Stripe:

```text
Оплата через Stripe
Иностранная карта / Apple Pay
Валюта: USD / EUR / PLN / BYN
Подписка будет оформлена на защищённой странице Stripe
```

Для bePaid:

```text
Белорусская карта (bePaid)
```

Все пользовательские статусы и helper-тексты — на русском языке.

---

# **PATCH 5 — Unified admin subscriptions UI**

Переименовать:

```text
Подписки BePaid → Подписки
```

Legacy route оставить:

```text
/admin/payments/bepaid-subscriptions
```

Расширить provider display:

```text
provider_subscriptions.provider IN ('bepaid', 'stripe')
```

Показывать provider badge:

```text
bePaid
Stripe
```

Не создавать отдельную вкладку Stripe.

Pending drafts в общей вкладке можно показывать только явно как:

```text
Ожидает оплаты
```

но в карточке контакта их не показывать как реальные подписки.

---

# **PATCH 6 — Links counters**

Обязательно проверить:

```text
orders_v2.meta.payment_link_id
orders_v2.meta.payment_link_counted
payment_links.current_uses
payment_links_enriched_v.paid_orders_count
```

Если UI кэширует ссылки, сделать refetch/invalidation после successful materialization.

---

# **Что НЕ делать**

Не делать:

```text
bePaid/e-clearing/Pay checkout changes
direct entitlements writes
tariff_offers.meta changes
new real charges
mass repair
legacy route removal
separate Stripe subscriptions tab
pending drafts in contact card
```

---

# **Verify**

## **SQL after recovery**

Показать:

```text
order created
payment created
subscription active
provider_subscription active with sub_...
payment_link counted once
entitlement/access granted
no duplicate order/payment
```

## **UI**

Показать скрины:

```text
PublicPayPage без bePaid-confusion
Stripe Checkout / CTA
Мои покупки
Админ → Платежи
Админ → Ссылки
Админ → Подписки
Карточка контакта без pending drafts
```

## **Idempotency**

Повторно запустить reconcile/webhook replay для той же session:

Ожидаемо:

```text
already_materialized
no duplicate order
no duplicate payment
current_uses unchanged
no duplicate entitlement
```

---

# **Proof**

Создать:

```text
.lovable/proofs/stripe_subscription_checkout_materialization_v1.md
```

Proof должен содержать:

1. Root cause.
2. Stripe session snapshot.
3. Provider events.
4. Dry-run preconditions.
5. Helper logic summary.
6. Recovery result for `$2`.
7. SQL after по:
  - order;
  - payment;
  - subscription;
  - provider_subscription;
  - payment_link;
  - entitlement/access.
8. UI screenshots.
9. Re-run idempotency proof.
10. bePaid/e-clearing/Pay untouched.

---

# **DoD**

PATCH = PASS, если:

- `$2` Stripe subscription payment восстановлена;
- order/payment/subscription/access созданы;
- user видит покупку;
- admin видит payment/link/subscription;
- Stripe subscription PublicPayPage не выглядит как bePaid;
- disabled bePaid saved card не показывается;
- вкладка называется «Подписки»;
- повторный replay не создаёт дублей;
- bePaid/e-clearing/Pay не затронуты.

Начинай Execute.

&nbsp;

План:

1. **Проблема**
  - Реальная Stripe subscription-оплата `$2` по public link прошла, но бизнес-данные не материализовались: нет `orders_v2`, `payments_v2`, active `subscriptions_v2`, видимости в «Мои покупки», «Платежи», «Ссылки».
  - Stripe-only subscription flow на `/pay/:token` визуально смешан с bePaid: показываются disabled сохранённые bePaid-карты и тексты, из-за чего кажется, что ссылка fallback’ится в bePaid.
  - Админская вкладка «Подписки BePaid» больше не соответствует системе с несколькими провайдерами.
2. **Диагностика / dry-run preconditions уже подтверждены read-only**
  - `checkout.session.completed` существует:
    - `session_id = cs_live_a1Div6ZmYLt6VOpbmdE6VdDOKqXKP9aP3VOVF7HotCokKoQqGZTvjroZHV`
    - `mode = subscription`
    - `status = complete`
    - `payment_status = paid`
    - `subscription = sub_1TgWoO6UYJj2vm0Gjc9P0jxH`
    - `invoice = in_1TgWoM6UYJj2vm0GFNtppUXO`
    - `amount_total = 200`, `currency = usd`
    - `account_code = stripe_poland`
  - Metadata достаточна для controlled recovery:
    - `subscription_v2_id = ac24c459-478a-40ed-8d2c-87e63d04cb13`
    - `provider_subscription_row_id = fa7ae2be-d743-4275-af9d-944d9396d53f`
    - `payment_link_id = c5f28396-a7ce-4575-ba27-b2ab45eb80c9`
    - `product_id`, `tariff_id`, `tariff_offer_id`, `business_stream` присутствуют.
  - Local pending rows есть:
    - `subscriptions_v2.status = pending`, `order_id = null`
    - `provider_subscriptions.state = pending`, `provider_subscription_id = pending:<subscription_v2_id>`, `order_id = null`
  - Payment link есть:
    - `provider = stripe`, `provider_mode = fixed`, `account_code = stripe_poland`
    - `payment_type = subscription`, `amount = 200`, `currency = USD`
    - `current_uses = 0`, `status = active`
  - Idempotency precheck:
    - `orders_by_session = 0`
    - `orders_by_invoice = 0`
    - `orders_by_sub = 0`
    - `orders_by_payment_link = 0`
    - `payments_by_session = 0`
    - `payments_by_invoice = 0`
    - `payments_by_sub = 0`
    - `payments_by_provider_payment_id_invoice = 0`
    - `payments_by_provider_payment_id_session = 0`
  - Root cause: `invoice.paid` не пришёл, а текущий activation path для Stripe subscriptions активирует бизнес-данные только через `invoice.paid`. `checkout.session.completed` был обработан как processed, но subscription materialization fallback отсутствует.
3. **Главное архитектурное решение**
  - Не добавлять второй write-path.
  - Вынести общий idempotent helper:
    ```text
    activateStripeSubscriptionCheckout()
    ```
  - Использовать helper из двух мест:
    ```text

    ```
  1. stripe-webhook → checkout.session.completed
  2. stripe-reconcile-session → ручное восстановление session
    `ли текущий`invoice.paid` resolver уже содержит часть логики, helper должен переиспользовать/разделить общую часть, а не копировать отдельную бизнес-логику.
4. **PATCH 1 — Backend materialization from checkout.session.completed**
  - Цель: если Stripe subscription Checkout Session завершена и оплачена, но `invoice.paid` отсутствует, создать бизнес-данные через общий helper.
  - Helper создаёт/обновляет:
    - `orders_v2.status = paid`
    - `payments_v2.status = succeeded`
    - `subscriptions_v2.status = active`
    - `provider_subscriptions.state = active`
    - `orders_v2.meta.payment_link_id`
    - `payment_links.current_uses` через `consumePaymentLinkForOrder`
  - Доступ выдаётся только через canonical path:
    ```text
    grant-access-for-order
    ```
  - Direct writes в `entitlements` запрещены.
5. **Strict guards helper-а**
  - Перед записью проверить:
  - При mismatch: STOP/manual_review + audit, без business writes.
6. **Idempotency helper-а**
  - Перед созданием искать existing records по:
  - Если уже материализовано:
    - не создавать дубль order;
    - не создавать дубль payment;
    - не увеличивать `payment_links.current_uses` повторно;
    - вернуть `already_materialized`.
7. **Provider payment id priority**
  - Для `payments_v2.provider_payment_id` использовать приоритет:
  1. payment_intent, если есть
  2. invoice id
  3. checkout session id
    `` payments_v2.meta.stripe`сохранить:`text
    eckout_session_id
    voice_id
    bscription_id
    yment_intent_id, если есть
    yment_link_id
    count_code
    urce = checkout.session.completed
    `
8. **Grant/access failure policy**
  - После materialization вызвать `grant-access-for-order`.
  - Если `grant-access-for-order` упал:
    - order/payment/subscription остаются;
    - audit/manual_review фиксируется;
    - доступ восстанавливается штатным reconcile;
    - helper не откатывает коммерческий факт оплаты.
9. **PATCH 2 — Recovery текущей оплаты `$2**`
  - Доработать `stripe-reconcile-session`, чтобы для `mode=subscription` он вызывал тот же `activateStripeSubscriptionCheckout()`.
  - Затем выполнить точечный reconcile для:
    ```text
    cs_live_a1Div6ZmYLt6VOpbmdE6VdDOKqXKP9aP3VOVF7HotCokKoQqGZTvjroZHV
    ```
  - Не делать ручные `INSERT`.
  - Не делать массовый repair.
10. **PATCH 3 — PublicPayPage provider-clean UI**
  - Для:
     убрать disabled saved bePaid cards.
  - Новый CTA:
    ```text
    Перейти к оплате картой / Apple Pay
    ```
    или:
    ```text
    Оплатить через Stripe
    ```
  - Текст:
    ```text
    Для оформления подписки вы будете перенаправлены на защищённую страницу Stripe, где можно ввести новую карту или использовать Apple Pay, если он доступен.
    ```
  - Не показывать в Stripe subscription flow:
    ```text
    bePaid
    сохранённые карты bePaid
    белорусская карта
    ```
  - One-time saved-card selector оставить только для совместимого provider flow.
  - Stripe saved payment methods — вне scope, отдельный будущий PATCH.
11. **PATCH 4 — AdminPaymentLinkDialog texts**
  - Исправить тексты provider labels / currency labels / customer-choice / generated preview.
  - Для Stripe использовать формулировки:
    ```text
    Оплата через Stripe
    Иностранная карта / Apple Pay
    Валюта: USD / EUR / PLN / BYN
    Подписка будет оформлена на защищённой странице Stripe
    ```
  - Для bePaid:
    ```text
    Белорусская карта (bePaid)
    ```
  - Не смешивать Stripe и bePaid в одном helper-тексте.
12. **PATCH 5 — Unified admin subscriptions UI**
  - Переименовать UI:
  - Legacy route оставить:
    ```text
    /admin/payments/bepaid-subscriptions
    ```
  - Не создавать отдельную вкладку Stripe subscriptions.
  - Добавить provider badge:
    ```text
    bePaid
    Stripe
    ```
  - Если текущий reader читает только bePaid rows — расширить на:
    ```text
    provider_subscriptions.provider IN ('bepaid', 'stripe')
    ```
  - Pending technical rows показывать только с явным статусом/бейджем «Ожидает оплаты».
  - В карточке контакта pending drafts не показывать как реальные подписки.
13. **PATCH 6 — Links UI counters**
  - Helper обязан писать `orders_v2.meta.payment_link_id`, потому что `payment_links_enriched_v` считает `paid_orders_count` через этот meta-path.
  - После activation вызвать `consumePaymentLinkForOrder`, чтобы `payment_links.current_uses` увеличился один раз.
  - Проверить, что `usePaymentLinks`/RPC обновляют строки после `updated_at`; при stale-cache — добавить корректную invalidation/refetch в UI без нового source of truth.
14. **Изменяемые компоненты**
  - Edge/shared:
    - `supabase/functions/_shared/stripe-subscription-resolver.ts`
    - новый shared helper внутри `supabase/functions/_shared/` или вынесенная функция в существующем модуле
    - `supabase/functions/stripe-webhook/index.ts`
    - `supabase/functions/stripe-reconcile-session/index.ts`
  - Frontend:
    - `src/pages/PublicPayPage.tsx`
    - `src/components/admin/AdminPaymentLinkDialog.tsx`
    - `src/pages/admin/AdminPaymentsHub.tsx`
    - `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`
  - Proof:
    - `.lovable/proofs/stripe_subscription_checkout_materialization_v1.md`
15. **Что НЕ делать**
  - Не трогать bePaid/e-clearing/Pay checkout logic.
  - Не менять `grant-access-for-order`.
  - Не писать `entitlements` напрямую.
  - Не менять глобальные `tariff_offers.meta`.
  - Не создавать новые реальные списания.
  - Не удалять legacy route.
  - Не делать массовый repair.
  - Не создавать отдельную Stripe subscriptions вкладку.
  - Не показывать pending drafts в карточке контакта как реальные подписки.
16. **Execute**
  - Вынести общий idempotent helper `activateStripeSubscriptionCheckout()`.
  - Подключить helper в `stripe-webhook` для `checkout.session.completed` subscription sessions.
  - Подключить helper в `stripe-reconcile-session` для ручного восстановления session.
  - Деплой edge functions выполняется штатно после правок.
  - Запустить точечный reconcile для `$2` session.
  - Исправить `PublicPayPage` UI.
  - Исправить `AdminPaymentLinkDialog` тексты.
  - Переименовать admin subscriptions UI.
  - Проверить counters в links UI.
17. **Verify**
  - Public payment page для Stripe subscription:
    - нет bePaid текстов;
    - нет disabled saved bePaid card;
    - CTA ведёт в Stripe Checkout;
    - можно оплатить другой картой / Apple Pay.
  - После recovery `$2` появились:
    ```text
    orders_v2.status = paid
    payments_v2.status = succeeded
    subscriptions_v2.status = active
    provider_subscriptions.state = active
    ```
  - «Мои покупки»: подписка/покупка видна пользователю.
  - Админка:
    - Stripe payment виден в «Платежах»;
    - paid count виден в «Ссылках»;
    - подписка видна в общей вкладке «Подписки»;
    - provider badge = Stripe.
  - Re-run safety:
    - повторный webhook/reconcile не создаёт дубль order;
    - не создаёт дубль payment;
    - не увеличивает счётчик ссылки повторно.
18. **Proof / DoD**
  - Создать proof:
  - Proof должен содержать:
    - root cause;
    - Stripe session snapshot;
    - provider events;
    - dry-run preconditions;
    - helper logic summary;
    - recovery result for `$2`;
    - SQL after по order/payment/subscription/provider_subscription/payment_link/access;
    - UI screenshots: PublicPayPage, Stripe Checkout, Мои покупки, Админ Платежи, Ссылки, Подписки;
    - re-run idempotency proof;
    - подтверждение, что bePaid/e-clearing/Pay untouched.
  - PATCH = PASS, если Stripe subscription checkout materializes from `checkout.session.completed` when `invoice.paid` is missing, текущая `$2` оплата восстановлена, UI очищен от bePaid-confusion, вкладка называется «Подписки», и повторный replay не создаёт дублей.