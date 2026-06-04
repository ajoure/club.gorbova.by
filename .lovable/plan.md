# Phase 3 Sequence Status

1. ✅ Discovery
2. ✅ Pending State Strategy
3. ✅ Phase 3.1.0 — enum `pending`
4. ✅ Phase 3.1.0-B — Pending Guard helper + manual cleanup (CR-2 helper closure)
5. ❌ **Phase 3.1.1 — Price Mapping STOP-GATE = FAIL (BLOCKED)** — DoD 5/9 ✅, 4/9 ❌. Proof: `.lovable/proofs/stripe_phase_3_1_1_price_mapping_v1.md`.
6. ⛔ Phase 3.1 Infinite Subscription MVP — заблокирован до закрытия GAP A–D.
7. ⛔ Runtime Proof — заблокирован.
8. ⛔ Phase 3.2+ (Customer Portal, Dunning, Reconcile) deferred.

## Phase 3.1.1 — что утверждено

- **SOT для Stripe Price/Product mapping:** `tariff_offers.meta.stripe.{product_id, price_id, price_id_history[]}`. Альтернативные источники отвергнуты с обоснованием.
- **Validation Contract** (резолвер `resolveStripePriceForOffer`) — HTTP 422 на любой mismatch, обязательный audit, checkout не создаётся.
- **Price Rotation Strategy** — supersede через append `price_id_history[]` + Stripe archive old; запрет изменения immutable Price; запрет нескольких активных Price per (offer, account_code).
- **Multi-account future схема:** `meta.stripe.accounts[<account_code>]` с fallback на flat legacy. MVP читает только flat.
- **bePaid не затронут.**

## Phase 3.1.1 — GAP List (блокируют MVP)

- **GAP-A — Currency Decision (бизнес-решение).** Stripe Poland не поддерживает BYN. Все 5 recurring-офферов в BYN. Выбрать: EUR/PLN/USD пилот, либо отложить Stripe для club/БкБ.
- **GAP-B — Recurring Interval Mapping.** `billing_period_mode/days` → Stripe `interval/interval_count`. Реализовать в резолвере (без миграции).
- **GAP-C — Stripe Product+Price Provisioning.** Нет ни UI, ни admin-функции. Mini-plan PHASE-3.1.1-C (`admin-provision-stripe-price`).
- **GAP-D — Runtime Proof retrieve.** После GAP-C: `prices.retrieve` + snapshot в `stripe_phase_3_1_1_price_mapping_v2.md`.

## Pilot recommendation
`Gorbova Club / CHAT` — offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`, amount 100, `billing_period_mode=days, days=30` → Stripe `interval=day, interval_count=30`. Final currency — в GAP-A.

## Memory update
**Candidate (требует approve):** `mem://architecture/payments/stripe-price-mapping-sot-v1`.

## Что заблокировано до полного PASS Phase 3.1.1
- `stripe-create-subscription-checkout`;
- subscription webhooks (`customer.subscription.*`, recurring `invoice.paid`);
- `provider_subscriptions` Stripe wiring;
- subscription runtime tests;
- Phase 3.1 MVP Execution.

## Следующий шаг
**GAP-A — бизнес-решение по валюте пилота.** Это не код, а решение пользователя. После A → mini-plan C (provisioning) → runtime D → повторный proof v2 → PASS → unblock Phase 3.1 MVP.
