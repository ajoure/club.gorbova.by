

# План: PRR-FIX-02 — закрытие F-PRR-09 и F-PRR-11

## Цель

Закрыть F1–F4 из `mp_a2_prr_fix_01_runtime_evidence_v1.md` и получить PRR v2 = 13/13 PASS. Только Stripe one-time path. bePaid, subscriptions, schedule, provider-migration и live mode заморожены.

## Discovery (что уже подтверждено в коде/БД)

- `stripe-create-checkout` уже зовёт `resolveBusinessStream({ offer.meta, product.meta, link })`. Для оффера `25880f13-…` и продукта `9d0d6de8-…` *`meta.business_stream` пустой в обоих источниках** → резолвер легитимно даёт `unspecified`. Это корень F1/F2 на стороне данных.

- `tariff_offers.meta.crm_routing` у оффера заполнен корректно `pipeline_id=a0000001-…-013`, `stage_on_success=b0000001-…-003`).

- `crm_routing` **не упоминается** в `stripe-webhook` и в `grant-access-for-order`. Хелперы `applyCrmStageOnTerminal` и `crm_routing_snapshot` существуют `_shared/crm-routing.ts`, `_shared/create-payment-checkout.ts`) и применяются только в bePaid-ветке. Это корень F3.

- В `stripe-webhook` уже есть запись в `meta.stripe.customers[...]`, но **нет sticky записи** `meta.stripe.checkout_session_id` / `payment_intent_id` / `charge_id` на `orders_v2`. Это корень F4.

## Изменения (узко, без расширения scope)

### 1. F1/F2 — business_stream до Stripe и обратно в наши таблицы

**Данные (приоритет 1, минимально):**

- Проставить `tariff_offers.meta.business_stream = 'consultations'` для всех активных pay_now offer'ов продукта `9d0d6de8-…` (5 шт).

- Проставить `products_v2.meta.business_stream = 'consultations'` для продукта «Платная консультация» как fallback.

- Оба апдейта — отдельной insert-операцией с предварительным dry-run выводом и записью в `audit_logs` `action='business_stream_seed_consultations'`).

**Код (никакого изменения резолвера — он уже правильный):**

- В `stripe-webhook` при ingest `checkout.session.completed` / `payment_intent.succeeded` обогащать `orders_v2.meta.business_stream` значением из `session.metadata.business_stream` (если уже не задано) и `payments_v2.meta.business_stream` тем же значением.

- Никаких изменений `stripe-create-checkout` (он уже корректно передаёт `bs` в адаптер → metadata).

### 2. F3 — CRM routing в Stripe-ветке

- В `stripe-create-checkout` материализовать `orderMeta.crm_routing_snapshot` через существующий `resolveOfferRoutingWithFallback` + `buildNegativeSnapshot/auditNegativeSnapshot` — точно так же, как `create-payment-checkout.ts` для bePaid. UPDATE `orders_v2.meta` идёт ДО возврата redirect_url.

- В `stripe-webhook` после `payment_intent.succeeded` / `checkout.session.completed` (terminal-успех) вызывать существующий `applyCrmStageOnTerminal(order_id, 'success')` (по аналогии с bePaid). Для `payment_intent.payment_failed` — `'failed'`. Никаких новых функций.

- Anti-orphan гарантия: routing работает поверх существующего `orders_v2` row, deal/contact entities не создаются отдельно (deal-as-order модель, что и в bePaid).

### 3. F4 — sticky Stripe meta на order

- В `stripe-webhook` на каждом обработанном событии merge'ить в `orders_v2.meta.stripe`:

  - `checkout_session_id` (из `cs_*`),

  - `payment_intent_id` (из `pi_*`),

  - `charge_id` (из `ch_*` когда доступен),

  - `customer_id` (из `cus_*`),

  - `account_code`,

  - `business_stream`.

- Merge безопасный: только set-if-absent для immutable полей, last-write-wins для `charge_idcustomer_id`.

### 4. Backfill ORD-26-00149

Двухшагово, audit обязателен.

**Dry-run (read-only SELECT, вывод в чат):**

- Какие поля будут дописаны в `orders_v2.meta` / `payments_v2.meta` `business_stream`, `pipeline_id`, `pipeline_stage_id`, `meta.stripe.checkout_session_id`, `meta.stripe.payment_intent_id`).

- Откуда берутся значения (offer.meta после seed, provider_events payload, существующий `payments_v2.provider_payment_id`).

- Почему безопасно (заказ paid, terminal, single fixture, нет конкурирующих процессов).

**Execute (после явного «да»):**

- UPDATE `orders_v2` ORD-26-00149: `meta.business_stream`, `pipeline_id`, `pipeline_stage_id`, `meta.stripe.*`, `meta.crm_routing_snapshot`.

- UPDATE `payments_v2` row: `meta.business_stream`, `meta.stripe.*` если применимо.

- Один audit: `action='prr_fix_02_backfill_ord_26_00149'` с diff'ом полей.

### 5. Повторный реальный Stripe test-checkout

- Только тариф «Срочная консультация — 800» по продукту «Платная консультация», от super_admin `ceo@ajoure.by`).

- Через `stripe-create-checkout` (не sandbox), реальная карта `4242 4242 4242 4242` в Hosted Page.

- Запрещены: `stripe-admin-sandbox-checkout`, `manual-sandbox-order`, любые `*_sim_*`, синтетические `provider_events`.

### 6. Evidence + PRR v2

- `.lovable/proofs/prr_fix_02_business_stream_crm_routing_sticky_meta.md`:

  - реальные `cs_test_*`, `pi_*`, `evt_*`, `customer_id`, `order_id`, `payment_id`, `entitlement_id`;

  - 6-node metadata trace (Session → PI → events → payments_v2 → orders_v2 → entitlement) с 7 полями;

  - 5-node CRM route (Contact → Deal=Order → Stage → Payment → Entitlement) с проверкой `pipeline_id` и `pipeline_stage_id` против `tariff_offers.meta.crm_routing`;

  - 6 anti-orphan SQL checks;

  - sticky meta dump из `orders_v2.meta.stripe`;

  - bePaid-frozen check.

- Обновить `.lovable/proofs/mp_a2_pilot_readiness_review_v2.md` до 13/13.

## STOP-GATE (без изменений к ранее зафиксированному)

- Запрещено: `sandbox-simulate`, `manual-sandbox-order`, `simulate_order_id`, `pi_sim_*`, `cs_sim_*`, любые искусственные `provider_events`.

- Green-light на Stage C только при одновременном: F-PRR-09=PASS И F-PRR-11=PASS И PRR v2 = 13/13. Любое 12/13 и ниже → новый mini-plan, Stage C не запускается.

## Out of scope (freeze)

- bePaid код и таблицы — не трогать.

- Subscriptions (v2, provider_subscriptions, schedule, recurring metadata) — не трогать.

- Provider migration — не запускать.

- Live mode — не включать.

- Изменения резолвера `business_stream` — не нужны, источник истины уже offer.meta → product.meta.

- Маппинг по `product_id` (приоритет 3 в плане пользователя) — НЕ добавляем как код-fallback: вместо этого делаем data-seed на offer.meta (единственный SOT по канону `business_stream_classification_v1.md`). Если в будущем потребуется product-mapping таблица — отдельный mini-plan.

## DoD

- F-PRR-09 = PASS (все 6 узлов содержат `business_stream='consultations'` + 6 обязательных полей).

- F-PRR-11 = PASS `orders_v2.pipeline_idpipeline_stage_id` совпадают с `tariff_offers.meta.crm_routing`).

- `orders_v2.meta.stripe.{checkout_session_id, payment_intent_id, customer_id, account_code, business_stream}` заполнены для нового заказа и backfilled для ORD-26-00149.

- Все 6 anti-orphan checks = 0.

- bePaid таблицы без новых записей за окно теста.

- PRR v2 = 13/13.

- Evidence-файл + обновлённый PRR v2 закоммичены.

## Файлы

Edit:

- `supabase/functions/stripe-create-checkout/index.ts` — materialize `crm_routing_snapshot` в `orders_v2.meta`.

- `supabase/functions/stripe-webhook/index.ts` — sticky `meta.stripe.*`, `meta.business_stream`, вызов `applyCrmStageOnTerminal`.

Data (через insert tool, с dry-run):

- `tariff_offers.meta.business_stream` для 5 offer'ов продукта `9d0d6de8-…`.

- `products_v2.meta.business_stream` для `9d0d6de8-…`.

- Backfill ORD-26-00149.

Create:

- `.lovable/proofs/prr_fix_02_business_stream_crm_routing_sticky_meta.md`.

Update:

- `.lovable/proofs/mp_a2_pilot_readiness_review_v2.md`.

- `.lovable/plan.md` (фиксация PRR-FIX-02 как in-progress → done).

&nbsp;

&nbsp;

План: PRR-FIX-02 — закрытие F-PRR-09 и F-PRR-11

## Цель

Закрыть F1–F4 из `mp_a2_prr_fix_01_runtime_evidence_v1.md` и получить PRR v2 = 13/13 PASS. Только Stripe one-time path. bePaid, subscriptions, schedule, provider-migration и live mode заморожены.

## Discovery (что уже подтверждено в коде/БД)

- `stripe-create-checkout` уже зовёт `resolveBusinessStream({ offer.meta, product.meta, link })`. Для оффера `25880f13-…` и продукта `9d0d6de8-…` `**meta.business_stream` пустой в обоих источниках** → резолвер легитимно даёт `unspecified`. Это корень F1/F2 на стороне данных.
- `tariff_offers.meta.crm_routing` у оффера заполнен корректно (`pipeline_id=a0000001-…-013`, `stage_on_success=b0000001-…-003`).
- `crm_routing` **не упоминается** в `stripe-webhook` и в `grant-access-for-order`. Хелперы `applyCrmStageOnTerminal` и `crm_routing_snapshot` существуют (`_shared/crm-routing.ts`, `_shared/create-payment-checkout.ts`) и применяются только в bePaid-ветке. Это корень F3.
- В `stripe-webhook` уже есть запись в `meta.stripe.customers[...]`, но **нет sticky записи** `meta.stripe.checkout_session_id` / `payment_intent_id` / `charge_id` на `orders_v2`. Это корень F4.

## Изменения (узко, без расширения scope)

### 1. F1/F2 — business_stream до Stripe и обратно в наши таблицы

**Данные (приоритет 1, минимально):**

- Проставить `tariff_offers.meta.business_stream = 'consultations'` для всех активных pay_now offer'ов продукта `9d0d6de8-…` (5 шт).
- Проставить `products_v2.meta.business_stream = 'consultations'` для продукта «Платная консультация» как fallback.
- Оба апдейта — отдельной insert-операцией с предварительным dry-run выводом и записью в `audit_logs` (`action='business_stream_seed_consultations'`).

**Код (никакого изменения резолвера — он уже правильный):**

- В `stripe-webhook` при ingest `checkout.session.completed` / `payment_intent.succeeded` обогащать `orders_v2.meta.business_stream` значением из `session.metadata.business_stream` (если уже не задано) и `payments_v2.meta.business_stream` тем же значением.
- Никаких изменений `stripe-create-checkout` (он уже корректно передаёт `bs` в адаптер → metadata).

### 2. F3 — CRM routing в Stripe-ветке

- В `stripe-create-checkout` материализовать `orderMeta.crm_routing_snapshot` через существующий `resolveOfferRoutingWithFallback` + `buildNegativeSnapshot/auditNegativeSnapshot` — точно так же, как `create-payment-checkout.ts` для bePaid. UPDATE `orders_v2.meta` идёт ДО возврата redirect_url.
- В `stripe-webhook` после `payment_intent.succeeded` / `checkout.session.completed` (terminal-успех) вызывать существующий `applyCrmStageOnTerminal(order_id, 'success')` (по аналогии с bePaid). Для `payment_intent.payment_failed` — `'failed'`. Никаких новых функций.
- Anti-orphan гарантия: routing работает поверх существующего `orders_v2` row, deal/contact entities не создаются отдельно (deal-as-order модель, что и в bePaid).

### 3. F4 — sticky Stripe meta на order

- В `stripe-webhook` на каждом обработанном событии merge'ить в `orders_v2.meta.stripe`:
  - `checkout_session_id` (из `cs_*`),
  - `payment_intent_id` (из `pi_*`),
  - `charge_id` (из `ch_*` когда доступен),
  - `customer_id` (из `cus_*`),
  - `account_code`,
  - `business_stream`.
- Merge безопасный: только set-if-absent для immutable полей, last-write-wins для `charge_id`/`customer_id`.

### 4. Backfill ORD-26-00149

Двухшагово, audit обязателен.

**Dry-run (read-only SELECT, вывод в чат):**

- Какие поля будут дописаны в `orders_v2.meta` / `payments_v2.meta` (`business_stream`, `pipeline_id`, `pipeline_stage_id`, `meta.stripe.checkout_session_id`, `meta.stripe.payment_intent_id`).
- Откуда берутся значения (offer.meta после seed, provider_events payload, существующий `payments_v2.provider_payment_id`).
- Почему безопасно (заказ paid, terminal, single fixture, нет конкурирующих процессов).

**Execute (после явного «да»):**

- UPDATE `orders_v2` ORD-26-00149: `meta.business_stream`, `pipeline_id`, `pipeline_stage_id`, `meta.stripe.*`, `meta.crm_routing_snapshot`.
- UPDATE `payments_v2` row: `meta.business_stream`, `meta.stripe.*` если применимо.
- Один audit: `action='prr_fix_02_backfill_ord_26_00149'` с diff'ом полей.

### 5. Повторный реальный Stripe test-checkout

- Только тариф «Срочная консультация — 800» по продукту «Платная консультация», от super_admin (`ceo@ajoure.by`).
- Через `stripe-create-checkout` (не sandbox), реальная карта `4242 4242 4242 4242` в Hosted Page.
- Запрещены: `stripe-admin-sandbox-checkout`, `manual-sandbox-order`, любые `*_sim_*`, синтетические `provider_events`.

### 6. Evidence + PRR v2

- `.lovable/proofs/prr_fix_02_business_stream_crm_routing_sticky_meta.md`:
  - реальные `cs_test_*`, `pi_*`, `evt_*`, `customer_id`, `order_id`, `payment_id`, `entitlement_id`;
  - 6-node metadata trace (Session → PI → events → payments_v2 → orders_v2 → entitlement) с 7 полями;
  - 5-node CRM route (Contact → Deal=Order → Stage → Payment → Entitlement) с проверкой `pipeline_id` и `pipeline_stage_id` против `tariff_offers.meta.crm_routing`;
  - 6 anti-orphan SQL checks;
  - sticky meta dump из `orders_v2.meta.stripe`;
  - bePaid-frozen check.
- Обновить `.lovable/proofs/mp_a2_pilot_readiness_review_v2.md` до 13/13.

## STOP-GATE (без изменений к ранее зафиксированному)

- Запрещено: `sandbox-simulate`, `manual-sandbox-order`, `simulate_order_id`, `pi_sim_*`, `cs_sim_*`, любые искусственные `provider_events`.
- Green-light на Stage C только при одновременном: F-PRR-09=PASS И F-PRR-11=PASS И PRR v2 = 13/13. Любое 12/13 и ниже → новый mini-plan, Stage C не запускается.

## Out of scope (freeze)

- bePaid код и таблицы — не трогать.
- Subscriptions (v2, provider_subscriptions, schedule, recurring metadata) — не трогать.
- Provider migration — не запускать.
- Live mode — не включать.
- Изменения резолвера `business_stream` — не нужны, источник истины уже offer.meta → product.meta.
- Маппинг по `product_id` (приоритет 3 в плане пользователя) — НЕ добавляем как код-fallback: вместо этого делаем data-seed на offer.meta (единственный SOT по канону `business_stream_classification_v1.md`). Если в будущем потребуется product-mapping таблица — отдельный mini-plan.

## DoD

- F-PRR-09 = PASS (все 6 узлов содержат `business_stream='consultations'` + 6 обязательных полей).
- F-PRR-11 = PASS (`orders_v2.pipeline_id`/`pipeline_stage_id` совпадают с `tariff_offers.meta.crm_routing`).
- `orders_v2.meta.stripe.{checkout_session_id, payment_intent_id, customer_id, account_code, business_stream}` заполнены для нового заказа и backfilled для ORD-26-00149.
- Все 6 anti-orphan checks = 0.
- bePaid таблицы без новых записей за окно теста.
- PRR v2 = 13/13.
- Evidence-файл + обновлённый PRR v2 закоммичены.

## Файлы

Edit:

- `supabase/functions/stripe-create-checkout/index.ts` — materialize `crm_routing_snapshot` в `orders_v2.meta`.
- `supabase/functions/stripe-webhook/index.ts` — sticky `meta.stripe.*`, `meta.business_stream`, вызов `applyCrmStageOnTerminal`.

Data (через insert tool, с dry-run):

- `tariff_offers.meta.business_stream` для 5 offer'ов продукта `9d0d6de8-…`.
- `products_v2.meta.business_stream` для `9d0d6de8-…`.
- Backfill ORD-26-00149.

Create:

- `.lovable/proofs/prr_fix_02_business_stream_crm_routing_sticky_meta.md`.

Update:

- `.lovable/proofs/mp_a2_pilot_readiness_review_v2.md`.
- `.lovable/plan.md` (фиксация PRR-FIX-02 как in-progress → done).