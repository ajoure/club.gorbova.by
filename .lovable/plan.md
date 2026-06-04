План: PRR-FIX-01 — Runtime Consultation Pilot Evidence

## Контекст

Pilot Readiness Review v1 завершён со счётом **11/13 PASS**. FAIL:
- **F-PRR-09** (E2E metadata trace) — нет реального Stripe Checkout по продукту «Платная консультация»; отсутствуют узлы Checkout Session → PaymentIntent → provider_events → payments_v2 → orders_v2 с полной metadata.
- **F-PRR-11** (CRM routing) — sandbox-заказы не триггерили deal/pipeline-binding; offer_id отсутствует.

Master Sprint статус (зафиксировано):

| Фаза | Статус |
|---|---|
| Phase 0 Discovery | Выполнено |
| Phase 1 Provider Abstraction | Выполнено |
| Phase 2 Stripe Sandbox | Частично выполнено (11/13 PRR) |
| Phase 3 Subscriptions | Discovery выполнен, implementation НЕ начат |
| Phase 4–10 | Не начаты |

## Цель PRR-FIX-01

Выполнить **один реальный test-mode Stripe Checkout по продукту «Платная консультация»** и собрать недостающие доказательства одновременно по F-PRR-09 и F-PRR-11. Один общий mini-plan, один прогон, один артефакт.

## Жёсткие STOP-GATE'ы (запрещено до закрытия PRR-FIX-01)

- Stage C Runtime Pilot (объявление продукта «живым» для реальных клиентов).
- Stripe Subscriptions (mode=subscription, любые `sub_*`).
- Subscription Schedule.
- Provider migration execute (любые ALTER provider на действующих ссылках/заказах).
- Расширения `subscription-actions`.
- Расширения reconcile jobs.
- Любые работы из Фазы 3 кроме discovery (уже выполнен).

## Жёсткие ограничения исполнения

- Test mode only. `acquiring_connections.test_mode=true` обязателен.
- bePaid не трогать (denylist verifier exit=1).
- Никаких новых миграций, RPC, RLS, secrets, изменений config.toml.
- Никаких изменений resolver/adapter/webhook кода. Если по ходу прогона выявлен баг, который блокирует prove — НЕ фиксить молча. Зафиксировать finding и предложить отдельный mini-plan.
- Допускаются точечные edits в `supabase/functions/stripe-create-checkout/index.ts` и `stripe-webhook/index.ts` ТОЛЬКО для добавления `account_code`/`business_stream` в top-level `orders_v2.meta` / `payments_v2.meta` (если выяснится, что они лежат только в nested `metadata`). Любое изменение — с before/after snippet в proof.

## STOP-GATE: запрет искусственных артефактов

Для закрытия F-PRR-09 и F-PRR-11 **категорически запрещено** использовать любые синтетические/симулированные объекты:

- `stripe-admin-sandbox-checkout` (sandbox-simulate), `manual-sandbox-order`, любые admin-симуляторы.
- `simulate_order_id`, искусственные `order_id`, помеченные `meta.sandbox=true` или `meta.sandbox_source`.
- Идентификаторы вида `pi_sim_*`, `cs_sim_*`, `evt_sim_*`, `pi_fake_*` и любые non-Stripe-issued.
- Ручные INSERT в `provider_events`, `payments_v2`, `orders_v2` для имитации webhook.
- Любые «искусственные provider_events».

Принимаются **только реальные Stripe test-mode объекты**, выпущенные Stripe API: `cs_test_*`, `pi_*` (real), `evt_*` (real), `ch_*` (real). Любой синтетический артефакт в evidence = автоматический FAIL PRR-FIX-01 и возврат на доработку.

## Подготовка (read-only verify)

1. Подтвердить, что продукт «Платная консультация» (`products_v2.code = 'consultation'`) имеет:
   - активный pay_now `tariff_offer` с `meta.business_stream` и `meta.crm_routing.pipeline_id` (Канон mapping memory `product-pipeline-mapping-canon`).
   - привязку к `crm_pipelines` через `crm_pipeline_product_bindings` ИЛИ через `tariff_offers.meta.crm_routing`.
   - `document_scenarios` (для будущих документов, в пилоте достаточно отсутствия ошибки маршрутизации).
2. Подтвердить наличие активного `acquiring_connections` (`provider='stripe' AND status='active' AND test_mode=true AND is_default=true`).
3. Подтвердить, что Stripe webhook endpoint зарегистрирован в Stripe Dashboard test mode и `provider_events` получает события (последняя запись < 24h либо обновится в прогоне).

## Шаги прогона (один реальный платёж)

### Шаг 1. Реальный Stripe Checkout по консультации

- Через продакшен-флоу (UI кабинета или public payment link) инициировать оплату «Платной консультации» под тестовым пользователем (известные `user_id`, `contact_id`, `email`).
- Использовать тестовую карту Stripe `4242 4242 4242 4242`.
- Зафиксировать `cs_test_*` (Checkout Session id) и `pi_test_*` (PaymentIntent id) из ответа `stripe-create-checkout` и из Stripe Dashboard.

### Шаг 2. Сбор F-PRR-09 evidence (metadata trace, 6 узлов)

Для одного и того же заказа собрать **6 узлов одновременно** (главный DoD мастер-спринта):

| # | Узел | Источник | Обязательные поля |
|---|---|---|---|
| 1 | Stripe Checkout Session | Stripe API GET `/v1/checkout/sessions/{cs_test_*}` | `metadata.{order_id, account_code, business_stream, user_id, contact_id, product_id, tariff_id, provider=stripe}` |
| 2 | Stripe PaymentIntent | Stripe API GET `/v1/payment_intents/{pi_*}` | то же metadata, унаследованное |
| 3 | `provider_events` | `SELECT id, payload, account_code FROM provider_events WHERE provider='stripe' AND payload->'data'->'object'->>'id' = '<pi_*>'` | `payload.data.object.metadata.*`, `account_code` колонка, реальный `evt_*` в `event_id` |
| 4 | `payments_v2` | `SELECT id, order_id, meta FROM payments_v2 WHERE meta->>'stripe_payment_intent_id' = '<pi_*>'` | top-level `meta.{order_id, account_code, business_stream, product_id, tariff_id}` |
| 5 | `orders_v2` | `SELECT id, user_id, product_id, tariff_id, offer_id, meta FROM orders_v2 WHERE id = '<order_id>'` | колонки + top-level `meta.{account_code, business_stream}` |
| 6 | Access grant / entitlement | `SELECT id, user_id, product_id, tariff_id, expires_at, source, meta FROM entitlements WHERE meta->>'order_id' = '<order_id>'` + `SELECT * FROM access_rules WHERE meta->>'order_id' = '<order_id>'` + `SELECT * FROM access_grant_ledger WHERE order_id = '<order_id>'` | entitlement создан `grant-access-for-order`, `tariff_id` совпадает, ledger содержит запись о grant |

Cross-check: значения `order_id, account_code, business_stream, product_id, tariff_id, user_id` **идентичны во всех 6 узлах**. Если хотя бы одно поле отсутствует или различается — finding и FAIL.

### Шаг 3. Сбор F-PRR-11 evidence (полный access + CRM маршрут)

Полный обязательный маршрут (мастер-спринт требует CRM **и** access routing):

`Contact → Deal → Order → Payment → Entitlement`

| Узел | Запрос | Ожидание |
|---|---|---|
| Contact resolution | `SELECT id, email, meta FROM profiles WHERE id = '<user_id>'` (+ contacts via `contact_id` если применимо) | контакт существует ДО checkout, не создан синтетически в прогоне |
| Deal | `SELECT id, pipeline_id, stage_id, order_id, contact_id, meta, created_at FROM /* canonical deals table */ WHERE order_id = '<order_id>'` | сделка создана автоматически, `contact_id` совпадает с Contact, `pipeline_id` = `tariff_offers.meta.crm_routing.pipeline_id` |
| Order | `SELECT id, user_id, product_id, tariff_id, offer_id, status, meta FROM orders_v2 WHERE id = '<order_id>'` | `offer_id IS NOT NULL`, `user_id` совпадает с Contact, `status='paid'` после webhook |
| Payment | `SELECT id, order_id, status, provider, meta FROM payments_v2 WHERE order_id = '<order_id>'` | `provider='stripe'`, `status='succeeded'`, `meta.stripe_payment_intent_id` = реальный `pi_*` |
| Entitlement | `SELECT id, user_id, product_id, tariff_id, expires_at, source, meta FROM entitlements WHERE meta->>'order_id' = '<order_id>'` + `access_grant_ledger` запись | entitlement создан через `grant-access-for-order`, `user_id`/`product_id`/`tariff_id` совпадают со сделкой и заказом |

Cross-check: `contact_id, order_id, user_id, product_id, tariff_id` идентичны во всех 5 узлах маршрута. Pipeline linkage сравнить 1:1 с `tariff_offers.meta.crm_routing.pipeline_id`.

### Шаг 4. Anti-orphan проверки (расширенные)

После прогона выполнить SQL:

```sql
-- Orphan Contact: контакт без orders за период прогона
SELECT count(*) FROM profiles p
 WHERE p.id = '<test_user_id>'
   AND NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.user_id = p.id);
-- ожидание: 0

-- Orphan Deal: сделка без order_id, contact_id или с битой ссылкой
SELECT d.id FROM /* deals */ d
 WHERE d.created_at > '<run_start>'
   AND (d.order_id IS NULL
        OR d.contact_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.id = d.order_id)
        OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = d.contact_id));
-- ожидание: 0

-- Orphan Order: заказ без payment / без deal / без entitlement (для paid)
SELECT o.id
  FROM orders_v2 o
 WHERE o.id = '<order_id>'
   AND (NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id = o.id AND p.status='succeeded')
        OR NOT EXISTS (SELECT 1 FROM /* deals */ d WHERE d.order_id = o.id)
        OR NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.meta->>'order_id' = o.id::text));
-- ожидание: 0

-- Orphan Payment: succeeded payment без orders_v2
SELECT p.id FROM payments_v2 p
 WHERE p.created_at > '<run_start>'
   AND p.provider='stripe' AND p.status='succeeded'
   AND NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.id = p.order_id);
-- ожидание: 0

-- Orphan Entitlement: entitlement без paid orders_v2
SELECT e.id FROM entitlements e
 WHERE e.created_at > '<run_start>'
   AND e.meta->>'order_id' IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.id::text = e.meta->>'order_id' AND o.status='paid');
-- ожидание: 0

-- Orphan provider_event: stripe event без payments_v2/orders_v2 binding
SELECT pe.id FROM provider_events pe
 WHERE pe.provider='stripe'
   AND pe.created_at > '<run_start>'
   AND pe.payload->'data'->'object'->>'id' = '<pi_*>'
   AND NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.meta->>'stripe_payment_intent_id' = '<pi_*>');
-- ожидание: 0
```

Если orphan найден — finding с классификацией (precondition violation / runtime gap / data integrity).

### Шаг 5. bePaid frozen re-verify

```
rg -l "acquiring/index|stripe-adapter|stripe-customer-resolver|vault\.ts" \
   supabase/functions/bepaid-webhook \
   supabase/functions/_shared/create-payment-checkout.ts \
   supabase/functions/_shared/acquiring/bepaid-adapter.ts
# exit=1
```

```sql
SELECT count(*) FROM payment_links WHERE provider='bepaid'; -- без падения, число >= 106
```

### Шаг 6. Cleanup test artifacts

- Stripe test customer/PaymentMethod, созданные прогоном, оставить как evidence (test mode, без финансовых последствий).
- Тестовый `orders_v2`, `payments_v2`, `entitlements` НЕ удалять (нужны для PRR v2 re-run). Пометить `meta.prr_fix_01_evidence = true`.
- Тестовая сделка в CRM — также оставить с пометкой в meta.

## Артефакты

- `.lovable/proofs/mp_a2_prr_fix_01_runtime_evidence_v1.md`
  - Section 1: Preconditions (продукт, оффер, connection).
  - Section 2: F-PRR-09 **6-node** metadata trace table (фактические значения, не count'ы).
  - Section 3: F-PRR-11 полный маршрут Contact → Deal → Order → Payment → Entitlement + pipeline linkage.
  - Section 4: Anti-orphan SQL (6 проверок) + результаты.
  - Section 5: bePaid frozen re-verify.
  - Section 6: Findings (если есть) + предложенные mini-planы (без исполнения).
  - **Section 7 (обязательно): Сводная таблица реальных идентификаторов** — `contact_id`, `deal_id`, `order_id`, `payment_id`, `entitlement_id`, `cs_test_*`, `pi_*`, `evt_*`. Без неё proof не принимается. SQL `count=0` сам по себе не является доказательством — нужны конкретные значения.
  - Итог: PASS/FAIL по F-PRR-09, PASS/FAIL по F-PRR-11.
- Обновить `.lovable/proofs/mp_a2_pilot_readiness_review_v1.md` (только Section 9 и Section 11 — статусы по результатам PRR-FIX-01). Остальные 11/13 не трогать.

## DoD PRR-FIX-01

1. Выполнен **один реальный test-mode Stripe Checkout** по продукту `consultation` через продакшен-флоу. Никаких sandbox-simulate / manual-sandbox-order / synthetic IDs.
2. Собраны **6 узлов** metadata trace (Section 2) с полным совпадением `order_id, account_code, business_stream, user_id, contact_id, product_id, tariff_id` во всех узлах, включая узел entitlement/access grant.
3. Подтверждён полный маршрут: Contact (pre-existing) → Deal (pipeline linkage matches `tariff_offers.meta.crm_routing.pipeline_id`) → Order (offer_id IS NOT NULL, status=paid) → Payment (provider=stripe, status=succeeded) → Entitlement (создан grant-access-for-order).
4. Anti-orphan SQL: **0 строк** по каждой из 6 проверок (Contact, Deal, Order, Payment, Entitlement, provider_event).
5. В Section 7 приведены **реальные идентификаторы** всех сущностей (не только count=0).
6. bePaid frozen verifier exit=1, `payment_links.provider='bepaid'` count >= 106.
7. Никаких изменений вне `.lovable/proofs/` и (при необходимости) точечного top-level meta merge в `stripe-create-checkout` / `stripe-webhook` — каждое изменение задокументировано before/after.
8. Если возник баг, блокирующий evidence — зафиксирован finding с предложенным mini-plan, без молчаливого фикса.

## После закрытия PRR-FIX-01 — Pilot Readiness Review v2

Подрядчик выпускает **Pilot Readiness Review v2** — НЕ частичный пересмотр FAIL'ов, а **повторная оценка всех 13 пунктов** с нуля (read-only, как v1):

1. Account resolver
2. Customer resolver
3. Saved Payment Method
4. Customer Portal readiness
5. Hardcode audit
6. Phase 2 regression
7. bePaid frozen
8. Multi-account safety
9. E2E metadata trace (6 nodes)
10. No live keys
11. CRM routing (full Contact→Deal→Order→Payment→Entitlement)
12. Telegram skip rationale
13. Document routing skip rationale

### Green-light на Stage C Runtime Pilot — три обязательных условия одновременно

- **F-PRR-09 = PASS** (6-node metadata trace).
- **F-PRR-11 = PASS** (полный access + CRM маршрут).
- **Pilot Readiness Review v2 = 13/13 PASS**.

### Если результат 12/13 или ниже

- Green-light **не выдаётся**.
- Stage C Runtime Pilot **не запускается**.
- Открывается новый точечный mini-plan под конкретный FAIL.
- Цикл повторяется до 13/13 PASS.

Сейчас green-light на Stage C **не выдаётся**.
