# GAP-A Verification — BYN Recurring Capability Proof (v1)

Дата: 2026-06-04 UTC. Режим: Stripe **test mode**. Аккаунт: `acct_1Tc88d6UYJj2vm0G` (PL).

## 0. Pre-check (PATCH перед выполнением)

Предыдущий вывод «STRIPE_SECRET_KEY отсутствует» оказался **некорректным**. Подрядчик проверял только Supabase Edge Function Secrets, тогда как runtime-путь Stripe-функций (`stripe-create-checkout`, `stripe-webhook`, `stripe-admin-refund`, `stripe-get-session`, …) читает ключ через собственный vault:

```
runtime call
  → supabase/functions/_shared/acquiring/vault.ts :: readAcquiringSecret('stripe', account_code, 'secret_key')
  → RPC public.get_acquiring_secret(p_provider, p_account_code, p_kind)  -- SECURITY DEFINER
  → vault.secrets (имя: `acq:stripe:stripe_poland:secret_key`)
  → fallback на env STRIPE_SECRET_KEY_STRIPE_POLAND / STRIPE_SECRET_KEY (dev only)
```

`acquiring_connections` запись `stripe / stripe_poland`:
- `test_mode = true`, `status = active`, `is_default = true`
- `publishable_key = pk_test_51Tc88d...`
- `capabilities_snapshot.account.key_mode = 'test'`, `country = PL`, `default_currency = pln`
- `capabilities_snapshot.supported_currencies` уже содержит `byn` (наряду с 130+ другими)

RPC `get_acquiring_secret('stripe','stripe_poland','secret_key')` фактически вернул валидный `sk_test_51Tc88d...` (107 символов). Stripe API ответил HTTP 200 на этом ключе → ключ работает. **Pre-check PASS.**

## 1. Гипотеза (Phase 3.1.1)

> «Stripe Poland does not support BYN. Поэтому recurring Price/Subscription/Checkout в BYN невозможны, MVP по валютному вопросу заблокирован».

## 2. Метод

1. Прочитан `STRIPE_SECRET_KEY` через канонический resolver (vault → RPC).
2. Read-only: `GET /v1/account`, `GET /v1/country_specs/PL`.
3. `POST /v1/prices` с разными комбинациями `currency` × `recurring` (test mode, `Idempotency-Key` на каждый probe, `metadata.purpose=gap_a_byn_capability_proof`, `metadata.do_not_use=true`).
4. Каждый успешно созданный Product/Price архивируется (`active=false`).
5. Никакого Checkout/Subscription поверх созданных Price не создавалось. bePaid не затронут.

## 3. Account snapshot

```json
{
  "id": "acct_1Tc88d6UYJj2vm0G",
  "country": "PL",
  "default_currency": "pln",
  "charges_enabled": true,
  "payouts_enabled": true,
  "capabilities": {
    "card_payments": "active",
    "transfers": "active",
    "blik_payments": "active",
    "klarna_payments": "active",
    "link_payments": "active",
    "bancontact_payments": "active",
    "eps_payments": "active",
    "revolut_pay_payments": "active",
    "mb_way_payments": "active",
    "pix_payments": "active",
    "cartes_bancaires_payments": "pending"
  }
}
```

`GET /v1/country_specs/PL`: `default_currency = pln`, `supported_payment_currencies` содержит **134** валюты, **`byn` присутствует** (индекс 21). `supported_payment_methods = ["card","stripe"]`.

## 4. Probe matrix

Все probes: `POST /v1/prices`, `unit_amount=100`, `product_data[name]=GAPA_*_PROBE_DO_NOT_USE`, `metadata.purpose=gap_a_byn_capability_proof`, разные `Idempotency-Key`.

| Probe | currency | recurring.interval | HTTP | result | type | billing_scheme | tax_behavior | livemode | price id | error |
|---|---|---|---|---|---|---|---|---|---|---|
| **P1** | byn | month | **200** | **created** | recurring | per_unit | unspecified | false | `price_1Ted0E6UYJj2vm0GjX7cMovA` | — |
| **P5** | byn | year | **200** | **created** | recurring | per_unit | unspecified | false | `price_1Ted0F6UYJj2vm0GIjJG5Jtb` | — |
| P2 | byn | — (one-time) | 200 | created | one_time | per_unit | unspecified | false | `price_1Ted0F6UYJj2vm0GVwxAZ66W` | — |
| P3 | eur | month | 200 | created | recurring | per_unit | unspecified | false | `price_1Ted0G6UYJj2vm0GEwfskBVX` | — |
| P4 | pln | month | 200 | created | recurring | per_unit | unspecified | false | `price_1Ted0G6UYJj2vm0G3799b0dY` | — |

Все Price: `active=true` на момент создания, `currency_options` не задан, `type` совпадает с режимом запроса (`recurring`/`one_time`), `recurring.interval_count=1`, `recurring.usage_type=licensed`. `product.livemode=false` (родительский Product создан вместе с Price в test mode).

## 5. Вердикт

| Capability | Status | Доказательство |
|---|---|---|
| **BYN Price Capability** | ✅ PASS | P1, P5, P2 — `POST /v1/prices` создаёт recurring и one-time Price в BYN, HTTP 200, `livemode=false` |
| **BYN Subscription Capability** | ⚠️ NOT TESTED HERE | По плану subscription create в этом discovery не выполнялся. Stripe Price типа `recurring` создан без ошибок и пригоден для `subscription.items[].price`; реальный тест — на этапе GAP-D runtime proof |
| **BYN Checkout Capability** | ⚠️ NOT TESTED HERE | Checkout Session с этим Price не создавался. Будет проверено в GAP-D вместе с PaymentMethod-резолвом (vs `card`-only PM) |

**GAP-A: PASS.** Утверждение «Stripe Poland не поддерживает BYN для recurring subscriptions» **опровергнуто фактическим ответом Stripe API**. BYN — валидная presentment-валюта для аккаунта Stripe Poland, recurring Price создаётся без ограничений. Settlement currency аккаунта = `pln`, поэтому при реальных платежах Stripe применит presentment→settlement-конверсию (+стандартная FX-комиссия); это операционная деталь, не блокер capability.

## 6. Влияние на MVP

- ❌ Запрет на смену валюты пилотного тарифа снят: BYN остаётся валютой пилота `Gorbova Club / CHAT` (offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`).
- ❌ Phase 3.1.1 НЕ закрывается как FAIL по причине BYN.
- ✅ Остаются открытыми и блокирующими MVP только:
  - **GAP-B** — `billing_period_mode/days → recurring.interval/interval_count` resolver.
  - **GAP-C** — provisioning Stripe Product + Price для реального пилотного оффера (запись в `tariff_offers.meta.stripe.{product_id, price_id, price_id_history[]}`).
  - **GAP-D** — runtime proof: `prices.retrieve` для prod_*/price_* реального оффера + (отдельным шагом) capability-проверка Subscription / Checkout в BYN.

Следующий шаг по согласованию пользователя — **GAP-B (resolver days→interval)**, до перехода к MVP.

## 7. Cleanup log

Архивирование Price через `POST /v1/prices/{id}` с `active=false` вернуло HTTP 400 `invalid_request_error: "This price cannot be archived because it is the default price of its product."` — это ожидаемое поведение Stripe (default Price нельзя архивировать отдельно). Выполнено архивирование родительских Products (что эквивалентно деактивации их default-Price):

| Product | HTTP | active |
|---|---|---|
| `prod_Udup1KuyJVCgni` (P1 byn/month) | 200 | false |
| `prod_UduppXgssKcQWi` (P5 byn/year) | 200 | false |
| `prod_UdupelYtLY2cHl` (P2 byn/onetime) | 200 | false |
| `prod_Udupbe3GRUEJdK` (P3 eur/month) | 200 | false |
| `prod_UdupC3Ie9jQQjW` (P4 pln/month) | 200 | false |

Все носят `metadata.do_not_use=true`, `metadata.purpose=gap_a_byn_capability_proof`. Test mode, прод не затронут.

## 8. Что НЕ делалось

- Не создавался `Customer`.
- Не создавался `Subscription`.
- Не создавался `Checkout Session`.
- Не выпускался webhook.
- Не менялся UI, миграции, edge functions, bePaid.
- Не записывались Stripe-идентификаторы в `tariff_offers.meta.stripe.*`.
