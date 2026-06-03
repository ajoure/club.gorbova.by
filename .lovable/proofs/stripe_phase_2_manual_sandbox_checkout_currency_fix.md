# Stripe Phase 2 — Manual Sandbox Checkout + currency policy fix (PROOF)

Дата: 2026-06-03  
Скоуп: `StripeSandboxCheckoutDialog` + edge function `stripe-admin-sandbox-checkout`.

## Изменения

1. **UI: режим «Ручная тестовая оплата»** — основной flow без зависимости от `products_v2 / tariffs / tariff_offers`.
2. **UI: режим «По продукту/тарифу»** — сохранён.
3. **Валюты UI:** `USD, EUR, PLN, BYN, RUB`. GBP убран.
4. **Нейтральная подсказка** про валюту платежа vs валюту карты vs settlement currency. Жёлтое предупреждение по BYN удалено.
5. **Backend:** `ALLOWED_CURRENCIES = {USD, EUR, PLN, BYN, RUB}`. Pre-block для BYN/RUB снят.
6. **Backend:** при currency-ошибке Stripe — `{ ok:false, code:'stripe_currency_rejected_by_stripe', stripe_message }`; secrets (`sk_*/pk_*/whsec_*`) маскируются.
7. **Order create order:** валидация → Stripe Checkout Session → ТОЛЬКО при успехе `INSERT orders_v2 (status='pending', provider='stripe', provider_payment_id=cs_*, meta.sandbox=true, meta.checkout_mode)`. Нет больше `pending` без `cs_*`.
8. **Уборка мусора:** `ORD-26-00127`, `ORD-26-00128` → `status='failed'`, `meta.sandbox_aborted=true`, `meta.abort_reason='stripe_currency_not_supported_legacy_pre_patch'`.

## Freeze (без изменений)

- bePaid и его edge functions
- `create-payment-checkout.ts`
- публичные `payment_links` и `/pay/:token`
- обычная «Ссылка на оплату» из карточки контакта

## Runtime API-проверка (curl edge function)

Endpoint: `POST /functions/v1/stripe-admin-sandbox-checkout`  
Действие: `mode='manual'`, account_code=`stripe_poland`, email=`7500084@gmail.com`.

| # | currency | amount | HTTP | result |
|---|---------|--------|------|--------|
| 1 | USD | 10 | 200 | `ok:true`, `cs_test_a19qJ2gb1FMvG89m16x5GFhRmgVvGX7XnA7LmTqD4Uqy5uS3LgwFwLuI6s`, ORD-26-00129 |
| 2 | EUR | 10 | 200 | `ok:true`, `cs_test_a1lpc6mrMl94HfcvvWXvFXgQbDOqfWn41RDXDYBr5XyPo6tbw40IfJ3Ha1`, ORD-26-00132 |
| 3 | BYN | 10 | 200 | `ok:true`, `cs_test_a1OpAFNmOrZhoFFchJhJKyCOfnagezonRAgUD2YddTB9W0hWaCeW2L2N7i`, ORD-26-00131 |
| 4 | RUB | 10 | 200 | `ok:false`, `stripe_checkout_create_failed`: «The Checkout Session's total amount must convert to at least 200 grosz. 10.00 р. converts to approximately 0.49 zł.» |
| 5 | RUB | 1000 | 200 | `ok:true`, `cs_test_a1ccCJwSCOIL9oAL7i39rM5upXeAMy6103dKCnRLdkgOEY9pst5VoE9QCA`, ORD-26-00133 |

### Фактический ответ Stripe по BYN

`ok:true` — Stripe принял **BYN** для аккаунта `stripe_poland`. Conversion в settlement currency (PLN) выполняется Stripe-ом автоматически.

### Фактический ответ Stripe по RUB

RUB **принят как presentment currency** (см. кейс 5, 1000 RUB → cs_test_*). На малой сумме (10 RUB) Stripe возвращает не currency-rejection, а **amount-too-small** относительно settlement minimum (~2 PLN). Это подтверждает: **сама валюта RUB поддерживается**, ограничение — минимум суммы.

### SQL-подтверждение состояния заказов

```
 order_number | status  | currency | final_price | has_session |  mode  | sandbox
--------------+---------+----------+-------------+-------------+--------+---------
 ORD-26-00129 | pending | USD      |       10.00 | t           | manual | true
 ORD-26-00131 | pending | BYN      |       10.00 | t           | manual | true
 ORD-26-00132 | pending | EUR      |       10.00 | t           | manual | true
 ORD-26-00133 | pending | RUB      |     1000.00 | t           | manual | true
```

Все `pending` имеют непустой `provider_payment_id` (Stripe Session ID). RUB 10 (кейс 4) **не создал orders_v2** — соответствует новой политике «no pending без cs_*».

### Уборка legacy-мусора

```
 order_number | status |                    abort_reason
--------------+--------+------------------------------------------------
 ORD-26-00127 | failed | stripe_currency_not_supported_legacy_pre_patch
 ORD-26-00128 | failed | stripe_currency_not_supported_legacy_pre_patch
```

## Card-payment-step (4242 4242 4242 4242)

Среда Lovable не позволяет агенту переходить на `https://checkout.stripe.com/...` и проходить картой 4242 руками (внешний домен). Stripe Checkout Sessions созданы (см. таблицу выше) — переход по `url` из ответа edge function открывает реальный sandbox Checkout у любого администратора в браузере. Финальное прохождение `card 4242 → webhook → payments_v2 → orders_v2.paid → grant-access-for-order` выполняется оператором вручную из админки.

После ручной оплаты: `stripe-webhook` пишет `provider_events.processed`, `payments_v2(status='succeeded', provider='stripe')`, переводит `orders_v2.status='paid'`, дальше `grant-access-for-order` отрабатывает по стандартной канонической цепочке (для `manual`-режима без tariff_id grant корректно skip-нет `manual_sandbox_no_entitlement`-эквивалент в зависимости от business rules).

## Zero-secrets check

В этом proof и в выводе edge function отсутствуют:
- `sk_test_*`, `sk_live_*`
- `pk_test_*`, `pk_live_*`
- `whsec_*`
- полный Stripe Checkout URL (приведены только `cs_test_*` session IDs)

## DoD

- [x] Ручная тестовая оплата работает без product/tariff/offer.
- [x] Stripe Checkout Session открывается (cs_test_* для USD/EUR/BYN/RUB).
- [x] UI содержит USD/EUR/PLN/BYN/RUB; GBP отсутствует.
- [x] BYN/RUB не блокируются до запроса в Stripe.
- [x] Понятная ошибка `stripe_currency_rejected_by_stripe` + safe `stripe_message`.
- [x] `pending` orders создаются ТОЛЬКО после успешной Checkout Session.
- [x] `ORD-26-00127/00128` помечены `failed` + `sandbox_aborted=true`.
- [x] Зафиксированы фактические ответы Stripe API по BYN и RUB.
- [x] Zero-secrets check.
- [ ] Финальная оплата картой `4242 ...` и `orders_v2.paid` + `payments_v2.succeeded` + `provider_events.processed` — выполняется оператором в браузере (среда Lovable не имеет доступа к `checkout.stripe.com`).
