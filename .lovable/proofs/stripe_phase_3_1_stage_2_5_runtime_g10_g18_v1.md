# Stripe Phase 3.1 — Stage 2.5 Runtime Proof (G10–G18)

Дата: 2026-06-05. Среда: Stripe TEST (account_code=`stripe_poland`, livemode=false).
Карта: 4242 4242 4242 4242, exp 12/34, cvc 123, ZIP 10001.

---

## FINDING-STAGE25-BLOCKER-1 — RESOLVED ✅

Stripe webhook endpoint `we_1TeFMV6UYJj2vm0GpIGKQ7pp` не был подписан на subscription/invoice события до запуска proof.

### Before
```
enabled_events (6):
  checkout.session.completed
  checkout.session.expired
  payment_intent.succeeded
  payment_intent.payment_failed
  charge.refunded
  charge.dispute.created
```

### After (Stripe API verify GET /v1/webhook_endpoints/we_1TeFMV6UYJj2vm0GpIGKQ7pp)
```
id: we_1TeFMV6UYJj2vm0GpIGKQ7pp
status: enabled
url: https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/stripe-webhook
enabled_events (11):
  charge.dispute.created
  charge.refunded
  checkout.session.completed
  checkout.session.expired
  customer.subscription.created    [+]
  customer.subscription.deleted    [+]
  customer.subscription.updated    [+]
  invoice.paid                     [+]
  invoice.payment_failed           [+]
  payment_intent.payment_failed
  payment_intent.succeeded
```

### Подтверждения
- Stripe API response → `status:"enabled"`, URL не изменён.
- `supabase/functions/stripe-webhook/index.ts` — НЕ модифицирован (Stripe-side config only).
- Webhook signing secret — НЕ ротирован.
- Никакой код / БД / схема не менялись.

---

## Setup / fixtures

| Поле | Значение |
|---|---|
| user_id | `05cd3754-d589-4d90-97d1-89ba2bee610b` |
| product_id | `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club) |
| tariff_id | `31f75673-a7ae-420a-b5ab-5906e34cbf84` (CHAT, 30d) |
| tariff_offer_id | `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` (BYN 100, recurring) |
| account_code | `stripe_poland` |
| price_id | `price_1Teeq26UYJj2vm0GPXHSLKlz` |
| stripe_product_id | `prod_UdwjYeet4QFbtW` |

### Pre-create writer (canonical Stage 1)
POST `/stripe-create-subscription-checkout` → HTTP 200:
- `subscription_v2_id` = `2725681b-b420-45e2-a71f-58973e3159ec`
- `provider_subscription_row_id` = `11d2ace5-0f31-4e1c-8ad1-8ba7a9a12864`
- Checkout Session: `cs_test_a1pUthNOmX0IcBnbrLLQpRHBFvFiyJThGIk4gUmzphQtsHRRptQvUBdWei`

Карта оплачена через browser automation → Stripe принял платёж, выпустил 4 события.

---

## Stripe events delivered (по Stripe timestamps, секунды)

| Stripe order (created_at) | event_type | event_id | local processing_status |
|---|---|---|---|
| 10:23:07.085 | `invoice.paid` | `evt_1Teuu46UYJj2vm0G2DUHo5uQ` | **manual_review** (`manual_review:unknown`) |
| 10:23:07.414 | `checkout.session.completed` | `evt_1Teuu46UYJj2vm0G4BvZfJZL` | processed |
| 10:23:07.424 | `customer.subscription.created` | `evt_1Teuu46UYJj2vm0GHjTZVkAY` | processed (bound + **state=active**) |
| 10:23:07.480 | `payment_intent.succeeded` | `evt_3Teuu06UYJj2vm0G11HvL4FQ` | processed |

Локальные `processed_at` показывают, что `invoice.paid` обработан первым (10:23:07.374), до того как `customer.subscription.created` (10:23:08.743) успел связать `subscriptions_v2.meta.stripe.subscription_id` с локальной строкой.

---

## Final DB state (после оплаты)

### `subscriptions_v2[2725681b-…]`
```
status            = pending          ← НЕ active
billing_type      = provider_managed
auto_renew        = false
access_start_at   = 2026-06-05 09:33:55+00 (pre-create stub)
access_end_at     = NULL             ← окно не открыто
meta.stripe.subscription_id = sub_1Teuu26UYJj2vm0GgEii9W5q
meta.stripe.customer_id     = cus_UeDKkXgNLzdNcV
meta.stripe.price_id        = price_1Teeq26UYJj2vm0GPXHSLKlz
```

### `provider_subscriptions[11d2ace5-…]`
```
state                    = active                            ← НЕСОВМЕСТИМО с subv2.status=pending
provider                 = stripe
provider_subscription_id = sub_1Teuu26UYJj2vm0GgEii9W5q      (pre-create placeholder перезаписан)
```

### `orders_v2` (provider=stripe, последние 15 мин)
```
0 rows
```

### `payments_v2` (provider=stripe, последние 15 мин)
```
0 rows
```

### `audit_logs` (этот subv2 / Stripe, последние 15 мин)
```
stripe.invoice.paid.no_subscription           ← invoice.paid не нашёл локальную подписку
stripe.subscription.created.bound             ← created выполнил bind после факта
```

---

## Gate results

### G10 — `customer.subscription.created` без `invoice.paid` ⚠️ PARTIAL
- `subscriptions_v2.status` = `pending` ✅ (как требует контракт).
- НО ход доказательства искажён: `subscriptions_v2` остался pending не потому что `created` правильно воздержался от активации, а потому что **`invoice.paid` упал в `manual_review` и физически не дошёл до активации**.
- Кроме того `provider_subscriptions.state` обновлён в `'active'` обработчиком `customer.subscription.created`. По контракту Stage 2 binding-only — это нарушение.

### G11 — `invoice.paid` → orders_v2/payments_v2/grant-access ❌ **FAIL**
- `orders_v2` не создан, `payments_v2` не создан, `grant-access-for-order` не вызван.
- `processing_status = manual_review`, `processing_error = manual_review:unknown`.
- `audit_logs.stripe.invoice.paid.no_subscription` — обработчик не нашёл subv2 по `meta.stripe.subscription_id`, потому что `customer.subscription.created` ещё не успел его записать (race-condition в порядке доставки/обработки событий).

### G12 — Idempotency replay 🛑 NOT EXECUTED
Замороженo: воспроизведение `invoice.paid` повторно зафиксирует тот же `manual_review`-исход. Идемпотентность по `event_id` гарантируется UNIQUE-индексом `provider_events_idem_unique` (подтверждено схемой), но business-level replay имеет смысл только после фикса G11.

### G13 — Conflict fixtures 🛑 NOT EXECUTED
Зависит от рабочего пути G11.

### G14 — Self-cancel → status active до конца периода 🛑 NOT EXECUTED
Невозможно протестировать: `subscriptions_v2.status` так и не достиг `active`.

### G15 — `invoice.payment_failed` (Test Clock / 4000…0341) 🛑 NOT EXECUTED
Заблокирован базовой ошибкой G11.

### G16 — Cross-provider conflict (unit-level) ✅ PASS
Совмещённый резолвер `_shared/subscription-conflict.ts` принимает `providers: ['bepaid','stripe']`. Проверка bePaid `provider_subscriptions` за 15 мин = 0 затронутых строк, 0 bePaid-events. Cross-provider write от Stripe-пути не зафиксирован.

### G17 — bePaid untouched ✅ PASS
- `provider_subscriptions` (provider=bepaid, modified last 15m) = **0**.
- `provider_events` (provider=bepaid, last 15m) = **0**.
- `git diff` для `supabase/functions/bepaid-*` за сессию = empty.

### G18 — End-to-end UUID chain ❌ FAIL
Цепочка обрывается на G11: `subv2_id` существует, но нет `order_id`, `payment_id`, `entitlement_id`. Полная цепочка недостижима.

---

## FAIL summary

| Gate | Verdict |
|---|---|
| G10 | ⚠️ Partially correct, по неверной причине |
| G11 | ❌ FAIL — invoice.paid → manual_review, нет orders/payments/grant |
| G12 | 🛑 not executed |
| G13 | 🛑 not executed |
| G14 | 🛑 not executed |
| G15 | 🛑 not executed |
| G16 | ✅ PASS (unit) |
| G17 | ✅ PASS |
| G18 | ❌ FAIL |

**Итого Stage 2 = FAIL.**

---

## Identified defects (для STAGE2-FIX-NN, без правок в proof-сессии)

### DEFECT-STAGE2-A — race condition: invoice.paid опережает customer.subscription.created
- Stripe доставляет `invoice.paid` и `customer.subscription.created` практически одновременно; порядок обработки не гарантирован.
- Если `invoice.paid` обрабатывается первым, locator по `subscriptions_v2.meta.stripe.subscription_id` не находит запись (она ещё не привязана), → `manual_review:unknown`.
- Требуется:
  1. Поиск pre-created `subscriptions_v2` по альтернативному ключу — `provider_subscriptions.provider_subscription_id = invoice.subscription` или `provider_subscriptions.meta.tracking_id` независимо от того, обработан ли `customer.subscription.created`.
  2. ИЛИ defer-обработка `invoice.paid` с коротким bounded retry (3–5 sec) до появления binding, затем повтор; в противном случае — manual_review.
  3. Дополнительно: outbox/queue с in-order replay per `subscription_id`.

### DEFECT-STAGE2-B — `customer.subscription.created` неконтрактно мутирует `provider_subscriptions.state='active'`
- По контракту Stage 2 `created` выполняет binding (записывает `provider_subscription_id` поверх `pending:{uuid}`) и НЕ активирует.
- Фактически `provider_subscriptions.state` сразу переведён в `active` без `invoice.paid`.
- Требуется: оставить `state='pending'` (или новый `bound`) до `invoice.paid`; activation — единая точка в invoice.paid пути.

### DEFECT-STAGE2-C — несогласованное состояние SOT
- `provider_subscriptions.state='active'` ↔ `subscriptions_v2.status='pending'` ↔ `orders_v2`=пусто.
- Любой downstream-консьюмер (access-resolver, billing, CRM) увидит противоречивые SOT.
- Требуется: атомарный переход всех трёх SOT в один такт под invoice.paid lock.

---

## Что НЕ менялось во время proof (compliance с STOP-rules)

| Файл / объект | Изменён? |
|---|---|
| `supabase/functions/stripe-webhook/index.ts` | NO |
| `supabase/functions/grant-access-for-order/*` | NO |
| `supabase/functions/bepaid-*` | NO |
| `supabase/functions/_shared/subscription-conflict.ts` | NO |
| Schema (subscriptions_v2/provider_subscriptions/orders_v2/payments_v2/provider_events) | NO |
| Webhook signing secret | NO |
| Webhook endpoint URL | NO |
| Stripe-side webhook `enabled_events` | **YES — BLOCKER-1 resolution, см. выше** |

---

## Следующий шаг

Согласно STOP-rules плана Stage 2.5, обнаружение defects, требующих правок `stripe-webhook` / contract — **формирует отдельный PATCH `STAGE2-FIX-01` со scope DEFECT-A/B/C**, затем runtime повторяется с G10. Никакие правки в этой proof-сессии не вносились.
