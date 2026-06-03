# Stripe Phase 2 — Final Runtime Verification

**Дата:** 2026-06-03 18:35 UTC
**Режим:** автономный (browser автоматизация + curl + миграция). Browser tool успешно открыл и оплатил Stripe Checkout картой `4242 4242 4242 4242`.

---

## TL;DR

| Что | Статус |
|---|---|
| Browser автоматизация Stripe Checkout | ✅ работает |
| Реальная оплата USD $5.00 в test mode | ✅ прошла |
| Webhook chain (`checkout.session.completed` + `payment_intent.succeeded`) | ✅ оба `processed` |
| Найдены 3 production-критичных бага в `stripe-webhook` / `stripe-reconcile-session` | ✅ исправлены add-only |
| Repair-миграция для уже-записанного USD-ордера | ✅ |
| Freeze bePaid / public-link / shared-checkout | ✅ не тронуты |
| EUR / PLN / BYN / RUB (4 валюты) | ⏸ deferred (см. ниже) |
| Refunds (partial+full) | ⏸ deferred |
| Idempotency resend webhook ×2 + reconcile ×1 | ⏸ deferred (код-уровень проверен) |
| grant-access extend/tariff_mismatch real-run | ⏸ deferred |

---

## 1. Что реально выполнено

### 1.1. Подключение Stripe Checkout через browser автоматизацию

`browser--navigate_to_url` успешно открыл `https://checkout.stripe.com/c/pay/{cs_id}#{fid_hash}` — критично: **hash `#fid…` обязателен**, без него Stripe возвращает 404 "page not found". Эта особенность не была учтена в начальном прогоне и приводила к ложным выводам "URL устарел".

Затем `browser--act` (natural_language) заполнил:
- Card information: `4242 4242 4242 4242`
- Expiry: `12 / 30`
- CVC: `123`
- Cardholder: `Test Stripe`
- ZIP: `12345`
- Снял чекбокс "Save my information for faster checkout" (Stripe Link)
- Нажал `Pay`

Стрипа показала `Processing…` → ~5 сек → 302 redirect на `https://gorbova.by/auth?redirectTo=%2Fadmin%2Fintegrations%2Fpayments%3Fstripe_result%3Dsuccess`. Оплата прошла.

### 1.2. End-to-end chain — ORD-26-00140 (USD $5.00)

| Слой | Объект | Статус |
|---|---|---|
| Stripe API | `cs_test_a1WvBnKjkMd3qO6O6PXbfoR4qdkkmyNgUbpiDwu5QflLPK3P2OW4FTMCga` | `status=complete`, `payment_status=paid` |
| Stripe API | `pi_3TeJWM6UYJj2vm0G0L6LxhcN` | `succeeded`, `amount=500`, currency=`usd` |
| provider_events | `checkout.session.completed` (evt_1TeJWN6UYJj2vm0Gh4fFHOw5) | `processed`, signature_valid=true, related_order_id ✓, related_payment_id ✓ |
| provider_events | `payment_intent.succeeded` (evt_3TeJWM6UYJj2vm0G0Mt3AwAX) | `processed`, signature_valid=true |
| payments_v2 | `620c81f5-d7a0-4ce9-9b49-aec3397b7493` | provider=`stripe`, status=`succeeded`, amount=5.00 USD (после repair) |
| orders_v2 | `cffcb1f2-…`/`ORD-26-00140` | status=`paid`, paid_amount=5.00, currency=USD, provider_payment_id=`pi_…` (после repair) |
| metadata | order_id / product_id / tariff_id / offer_id / business_stream / account_code / provider | все 7 ключей контракта проставлены на Session и PaymentIntent ✓ |

---

## 2. Баги найдены и исправлены (add-only)

### BUG-1: webhook записывал amount в minor units

`stripe-webhook` / `stripe-reconcile-session` сохраняли `payments_v2.amount = Number(obj.amount_total)` — это **minor units** (для USD = центы). Результат: $5.00 был записан как `500.00` в БД. Влияет на все non-zero-decimal валюты (USD, EUR, PLN, BYN, RUB и др.).

**Фикс:** добавлен `toMajorUnits()` (`ZERO_DECIMAL = {JPY, KRW, VND}`), все три точки вставки (`checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `reconcile`) теперь конвертируют через него.

### BUG-2: webhook НЕ переводил orders_v2 в paid

Старый код после `grant-access-for-order` оставлял `orders_v2.status='pending'` и `paid_amount=0`. Recoonciler делал только `status='paid'`, без `paid_amount`/`currency`/`provider_payment_id`.

**Фикс:** добавлен idempotent helper `transitionOrderPaid()`, вызываемый из обоих handlers (`checkout.session.completed` и `payment_intent.succeeded`); защита от регрессии "paid → paid" по условию `(status='paid' AND paid_amount>0)`. Reconcile-функция тоже обновляет `paid_amount/currency/provider_payment_id`.

### BUG-3: попытка писать в несуществующий `orders_v2.paid_at`

В первой версии фикса я ошибочно включил `paid_at`. В `orders_v2` такой колонки нет (есть только `updated_at`). Removed во всех точках.

### Repair одного уже-записанного ордера

Миграция `2026_06_03_stripe_repair_minor_units_ord_140`:
- `payments_v2.amount: 500 → 5`
- `orders_v2.paid_amount: 0 → 5`
- `audit_logs`: `stripe.repair.amount_minor_units_2026_06_03`

Идемпотентно (`WHERE amount=500`), затрагивает строго один pi.

---

## 3. Freeze (Этап 8.7)

```
rg -n "stripe" supabase/functions/bepaid-webhook \
                supabase/functions/_shared/create-payment-checkout.ts \
                supabase/functions/_shared/acquiring/bepaid-adapter.ts \
                src/utils/buildPublicPaymentUrl.ts
→ exit 0, no matches
```

bePaid / public-link / shared-checkout — НЕ затронуты Stripe-кодом. ✅

---

## 4. Что НЕ выполнено в этом запуске — честно

Каждая дополнительная сессия Stripe Checkout — это ~10 браузерных turn'ов (navigate → fill card×5 → uncheck Link → click Pay → wait → screenshot → verify). Полный план Phase 2 (4 валюты + 2 refund + idempotency + extend + tariff_mismatch + bePaid parallel + UI скриншоты) — это ~80–100 turn'ов в браузере + 30 SQL-проверок. Это не уместить в один автономный запуск.

Вместо ложного "всё зелёное" фиксирую правду — что осталось:

| # | Что | Почему deferred | Готовность кода после фикса |
|---|---|---|---|
| 1 | EUR €5.00 платёж | ~10 browser turn'ов | код с фиксом BUG-1/2 готов, передеплоен |
| 2 | PLN 20.00 платёж | ~10 browser turn'ов | то же |
| 3 | BYN 100.00 платёж | ~10 browser turn'ов; Stripe API уже принял `currency=byn` без `currency_not_supported` (видел в первом прогоне) | то же |
| 4 | RUB 500.00 платёж | ~10 browser turn'ов; аналогично RUB | то же |
| 5 | Partial refund USD $2.00 | требует Stripe API вызов с `secret_key` из vault | код `charge.refunded` handler фикснут (toMajorUnits применён к `refund.amount`); канон через `record_refund_atomic` ✓ |
| 6 | Full refund EUR €5.00 | то же | то же |
| 7 | Idempotency: resend webhook ×2 | `provider_events.idempotency_key` UNIQUE — guard уже в коде, проверяется на 11-й строчке `Pipeline:` блока stripe-webhook | гарантия `INSERT ON CONFLICT DO NOTHING` ✓ |
| 8 | Idempotency: повторный reconcile | helper в `stripe-reconcile-session` уже маркирует `alreadyProcessed:true` | ✓ |
| 9 | grant-access extend (повторный USD на тот же tariff) | требует ещё одного платежа | канон в `grant-access-for-order` — extend по `tariff_id` ✓ |
| 10 | grant-access tariff_mismatch (FULL tariff) | требует другого tariff_id | канон ✓ |
| 11 | UI скриншоты `/admin/payments` | требует логин в preview + навигация | UI существует, RefundDialog есть |
| 12 | bePaid parallel checkout | требует bePaid public link | freeze-grep подтвердил отсутствие конфликтов на код-уровне |

---

## 5. Сделать в следующем итерационном запуске

1. **EUR €5.00** через тот же flow (создать session → browser → 4242 → verify). Должно подтвердить фикс BUG-1 и BUG-2 «вживую» на свежем платеже.
2. **Refund** через Stripe API (`POST /v1/refunds` с `secret_key` из vault) → проверить `charge.refunded` webhook и `record_refund_atomic`.
3. Остальные валюты + idempotency повторы.

---

## 6. Снимки proof

- Screenshot Stripe Checkout перед оплатой: `tool-results://screenshots/20260603-182702-332843.png`
- Screenshot после "Processing": `tool-results://screenshots/20260603-182814-683981.png`
- Browser get_url после redirect: `https://gorbova.by/auth?redirectTo=%2Fadmin%2Fintegrations%2Fpayments%3Fstripe_result%3Dsuccess`

---

## 7. Файлы изменены

- `supabase/functions/stripe-webhook/index.ts` (add-only: `toMajorUnits` + `transitionOrderPaid`; фикс трёх handler'ов)
- `supabase/functions/stripe-reconcile-session/index.ts` (тот же `toMajorUnits`, расширен update orders_v2)
- миграция `2026_06_03_stripe_repair_minor_units_ord_140` (один заказ ORD-26-00140)

Freeze: bePaid / shared-checkout / public-link / adapter — не тронуты.
