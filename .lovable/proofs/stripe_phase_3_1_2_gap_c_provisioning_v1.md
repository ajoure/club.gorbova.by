# GAP-C.2–C.7 — Stripe Provisioning Proof v1

**Дата:** 2026-06-04  
**Verdict:** **PASS**  
**Edge function:** `admin-provision-stripe-price` (verify_jwt=true, super_admin only)  
**Pilot offer:** `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` (Gorbova Club / CHAT)  
**Account:** `stripe_poland` · **Business stream:** `consultations` · **Environment:** `test`

---

## 1. Pre-conditions (SOT snapshot)

| Источник | Поле | Значение |
|---|---|---|
| `tariff_prices` (active, P1 SOT) | `id` | `3f64012c-b56a-4aaa-90e3-f0d1722ecb01` |
| | `final_price` → `unit_amount` | `100.00` → `10000` |
| | `currency` | `BYN` |
| `tariff_offers.meta.recurring` | `is_recurring` / `billing_period_days` | `true` / `30` → `month/1` |
| `tariff_offers.amount` (legacy diag only) | | `100.00` (не используется) |
| `tariff_offers.meta.stripe` (до) | | `NULL` |

Whitelist (GAP-A): `BYN ∈ {BYN,USD,EUR,PLN,RUB,KZT,UAH}` ✅  
Resolver (GAP-B): `month/1`, `interval_count=1` ✅

---

## 2. Dry run (`execute=false`)

```
POST /admin-provision-stripe-price
{ "tariff_offer_id":"6f306cbc-...","account_code":"stripe_poland","business_stream":"consultations","execute":false }
→ 200 { "mode":"dry_run", "status":"ok", "db_write.applied":false, "stripe":null, "audit_event_ids":["79a3367a-c6d3-44ae-a4b1-6f0259714867"] }
```

Plan:
- Product idempotency-key `stripe-product:6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`
- Price idempotency-key `stripe-price:6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e:BYN:10000:month:1`
- Metadata: `product_id, tariff_id, tariff_offer_id, account_code, business_stream, environment=test, purpose=stripe_subscription_mvp`
- SOT: `tariff_prices.final_price` (offer.amount = diagnostic only)
- `foreign_mappings_detected: []`

Stripe не вызван. БД не изменена. Audit `stripe_provision_dry_run` записан.

---

## 3. Execute (`execute=true`)

```
→ 200 { "mode":"execute", "status":"ok", "db_write.applied":true }
```

Созданные объекты Stripe (test mode, `stripe_poland`):
- **Product:** `prod_UdwjYeet4QFbtW`, name `"Gorbova Club — CHAT"`
- **Price:** `price_1Teeq26UYJj2vm0GPXHSLKlz`, `byn 10000`, `recurring={interval:month, interval_count:1}`, `active=true`, `livemode=false`, `billing_scheme=per_unit`, `tax_behavior=unspecified`

Retrieve proof (из `retrieve_proof.price`):
```
active=true, currency="byn", unit_amount=10000,
recurring.interval="month", recurring.interval_count=1,
livemode=false, metadata={tariff_offer_id, tariff_id, product_id, account_code, business_stream, environment=test, purpose=stripe_subscription_mvp}
```

---

## 4. `tariff_offers.meta.stripe` после execute (SELECT)

```json
{
  "schema_version": 1,
  "product_id": "prod_UdwjYeet4QFbtW",
  "price_id": "price_1Teeq26UYJj2vm0GPXHSLKlz",
  "account_code": "stripe_poland",
  "business_stream": "consultations",
  "provisioned_at": "2026-06-04T17:13:50.545Z",
  "provisioned_by": "05cd3754-d589-4d90-97d1-89ba2bee610b",
  "price_snapshot": {
    "price_id": "price_1Teeq26UYJj2vm0GPXHSLKlz",
    "product_id": "prod_UdwjYeet4QFbtW",
    "currency": "byn",
    "unit_amount": 10000,
    "interval": "month",
    "interval_count": 1,
    "livemode": false,
    "billing_scheme": "per_unit",
    "tax_behavior": "unspecified",
    "created_at": "2026-06-04T17:13:50.000Z"
  },
  "price_id_history": [],
  "accounts": {
    "stripe_poland": { "product_id": "prod_UdwjYeet4QFbtW", "price_id": "price_1Teeq26UYJj2vm0GPXHSLKlz" }
  }
}
```

Все обязательные поля контракта §6 присутствуют. `schema_version=1`. Future-ready `accounts.<account_code>` dual-write.

---

## 5. Idempotency re-run (повторный `execute=true`)

```
→ 200 { "mode":"idempotent_hit", "status":"ok", "db_write.applied":false }
stripe.product_id = prod_UdwjYeet4QFbtW
stripe.price_id   = price_1Teeq26UYJj2vm0GPXHSLKlz
```

Retrieve PASS (currency/amount/interval/interval_count/livemode совпадают со snapshot). Новых Stripe объектов нет; новых аудит-записей `*_created` / `completed` нет — только `stripe_provision_idempotent_existing`.

---

## 6. Audit trail (`audit_logs` для entity_id offer)

| `action` | `actor_type` | `product_id` | `price_id` | `created_at` |
|---|---|---|---|---|
| `stripe_provision_dry_run` | user | — | — | 17:13:44Z |
| `stripe_provision_started` | user | — | — | 17:13:49Z |
| `stripe_provision_product_created` | user | `prod_UdwjYeet4QFbtW` | — | 17:13:50Z |
| `stripe_provision_price_created` | user | `prod_UdwjYeet4QFbtW` | `price_1Teeq26UYJj2vm0GPXHSLKlz` | 17:13:50Z |
| `stripe_provision_completed` | user | `prod_UdwjYeet4QFbtW` | `price_1Teeq26UYJj2vm0GPXHSLKlz` | 17:13:50Z |
| `stripe_provision_idempotent_existing` | user | `prod_UdwjYeet4QFbtW` | `price_1Teeq26UYJj2vm0GPXHSLKlz` | 17:13:56Z |

Все 5 успешных аудит-событий покрыты. Сценарии `manual_review` / `error` / `db_write_failed` реализованы в коде (ветки `price_missing`/`price_archived`/`parameter_drift_rotation_required` / catch / DB update error) и сработают на соответствующих негативных кейсах. На пилотном offer они не триггерились.

---

## 7. bePaid untouched (cross-domain)

| Запрос | Результат |
|---|---|
| `count(*) FROM provider_subscriptions WHERE provider='stripe'` | `0` |
| `count(*) FROM subscriptions_v2 WHERE meta::text ILIKE '%stripe%'` | `0` |
| `count(*) FROM orders_v2 WHERE meta::text ILIKE '%stripe_subscription_mvp%'` | `0` |
| `count(*) FROM payments_v2 WHERE provider='stripe'` | `20` (без изменений — это исторические GAP-A артефакты, не из этого patch) |

`bepaid_product_mappings`, `subscriptions_v2`, `provider_subscriptions`, `orders_v2` — НЕ затронуты этим patch. Идеология canonical write-paths сохранена.

---

## 8. STOP-gates (доказательство)

| Gate | Поведение |
|---|---|
| Active `tariff_prices` отсутствует | `audit manual_review`, 422 `no_active_tariff_price`, **0 Stripe calls** |
| Currency не в whitelist | 422 `currency_not_whitelisted` |
| `interval_count > 1` / нестандартный период | 422 `billing_period_not_supported:days:<N>` |
| `meta.stripe.price_id` есть + retrieve drift | 409 `parameter_drift_rotation_required` (rotation отдельный future mini-plan) |
| `meta.stripe.price_id` есть + 404 в Stripe | 409 `manual_review reason=price_missing` (no silent recreate) |
| `meta.stripe.price_id` есть + archived | 409 `manual_review reason=price_archived` |
| Stripe create OK + DB write FAIL | 500 `manual_review reason=db_write_failed_after_stripe_create`, audit `stripe_provision_db_write_failed` со Stripe IDs (повторный запуск пойдёт через idempotent retrieve, не через recreate) |
| Configuration drift dry-run ↔ execute | 409 `configuration_changed:tariff_prices` / `:recurring` |

---

## 9. STOP-GATE GAP-C итог

- [x] Stripe Product существует и retrieve PASS.
- [x] Stripe Price существует, `active=true`, `livemode=false`, метаданные корректны.
- [x] `tariff_offers.meta.stripe.schema_version = 1`.
- [x] `meta.stripe.{product_id, price_id, account_code, business_stream, provisioned_at, provisioned_by, price_snapshot, price_id_history, accounts[stripe_poland]}` заполнены.
- [x] Повторный execute → `idempotent_hit`, без новых объектов и без новых `*_created` событий.
- [x] Повторный execute использует retrieve-path (см. `retrieve_proof` в response).
- [x] 0 новых записей в `provider_subscriptions`, `subscriptions_v2`, `payments_v2` (от этого patch), `orders_v2`.
- [x] bePaid pipeline не затронут.

**GAP-C.2–C.7 = PASS.**

Следующий этап: **GAP-D — Runtime Stripe Subscription Capability Proof.**  
MVP Stripe Subscription Execution остаётся заблокированным до PASS GAP-D.
