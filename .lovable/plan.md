# Phase 3 Sequence Status

1. ✅ Discovery
2. ✅ Pending State Strategy
3. ✅ Phase 3.1.0 — enum `pending`
4. ✅ Phase 3.1.0-B — Pending Guard helper + manual cleanup (CR-2 helper closure)
5. ⏳ **Phase 3.1.1 — Price Mapping STOP-GATE** — частично закрыт. GAP-A **PASS** (BYN recurring капабилен на stripe_poland, см. proof). Остаются открытыми GAP-B, GAP-C, GAP-D.
6. ⛔ Phase 3.1 Infinite Subscription MVP — заблокирован до закрытия GAP-B/C/D.
7. ⛔ Runtime Proof — заблокирован (GAP-D).
8. ⛔ Phase 3.2+ (Customer Portal, Dunning, Reconcile) deferred.

## Phase 3.1.1 — что утверждено

- **SOT для Stripe Price/Product mapping:** `tariff_offers.meta.stripe.{product_id, price_id, price_id_history[]}`. Альтернативные источники отвергнуты с обоснованием.
- **Validation Contract** (резолвер `resolveStripePriceForOffer`) — HTTP 422 на любой mismatch, обязательный audit, checkout не создаётся.
- **Price Rotation Strategy** — supersede через append `price_id_history[]` + Stripe archive old; запрет изменения immutable Price; запрет нескольких активных Price per (offer, account_code).
- **Multi-account future схема:** `meta.stripe.accounts[<account_code>]` с fallback на flat legacy. MVP читает только flat.
- **bePaid не затронут.**

## Phase 3.1.1 — GAP List

- **GAP-A — Currency Decision.** ✅ **verified_pass** (2026-06-04). Stripe API на test-аккаунте `acct_1Tc88d6UYJj2vm0G` (PL) создаёт recurring Price в BYN (month и year), HTTP 200, `livemode=false`. Гипотеза «BYN не поддерживается» опровергнута. Proof: `.lovable/proofs/stripe_phase_3_1_1_gap_a_byn_capability_proof_v1.md`. Subscription/Checkout capability в BYN — отдельно в GAP-D.
- **GAP-B — Recurring Interval Mapping.** `billing_period_mode/days` → Stripe `recurring.interval/interval_count` resolver (без миграции). **NEXT.**
- **GAP-C — Stripe Product+Price Provisioning.** Mini-plan `admin-provision-stripe-price` + запись в `tariff_offers.meta.stripe.*`.
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

Supabase Edge Function Secrets — НЕ источник истины для Stripe. Это объясняет, почему `fetch_secrets` не показывает `STRIPE_SECRET_KEY`, хотя интеграция работает.

## Pilot recommendation
`Gorbova Club / CHAT` — offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`, amount 100 BYN, `billing_period_mode=days, days=30` → Stripe `interval=day, interval_count=30` (требует GAP-B resolver).

## Memory update
**Candidate (требует approve):** `mem://architecture/payments/stripe-price-mapping-sot-v1`, `mem://architecture/payments/stripe-secret-resolver-sot`.

## Что заблокировано до полного PASS Phase 3.1.1
- `stripe-create-subscription-checkout`;
- subscription webhooks (`customer.subscription.*`, recurring `invoice.paid`);
- `provider_subscriptions` Stripe wiring;
- subscription runtime tests;
- Phase 3.1 MVP Execution.

## Следующий шаг
**GAP-B — Recurring Interval Mapping resolver** (как зафиксировано пользователем при approve plan GAP-A: после PASS GAP-A не переходить сразу к MVP, сначала GAP-B).
