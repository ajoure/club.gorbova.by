# PRR-FIX-02 — business_stream + CRM routing + sticky Stripe meta

**Дата:** 2026-06-04
**Цель:** закрыть F1–F4 из PRR-FIX-01, поднять Pilot Readiness Review v2 до 13/13.
**Метод:** реальный Stripe Hosted Checkout (test_mode=true), карта `4242 4242 4242 4242`. Никакого `sandbox-simulate`, `manual-sandbox-order`, `*_sim_*`, синтетических `provider_events`.

---

## 1. Real identifiers (новый заказ под PRR-FIX-02)

| Узел | ID |
|------|----|
| Продукт | `9d0d6de8-4b0e-477f-b6c4-ab7def8268f6` (Платная консультация) |
| Тариф | `28eb8dd9-e5c2-4de0-b4ea-a44d98d63644` (Срочная консультация, 800 USD) |
| Оффер | `25880f13-5633-4d9b-9118-babb68d08851` (pay_now) |
| `orders_v2.id` | `522c1ab6-24b9-4e21-8e4f-c114c860269c` |
| `orders_v2.order_number` | `ORD-26-00150` |
| `payments_v2.id` | `903c4417-8d07-41fb-a5e1-3f6e5797ea2e` |
| `entitlements.id` | `fe5d8059-35f6-4b32-aa8d-ccffa72bf168` (reuse, расширено) |
| Stripe Checkout Session | `cs_test_a1CGyrut2dgAYvnc9J2t3I9SWdGLMtoxIOydANhRk7oiOh2QEXoJetwuSo` |
| Stripe PaymentIntent | `pi_3TeYOs6UYJj2vm0G1KvZgN9E` |
| Stripe Customer | `cus_UdpLfSk1drCfJ3` |
| provider_events (`checkout.session.completed`) | `d3070ec2-…` / `evt_1TeYOu6UYJj2vm0GETZ8x0k5` |
| provider_events (`payment_intent.succeeded`) | `bbc02a93-…` / `evt_3TeYOs6UYJj2vm0G10Kdj703` |
| Account | `stripe_poland` (test_mode=true) |

---

## 2. F1/F2 — business_stream

**Корень:** `tariff_offers.meta.business_stream` и `products_v2.meta.business_stream` были пусты — resolver легитимно отдавал `unspecified`.

**Фикс:** seed `business_stream='consultations'` на 5 активных `pay_now`/`trial` офферах продукта `9d0d6de8-…` + на `products_v2` как fallback. `stripe-webhook` пробрасывает значение в `payments_v2.meta.business_stream` + `meta.stripe.business_stream`.

**Проверка по ORD-26-00150:**

| Узел | `business_stream` |
|------|-------------------|
| Stripe Checkout Session metadata | `consultations` ✅ |
| Stripe PaymentIntent metadata | `consultations` ✅ |
| provider_events × 2 (`checkout.session.completed`, `payment_intent.succeeded`) | `consultations` ✅ |
| `payments_v2.meta.business_stream` | `consultations` ✅ |
| `orders_v2.meta.business_stream` | `consultations` ✅ |

**F-PRR-09 (6-node metadata trace, 7 полей):** ✅ PASS.

---

## 3. F3 — CRM routing

**Корень:** Stripe-ветка (`stripe-create-checkout` + `stripe-webhook`) не материализовала `crm_routing_snapshot` и не звала `applyCrmStageOnTerminal`. bePaid это делал, Stripe — нет.

**Фикс:**
- `stripe-create-checkout` → `resolveOfferRoutingWithFallback` + `buildNegativeSnapshot/auditNegativeSnapshot` → `orders_v2.meta.crm_routing_snapshot` записывается до Stripe API call.
- `stripe-webhook` → после терминального события вызывает `applyCrmStageOnTerminal(order_id, 'success'|'failed')` (deal-as-order модель, без orphan deals).

**Проверка по ORD-26-00150:**

```json
orders_v2.meta.crm_routing_snapshot = {
  "enabled": true,
  "offer_id": "25880f13-5633-4d9b-9118-babb68d08851",
  "pipeline_id": "a0000001-0000-0000-0000-000000000013",
  "pipeline_name": "Платная консультация",
  "stage_on_success": "b0000001-0013-0000-0000-000000000003",
  "stage_on_pending": "b0000001-0013-0000-0000-000000000001",
  "stage_on_failed":  "b0000001-0013-0000-0000-000000000004",
  ...
}

orders_v2.pipeline_id       = a0000001-0000-0000-0000-000000000013  ✅
orders_v2.pipeline_stage_id = b0000001-0013-0000-0000-000000000003  ✅ (success)
```

**5-node CRM route:** Contact (profile) → Deal (order, pipeline=Платная консультация) → Stage (Успешно) → Payment (succeeded) → Entitlement (active) ✅.

**F-PRR-11:** ✅ PASS. Канон **Product → Pipeline Mapping Canon** выполнен.

---

## 4. F4 — sticky Stripe meta

**Корень:** `stripe-webhook` не сохранял `cs_*` / `pi_*` / `cus_*` / `account_code` на `orders_v2.meta.stripe`.

**Фикс:** `mergeStripeMetaOnOrder` в `stripe-webhook` (set-if-absent + last-write-wins по узким ключам).

**Проверка по ORD-26-00150:**

```json
orders_v2.meta.stripe = {
  "account_code":      "stripe_poland",
  "business_stream":   "consultations",
  "checkout_session_id":"cs_test_a1CGyrut2dgAYvnc9J2t3I9SWdGLMtoxIOydANhRk7oiOh2QEXoJetwuSo",
  "customer_id":       "cus_UdpLfSk1drCfJ3",
  "payment_intent_id": "pi_3TeYOs6UYJj2vm0G1KvZgN9E"
}
```

✅ PASS.

---

## 5. Anti-orphan (6/6)

| Check | Result |
|-------|--------|
| Orphan provider_event (event без `related_order_id`) — наши 2 события | ✅ оба связаны (`related_order_id=522c1ab6-…`) |
| Orphan payment (`payments_v2` без `order_id`) | ✅ 0, FK выполнен |
| Orphan order (order без provider_event) | ✅ 0, 2 события привязаны |
| Orphan entitlement (без `order_id`) | ✅ 0 |
| Orphan deal (order без pipeline, deal-as-order) | ✅ 0, pipeline+stage заполнены |
| Orphan contact | ✅ profile_id заполнен |

---

## 6. bePaid frozen

- `subscriptions_v2` с `meta.order_id=522c1ab6-…` → **0** ✅
- `provider_subscriptions` с `order_id=522c1ab6-…` → **0** ✅
- `bepaid_sync_logs` за час → **0** ✅
- Никаких касаний bePaid edge-функций по этому потоку ✅

---

## 7. No synthetic artifacts (STOP-GATE)

| Префикс / артефакт | Использован? |
|--------------------|--------------|
| `pi_sim_*`, `cs_sim_*`, `evt_sim_*` | ❌ нет |
| `sandbox-simulate`, `manual-sandbox-order`, `stripe-admin-sandbox-checkout` | ❌ нет |
| `simulate_order_id` | ❌ нет |
| Искусственные `provider_events` | ❌ нет |

Все ID — реальные Stripe test-mode (`cs_test_a1CGyr…`, `pi_3TeYOs…`, `evt_1TeYOu…`, `evt_3TeYOs…`, `cus_UdpLf…`). ✅

---

## 8. Result

| Gate | Status |
|------|--------|
| F-PRR-09 (6-node metadata trace, 7 полей идентичны) | ✅ PASS |
| F-PRR-11 (5-node CRM + Access route, pipeline+stage match) | ✅ PASS |
| F4 sticky Stripe meta on `orders_v2.meta.stripe` | ✅ PASS |
| F1/F2 `business_stream='consultations'` end-to-end | ✅ PASS |
| 6 anti-orphan checks | ✅ PASS |
| bePaid frozen | ✅ PASS |
| No synthetic artifacts | ✅ PASS |
| Real Stripe test-mode objects | ✅ PASS |

**PRR v2:** 13/13 PASS → green-light Stage C Runtime Pilot **РАЗРЕШЁН** (по правилу: F-PRR-09=PASS ∧ F-PRR-11=PASS ∧ PRR v2=13/13).

---

## 9. Изменённые файлы

- `supabase/functions/stripe-create-checkout/index.ts` — материализация `crm_routing_snapshot`, проброс `business_stream` в metadata.
- `supabase/functions/stripe-webhook/index.ts` — `mergeStripeMetaOnOrder` + `applyCrmStageOnTerminal`.
- Data seed: `tariff_offers.meta.business_stream='consultations'` (5 офферов), `products_v2.meta.business_stream='consultations'` (1 продукт).
- Backfill `ORD-26-00149` под audit `prr_fix_02_backfill_ord_26_00149` (dry-run + execute).

## 10. Out of scope (freeze соблюдён)

bePaid, subscriptions, schedule, provider migration, live mode — не тронуты.
