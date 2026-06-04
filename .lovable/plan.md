# Phase 3 Sequence Status

1. ✅ Discovery
2. ✅ Pending State Strategy
3. ✅ Phase 3.1.0 — enum `pending`
4. ✅ Phase 3.1.0-B — Pending Guard helper + manual cleanup (CR-2 helper closure)
5. ✅ Phase 3.1.1 — Price Mapping STOP-GATE: GAP-A **PASS**, GAP-B **PASS (with backlog, approved 2026-06-04)**.
6. ⏳ **Phase 3.1.2 — GAP-C Provisioning Strategy.** NEXT.
7. ⛔ Phase 3.1 Infinite Subscription MVP — заблокирован до PASS GAP-C/D.
8. ⛔ Runtime Proof — GAP-D, заблокирован.
9. ⛔ Phase 3.2+ (Customer Portal, Dunning, Reconcile) deferred.

## Phase 3.1.1 — что утверждено

- **SOT для Stripe Price/Product mapping:** `tariff_offers.meta.stripe.{product_id, price_id, price_id_history[]}`. Альтернативные источники отвергнуты с обоснованием.
- **Validation Contract** (резолвер `resolveStripePriceForOffer`) — HTTP 422 на любой mismatch, обязательный audit, checkout не создаётся.
- **Price Rotation Strategy** — supersede через append `price_id_history[]` + Stripe archive old; запрет изменения immutable Price; запрет нескольких активных Price per (offer, account_code).
- **Multi-account future схема:** `meta.stripe.accounts[<account_code>]` с fallback на flat legacy. MVP читает только flat.
- **SOT суммы/валюты для Stripe Price** = активная строка `tariff_prices` (`final_price`, `currency`). `tariff_offers.amount` = fallback/диагностика, в Stripe не уходит.
- **Resolver `billing_period → Stripe recurring`** (GAP-B): см. proof v1, MVP принципиально `interval_count = 1`.
- **bePaid не затронут.**

## Phase 3.1.1 — GAP List

- **GAP-A — Currency Decision.** ✅ **verified_pass** (2026-06-04). Stripe API на test-аккаунте `acct_1Tc88d…` (PL) создаёт recurring Price в BYN (month и year), HTTP 200, `livemode=false`. Гипотеза «BYN не поддерживается» опровергнута. Proof: `.lovable/proofs/stripe_phase_3_1_1_gap_a_byn_capability_proof_v1.md`. Subscription/Checkout capability в BYN — отдельно в GAP-D.
- **GAP-B — Recurring Interval Mapping.** ✅ **pass_with_backlog** (2026-06-04). Resolver contract зафиксирован: `mode=days/{7,30,365}` → `week/month/year` с `count=1`; `mode=month|year` без days → legacy-нормализация; `interval_count>1` принципиально unsupported в MVP. Пилот `6f306cbc…` → `month/1`, BYN 100.00 (SOT суммы — `tariff_prices`, не `offer.amount`). 5/5 active recurring offer'ов прогнаны. Backlog: нормализация `88c6f10d…` + отсутствующие `tariff_prices` для `d307b438…`/`88c6f10d…`. Proof: `.lovable/proofs/stripe_phase_3_1_1_gap_b_billing_period_resolver_v1.md`.
- **GAP-C — Stripe Product+Price Provisioning.** Mini-plan `admin-provision-stripe-price` + запись в `tariff_offers.meta.stripe.*`. **NEXT.**
- **GAP-D — Runtime Proof.** `prices.retrieve` + capability-проверка `subscription.create` и `checkout.session.create (mode=subscription)` в BYN на пилотном оффере.

## Источник Stripe-ключа (зафиксировано после Pre-check PATCH)

Runtime-путь всех Stripe-функций:

```
runtime call
  → _shared/acquiring/vault.ts :: readAcquiringSecret('stripe', account_code, kind)
  → RPC public.get_acquiring_secret(...)  -- SECURITY DEFINER
  → vault.secrets (`acq:stripe:{account_code}:{secret_key|webhook_signing_secret}`)
  → fallback ENV STRIPE_SECRET_KEY_<ACCOUNT_CODE>/STRIPE_SECRET_KEY (dev only)
```

Supabase Edge Function Secrets — НЕ источник истины для Stripe.

## Pilot recommendation

`Gorbova Club / CHAT` — offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`, amount `BYN 100.00` (`tariff_prices` active row), `billing_period_mode=days, days=30` → Stripe `recurring.interval=month, interval_count=1` (через GAP-B resolver).

## Memory update

**Candidate (требует approve):** `mem://architecture/payments/stripe-price-mapping-sot-v1`, `mem://architecture/payments/stripe-secret-resolver-sot`, `mem://architecture/payments/stripe-billing-period-resolver-v1`.

## Что заблокировано до полного PASS Phase 3.1.1

- `stripe-create-subscription-checkout`;
- subscription webhooks (`customer.subscription.*`, recurring `invoice.paid`);
- `provider_subscriptions` Stripe wiring;
- subscription runtime tests;
- Phase 3.1 MVP Execution.

## Следующий шаг

**GAP-C — Stripe Product+Price Provisioning** (mini-plan `admin-provision-stripe-price`, реальное создание `prod_*`/`price_*` для пилота, запись `tariff_offers.meta.stripe.*`).
