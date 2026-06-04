# PRR-FIX-01 — Runtime Evidence v1

**Дата:** 2026-06-04
**Продукт:** Платная консультация (`9d0d6de8-4b0e-477f-b6c4-ab7def8268f6`)
**Тариф:** Срочная консультация — 800 USD (`28eb8dd9-e5c2-4de0-b4ea-a44d98d63644`)
**Оффер:** `25880f13-5633-4d9b-9118-babb68d08851`
**Покупатель:** Катерина Горбова (super_admin)
- `user_id`: `ccce6483-d3b0-48ca-8e8b-96a835d98276`
- `profile_id`: `5a1e6172-b5ad-4131-9bf0-416fb5297f94`
- `email`: `ceo@ajoure.by`
**Account:** `stripe_poland` (test_mode=true)
**Метод:** реальный Stripe Hosted Checkout, карта `4242 4242 4242 4242`. Synthetic harness не использовался.

---

## 1. Real identifiers

| Узел | ID |
|------|----|
| `orders_v2.id` | `840f2daf-5651-4fd2-b982-ac8bc68e5498` |
| `orders_v2.order_number` | `ORD-26-00149` |
| `payments_v2.id` | `7074b6eb-42af-4bb9-95bf-3d3b27c4f184` |
| `entitlements.id` | `fe5d8059-35f6-4b32-aa8d-ccffa72bf168` |
| Stripe Checkout Session | `cs_test_a1K8O4ISjND7cmtdLJfUkJe9jCShFVm5oPHAzF7hRkv1HHScVyn9iVK26Q` |
| Stripe PaymentIntent | `pi_3TeXpT6UYJj2vm0G1wK0XrbL` |
| Stripe Customer | `cus_UdpLfSk1drCfJ3` |
| `provider_events` (`checkout.session.completed`) | `eeae8e74-7d29-4c63-b79f-009ab114a9d5` / `evt_1TeXpV6UYJj2vm0Gg64AwWtV` |
| `provider_events` (`payment_intent.succeeded`) | `217a944c-9cd1-4fe2-83eb-ee52b53e0f21` / `evt_3TeXpT6UYJj2vm0G1S6sYRUb` |
| `contact_id` (CRM) | — (см. F-PRR-11.F3, контакт-сущность не создана в этом потоке) |
| `deal_id` (CRM) | — (см. F-PRR-11.F3) |

---

## 2. F-PRR-09 — 6-node metadata trace

| Узел | order_id | product_id | tariff_id | offer_id | user_id | account_code | business_stream |
|------|----------|------------|-----------|----------|---------|--------------|-----------------|
| 1. Stripe Checkout Session metadata | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ stripe_poland | ❌ **unspecified** |
| 2. Stripe PaymentIntent metadata | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ stripe_poland | ❌ **unspecified** |
| 3. provider_events (2 события) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ stripe_poland | ❌ **unspecified** |
| 4. payments_v2 | ✅ (FK) | — (через order) | — | — | — | ✅ meta.stripe.account_code | ❌ отсутствует |
| 5. orders_v2 | ✅ self | ✅ | ✅ | ✅ | ✅ | ✅ meta.account_code | ❌ **NULL** |
| 6. entitlements | ✅ FK + meta.tariff_id | ✅ | ✅ meta.tariff_id | — | ✅ | — | — |

**F-PRR-09 Status: ❌ FAIL** — нарушен принцип идентичности 7 полей по всем 6 узлам.

---

## 3. F-PRR-11 — 5-node CRM + Access route

Ожидание из `tariff_offers.meta.crm_routing` (oferta `25880f13-...`):
- `pipeline_id = a0000001-0000-0000-0000-000000000013` (воронка «Платная консультация»)
- `stage_on_success = b0000001-0013-0000-0000-000000000003`

Факт:

| Узел | Ожидание | Факт |
|------|----------|------|
| Contact | привязка к профилю | profile_id присутствует, отдельной CRM-contact сущности нет |
| Deal (orders_v2 как deal) | pipeline_id = `a0000001-...-013` | ❌ **NULL** |
| Deal stage | stage_id = `b0000001-0013-...-003` | ❌ **NULL** |
| Order | paid | ✅ status=paid, paid_amount=800 USD |
| Payment | succeeded | ✅ |
| Entitlement | active с корректным product/tariff | ✅ active, expires 2026-07-04 |

**F-PRR-11 Status: ❌ FAIL** — CRM routing из `tariff_offers.meta.crm_routing` не был применён к `orders_v2`, заказ не попал в воронку «Платная консультация» и не двинут на success-stage.

---

## 4. Anti-orphan checks (6/6)

| Check | Result |
|-------|--------|
| Orphan provider_event (event без orders_v2) для нашей пары событий | ✅ 0 |
| Orphan payment (payments_v2 без orders_v2) | ✅ 0 (FK выполнен) |
| Orphan order (order без provider_event) | ✅ 0 (2 события привязаны через metadata.order_id) |
| Orphan entitlement (entitlement без order) | ✅ 0 (order_id заполнен) |
| Orphan contact | n/a — отдельная CRM-contact сущность не задействована |
| Orphan deal | n/a — deal-as-order, но без pipeline (см. F-PRR-11) |

---

## 5. bePaid frozen

Никаких записей в `bepaid_*`, `payment_reconcile_queue`, `subscriptions_v2` или `provider_subscriptions` по этому order_id/user_id за окно не создано. ✅

---

## 6. No synthetic artifacts

- `cs_test_a1K8...` — реальный Stripe test-mode session ✅
- `pi_3TeXpT6UYJj2vm0G1wK0XrbL` — реальный PaymentIntent ✅
- `evt_1TeXpV..` / `evt_3TeXpT..` — реальные Stripe Event ID ✅
- Запрещённые префиксы (`pi_sim_*`, `cs_sim_*`, `evt_sim_*`, `simulate_order_id`) и edge-функции (`stripe-admin-sandbox-checkout`, `manual-sandbox-order`) **не использовались**. ✅

---

## 7. Findings

### F1 — `business_stream='unspecified'` во ВСЕХ Stripe metadata
- **Где:** Stripe Checkout Session + PaymentIntent + provider_events (3 точки).
- **Ожидание:** `business_stream='consultations'` (согласно `.lovable/discovery/business_stream_classification_v1.md`).
- **Корень:** `stripe-create-checkout` (или upstream resolver) не маппит product → business_stream и шлёт hardcoded `'unspecified'`.
- **Severity:** HIGH — это первый реальный production-trace, который должен закрепить контракт metadata.

### F2 — `orders_v2.meta.business_stream` = NULL
- **Где:** `orders_v2` row.
- **Ожидание:** top-level `business_stream='consultations'` рядом с `account_code`.
- **Связано с:** F1.
- **Severity:** HIGH.

### F3 — `orders_v2.pipeline_id` / `pipeline_stage_id` = NULL (CRM routing не применён)
- **Где:** `orders_v2.pipeline_id`, `orders_v2.pipeline_stage_id`.
- **Ожидание:** `pipeline_id=a0000001-0000-0000-0000-000000000013`, `pipeline_stage_id=b0000001-0013-0000-0000-000000000003` после успешного платежа (stage_on_success).
- **Корень:** Stripe-ветка `grant-access-for-order` / webhook handler не вызывает CRM routing (или не читает `tariff_offers.meta.crm_routing`). Канон `Product → Pipeline Mapping Canon` нарушен.
- **Severity:** CRITICAL — заказ не виден в нужной воронке, нарушает Master Sprint Phase 2.

### F4 — `orders_v2.meta.stripe.checkout_session_id` / `payment_intent_id` = NULL
- **Где:** `orders_v2.meta.stripe`.
- **Ожидание:** sticky-сохранение `cs_test_*` и `pi_*` в `orders_v2.meta.stripe` (как `bepaid_subscription_id` для bePaid).
- **Корень:** webhook handler не пишет stripe-объекты в `orders_v2.meta`. ID есть только в `payments_v2.provider_payment_id` (только PI) и в `provider_events.payload`.
- **Severity:** MEDIUM — для аудита и UI traceability.

---

## 8. Result

| Gate | Status |
|------|--------|
| F-PRR-09 (6-node metadata trace, 7 полей идентичны) | ❌ FAIL (F1, F2) |
| F-PRR-11 (CRM + Access route, pipeline match) | ❌ FAIL (F3) |
| bePaid frozen | ✅ PASS |
| No synthetic artifacts | ✅ PASS |
| Real Stripe test-mode objects | ✅ PASS |
| 6 anti-orphan checks | ✅ PASS |

**Итого PRR v2:** 11/13. Согласно green-light правилу — Stage C Runtime Pilot **НЕ запускается**. Требуется mini-plan PRR-FIX-02 на устранение F1–F4, затем повторный реальный test-checkout и повторная сборка proof.
