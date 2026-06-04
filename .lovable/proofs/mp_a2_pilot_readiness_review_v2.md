# Pilot Readiness Review v2 — Stage B → Stage C gate

**Дата:** 2026-06-04
**Скоуп:** Master Sprint v1.0, Phase 2 (Stripe one-time checkout). Subscriptions/bePaid/live mode — out of scope.
**Метод:** реальный Stripe Hosted Checkout (test_mode=true), карта `4242 4242 4242 4242`. STOP-GATE на `*_sim_*` / sandbox-simulate / синтетические `provider_events` соблюдён.

---

## 1. Sample fixtures

| Fixture | Order | Stripe Session | Stripe PI | Use |
|---------|-------|----------------|-----------|-----|
| Базовый | `ORD-26-00149` | `cs_test_a1K8O4ISjND7…` | `pi_3TeXpT6UYJj2vm0G1wK0XrbL` | PRR-FIX-01 (выявил F1–F4), bакфилл под PRR-FIX-02 |
| Контрольный (после фиксов) | `ORD-26-00150` | `cs_test_a1CGyrut2dgAY…` | `pi_3TeYOs6UYJj2vm0G1KvZgN9E` | PRR-FIX-02 финальный proof |

Обе фикстуры — реальные Stripe test-mode объекты. Никаких `pi_sim_*`, `cs_sim_*`, `evt_sim_*`, `simulate_order_id`, `manual-sandbox-order`, искусственных `provider_events`.

---

## 2. Gates (13/13)

| # | Gate | Status | Evidence |
|---|------|--------|----------|
| 1 | Real Stripe test-mode Checkout Session создаётся через `stripe-create-checkout` (без sandbox harness) | ✅ PASS | `cs_test_a1CGyr…` |
| 2 | Real Stripe test-mode PaymentIntent создаётся и доходит до `succeeded` | ✅ PASS | `pi_3TeYOs…` |
| 3 | Webhook signature verification (`stripe-webhook` через `whsec_…`) | ✅ PASS | 2 события приняты, `signature_valid=true` |
| 4 | Idempotency по `event_id` в `provider_events` | ✅ PASS | unique по `(provider,event_id)`, ретраи не задвоили |
| 5 | `payments_v2` создаётся ровно один раз на терминальное событие | ✅ PASS | 1 запись `succeeded` на `ORD-26-00150` |
| 6 | `orders_v2` переходит в `paid` с корректным `paid_amount/currency` | ✅ PASS | `status=paid`, `paid_amount=800.00 USD` |
| 7 | `entitlements` выдан/продлён через `grant-access-for-order` (canonical write-path) | ✅ PASS | `fe5d8059-…` active, расширен `extend_tariff_match=true` |
| 8 | Anti-orphan: ни provider_event, ни payment, ни order, ни entitlement не сирота | ✅ PASS | см. PRR-FIX-02 §5 |
| 9 | **F-PRR-09:** 6-node metadata trace, 7 ключевых полей идентичны на всех узлах (Checkout → PI → provider_events → payments_v2 → orders_v2 → entitlements) | ✅ PASS | см. PRR-FIX-02 §2 |
| 10 | **F-PRR-11:** 5-node CRM + Access route, `pipeline_id`/`pipeline_stage_id` соответствуют `tariff_offers.meta.crm_routing` (canonical Product → Pipeline Mapping) | ✅ PASS | pipeline `a0000001-…-013`, stage `b0000001-0013-…-003` |
| 11 | Sticky Stripe meta на `orders_v2.meta.stripe` (`checkout_session_id`, `payment_intent_id`, `customer_id`, `account_code`, `business_stream`) | ✅ PASS | см. PRR-FIX-02 §4 |
| 12 | `business_stream='consultations'` end-to-end (Stripe metadata → provider_events → payments_v2 → orders_v2) | ✅ PASS | см. PRR-FIX-02 §2 |
| 13 | bePaid frozen, subscriptions frozen, schedule frozen, provider migration frozen, live mode выключен | ✅ PASS | `subscriptions_v2=0`, `provider_subscriptions=0`, `bepaid_sync_logs=0` за окно |

**Итого:** **13/13 PASS**.

---

## 3. Green-light rule

> Stage C Runtime Pilot выдаётся только если одновременно:
> - F-PRR-09 = PASS,
> - F-PRR-11 = PASS,
> - PRR v2 = 13/13 PASS.

| Условие | Факт |
|---------|------|
| F-PRR-09 | ✅ PASS |
| F-PRR-11 | ✅ PASS |
| PRR v2 | ✅ 13/13 |

**Результат:** ✅ **Green-light на Stage C Runtime Pilot выдан.**

---

## 4. История

- **2026-06-04 / PRR-FIX-01** — runtime evidence v1: 11/13, F-PRR-09=FAIL, F-PRR-11=FAIL. Stage C **запрещён**. Заведён mini-plan PRR-FIX-02 на F1–F4. См. `.lovable/proofs/mp_a2_prr_fix_01_runtime_evidence_v1.md`.
- **2026-06-04 / PRR-FIX-02** — F1–F4 закрыты, повторный реальный Stripe test-checkout (`ORD-26-00150`) даёт 13/13. См. `.lovable/proofs/prr_fix_02_business_stream_crm_routing_sticky_meta.md`.

---

## 5. Freeze (соблюдён)

- bePaid pipeline не тронут.
- Subscriptions (Stripe + bePaid) не тронуты.
- Schedule (cron/dispatcher) не тронут.
- Provider migration не запускалась.
- Live mode не включался.
