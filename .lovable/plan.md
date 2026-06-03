да, согласен, с учетом правок:

1. **MP-A2-1**
  &nbsp;
  &nbsp;
  - Не нравится пункт:
    `throw no_redirect_url_configured`
  - Для sandbox и test-mode это может блокировать создание Checkout.
  - Лучше:
  - Иначе можем получить ложный блокер.
2. **MP-A2-1**
  - Добавить обязательную проверку:
    ```text
    account_code
    business_stream
    ```
    проходят весь путь:
  - Сейчас проверяется только metadata checkout.
3. **MP-A2-1**
  - Дополнить hardcode audit:
    ```text
    rg "stripe_poland|default|example.com|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET"
    ```
    по всему проекту, а не только по Stripe-функциям.
  - Иначе часть хардкодов может остаться во frontend.
4. **MP-A2-2**
  - Обязательно проверить:
    ```text
    customer_id не создаётся повторно
    ```
    при:
    - смене email;
    - смене имени;
    - повторной покупке.
  - SOT должен быть:
    &nbsp;
    ```text
    user_id + account_code
    ```
    а не email.
5. **MP-A2-2**
  - Добавить negative test:
    ```text
    один пользователь
    +
    два Stripe account_code
    ```
    Ожидаемо:
    ```text
    два разных Customer
    ```
    Это критично для будущего multi-account.
6. **MP-A2-2**
  - Не использовать:
    ```text
    stripe.customers.list(email=...)
    ```
    как основной способ поиска.
  - Сначала:
  - Потом:
  - Email только fallback.
  - Иначе возможны коллизии между аккаунтами.
7. **MP-A2-2**
  - В proof обязательно добавить:
    ```text
    Stripe Dashboard screenshot / API dump
    ```
    подтверждающий:
    - Customer;
    - PaymentMethod;
    - привязку PaymentMethod к Customer.
  - Без этого сохранение карты не доказано.
8. **Общий порядок**
  - После закрытия MP-A2-2 не запускать сразу весь этап C.
  - Сначала сделать отдельный:
    ```text
    Pilot Readiness Review
    ```
    с чек-листом:
    - account resolver;
    - customer resolver;
    - saved payment method;
    - portal readiness;
    - hardcode audit;
    - phase 2 regression.
  - Только после PASS запускать Runtime Pilot.

&nbsp;

После этих правок оба mini-plan можно утверждать и запускать по очереди:

1. MP-A2-1
2. MP-A2-2
3. Pilot Readiness Review
4. Stage C Runtime Pilot.
5. &nbsp;
6. План: Stripe Phase 3.1 — MP-A2-1 и MP-A2-2 (plan-mode, execute только после отдельного approve каждого mini-plan)

Оба mini-plan add-only, test-mode only, без изменений bePaid, без новых таблиц, без live-ключей. Все proof и отчёты на русском, складываются в `.lovable/proofs/`.

---

# Mini-Plan 1 — MP-A2-1: Account / Business Stream Defaults Cleanup

## Цель

Убрать три хардкода из Stripe-флоу Phase 2:

- `account_code = 'stripe_poland'` (H3, H7 из hardcode-аудита);
- `business_stream = 'default'` (H6);
- fallback URL `https://example.com` в success/cancel (H4).

Поведение должно стать data-driven: значения резолвятся из `acquiring_connections`, product/tariff/offer meta, и production domain resolver.

## Scope (только эти файлы)

- `supabase/functions/_shared/acquiring/resolver.ts` (или эквивалент — точное имя зафиксировать в Discovery-шаге плана) — добавить `resolveDefaultStripeAccount()`.
- `supabase/functions/_shared/acquiring/business-stream-resolver.ts` — уже существует, только подключить в местах хардкода.
- `supabase/functions/_shared/stripe-metadata.ts` — убрать literal `'default'` в `business_stream`, требовать явное значение от caller, fallback на `business-stream-resolver` (а не строку).
- `supabase/functions/stripe-create-checkout/index.ts` — заменить хардкоды account_code и success/cancel URL.
- `supabase/functions/stripe-admin-sandbox-checkout/index.ts` — то же.
- `supabase/functions/stripe-webhook/index.ts` — там, где читается account_code для refund-ветки, использовать резолвер.

Файлы вне списка НЕ трогаем. Никаких изменений в `bepaid-*`, `record_refund_atomic_multi`, RLS, schema.

## Шаги

1. **Discovery (read-only, 1 шаг).** Подтвердить точные строки/файлы хардкода по `hardcode_audit_v1.md`. Зафиксировать в `.lovable/proofs/mp_a2_1_targets.md` с цитатами кода (file:line).
2. **Default account resolver.** Добавить в `_shared/acquiring/` функцию:
  ```ts
   async function resolveDefaultStripeAccount(): Promise<{ account_code: string; test_mode: boolean }>
  ```
   Логика: `SELECT account_code, test_mode FROM acquiring_connections WHERE provider='stripe' AND is_default=true AND status='active' LIMIT 1`. Если нет — throw `no_active_default_stripe_account` (HTTP 500, audit).
3. **Business stream contract.** В `stripe-metadata.ts` параметр `business_stream` делается обязательным non-null. Caller обязан передать значение из `resolveBusinessStream({ offer, tariff, product })`. Если резолвер вернул null — пишем `'unspecified'` (не `'default'`) и audit `business_stream_unspecified`.
4. **URL resolver.** Использовать существующий `src/utils/publicAppHost.ts` (`PUBLIC_APP_HOST`) на фронте и `acquiring_connections.success_url`/`cancel_url` на бэке. Если оба null — throw `no_redirect_url_configured`. `example.com` удаляется полностью.
5. **Замена хардкодов.** Точечные правки в 4 edge-функциях из Scope. Никаких изменений в публичном API edge-функций (входные параметры, response shape — без изменений).
6. **Verify.**
  - Smoke: `stripe-admin-sandbox-checkout` — Checkout Session создаётся с правильными metadata (account_code из БД, business_stream из offer/product), success_url из connection.
  - Регрессия: повторить 10/10 runtime checks Phase 2 — должны остаться PASS.
7. **Proof.** `.lovable/proofs/mp_a2_1_defaults_cleanup_v1.md` (RU):
  - diff по каждому файлу (before/after);
  - вывод smoke `stripe-admin-sandbox-checkout` (Checkout Session ID, metadata JSON);
  - подтверждение 10/10 регрессии;
  - подтверждение что bePaid-функции не менялись (`git diff --stat` по `supabase/functions/bepaid-*` — пусто).

## Не делаем

- Не создаём таблицы.
- Не трогаем `acquiring_connections` schema.
- Не включаем live-ключи.
- Не меняем bePaid.
- Не меняем `record_refund_atomic_multi`.
- Не меняем RLS.

## DoD

- Все три хардкода удалены из кода (`rg "stripe_poland|'default'|example\.com" supabase/functions/stripe-*` возвращает 0 в Stripe-функциях).
- Smoke + регрессия PASS.
- Proof-файл создан, на русском.
- User approve получен **до** execute.

---

# Mini-Plan 2 — MP-A2-2: Stripe Customer Resolver + Saved Payment Method

## Цель

Подготовить инфраструктуру reuse карты для пилота «Платная консультация»:

- Stripe `Customer` per `(user, account_code)`;
- хранение `customer_id` в `profiles.meta.stripe.customers[account_code]`;
- сохранение карты на стороне Stripe через `setup_future_usage='off_session'` (или эквивалент, подтверждённый Discovery-шагом);
- повторная покупка использует того же `Customer`.

**Зависимость:** MP-A2-1 должен быть исполнен и закрыт **до** старта MP-A2-2 (резолверы account_code и business_stream — предусловие).

## Scope (только эти файлы)

- `supabase/functions/_shared/acquiring/stripe-customer-resolver.ts` (новый, add-only).
- `supabase/functions/stripe-create-checkout/index.ts` — подключить резолвер, добавить `customer` и `payment_intent_data.setup_future_usage`.
- `supabase/functions/stripe-admin-sandbox-checkout/index.ts` — то же для пилота.
- `supabase/functions/stripe-webhook/index.ts` — на `checkout.session.completed` сохранять `customer_id` в `profiles.meta.stripe.customers[account_code]` если ещё не сохранён (idempotent merge).

НЕ создаём таблицы. НЕ модифицируем schema `profiles` (используем существующее `meta jsonb`). НЕ хранится PAN/token локально.

## Контракт `stripe-customer-resolver.ts`

```ts
async function resolveStripeCustomerId(args: {
  user_id: string;            // auth.users.id
  account_code: string;       // из MP-A2-1
  email: string;
  name?: string;
}): Promise<{ customer_id: string; created: boolean }>
```

Логика:

1. Прочитать `profiles.meta.stripe.customers[account_code].customer_id`. Если есть — вернуть.
2. Иначе: `stripe.customers.list({ email, limit: 100 })` per account → фильтр по `metadata.account_code === account_code` AND `metadata.user_id === user_id`. Если найден — вернуть, записать в profile (idempotent merge).
3. Иначе: `stripe.customers.create({ email, name, metadata: { user_id, account_code } })`. Записать в profile.
4. Запись в profile через атомарный jsonb-merge (RPC или `update profiles set meta = jsonb_set(... )`), idempotent.

Audit: `stripe_customer_resolved` с полями `{user_id, account_code, customer_id, created, source: 'profile_cache' | 'stripe_list' | 'stripe_create'}`.

## Шаги

1. **Discovery (read-only, 1 шаг).** Подтвердить, что Stripe Checkout Session в режиме `mode=payment` поддерживает `payment_intent_data.setup_future_usage='off_session'` для нужных payment_method_types в test-mode (cards). Зафиксировать в `.lovable/proofs/mp_a2_2_stripe_capabilities.md`.
2. **Customer resolver.** Реализовать `_shared/acquiring/stripe-customer-resolver.ts` по контракту выше. Unit-вызовы протестировать через `stripe-admin-sandbox-checkout`.
3. **Profile meta merge.** Добавить shared helper `mergeStripeCustomerIntoProfile(user_id, account_code, customer_id)`. Idempotent.
4. **Checkout integration.** В `stripe-create-checkout` и `stripe-admin-sandbox-checkout`:
  - резолвить `customer_id` ДО создания Checkout Session;
  - передавать `customer` в session params;
  - добавлять `payment_intent_data: { setup_future_usage: 'off_session' }`;
  - `customer_creation` НЕ ставим (т.к. customer уже резолвится).
5. **Webhook.** На `checkout.session.completed`: если `session.customer` есть — вызвать `mergeStripeCustomerIntoProfile`. Idempotent, не падает если уже записано.
6. **Saved PM gap check.** Проверить: позволяет ли текущий Stripe Checkout flow клиенту **выбрать** ранее сохранённую карту? Если нет (а у Stripe Checkout в `mode=payment` это поведение зависит от типа Customer и настроек) — **зафиксировать gap** в proof и предложить follow-up:
  - либо подключить Stripe Customer Portal как UI для управления saved PM (MVP без выбора в Checkout);
  - либо мигрировать на Stripe Payment Element с собственным UI (отдельный mini-plan, не входит в MP-A2-2).
7. **Verify (5 runtime-сценариев).**
  - S1: Новый user → checkout → создан Customer → `profiles.meta.stripe.customers[account_code].customer_id` записан.
  - S2: Тот же user → второй checkout → resolver вернул тот же `customer_id`, новый Customer не создан.
  - S3: На стороне Stripe Dashboard у Customer появилась saved PaymentMethod после успешной оплаты (setup_future_usage сработал).
  - S4: Локально PAN/token НЕ хранится (`rg "card_number|pan|payment_method_id" supabase/functions/stripe-*` — только ссылки на Stripe ID, не данные карты).
  - S5: UI ответ Checkout Session не содержит `payment_method` details (только session URL).
  - Регрессия: 10/10 Phase 2 + smoke MP-A2-1 — PASS.
8. **Proof.** `.lovable/proofs/mp_a2_2_customer_resolver_v1.md` (RU):
  - diff по каждому файлу;
  - вывод 5 сценариев с реальными Stripe test IDs (`cus_...`, `pm_...`, `cs_test_...`);
  - JSON-фрагмент `profiles.meta.stripe.customers` для тестового user;
  - явный раздел «Gap: выбор saved PM в Checkout» с рекомендацией follow-up;
  - подтверждение неизменности bePaid (`git diff --stat supabase/functions/bepaid-*` — пусто).

## Не делаем

- Не создаём таблицы для карт/customers.
- Не храним PAN, fingerprint, last4 локально (даже если Stripe их возвращает в webhook — игнорируем).
- Не возвращаем `payment_method` объекты в UI ответы.
- Не включаем live-режим.
- Не меняем bePaid.
- Не реализуем Payment Element / Customer Portal в этом mini-plan (только фиксируем gap).

## DoD

- `stripe-customer-resolver.ts` создан и подключён в обе Checkout-функции.
- 5/5 runtime сценариев PASS.
- Saved PM gap зафиксирован в proof с рекомендацией.
- Proof-файл создан, на русском.
- MP-A2-1 закрыт **до** старта MP-A2-2.
- User approve получен **до** execute.

---

# Общий порядок execute

1. Approve MP-A2-1 → execute → proof → review.
2. Approve MP-A2-2 → execute → proof → review.
3. Только после закрытия обоих — переход к runtime-пилоту «Платная консультация» (Stage C исходного Phase 3.1 v3 плана).