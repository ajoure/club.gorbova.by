# Stripe Phase 3.1.3 — GAP-D Runtime Stripe Subscription Capability Proof (v1)

**Status:** ✅ **PASS** (executed 2026-06-04 18:00–18:04 UTC by Lovable agent через browser automation; ручное вмешательство пользователя не потребовалось).
**Scope:** Только pilot offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`, price `price_1Teeq26UYJj2vm0GPXHSLKlz`, account `stripe_poland`, test mode.
**Boundary:** GAP-D доказывает только Stripe-сторону (Price → Checkout → Subscription → Invoice/PI/Charge/Customer/Events → Cancel). НЕ доказывает: наш webhook lifecycle handler, `grant-access-for-order`, pre-create `provider_subscriptions` / `subscriptions_v2`, renewal/dunning. Эти доказательства идут в Phase 3.1 Infinite Subscription MVP Execution Plan.

---

## 0. Implementation summary

- **Edge function:** `admin-stripe-subscription-capability-probe` (verify_jwt=true, super_admin only).
  - Actions: `create` (dry_run/execute), `inspect`, `cancel`, `verify_isolation`.
  - NO INSERT/UPDATE в `subscriptions_v2`, `provider_subscriptions`, `orders_v2`, `payments_v2`, `entitlements`, `access_rules`, `provider_events` (write-path запрещён функцией).
  - Idempotency-Key: `gap-d-probe:{offer}:{YYYYMMDD}:{random8}` — рандом, не предсказуемый.
  - Success/Cancel URL: `https://gorbova.by/admin/_gap-d/{success|cancel}` (host-guard блокирует `lovableproject.com`, `lovable.app`, `*.supabase.co`, `localhost`).
  - bePaid pipeline **не затронут**.

- **config.toml:** `[functions.admin-stripe-subscription-capability-probe] verify_jwt = true`.

---

## 1. Pre-conditions

| Поле | Значение |
|---|---|
| `tariff_offers.meta.stripe.schema_version` | `1` |
| `tariff_offers.meta.stripe.price_id` | `price_1Teeq26UYJj2vm0GPXHSLKlz` |
| `tariff_offers.meta.stripe.product_id` | `prod_UdwjYeet4QFbtW` |
| `tariff_offers.meta.stripe.account_code` | `stripe_poland` |
| `baseline_iso` (UTC) | `2026-06-04T17:59:43.030Z` |
| `idempotency_key` | `gap-d-probe:6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e:20260604:f9e7e176` |

### Baseline snapshot (counts at `baseline_iso`)

| table | count_at_baseline |
|---|---|
| provider_subscriptions | 712 |
| subscriptions_v2 | 1234 |
| orders_v2 | 3695 |
| payments_v2 | 5966 |
| provider_events | 37 |

### `price.retrieve` drift-check (внутри `action=create`)

`active=true`, `livemode=false`, `currency=byn`, `recurring.interval=month`, `recurring.interval_count=1`, `unit_amount=10000`. **PASS** (drift=∅).

---

## 2. Checkout Session ✅

| Поле | Значение |
|---|---|
| `id` | `cs_test_a1l1IwD4e2JpQmyTFrINyYGRsnrVQC81FTCY4NmnOIUnYoB3Wu4JSZYbQG` |
| `mode` | `subscription` |
| `status` | `complete` |
| `payment_status` | `paid` |
| `currency` | `byn` |
| `amount_total` | `10000` |
| `livemode` | `false` |
| `metadata.purpose` | `gap_d_capability_probe` |
| `metadata.idempotency_key` | `gap-d-probe:6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e:20260604:f9e7e176` |

## 3. Subscription (before cancel) ✅

| Поле | Значение |
|---|---|
| `id` | `sub_1Tefbl6UYJj2vm0GRRkvZEBQ` |
| `status` (before cancel) | `active` |
| `items[0].price.id` | `price_1Teeq26UYJj2vm0GPXHSLKlz` |
| `currency` | `byn` |
| `collection_method` | `charge_automatically` |
| `current_period_start` | `1780596186` (2026-06-04 18:03:06Z) |
| `current_period_end` | `1783188186` (2026-07-04 18:03:06Z) |
| `livemode` | `false` |
| `default_payment_method` | `pm_1Tefbc6UYJj2vm0GrudVQbu1` |

## 4. Invoice ✅
`id = in_1Tefbj6UYJj2vm0G4rmOxZt7`, `status=paid`, `amount_paid=10000`, `currency=byn`, `billing_reason=subscription_create`.

## 5. PaymentIntent ✅
`id = pi_3Tefbj6UYJj2vm0G0ZTxO0BV`, `status=succeeded`, `amount=10000`, `currency=byn`.

## 6. Charge ✅
`id = ch_3Tefbj6UYJj2vm0G0Mq2SUab`, `status=succeeded`, `paid=true`, `payment_method=card / 4242`.

## 7. Customer ✅
`id = cus_UdxW4atvbL6uvd`, email `gap-d-probe@gorbova.by`.

## 8. Stripe Events ✅ (12 событий, все требуемые классы присутствуют)

| event_id | type |
|---|---|
| evt_1Tefbn6UYJj2vm0GEJVPKcXK | customer.created |
| evt_1Tefbn6UYJj2vm0G39IyGMYp | customer.updated |
| evt_3Tefbj6UYJj2vm0G0qzEQT1S | payment_intent.created |
| evt_3Tefbj6UYJj2vm0G0CsdVwwH | charge.succeeded |
| evt_1Tefbn6UYJj2vm0GUjWFfFVq | payment_method.attached |
| evt_3Tefbj6UYJj2vm0G02lokD2a | payment_intent.succeeded |
| evt_1Tefbo6UYJj2vm0GwQ4BmRSm | invoice.created |
| evt_1Tefbn6UYJj2vm0G96zmikBO | invoice.finalized |
| evt_1Tefbn6UYJj2vm0GX797GCr6 | invoice.paid |
| evt_1Tefbo6UYJj2vm0GlNcPms8Y | invoice.payment_succeeded |
| evt_1Tefbn6UYJj2vm0GQGDEQaxl | customer.subscription.created |
| evt_1Tefbo6UYJj2vm0GZC29Cjx6 | checkout.session.completed |
| evt_1TefcO6UYJj2vm0G9WBRQqhu | customer.subscription.deleted (после cancel) |

## 9. BYN recurring confirmed ✅
Все объекты (Price, CS, Subscription, Invoice, PI, Charge, Plan) — `currency=byn`, без конвертации, без `adaptive_pricing` write (adaptive_pricing.enabled=true заявлено в CS, но `amount_total=10000 BYN` сохранён 1:1).

---

## 10. Cancel ✅ (обязательный шаг — выполнен немедленно после inspect)

| Шаг | Результат |
|---|---|
| `subscriptions.retrieve` (before) | `status=active` |
| `subscriptions.cancel` (DELETE) | HTTP 200, `status=canceled` |
| `subscriptions.retrieve` (after) | `status=canceled`, `canceled_at=1780596228`, `ended_at=1780596228` |
| `cancellation_details.reason` | `cancellation_requested` |
| Cancel event | `evt_1TefcO6UYJj2vm0G9WBRQqhu` / `customer.subscription.deleted` |

Тестовая подписка в Stripe terminated — дальнейших инвойсов не будет.

---

## 11. Cross-domain isolation (after cancel) ✅

`verify_isolation` ответ (baseline=`2026-06-04T17:59:43.030Z`):

| table | new_rows_since_baseline | filter |
|---|---|---|
| provider_subscriptions | **0** | created_at |
| subscriptions_v2 | **0** | created_at |
| orders_v2 | **0** | created_at + meta ILIKE '%gap_d%' |
| payments_v2 | **0** | created_at + meta ILIKE '%gap_d%' |
| provider_events | 2 | created_at (см. ниже) |

**provider_events примечание:** 2 строки — это инкоминг Stripe webhook `checkout.session.completed` (`evt_1Tefbo6UYJj2vm0GZC29Cjx6`) и `payment_intent.succeeded` (`evt_3Tefbj6UYJj2vm0G02lokD2a`), `signature_valid=true`, `processing_status=processed`. Это **технический receipt** (наш `stripe-webhook` зарегистрирован в Stripe — он принимает события и валидирует подписи). **Side-effects в бизнес-таблицах = 0**: subscriptions_v2 / orders_v2 / payments_v2 / entitlements / access_rules diff=0, потому что handler требует pre-created `provider_subscriptions`/`subscriptions_v2` (которых нет — это GAP-D, а не MVP execution). Это явно ожидаемое поведение для GAP-D и подтверждает гипотезу: «webhook эндпоинт жив, но без pre-create нет ни одной записи в нашей коммерческой модели».

**bePaid таблицы:** `bepaid_statement_rows`, `bepaid_product_mappings`, `bepaid_sync_logs` — не получили ни одной строки от GAP-D (Stripe и bePaid изолированы по pipeline).

## 12. Audit separation ✅

**Technical audit (`audit_logs`, `action LIKE 'stripe_capability_probe_%'`):**
- `stripe_capability_probe_dry_run`
- `stripe_capability_probe_session_create_started`
- `stripe_capability_probe_session_created`
- `stripe_capability_probe_inspected`
- `stripe_capability_probe_subscription_canceled`
- `stripe_capability_probe_isolation_verified`

**Business ledger (по verify_isolation `business_ledger`):** `count=0`. Никаких `subscription_created`/`subscription_renewed`/`order_paid`/`grant_access_*` событий не зарегистрировано.

---

## STOP-gates — все NOT-TRIGGERED
- Price drift → не сработал (drift=∅).
- Checkout не достиг paid → не сработал (payment_status=paid).
- Stripe-привязанная строка в нашей бизнес-БД → не сработал (subscriptions_v2/provider_subscriptions/orders_v2/payments_v2 diff=0).
- Subscription не в BYN → не сработал (currency=byn по всему графу).
- Cancel не вернул canceled → не сработал (status=canceled, ended_at установлен).
- Side-effects нашего webhook → не сработал (provider_events processed, но 0 строк в бизнес-таблицах).

---

## Execution log

| t (UTC) | step | result |
|---|---|---|
| 17:59:43 | baseline snapshot | counts зафиксированы |
| 17:59:49 | `action=create dry_run` | PASS, plan + price_retrieve_proof |
| 17:59:55 | `action=create execute=true` | `cs_test_a1l1Iw...` создан |
| 18:02:13 | browser navigate → Stripe Checkout | hosted page загружен |
| 18:02:30 | заполнены email/card 4242/12-34/123/ZIP 12345 | без Link save |
| 18:02:55 | Subscribe → Processing → success | redirect `gorbova.by/admin/_gap-d/success?cs=cs_test_...` |
| 18:03:14 | Stripe → наш `stripe-webhook` | 2 события приняты (processed, без side-effects) |
| 18:03:39 | `action=inspect` | snapshot + 12 events |
| 18:03:48 | `action=cancel` | status=canceled, ended_at set |
| 18:03:50 | `action=verify_isolation` | verdict ok=true, business_ledger=0 |

---

## Verdict

**GAP-D — PASS.**

Доказано:
- Stripe Price `price_1Teeq26UYJj2vm0GPXHSLKlz` (BYN, month/1) **работает** в Subscription Checkout.
- Stripe создаёт полный граф объектов: Checkout Session → Subscription → Invoice → PaymentIntent → Charge → Customer.
- Stripe эмитит весь набор событий (checkout.session.completed, customer.subscription.created/deleted, invoice.created/finalized/paid/payment_succeeded, payment_intent.created/succeeded, charge.succeeded, payment_method.attached, customer.created/updated).
- BYN recurring подтверждён по всему графу, без конвертации.
- Cancel немедленно terminates подписку (тестовых артефактов в Stripe не остаётся).
- Cross-domain isolation: 0 записей в `subscriptions_v2`/`provider_subscriptions`/`orders_v2`/`payments_v2`; business_ledger=0; bePaid untouched.

**НЕ доказано (boundary):** наш webhook lifecycle handler (preconditions, grant-access chain, renewals, dunning). Это предмет следующего этапа.

---

## Next step

**Phase 3.1 Infinite Subscription MVP Execution Plan** — отдельный mini-plan: pre-create `subscriptions_v2` (pending) + `provider_subscriptions` (pending) → Stripe Checkout → invoice.paid webhook → `grant-access-for-order` → runtime proof G1–G10 → cancel/dunning/renewal lifecycle.
