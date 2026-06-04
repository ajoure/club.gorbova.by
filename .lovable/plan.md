# Phase 3 Sequence Status

1. ✅ Discovery
2. ✅ Pending State Strategy
3. ✅ Phase 3.1.0 — enum `pending`
4. ✅ Phase 3.1.0-B — Pending Guard helper + manual cleanup (CR-2 helper closure)
5. ✅ Phase 3.1.1 — Price Mapping STOP-GATE: GAP-A **PASS**, GAP-B **PASS (with backlog, approved 2026-06-04)**.
6. ⏳ **Phase 3.1.2 — GAP-C Provisioning Strategy.** C.1 ✅ PASS (2026-06-04). C.2–C.7 NEXT.
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
- **GAP-B — Recurring Interval Mapping.** ✅ **pass_with_backlog, approved 2026-06-04**. Resolver contract зафиксирован: `mode=days/{7,30,365}` → `week/month/year` с `count=1`; `mode=month|year` без days → legacy-нормализация; `interval_count>1` принципиально unsupported в MVP (60/90/180/730 → `billing_period_not_supported` + `future-rule` тег, mapping `month/2|3|6`, `year/2` зафиксирован, но активируется только отдельным approve). SOT цены: `tariff_prices.final_price` (P1), `tariff_offers.amount` = fallback diagnostic only, в Stripe не уходит. Валютная часть пилота закрыта GAP-A (BYN Price Capability PASS) — GAP-B валютой не блокируется. Пилот `6f306cbc…` → `month/1`, BYN 100.00. 5/5 active recurring offer'ов прогнаны. Backlog: нормализация `88c6f10d…` + отсутствующие `tariff_prices` для `d307b438…`/`88c6f10d…`. Proof: `.lovable/proofs/stripe_phase_3_1_1_gap_b_billing_period_resolver_v1.md`.
- **GAP-C — Stripe Product+Price Provisioning.** ⏳ **NEXT (Phase 3.1.2).** Mini-plan `admin-provision-stripe-price` + запись в `tariff_offers.meta.stripe.*`. MVP Stripe Subscriptions остаётся заблокированным до PASS GAP-C.
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

## Что заблокировано до PASS GAP-C (Phase 3.1.2)

- `stripe-create-subscription-checkout`;
- subscription webhooks (`customer.subscription.*`, recurring `invoice.paid`);
- `provider_subscriptions` Stripe wiring;
- subscription runtime tests;
- Phase 3.1 MVP Execution.

## Следующий шаг

**Phase 3.1.2 — GAP-C Provisioning Strategy.** Mini-plan на edge function `admin-provision-stripe-price`: реальное создание `prod_*`/`price_*` для пилота `6f306cbc…` (BYN 100.00, month/1), запись в `tariff_offers.meta.stripe.{product_id, price_id, price_id_history[]}`, idempotency через `Idempotency-Key`, rotation-стратегия supersede-only, audit на каждую попытку. Discovery + mini-plan before execute (Diagnose → Plan → Dry run → Execute → Verify).

### GAP-C — обязательный объём (зафиксировано 2026-06-04)

#### C.1 Discovery по существующим Stripe объектам (обязательно до любого provisioning)
- Цель: **не создать дубликат Product/Price** для пилотного оффера `6f306cbc…`.
- Проверить источники:
  - `tariff_offers.meta.stripe.*` (product_id, price_id, price_id_history[], accounts[*]);
  - `products_v2.meta.stripe.*` и `products.meta.stripe.*`;
  - legacy mapping-хранилища: `bepaid_product_mappings` (на предмет stripe-веток), `provider_subscriptions.meta` (sub_*/price_*), `payment_links.meta`, `payments_v2.meta.stripe.*`;
  - admin-конфиги: `payment_settings`, `acquiring_connections.capabilities_snapshot`;
  - реальный Stripe API: `GET /v1/products?ids[]=...` и `GET /v1/prices?product=...&active=all` под `account_code=stripe_poland`.
- Результат фиксируется в `.lovable/proofs/stripe_phase_3_1_1_gap_c_existing_objects_discovery_v1.md` до старта provisioning.

#### C.2 Provisioning idempotency (контракт)
- На один `tariff_offer_id` повторный запуск provisioning **не создаёт** новый Product/Price.
- Алгоритм:
  1. если `meta.stripe.price_id` существует **и** Stripe `prices.retrieve(price_id)` подтверждает `active=true, livemode=false (test), currency=BYN, unit_amount=10000, recurring={interval:month, count:1}` → вернуть существующий mapping, статус `idempotent_hit`;
  2. если Price `archived` (`active=false`) **или** Stripe возвращает 404 → статус `manual_review` + audit `stripe_price_state_drift`, **без silent recreate**;
  3. если `meta.stripe.price_id` пуст **и** Discovery (C.1) не нашёл existing → создать новый Product+Price с `Idempotency-Key = stripe-provision:{tariff_offer_id}:v1`;
  4. mismatch по currency/amount/interval → 422 + audit `stripe_price_parameter_drift`, без перезаписи.
- Silent recreate, force-overwrite, авто-rotation **запрещены**.

#### C.3 Stripe Product SOT (роли источников)
- **Stripe Product** = контейнер (имя, описание, metadata `{product_id, business_stream, account_code}`);
- **Stripe Price** = коммерческие условия (amount, currency, recurring);
- **Бизнес-SOT** остаётся в БД: `tariff_offers` (период, business_stream, account_code), `tariff_prices` (amount, currency);
- Stripe **не становится** источником истины по сумме/периоду — мы только зеркалим БД-факт в Stripe и храним обратные id;
- Любое расхождение Stripe ↔ БД = ошибка нашей синхронизации, не повод доверять Stripe.

#### C.4 Rotation / supersede (изменение стоимости подписки)
- При изменении amount/currency/interval активного оффера:
  - старый `price_*` **не удаляется** локально и **не deactivate** до append в history;
  - создаётся новый `price_*` в Stripe;
  - старый `price_id` переносится в `meta.stripe.price_id_history[]` с `{price_id, archived_at, reason}`;
  - старый Price помечается `active=false` в Stripe (archive);
  - в `meta.stripe.price_id` записывается новый id;
  - **новые подписки** идут на новый Price;
  - **существующие подписки не мигрируются автоматически** (миграция = отдельный operator flow, вне GAP-C).
- Несколько одновременно активных Price per (offer, account_code) запрещены.

#### C.5 Write-path audit (до написания edge function)
- **Кто запускает:** только `super_admin` через UI или ручной вызов; service-role вызовы запрещены без явного actor.
- **actor_type:** `admin` (с `actor_user_id` из JWT); системные ретраи — `system` с `caller='admin-provision-stripe-price'`.
- **audit_logs (обязательные events):**
  - `stripe_provision_started` (input: offer_id, account_code, dry_run flag);
  - `stripe_provision_discovery_result` (existing/missing/drift);
  - `stripe_product_created` или `stripe_product_reused`;
  - `stripe_price_created` или `stripe_price_reused`;
  - `stripe_provision_completed` (final mapping snapshot);
  - `stripe_provision_failed` (error, http_status, stripe_request_id);
  - `stripe_price_state_drift` / `stripe_price_parameter_drift` (для manual_review).
- **dry-run mode:** обязателен, выполняет C.1 + симуляцию C.2 без вызовов `POST /v1/products` и `POST /v1/prices`, возвращает план действий + diff.
- Provisioning **без полного audit trail** запрещён.

#### C.6 Multi-account guard
- Хотя MVP использует только `stripe_poland`, контракт фиксируется сразу:
  - каждый Product и Price принадлежит конкретному `account_code`;
  - целевая future-ready схема хранения — `tariff_offers.meta.stripe.accounts[<account_code>] = { product_id, price_id, price_id_history[] }`;
  - MVP пишет одновременно во **flat** (`meta.stripe.{product_id, price_id, ...}`) и в `meta.stripe.accounts[stripe_poland]` (dual-write), чтение MVP — flat;
  - вызов provisioning **без явного `account_code`** запрещён (422 `account_code_required`);
  - cross-account reuse `price_id` запрещён (Stripe Price принадлежит ровно одному аккаунту).

#### C.7 STOP-GATE GAP-C
GAP-C = **PASS** только при одновременном выполнении:
1. найден или создан **единственный** Stripe Product для пилотного оффера;
2. найден или создан **единственный** активный Stripe Price для пилотного оффера;
3. `tariff_offers.meta.stripe.price_id` (и `product_id`) заполнен и подтверждён `prices.retrieve`;
4. Validation Matrix GAP-B остаётся PASS (currency=BYN, unit_amount=10000, interval=month/1);
5. provisioning полностью идемпотентен (повторный запуск → `idempotent_hit`, без новых объектов);
6. audit trail (C.5) доказан в `audit_logs`;
7. bePaid pipeline (`bepaid-webhook`, `bepaid-sync-*`, `provider_subscriptions` bePaid-ветка) **не затронут** — diff edge functions = 0 в bePaid-области.

#### C.8 Что следует ПОСЛЕ PASS GAP-C
- **GAP-D — Runtime Stripe Subscription Capability Proof:** реальный `subscription.create` + `checkout.session.create (mode=subscription)` на полученном `price_id` в BYN, тестовая карта, проверка `customer.subscription.created` webhook.
- **Только после PASS GAP-D** разрешается переход к **Phase 3.1 Infinite Subscription MVP Execution**.
- До PASS GAP-D запрещено: `stripe-create-subscription-checkout`, subscription webhooks wiring, `provider_subscriptions` Stripe-записи, любые продовые MVP-шаги.
