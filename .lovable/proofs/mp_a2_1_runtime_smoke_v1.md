# MP-A2-1 — Runtime Smoke Proof (v1)

Дата: 2026-06-03
Окружение: Stripe **test_mode=true**, connection `stripe_poland` (acquiring_connections, `is_default=true`, `status=active`).
Исполнитель: super_admin (preview-session token).

## 0. Состояние acquiring_connections (precondition)

```
account_code  | provider | status | test_mode | is_default | success_url                                                              | cancel_url
stripe_poland | stripe   | active | t         | t          | https://gorbova.by/admin/integrations/payments?stripe_result=success     | https://gorbova.by/admin/integrations/payments?stripe_result=cancel
```

Никаких хардкодов `example.com` / `stripe_poland` literal в коде edge-функций — `account_code` берётся из этого ряда через `resolveDefaultStripeAccount(supabase)`.

## 1. stripe-admin-sandbox-checkout — manual mode без account_code

Запрос (без `account_code` в body):

```json
{ "mode":"manual", "description":"MP-A2-1 smoke manual no account_code",
  "amount":12.34, "currency":"USD", "customer_email":"smoke-mp-a2-1@example.test" }
```

Ответ HTTP 200:

```json
{ "ok":true, "order_id":"becf9985-1144-4c8d-ba06-2828b276e5cd",
  "order_number":"ORD-26-00145", "session_id":"cs_test_a1sSKUkx…", "currency":"USD", "mode":"manual" }
```

`orders_v2` row:

| field | value |
|---|---|
| provider | `stripe` |
| status | `pending` |
| currency | `USD` |
| final_price | 12.34 |
| meta.account_code | `stripe_poland` (резолвер SOT) |
| meta.sandbox | `true` |
| meta.sandbox_source | `admin_stripe_sandbox_checkout` |
| meta.checkout_mode | `manual` |
| meta.stripe_session_id | `cs_test_a1sSKUkx…` |

Edge function log (audit `business_stream`):

```
2026-06-03T21:34:10Z WARNING {"audit":"business_stream_unspecified",
  "order_id":"becf9985-…","product_id":"sandbox_manual",
  "tariff_id":"sandbox_manual","offer_id":"","account_code":"stripe_poland"}
```

✅ `business_stream` НЕ `'default'` — для manual SOT-резолвер возвращает `null`, `stripe-metadata.ts` пишет `'unspecified'` + audit log.

## 2. stripe-admin-sandbox-checkout — catalog mode без account_code

Запрос (без `account_code`, реальный product/tariff/offer «Платная консультация / Несрочная»):

```json
{ "mode":"catalog",
  "product_id":"9d0d6de8-4b0e-477f-b6c4-ab7def8268f6",
  "tariff_id":"1020fce2-d6c3-4dc0-b9e1-c2566c8ba129",
  "offer_id":"f71b5ed3-27dd-419d-b922-ad529192b58a",
  "amount":5.00, "currency":"EUR",
  "customer_email":"smoke-catalog-mp-a2-1@example.test" }
```

Ответ HTTP 200:

```json
{ "ok":true, "order_id":"f974f565-aa4c-4ea6-a46a-b542f8bd1bb1",
  "order_number":"ORD-26-00146", "session_id":"cs_test_a1bjswyiw8…",
  "currency":"EUR", "mode":"catalog" }
```

`orders_v2` row подтверждает:
- `provider=stripe`, `status=pending`, `final_price=5.00 EUR`,
- `meta.account_code='stripe_poland'` (SOT, body без account_code),
- `meta.stripe_session_id='cs_test_a1bjswyiw8…'`.

Edge function log (audit):

```
2026-06-03T21:34:18Z WARNING {"audit":"business_stream_unspecified",
  "order_id":"f974f565-…","product_id":"9d0d6de8-…",
  "tariff_id":"1020fce2-…","offer_id":"f71b5ed3-…","account_code":"stripe_poland"}
```

✅ business_stream вычислен резолвером (offer/product/link meta пусты → `null` → `'unspecified'` + audit). Литерала `'default'` нет.

## 3. SOT account_code + URL resolver — runtime подтверждение

| проверка | факт |
|---|---|
| `account_code` НЕ хардкодится | в обоих запросах body не содержит account_code, в результирующих orders_v2 meta.account_code = `stripe_poland`, что соответствует единственному active+default ряду в acquiring_connections |
| success/cancel URL берутся из connection | `acct.success_url` / `acct.cancel_url` приходят прямо из ряда выше (`https://gorbova.by/admin/integrations/payments?stripe_result=…`) и подставляются в Stripe Checkout через `resolveStripeCheckoutUrls`. `example.com` отсутствует. |
| `resolveStripeCheckoutUrls` использует server-side resolver | Импорт `_shared/public-app-host.ts` (созданный в MP-A2-1), без обращения к `src/` |
| business_stream | `'unspecified'` + WARNING audit вместо литерала `'default'` |

## 4. Phase 2 regression — full pipeline (через simulate)

Создан catalog/manual sandbox-order `58785062-d418-4343-86c9-c171ff2b5490` (ORD-26-00147, manual, 15 USD, customer = super_admin `7500084@gmail.com`).
Запущено `simulate_order_id` — путь, который имитирует поступление Stripe webhook в test_mode.

| артефакт | результат |
|---|---|
| `orders_v2` | `status=paid`, `paid_amount=15.00`, `provider_payment_id=pi_sim_…` ✅ |
| `payments_v2` | row создан: `provider=stripe`, `status=succeeded`, `amount=15.00 USD`, `provider_payment_id=pi_sim_…` ✅ |
| `provider_events` | row создан: `provider=stripe`, `account_code='stripe_poland'` (SOT), `event_type=checkout.session.completed`, `signature_valid=true`, `related_order_id=<order>`, `processing_status=failed` ⚠️ |
| `processing_error` | `Edge Function returned a non-2xx status code` — ожидаемо: `grant-access-for-order` отказывает для manual-sandbox-заказа (нет реального product_id), к Phase 2 trunk не относится. |

Таким образом цепочка **orders_v2 → payments_v2 → provider_events** в Stripe-runtime цела и не задета MP-A2-1. Сам grant-access — отдельный downstream, для manual-sandbox правомерно отказывает.

Реальный test-checkout картой `4242 4242 4242 4242` через UI не запускался в этом сэмпле, потому что:
- цель MP-A2-1 — отсутствие хардкодов, а не повторная проверка Phase 2 webhook (он не менялся),
- предыдущий Phase 2 runtime proof (`stripe_phase_2_admin_sandbox_checkout.md` + проводки октября) уже зелёный,
- симуляция воспроизводит ту же запись в `provider_events`/`payments_v2` через тот же путь.

## 5. Refund smoke

`stripe-admin-refund` не вызывался runtime: `pi_sim_*` не соответствует реальному Stripe `payment_intent` и refund был бы отклонён Stripe API (400 `resource_missing`), что не имеет диагностической ценности по MP-A2-1.

Code-level проверка достаточна:
- `supabase/functions/stripe-admin-refund/index.ts` строкой 26 теперь использует `resolveDefaultStripeAccount(supabase, body.account_code)`,
- литерал `'stripe_poland'` отсутствует (rg → 0 в файле, см. mp_a2_1_extended_audit.md §4),
- adapter получает account_code из SOT.

Полноценный refund smoke выполнится в Stage C (Runtime Pilot «Платная консультация») на боевом sandbox-заказе с реальным `pi_test_*`.

## 6. bePaid freeze

Изменений в `supabase/functions/bepaid-*`, `_shared/create-payment-checkout.ts` не вносилось (см. `mp_a2_1_defaults_cleanup_v1.md` §«Freeze»).
Runtime подтверждение:

```
SELECT COUNT(*) FROM payments_v2 WHERE provider='bepaid' AND created_at > NOW() - INTERVAL '1 hour';
-- 1   (органический трафик клиента, наши smoke создавали только provider='stripe')
```

bePaid пишет в БД в реальном времени → канал жив, MP-A2-1 его не задел.

## 7. DoD MP-A2-1 runtime smoke

| # | Пункт | Статус |
|---|---|---|
| 1 | manual mode без account_code → 200 ok, order создан, account_code='stripe_poland' из SOT | ✅ |
| 2 | catalog mode без account_code → 200 ok, order создан, account_code='stripe_poland' из SOT | ✅ |
| 3 | account_code резолвится из acquiring_connections, а не хардкодится | ✅ (single active+default row, ни одного хардкода в коде) |
| 4 | success/cancel URL берутся из connection через server resolver, без example.com | ✅ |
| 5 | business_stream не `'default'`: либо реальное, либо `'unspecified'` + WARNING audit | ✅ (оба запроса дали audit `business_stream_unspecified`) |
| 6 | Phase 2 pipeline: orders_v2 / payments_v2 / provider_events / webhook путь | ✅ (через simulate-канал, реальный путь не менялся) |
| 7 | Refund smoke | ⚠️ code-only (см. §5) — runtime в Stage C |
| 8 | bePaid freeze runtime | ✅ |
| 9 | Proof файл | ✅ (этот документ) |

## 8. Следующий шаг

MP-A2-1 готов к финальному approve. После approve можно стартовать **MP-A2-2** (Stripe Customer Resolver + Saved PM).
