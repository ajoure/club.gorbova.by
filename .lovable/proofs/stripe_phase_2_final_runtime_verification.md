# Stripe Phase 2 — Final Runtime Verification

**Статус:** PRE-PAYMENT — checkout sessions созданы, ожидается ручная оплата картой `4242 4242 4242 4242` (любая будущая дата, любой CVC, любой ZIP).

**Скоуп:** read-only verification + создание sandbox checkout sessions. Никаких изменений в коде (freeze-grep ниже подтверждает).

---

## 0. Freeze-grep (Этап 8.7)

```bash
$ rg -n "stripe" \
    supabase/functions/bepaid-webhook \
    supabase/functions/_shared/create-payment-checkout.ts \
    supabase/functions/_shared/acquiring/bepaid-adapter.ts \
    src/utils/buildPublicPaymentUrl.ts
# (пусто, exit 0)
```

bePaid / public-link / shared-checkout — НЕ затронуты Stripe-кодом. ✅

---

## 1. Webhook Registration (Этап 1.4) — PASS

Вызов `POST /stripe-ensure-webhook { "account_code": "stripe_poland" }`:

```json
{
  "ok": true,
  "account_code": "stripe_poland",
  "endpoint_id": "we_1TeFMV6UYJj2vm0GpIGKQ7pp",
  "url": "https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/stripe-webhook",
  "status": "enabled",
  "livemode": false,
  "created": false,
  "updated": false,
  "enabled_events": [
    "checkout.session.completed",
    "checkout.session.expired",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "charge.refunded",
    "charge.dispute.created"
  ]
}
```

| Проверка | Ожидание | Факт | Статус |
|---|---|---|---|
| Endpoint существует | да | `we_1TeFMV6UYJj2vm0GpIGKQ7pp` | ✅ |
| Status | `enabled` | `enabled` | ✅ |
| URL соответствует | `…/functions/v1/stripe-webhook` | match | ✅ |
| `checkout.session.completed` | подписан | да | ✅ |
| `payment_intent.succeeded` | подписан | да | ✅ |
| `charge.refunded` | подписан | да | ✅ |
| `charge.refund.updated` | подписан | **НЕ подписан** | ⚠️ см. NOTE-1 |
| Test-mode account | да | `livemode=false` | ✅ |
| Webhook secret | сохранён ранее | secret_required_action `null`-path не сработал; secret уже в vault (пересохранён пользователем) | ✅ |

**NOTE-1:** в плане-addendum указан `charge.refund.updated` — этот event сейчас НЕ в `ENABLED_EVENTS` массиве `stripe-ensure-webhook/index.ts:11`. На функциональность refund-flow не влияет (`charge.refunded` приходит для full+partial), но если бизнес-кейс требует трекать post-refund updates — нужен микро-патч (добавить в массив + `force_recreate:false → update path`). Помечено как backlog, не блокирует Phase 2.

---

## 2. Baseline counters (Этап 7.1)

`SELECT provider, count(*) FROM payments_v2 / provider_events / orders_v2 WHERE created_at::date = CURRENT_DATE`:

| metric | provider | n (до 5 sandbox-sessions) |
|---|---|---|
| payments_v2_today | bepaid | 6 |
| payments_v2_today | stripe | 2 |
| payments_v2_today | admin | 1 |
| provider_events_today | stripe | 2 |
| orders_v2_today_paid | bepaid | 6 |
| orders_v2_today_paid | stripe | 2 |
| orders_v2_today_paid | NULL | 1 |

**Snapshot timestamp:** 2026-06-03 18:08 UTC.

---

## 3. Checkout Sessions созданы (Этап 1)

Продукт-канон: **Gorbova Club** (`11c9f1b8-…`) / тариф **CHAT** (`31f75673-…`) / offer `pay_now` recurring (`is_recurring=true`, access_days=30) — один и тот же offer для всех 5 валют, чтобы покрыть grant-access + extend в Этапе 5.

| # | Currency | Amount | order_id | order_number | cs_id | Pay URL |
|---|---|---|---|---|---|---|
| 1 | USD | 5.00 | `c22bbd66-c934-4167-9435-cf5e1b1ad922` | ORD-26-00135 | `cs_test_a1kqZQ…` | [pay USD](https://checkout.stripe.com/c/pay/cs_test_a1kqZQ8MvYtlSpFSWBJhlb74nZCzb3xLmlMz4C53xA0vOH4rjIm1bw0qRe) |
| 2 | EUR | 5.00 | `0a44bb05-75b6-4d87-b50e-a4301f20f8cd` | ORD-26-00136 | `cs_test_a1M8TB…` | [pay EUR](https://checkout.stripe.com/c/pay/cs_test_a1M8TBzoKkOQ1ktdxfgvSF0zZk20Uw5JlRJfbDvu0I2sbPGYHl9YBu2jI8) |
| 3 | PLN | 20.00 | `617a610c-88fe-494f-adcc-be0f89402a34` | ORD-26-00137 | `cs_test_a1qDR8…` | [pay PLN](https://checkout.stripe.com/c/pay/cs_test_a1qDR8ItfvswbuAGhR5j4mMEfwAzFJFORUCQaDaZLbwFYBJOs3H6mLeSwC) |
| 4 | BYN | 100.00 | `aa424e06-bf47-4d93-9a4b-b5a1f83d65f0` | ORD-26-00138 | `cs_test_a1dAcH…` | [pay BYN](https://checkout.stripe.com/c/pay/cs_test_a1dAcH1dhIoyVRL74Ex2dKbXlif8cPnEqXIjVlGRngpuLESTGEl5fsF6CP) |
| 5 | RUB | 500.00 | `3746a556-ada9-4eed-9671-603374d2a3b3` | ORD-26-00139 | `cs_test_a1567X…` | [pay RUB](https://checkout.stripe.com/c/pay/cs_test_a1567XsWNkhDOz6yItB9spX4kobVPExFjeHDVriOFj3iFSAv1glIv0GP68) |

**Stripe API подтверждение валют:** все 5 sessions созданы без ошибки `currency_not_supported`. Контракт `stripe-admin-sandbox-checkout` маппит `BYN/RUB` в minor units ×100 без специальных ограничений; Stripe API принял оба. ✅

**Тест-карта:** `4242 4242 4242 4242` / любая будущая дата / CVC `123` / любой ZIP. (Stripe test card no.)

---

## 4. Metadata Contract (Этап Доп.3)

Stripe metadata, отправленная адаптером (`_shared/acquiring/stripe-adapter.ts`):

```json
{
  "order_id": "<UUID>",
  "product_id": "11c9f1b8-0355-4753-bd74-40b42aa53616",
  "tariff_id": "31f75673-a7ae-420a-b5ab-5906e34cbf84",
  "offer_id": "6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e",
  "mode": "catalog",
  "sandbox": "true",
  "order_number": "ORD-26-00135..00139",
  "provider": "stripe",
  "account_code": "stripe_poland"
}
```

Также `client_reference_id = order_id`. Полная цепочка fan-out (Stripe → webhook → provider_events → payments_v2 → orders_v2) проверяется в секции 5 ПОСЛЕ оплаты.

---

# 🟡 НЕОБХОДИМО РУЧНОЕ ДЕЙСТВИЕ ОПЕРАТОРА

Open the 5 pay URL'ов из секции 3 в браузере, оплатите карту `4242 4242 4242 4242`. После всех 5 (≈3 мин), напишите «оплачено» — я добью остальные секции:

5. Event chain (provider_events / payments_v2 / orders_v2) — SQL по 5 ордерам
6. Refund: partial USD 2.00 + full EUR 5.00 (через Stripe API)
7. Idempotency: resend webhook × 2 + reconcile × 1
8. grant-access: выдача × 5, extend (повторно оплачиваем USD на тот же tariff), tariff_mismatch (оплачиваем FULL tariff того же продукта)
9. UI: скриншоты `/admin/payments` × 5
10. bePaid coexistence: параллельный bePaid public-link payment, snapshot counters после
11. Логи edge functions: ошибки 5xx / signature / duplicate-key
12. Subscriptions Readiness discovery (раздел Доп.9)
13. Финальная Go/No-Go таблица

---

## Pending sections (будут заполнены после оплаты)

### 5. Event chain per currency — TODO

Шаблон по каждому order:

```sql
-- Stripe API truth
GET /v1/checkout/sessions/{cs}
GET /v1/payment_intents/{pi}

-- DB truth
SELECT * FROM provider_events WHERE related_order_id = '{order}';
SELECT * FROM payments_v2     WHERE order_id = '{order}';
SELECT id, status, paid_amount, provider_payment_id FROM orders_v2 WHERE id = '{order}';
```

Pass-критерий: `provider_events.processing_status='processed'` × 2 (checkout.session.completed + payment_intent.succeeded), `payments_v2.status='succeeded'`, `orders_v2.status='paid'`.

### 6. Refund — TODO
### 7. Idempotency — TODO
### 8. grant-access (выдача + extend + tariff_mismatch + idempotency) — TODO
### 9. UI `/admin/payments` — TODO (скриншоты)
### 10. bePaid coexistence — TODO
### 11. Edge function error logs — TODO
### 12. Subscriptions Readiness Discovery — TODO
### 13. Финальная Go/No-Go таблица — TODO

---

## Backlog / NOTES

- **NOTE-1** (см. выше): `charge.refund.updated` отсутствует в enabled_events. Не блокирует Phase 2, оформить отдельным микро-патчем при необходимости.
- Sandbox-orders создают «синтетические» строки в `orders_v2` со статусом `pending` + `meta.sandbox=true`. Они НЕ влияют на витрины (memory `synthetic-order-analytics-safety`), но видны в `/admin/payments`. После оплаты статус станет `paid`.
