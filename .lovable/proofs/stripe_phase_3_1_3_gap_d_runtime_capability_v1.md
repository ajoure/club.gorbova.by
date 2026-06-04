# Stripe Phase 3.1.3 — GAP-D Runtime Stripe Subscription Capability Proof (v1)

**Status:** ⏳ AWAITING EXECUTION (function deployed, proof заполняется по факту прохождения `create execute=true → pay → inspect → cancel → verify_isolation`)
**Scope:** Только pilot offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`, price `price_1Teeq26UYJj2vm0GPXHSLKlz`, account `stripe_poland`, test mode.
**Boundary (что НЕ доказывается):** наш webhook lifecycle, `grant-access-for-order`, pre-create `provider_subscriptions` / `subscriptions_v2`, renewal/dunning. Эти доказательства идут в Phase 3.1 Infinite Subscription MVP Execution Plan.

---

## 0. Implementation summary

- **Edge function:** `admin-stripe-subscription-capability-probe`
  - `verify_jwt=true`, super-admin only (см. `_shared/acquiring/auth-guard.ts:requireSuperAdmin`).
  - Actions: `create` (dry_run/execute), `inspect`, `cancel`, `verify_isolation`.
  - **Никаких INSERT/UPDATE** в `subscriptions_v2`, `provider_subscriptions`, `orders_v2`, `payments_v2`, `entitlements`, `access_rules`, `provider_events`.
  - Идемпотентность: `Idempotency-Key = gap-d-probe:{tariff_offer_id}:{YYYYMMDD}:{random8}` — random, не предсказуемый.
  - Success/Cancel URL: `https://gorbova.by/admin/_gap-d/{success|cancel}` (host-guard блокирует `lovableproject.com`, `lovable.app`, `*.supabase.co`, `localhost`).
  - bePaid pipeline **не затронут**.

- **config.toml:** добавлен блок `[functions.admin-stripe-subscription-capability-probe] verify_jwt = true`.

---

## 1. Pre-conditions (заполняется при run)

| Поле | Значение |
|---|---|
| `tariff_offers.meta.stripe.schema_version` | `1` |
| `tariff_offers.meta.stripe.price_id` | `price_1Teeq26UYJj2vm0GPXHSLKlz` |
| `tariff_offers.meta.stripe.product_id` | `prod_UdwjYeet4QFbtW` |
| `tariff_offers.meta.stripe.account_code` | `stripe_poland` |
| `baseline_time (UTC ISO)` | _<заполнить при run>_ |
| `idempotency_key` | _<заполнить из ответа `action=create execute=true`>_ |

### Baseline counts (запросы повторяются после cancel — diff должен быть 0)

```sql
SELECT count(*), max(created_at) FROM provider_subscriptions WHERE created_at >= :baseline;
SELECT count(*), max(created_at) FROM subscriptions_v2       WHERE created_at >= :baseline;
SELECT count(*) FROM orders_v2   WHERE created_at >= :baseline AND meta::text ILIKE '%gap_d%';
SELECT count(*) FROM payments_v2 WHERE created_at >= :baseline AND meta::text ILIKE '%gap_d%';
SELECT count(*) FROM provider_events WHERE created_at >= :baseline;
```

### `price.retrieve` drift-check (внутри `action=create`)

Ожидается: `active=true`, `livemode=false`, `currency=byn`, `recurring.interval=month`, `recurring.interval_count=1`.

---

## 2. Checkout Session

| Поле | Ожидание |
|---|---|
| `id` | `cs_test_…` |
| `mode` | `subscription` |
| `status` | `complete` |
| `payment_status` | `paid` |
| `currency` | `byn` |
| `amount_total` | `10000` (BYN 100.00) |
| `livemode` | `false` |
| `metadata.purpose` | `gap_d_capability_probe` |
| `metadata.idempotency_key` | _<совпадает с разделом 1>_ |

---

## 3. Subscription (before cancel)

| Поле | Ожидание |
|---|---|
| `id` | `sub_…` |
| `status` | `active` или `trialing` |
| `items.data[0].price.id` | `price_1Teeq26UYJj2vm0GPXHSLKlz` |
| `currency` | `byn` |
| `collection_method` | `charge_automatically` |
| `current_period_start / _end` | заполнены |
| `livemode` | `false` |
| `metadata.purpose` | `gap_d_capability_probe` |

## 4. Invoice
`id=in_…`, `status=paid`, `amount_paid=10000`, `currency=byn`, `billing_reason=subscription_create`.

## 5. PaymentIntent
`id=pi_…`, `status=succeeded`, `amount=10000`, `currency=byn`.

## 6. Charge
`id=ch_…`, `status=succeeded`, `paid=true`, `payment_method_details.card.brand=visa`, `last4=4242`.

## 7. Customer
`id=cus_…`.

## 8. Stripe Events (`events.list`)

Должны присутствовать:
- `checkout.session.completed`
- `customer.subscription.created`
- `invoice.created`, `invoice.finalized`, `invoice.paid`
- `payment_intent.succeeded`
- `charge.succeeded`

## 9. BYN recurring confirmed
Все объекты выше — в BYN, без конвертации.

---

## 10. Cancel (обязательный шаг)

| Шаг | Ожидание |
|---|---|
| `subscriptions.retrieve` (before) | `status ∈ {active, trialing}` |
| `subscriptions.cancel` (DELETE) response | HTTP 200, `status=canceled` |
| `subscriptions.retrieve` (after) | `status=canceled`, `canceled_at != null`, `ended_at != null` |
| Events после cancel | присутствует `customer.subscription.deleted` или `customer.subscription.updated → canceled` |
| Дальнейшие invoices | Stripe больше не генерирует (subscription terminated) |

---

## 11. Cross-domain isolation (after cancel)

5 baseline-запросов из раздела 1 — diff = **0**.

Дополнительно:
- bePaid таблицы (`bepaid_statement_rows`, `bepaid_product_mappings`, `bepaid_sync_logs`) не имеют записей с `created_at >= baseline_time` от GAP-D.
- Если `provider_events` пополнился (наш test webhook исторически зарегистрирован), показать, что `subscriptions_v2 / orders_v2 / payments_v2 / entitlements / access_rules` diff = 0 — webhook принял события, но handler не сделал side-effects (поскольку preconditions handler-а — наличие соответствующих pre-created строк, которых нет).

## 12. Audit separation

**Technical audit (GAP-D)** — только в `audit_logs` с `action LIKE 'stripe_capability_probe_%'` и `meta.purpose='gap_d_capability_probe'`. Ожидаемые события:
- `stripe_capability_probe_dry_run` (если был dry-run)
- `stripe_capability_probe_session_create_started`
- `stripe_capability_probe_session_created`
- `stripe_capability_probe_inspected`
- `stripe_capability_probe_subscription_canceled`
- `stripe_capability_probe_isolation_verified`

**Business ledger** — должен быть **пуст**:
```sql
SELECT count(*) FROM audit_logs
 WHERE created_at >= :baseline
   AND action IN ('subscription_created','subscription_renewed','order_paid',
                  'grant_access_started','grant_access_completed'); -- expected: 0
```
+ `orders_v2 / payments_v2 / subscriptions_v2` diff = 0 (см. раздел 11).

---

## STOP-gates (если хоть один сработал — Verdict: FAIL)
- Price drift при retrieve → 422, без Stripe write-calls.
- Checkout не достиг `payment_status=paid`.
- В нашей БД появилась хоть одна Stripe-привязанная строка (subscriptions_v2/provider_subscriptions/orders_v2/payments_v2).
- Subscription не в BYN.
- Cancel не вернул `status=canceled` — эскалация (оставлять активную тестовую подписку запрещено).
- Side-effects нашего webhook обнаружены.

---

## Verdict
_<PASS / FAIL — заполнить после прогона всех 4 actions>_
