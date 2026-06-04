# Stripe Subscription MVP — статус этапов

- GAP-A — BYN Price Capability: ✅ **PASS**
- GAP-B — Billing Period Resolver: ✅ **PASS**
- GAP-C — Product/Price Provisioning: ✅ **PASS** (pilot `prod_UdwjYeet4QFbtW` / `price_1Teeq26UYJj2vm0GPXHSLKlz`)
- GAP-D — Runtime Stripe Subscription Capability Proof: ✅ **PASS** (executed 2026-06-04 18:00–18:04 UTC агентом через browser automation; proof: `.lovable/proofs/stripe_phase_3_1_3_gap_d_runtime_capability_v1.md`; sub `sub_1Tefbl6UYJj2vm0GRRkvZEBQ` canceled; isolation diff=0 во всех бизнес-таблицах)
- Phase 3.1 Infinite Subscription MVP Execution: 🟡 IN PROGRESS
  - Stage 0 — Pre-MVP Webhook Contract Discovery: ✅ **PASS** (2026-06-04; proof: `.lovable/proofs/stripe_phase_3_1_stage_0_webhook_contract_discovery_v1.md`)
  - Stage 1 — Pre-create writer + adapter extension: ⏳ ожидает approve
  - Stage 2 — Webhook 5 event-веток + shared resolver: ⏸ TODO
  - Stage 3 — Runtime Proof G1–G10 + bePaid non-regression: ⏸ TODO
  - Stage 4 — Lost Webhook Recovery (reconcile/replay): ⏸ TODO

---

# Да, согласен, с учетом правок:

1. **Webhook формулировку лучше уточнить.**
  &nbsp;
  Сейчас написано:
  stripe-webhook не должен получать события этого probe
  Но если webhook endpoint уже зарегистрирован в Stripe test mode, Stripe может физически отправить события. Правильнее:
2. **provider_events = 0 может быть слишком жёстким.**
  &nbsp;
  Если текущий `stripe-webhook` уже получает все test events и пишет их в `provider_events`, это не обязательно нарушение.
  Исправить критерий:
3. **Обязательная отмена subscription — правильно.**
  &nbsp;
  Добавить ещё контроль:
4. **Events.list фильтр.**
  &nbsp;
  В `events.list` не все события имеют `metadata.purpose` на верхнем объекте.
  Поэтому фильтровать не только по metadata, но и по ID-цепочке:
5. **Browser automation**
  &nbsp;
  Согласен: сначала automation. Ручная оплата пользователем только если automation реально недоступна и это зафиксировано.
6. **DoD дополнить**
  &nbsp;
  Добавить:
7. **После PASS**
  &nbsp;
  Формулировка правильная:

```text
Следующий шаг — Phase 3.1 Infinite Subscription MVP Execution Plan.
Не execute сразу.
```

С этими правками GAP-D можно approve к выполнению.

&nbsp;

План: GAP-D — Runtime Stripe Subscription Capability Proof (v2, с правками)

## Цель

Доказать, что `price_1Teeq26UYJj2vm0GPXHSLKlz` (BYN 100/month, account `stripe_poland`, test) реально работает в Stripe Subscription flow: Checkout Session → оплата test-картой `4242` → реальная `sub_*` → `invoice.paid` → `payment_intent.succeeded` → events. **Без записи в нашу БД, без участия нашего webhook, с обязательной отменой subscription после proof.**

## Что GAP-D PASS доказывает (и что НЕ доказывает)

PASS GAP-D **доказывает**:

- BYN recurring Price технически работает в Stripe Subscriptions.
- Stripe Checkout `mode=subscription` принимает наш price_id.
- Stripe создаёт связку `sub_* → in_* → pi_* → ch_* → evt_*`.

PASS GAP-D **НЕ доказывает**:

- наш webhook lifecycle (`stripe-webhook` НЕ участвует);
- `grant-access-for-order` интеграцию;
- pre-create `provider_subscriptions` / `subscriptions_v2`;
- renewal/dunning logic.

Эти доказательства — отдельный этап **Phase 3.1 Infinite Subscription MVP Execution Plan**.

## Scope (строго)

- ТОЛЬКО offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` / price `price_1Teeq26UYJj2vm0GPXHSLKlz`.
- ТОЛЬКО account `stripe_poland`, ТОЛЬКО test mode (`livemode=false`).
- Создаваемая subscription **обязательно отменяется** в том же proof-run.

## Out of scope (запрещено)

- INSERT/UPDATE в `subscriptions_v2`, `provider_subscriptions`, `orders_v2`, `payments_v2`, `entitlements`, `access_rules`, `telegram_*`, `provider_events`.
- Регистрация Stripe webhook endpoint или любые изменения `supabase/functions/stripe-webhook` (он не должен получать события этого probe — endpoint для test-аккаунта в Stripe Dashboard не настраивается в рамках этого GAP; если он уже настроен исторически — отдельно зафиксировать в proof факт получения событий, но не их обработку).
- Изменения bePaid pipeline / `bepaid-webhook`.
- Live keys.
- UI для конечных пользователей.
- `grant-access-for-order` и любые fulfillment-цепочки.
- Создание новых Stripe Products/Prices.

## Discovery (read-only baseline)

1. Подтвердить `tariff_offers.meta.stripe.price_id = price_1Teeq26UYJj2vm0GPXHSLKlz`, `schema_version=1`, `account_code=stripe_poland`.
2. `stripe.prices.retrieve(...)` → drift-check (см. STOP-gates).
3. Зафиксировать `baseline_time = now()` и сохранить в proof. Снять baseline-снимки (запросы выполняются повторно после cancel — diff должен быть пуст):
  - `SELECT count(*), max(created_at) FROM provider_subscriptions WHERE created_at >= baseline_time;`
  - `SELECT count(*), max(created_at) FROM subscriptions_v2 WHERE created_at >= baseline_time;`
  - `SELECT count(*) FROM orders_v2 WHERE created_at >= baseline_time AND meta::text ILIKE '%gap_d%';`
  - `SELECT count(*) FROM payments_v2 WHERE created_at >= baseline_time AND meta::text ILIKE '%gap_d%';`
  - `SELECT count(*) FROM provider_events WHERE created_at >= baseline_time;` (для проверки, что наш webhook не пополнялся).

## Реализация — одна edge function

### `admin-stripe-subscription-capability-probe`

- `verify_jwt=true`, super_admin only, без UI.
- Не регистрирует webhook, не вызывает наш webhook, не пишет в рантайм-таблицы.
- Actions:

#### `action=create` (с `execute: true|false`)

- Резолв ключа Stripe по `account_code=stripe_poland` (test) через `_shared/acquiring/vault.ts`.
- STOP-валидация `price.retrieve`: `active && livemode===false && currency==='byn' && recurring.interval==='month' && recurring.interval_count===1`. При расхождении → 422 `price_drift_detected`, без Stripe write-calls.
- Генерация **idempotency-key**: `gap-d-probe:{tariff_offer_id}:{YYYYMMDD}:{crypto.randomUUID().slice(0,8)}` — сохраняется в response и в proof. Часовой/предсказуемый ключ запрещён.
- `stripe.checkout.sessions.create({ mode:'subscription', line_items:[{price, quantity:1}], success_url:'https://gorbova.by/admin/_gap-d/success?cs={CHECKOUT_SESSION_ID}', cancel_url:'https://gorbova.by/admin/_gap-d/cancel', metadata:{ purpose:'gap_d_capability_probe', tariff_offer_id, account_code, environment:'test', idempotency_key }, subscription_data:{ metadata:{ purpose:'gap_d_capability_probe', tariff_offer_id, idempotency_key } } })`.
- Возврат: `{ checkout_session_id, url, idempotency_key, expires_at }`. **Нет** записей в нашу БД.
- Audit (technical only, не business ledger): `stripe_capability_probe_dry_run` / `stripe_capability_probe_session_created` с пометкой `purpose=gap_d_capability_probe`.

#### `action=pay_via_browser`

- Если browser automation доступен — вызвать `browser--navigate_to_url(url)`, заполнить card `4242 4242 4242 4242`, любой будущий exp, любой CVC, любой ZIP, submit, дождаться success page.
- Если browser automation недоступен — отдать оператору URL.

#### `action=inspect { checkout_session_id }`

- `checkout.sessions.retrieve(id, { expand:['subscription','subscription.latest_invoice','subscription.latest_invoice.payment_intent','subscription.latest_invoice.charge','customer'] })`.
- `events.list({ created.gte: session.created, limit: 100 })`, фильтр по `data.object.metadata.purpose='gap_d_capability_probe'` либо по `subscription/invoice/payment_intent/charge id`.
- Снимок: `cs_*`, `sub_*`, `in_*`, `pi_*`, `ch_*`, `cus_*`, `evt_*[]`. **Read-only.**

#### `action=cancel { subscription_id }` — обязательный шаг

- Перед: `subscriptions.retrieve(sub_id)` → ожидаем `status=active|trialing`.
- `stripe.subscriptions.cancel(sub_id, { invoice_now: false, prorate: false })`.
- После: `subscriptions.retrieve(sub_id)` → ожидаем `status=canceled`, `canceled_at != null`, `cancel_at_period_end=false` (или эквивалент `ended_at` set).
- `events.list` после cancel → зафиксировать `customer.subscription.deleted` / `customer.subscription.updated`.
- Audit: `stripe_capability_probe_subscription_canceled`.

#### `action=verify_isolation { baseline_time }`

- Повторить baseline-запросы. Должны вернуть **0 новых строк** в `provider_subscriptions`, `subscriptions_v2`, `orders_v2`, `payments_v2` (с фильтром `meta ILIKE '%gap_d%'` где применимо).
- `provider_events` за окно: если наш Stripe webhook endpoint не зарегистрирован в test-аккаунте → 0; если зарегистрирован исторически — зафиксировать поступившие, но проверить, что обработчик не создал side-effects (`subscriptions_v2`/`orders_v2`/`payments_v2`/`entitlements`/`access_rules` baseline diff = 0). Любая нестыковка → FAIL.

## Success / Cancel URLs

- `success_url=https://gorbova.by/admin/_gap-d/success?cs={CHECKOUT_SESSION_ID}`
- `cancel_url=https://gorbova.by/admin/_gap-d/cancel`
- Запрещено: `*.lovableproject.com`, `*.lovable.app`, `*.supabase.co/functions/...`, `localhost`. Соответствует `isForbiddenRedirectUrl` контракту.

## Proof artifact (PASS criteria)

Файл: `.lovable/proofs/stripe_phase_3_1_3_gap_d_runtime_capability_v1.md`

Структура:

1. **Pre-conditions:** snapshot `tariff_offers.meta.stripe`, retrieve(price), `baseline_time`, baseline counts (5 запросов выше), сгенерированный `idempotency_key`.
2. **Checkout Session:** `cs_test_*`, `mode=subscription`, `status=complete`, `payment_status=paid`, `currency=byn`, `amount_total=10000`, `livemode=false`, `metadata.purpose=gap_d_capability_probe`, `metadata.idempotency_key=...`.
3. **Subscription (before cancel):** `id=sub_*`, `status ∈ {active, trialing}`, `items[0].price.id=price_1Teeq26UYJj2vm0GPXHSLKlz`, `currency=byn`, `collection_method=charge_automatically`, `current_period_start/end`, `livemode=false`, `metadata.purpose=gap_d_capability_probe`.
4. **Invoice:** `id=in_*`, `status=paid`, `amount_paid=10000`, `currency=byn`, `billing_reason=subscription_create`.
5. **PaymentIntent:** `id=pi_*`, `status=succeeded`, `amount=10000`, `currency=byn`.
6. **Charge:** `id=ch_*`, `status=succeeded`, `paid=true`, `payment_method_details.card.brand=visa`, `last4=4242`.
7. **Customer:** `id=cus_*`.
8. **Events (`events.list`):** доказать наличие:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `invoice.created`, `invoice.finalized`, `invoice.paid`
  - `payment_intent.succeeded`
  - `charge.succeeded`
9. **BYN recurring confirmed:** валюта BYN на всех уровнях, без конвертации.
10. **Cancel section (обязательно):**
  - Snapshot subscription до cancel (status=active).
    - Cancel API response.
    - Snapshot subscription после cancel (status=canceled, canceled_at, ended_at).
    - Events после cancel: `customer.subscription.updated`/`customer.subscription.deleted`.
    - Подтверждение: дальнейших invoices Stripe не сгенерирует.
11. **Cross-domain isolation (after cancel, повторно):**
  - 5 baseline-запросов — diff = 0.
    - Если `provider_events` пополнился — отдельно показать, что side-effects в `subscriptions_v2/orders_v2/payments_v2/entitlements/access_rules` отсутствуют.
    - bePaid таблицы не затронуты.
12. **Audit separation:**
  - **Technical audit (GAP-D):** только `stripe_capability_probe_*` события, помечены `purpose=gap_d_capability_probe`, не выглядят как production payment/subscription.
    - **Business ledger:** пуст. Перечислить запросы и показать 0 строк:
      - `audit_logs WHERE action IN ('subscription_created','subscription_renewed','order_paid','grant_access_*') AND created_at >= baseline_time` → 0.
      - `orders_v2`/`payments_v2`/`subscriptions_v2` diff = 0.

## STOP-gates

- Price drift при retrieve → 422, без Stripe writes.
- Checkout не достиг `payment_status=paid` → FAIL.
- В нашей БД появилась хоть одна Stripe-строка (subscriptions_v2/provider_subscriptions/orders_v2/payments_v2) → FAIL + RCA.
- Subscription не в BYN → FAIL.
- Cancel вернул не `status=canceled` → FAIL, эскалация (оставлять активную тестовую подписку запрещено).
- Webhook side-effects обнаружены → FAIL.

## Файлы/изменения

- `supabase/functions/admin-stripe-subscription-capability-probe/index.ts` — new.
- `supabase/config.toml` — `[functions.admin-stripe-subscription-capability-probe] verify_jwt = true`.
- `.lovable/proofs/stripe_phase_3_1_3_gap_d_runtime_capability_v1.md` — new (заполняется по факту).
- `.lovable/plan.md` — обновить статус (GAP-A/B/C = PASS; GAP-D = блок добавлен, verdict после прохождения).

## DoD

- Edge function задеплоена. Dry-run возвращает план без Stripe API write-calls.
- `create execute=true` создал `cs_test_*` URL и вернул `idempotency_key`.
- Оплата картой `4242` выполнена (browser automation или fallback на оператора) — success page получен.
- `inspect` вернул полный snapshot 7 объектов + ≥7 классов events.
- `cancel` выполнен, post-snapshot `status=canceled`.
- `verify_isolation` после cancel: 5 запросов diff = 0; business ledger пуст.
- Proof-файл заполнен по 12 пунктам, помечен `Verdict: PASS`.
- `.lovable/plan.md` обновлён.

## После PASS GAP-D

Следующий шаг — **не execute**, а отдельный план: **Phase 3.1 Infinite Subscription MVP Execution Plan**.
В нём:

- pre-create `subscriptions_v2` (pending) + `provider_subscriptions` (pending) до Checkout;
- регистрация и обработка Stripe webhook (`invoice.paid`, `customer.subscription.*`, `payment_intent.*`, `charge.*`);
- маршрут `invoice.paid → grant-access-for-order`;
- runtime proof G1–G10;
- cancel/dunning/renewal lifecycle.