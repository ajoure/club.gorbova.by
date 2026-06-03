да, согласен, с учетом правок:

```text
MP-A2-1 и MP-A2-2 можно утверждать к execute по очереди.

Правки перед execute:

1. MP-A2-1 — `rg "'default'"` по всему проекту может дать много ложных срабатываний.
   В proof разделить:
   - Stripe payment context hardcodes;
   - unrelated UI/default values;
   - comments/tests.
   Не требовать 0 по всему проекту, требовать 0 только по Stripe payment context MUST-FIX.

2. MP-A2-1 — `PUBLIC_APP_HOST` из `src/utils` нельзя напрямую импортировать в edge-функции.
   Для edge-функций сделать отдельный shared helper или продублировать безопасную server-side константу:
   - сначала брать acquiring_connections.success_url/cancel_url;
   - затем server-side PUBLIC_APP_HOST;
   - без импорта из `src/`.

3. MP-A2-2 — временный второй Stripe account_code для S9 не должен требовать новых live/test секретов.
   Это должен быть safe fake/mock connection или controlled test entry, который не делает реальный Stripe API call, либо использовать тот же test secret через отдельный `account_code` только в тестовом окружении.
   В proof явно указать, что это multi-account resolver test, а не реальный второй Stripe-аккаунт.

4. MP-A2-2 — `stripe.customers.search` может иметь задержку индексации.
   Если search сразу не находит созданного customer — использовать повтор с короткой паузой или fallback, но не создавать дубль.

5. MP-A2-2 — не хранить `pm_` в `profiles.meta`.
   В `profiles.meta` хранить только `customer_id` per account_code. PaymentMethod ID можно показывать только в proof/API dump, но не сохранять локально.

6. Pilot Readiness Review — пункт “No live keys” формулировать так:
   - активное пилотное подключение должно быть `test_mode=true`;
   - наличие live-подключений в системе само по себе не FAIL, если они не используются в пилоте.
```

После этих правок:

```text
Approve MP-A2-1 execute.
После отчета по MP-A2-1 отдельно approve MP-A2-2.

План: Stripe Phase 3.1 — MP-A2-1, MP-A2-2, Pilot Readiness Review (v2, plan-mode)
```

Все три блока — plan-mode. Execute только после отдельного approve каждого. Add-only, test-mode only, без изменений bePaid, без новых таблиц, без live-ключей. Все proof и отчёты на русском, в `.lovable/proofs/`.

Общий порядок: **MP-A2-1 → MP-A2-2 → Pilot Readiness Review → Stage C Runtime Pilot**. Каждый этап утверждается отдельно.

---

# Mini-Plan 1 — MP-A2-1: Account / Business Stream Defaults Cleanup (v2)

## Цель

Убрать хардкоды:

- `account_code = 'stripe_poland'` (H3, H7);
- `business_stream = 'default'` (H6);
- fallback URL `https://example.com` (H4).

Поведение становится data-driven: значения резолвятся из `acquiring_connections`, product/tariff/offer meta, production domain resolver.

## Scope

- `supabase/functions/_shared/acquiring/resolver.ts` — добавить `resolveDefaultStripeAccount()`.
- `supabase/functions/_shared/acquiring/business-stream-resolver.ts` — существующий, подключить в точках хардкода.
- `supabase/functions/_shared/stripe-metadata.ts` — убрать literal `'default'`.
- `supabase/functions/stripe-create-checkout/index.ts`.
- `supabase/functions/stripe-admin-sandbox-checkout/index.ts`.
- `supabase/functions/stripe-webhook/index.ts` (refund-ветка).
- Frontend: точечно заменить хардкоды, найденные расширенным audit (см. шаг 1).

bePaid, RLS, schema, `record_refund_atomic_multi` — не трогаем.

## Шаги

### 1. Расширенный hardcode audit (правка #3)

Запуск по всему проекту, не только Stripe-функции:

```bash
rg -n "stripe_poland|'default'|example\.com|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET" \
   --type ts --type tsx --type sql --type toml
```

Каждое попадание классифицируется: `MUST-FIX-A2-1` / `BACKLOG` / `OK` (env reference, comment, test fixture). Результат — `.lovable/proofs/mp_a2_1_extended_audit.md`. Frontend MUST-FIX попадания включаются в Scope этого mini-plan.

### 2. Default account resolver

```ts
async function resolveDefaultStripeAccount(): Promise<{
  account_code: string;
  test_mode: boolean;
  success_url: string | null;
  cancel_url: string | null;
}>
```

SQL: `SELECT account_code, test_mode, success_url, cancel_url FROM acquiring_connections WHERE provider='stripe' AND is_default=true AND status='active' LIMIT 1`. Если нет — throw `no_active_default_stripe_account` (HTTP 500, audit).

### 3. Business stream contract

- `stripe-metadata.ts`: параметр `business_stream` обязательный non-null.
- Caller обязан передать значение из `resolveBusinessStream({ offer, tariff, product })`.
- Если резолвер вернул null → пишем `'unspecified'` (НЕ `'default'`) + audit `business_stream_unspecified` с `{product_id, tariff_id, offer_id}`.

### 4. URL resolver (правка #1 — без жёсткого throw)

Приоритет:

1. `acquiring_connections.success_url` / `cancel_url` (per-account).
2. `PUBLIC_APP_HOST` из `src/utils/publicAppHost.ts` (production canonical, `https://gorbova.by`) + конвенциональные пути `/payment/success`, `/payment/cancel`.
3. **Sandbox-only fallback**: если `test_mode=true` AND вызов через `stripe-admin-sandbox-checkout` → разрешаем `${PUBLIC_APP_HOST}/admin/payments/sandbox-return` с audit `sandbox_fallback_url_used`. Production checkout sandbox-fallback НЕ использует.
4. `example.com` удаляется полностью из кода.

Никакого жёсткого `throw no_redirect_url_configured` — для test-mode всегда есть deterministic fallback через PUBLIC_APP_HOST.

### 5. Замена хардкодов

Точечные правки в файлах из Scope. Публичный API edge-функций не меняется (request/response shape без изменений).

### 6. End-to-end metadata trace (правка #2)

Обязательная проверка, что `account_code` и `business_stream` доходят до:

- Stripe Checkout Session `metadata`;
- Stripe PaymentIntent `metadata` (наследование из session);
- `payments_v2.meta.{account_code, business_stream}`;
- `orders_v2.meta.{account_code, business_stream}`;
- `provider_events.account_code` (для webhook);
- Stripe Dashboard (визуально на Session / PaymentIntent).

Каждая точка — отдельный bullet в proof с реальными значениями.

### 7. Verify

- Smoke: `stripe-admin-sandbox-checkout` → Checkout Session с правильными metadata + правильным success_url из connection.
- 10/10 регрессия Phase 2 — PASS.
- E2E metadata trace (шаг 6) — 6/6 точек PASS.

### 8. Proof

`.lovable/proofs/mp_a2_1_defaults_cleanup_v1.md` (RU):

- `mp_a2_1_extended_audit.md` (классификация всех попаданий по проекту);
- diff по каждому файлу;
- smoke output (Session ID, metadata JSON, success_url);
- e2e metadata trace по 6 точкам с реальными значениями;
- 10/10 регрессия;
- `git diff --stat supabase/functions/bepaid-*` — пусто.

## DoD

- Все три хардкода удалены (`rg` по всему проекту в MUST-FIX = 0).
- E2E metadata trace 6/6 PASS.
- Smoke + регрессия PASS.
- Proof создан, на русском.
- User approve получен **до** execute.

---

# Mini-Plan 2 — MP-A2-2: Stripe Customer Resolver + Saved Payment Method (v2)

## Цель

Reuse карты для пилота «Платная консультация»:

- Stripe `Customer` per `(user_id, account_code)` (SOT, не email);
- хранение `customer_id` в `profiles.meta.stripe.customers[account_code]`;
- сохранение карты через `setup_future_usage='off_session'` (или эквивалент по Discovery);
- повторная покупка использует тот же `Customer`;
- разные `account_code` → разные `Customer` (multi-account safe).

**Зависимость**: MP-A2-1 закрыт + approved.

## Scope

- `supabase/functions/_shared/acquiring/stripe-customer-resolver.ts` (новый).
- `supabase/functions/stripe-create-checkout/index.ts`.
- `supabase/functions/stripe-admin-sandbox-checkout/index.ts`.
- `supabase/functions/stripe-webhook/index.ts` (`checkout.session.completed` → merge `customer_id`).

НЕ создаём таблицы, не меняем schema `profiles`, не храним PAN/last4/fingerprint локально.

## SOT (правка #4)

**Идентичность Customer = `(user_id, account_code)`. Email и name — НЕ идентичность, могут меняться без создания нового Customer.**

При смене email/имени:

- `profiles.meta.stripe.customers[account_code].customer_id` остаётся;
- если email менялся, опционально шлём `stripe.customers.update(customer_id, { email })` — но НЕ создаём нового.

## Поиск Customer (правка #6 — приоритет SOT, email как последний fallback)

Порядок lookup в `resolveStripeCustomerId({user_id, account_code, email, name})`:

1. **Cache hit**: `profiles.meta.stripe.customers[account_code].customer_id` → вернуть, source `profile_cache`.
2. **Stripe search by metadata** (НЕ list-by-email): `stripe.customers.search({ query: \`metadata['user_id']:'${user_id}' AND metadata['account_code']:'${account_code}' })`→ если найден, merge в profile, source`stripe_search_metadata`.
3. **Email fallback** (только если шаги 1-2 пусты): `stripe.customers.list({ email, limit: 100 })` → фильтр по `metadata.user_id === user_id AND metadata.account_code === account_code`. Source `stripe_list_email_fallback`. Audit предупреждение `customer_email_fallback_used`.
4. **Create**: `stripe.customers.create({ email, name, metadata: { user_id, account_code } })`. Source `stripe_create`. Merge в profile.

Audit `stripe_customer_resolved` с `{user_id, account_code, customer_id, created, source}`.

## Контракт

```ts
async function resolveStripeCustomerId(args: {
  user_id: string;
  account_code: string;
  email: string;
  name?: string;
}): Promise<{ customer_id: string; created: boolean; source: 'profile_cache'|'stripe_search_metadata'|'stripe_list_email_fallback'|'stripe_create' }>
```

## Шаги

### 1. Discovery

- Подтвердить `setup_future_usage='off_session'` в `mode=payment` для cards в test-mode.
- Подтвердить доступность `stripe.customers.search` API (нужен версионный bump search index — обычно minute-level).
- `.lovable/proofs/mp_a2_2_stripe_capabilities.md`.

### 2. Customer resolver

Реализовать `_shared/acquiring/stripe-customer-resolver.ts` по контракту.

### 3. Profile meta merge

Helper `mergeStripeCustomerIntoProfile(user_id, account_code, customer_id)` — idempotent jsonb-merge через RPC или `jsonb_set`. Не перезаписывает существующий `customer_id` если он отличается — в этом случае throw `customer_id_collision` + audit (защита от случайной потери reference).

### 4. Checkout integration

- Резолвим `customer_id` ДО создания Session.
- `customer: customer_id` в session params.
- `payment_intent_data: { setup_future_usage: 'off_session' }`.
- `customer_creation` НЕ ставим.

### 5. Webhook

`checkout.session.completed` → если `session.customer` есть и не совпадает с profile → audit + manual_review (не молча перезаписываем). Если совпадает или profile пуст — `mergeStripeCustomerIntoProfile`.

### 6. Saved PM gap check

Проверить, может ли клиент выбрать сохранённую карту в Stripe Checkout `mode=payment`. Зафиксировать gap в proof. Follow-up предложить:

- Stripe Customer Portal (MVP управление PM, без выбора в Checkout);
- либо Stripe Payment Element (отдельный mini-plan).

### 7. Verify (расширенный, правки #4 и #5)

- **S1** Новый user → checkout → Customer создан → profile записан.
- **S2** Тот же user → второй checkout → тот же `customer_id`, новый Customer НЕ создан.
- **S3** Stripe Dashboard / API dump: у Customer появилась `PaymentMethod`, привязка `PaymentMethod.customer === customer_id` подтверждена.
- **S4** Локально PAN/last4/token НЕ хранится (`rg "card_number|pan|fingerprint|last4" supabase/functions/stripe-*` — 0).
- **S5** UI ответ Checkout Session не содержит `payment_method` details (только session URL).
- **S6 (правка #4a) — смена email**: user меняет email в profile → новый checkout → тот же `customer_id`, Stripe Customer.email опционально обновлён.
- **S7 (правка #4b) — смена name**: то же, тот же `customer_id`.
- **S8 (правка #4c) — повторная покупка**: 3-й checkout того же user → тот же `customer_id`.
- **S9 (правка #5 negative test) — multi-account**: один user, ДВА разных `account_code` (`stripe_poland` + тестовый второй connection в `acquiring_connections`, добавляется временно через INSERT в test) → checkout по каждому → ДВА разных `customer_id`, оба сохранены в `profiles.meta.stripe.customers[]` по разным ключам.
- Регрессия: 10/10 Phase 2 + smoke MP-A2-1 — PASS.

### 8. Proof (правка #7)

`.lovable/proofs/mp_a2_2_customer_resolver_v1.md` (RU):

- diff по каждому файлу;
- 9 сценариев с реальными Stripe test IDs (`cus_...`, `pm_...`, `cs_test_...`, `pi_...`);
- **Stripe Dashboard screenshot ИЛИ API dump** для S3: объекты `Customer`, `PaymentMethod`, и подтверждение `PaymentMethod.customer === Customer.id` (через `stripe.paymentMethods.list({ customer })`);
- JSON-фрагменты `profiles.meta.stripe.customers` для тестовых users (S1, S9 multi-account);
- раздел «Gap: выбор saved PM в Checkout» с follow-up рекомендацией;
- `git diff --stat supabase/functions/bepaid-*` — пусто.

## Не делаем

- Не создаём таблицы для PM/customers.
- Не храним PAN/fingerprint/last4 локально.
- Не возвращаем `payment_method` объекты в UI.
- Не включаем live.
- Не меняем bePaid.
- Не реализуем Payment Element / Customer Portal в этом mini-plan.

## DoD

- 9/9 runtime сценариев PASS (включая multi-account negative test).
- Stripe Dashboard / API dump приложен.
- Saved PM gap зафиксирован.
- Proof создан, на русском.
- User approve получен **до** execute.

---

# Pilot Readiness Review (правка #8) — отдельный gate перед Stage C

После закрытия MP-A2-2, **до** старта Runtime Pilot, выполняется отдельный read-only review с чек-листом.

## Чек-лист (PASS/FAIL по каждому пункту)

1. **Account resolver** — `resolveDefaultStripeAccount()` возвращает корректный `(account_code, test_mode, success_url, cancel_url)` из БД. Хардкод `stripe_poland` отсутствует.
2. **Customer resolver** — 4-step lookup (cache → search → email fallback → create) работает; SOT = `(user_id, account_code)`.
3. **Saved Payment Method** — `setup_future_usage='off_session'` активен; PM привязан к Customer (подтверждено через `stripe.paymentMethods.list({customer})`).
4. **Customer Portal readiness** — оценить, нужен ли Stripe Customer Portal Session для пилота (только консультация, single charge — может НЕ требоваться). Решение зафиксировать.
5. **Hardcode audit** — повторный `rg` по правке #3 показывает 0 MUST-FIX попаданий.
6. **Phase 2 regression** — 10/10 PASS.
7. **bePaid frozen** — `git diff` по `bepaid-*` за период MP-A2-1+MP-A2-2 — пусто.
8. **Multi-account safety** — S9 negative test переподтверждён (один user, два account_code, два разных Customer).
9. **E2E metadata trace** — 6/6 точек (Checkout/PaymentIntent/payments_v2/orders_v2/provider_events/Dashboard) — PASS.
10. **No live keys** — `acquiring_connections.test_mode=true` для активного дефолтного Stripe-аккаунта; в env нет live-ключей.

## Proof

`.lovable/proofs/pilot_readiness_review_v1.md` (RU): по каждому пункту PASS/FAIL с короткой ссылкой на источник (proof-файл, SQL, screenshot).

## Gate

Runtime Pilot Stage C запускается **только при 10/10 PASS**. Любой FAIL — возврат в соответствующий mini-plan, без перехода к пилоту.

---

# Общий порядок execute

1. Approve MP-A2-1 v2 → execute → proof → review.
2. Approve MP-A2-2 v2 → execute → proof → review.
3. Approve Pilot Readiness Review → execute (read-only) → proof.
4. Только при 10/10 PASS Pilot Readiness Review → Approve Stage C Runtime Pilot («Платная консультация»).