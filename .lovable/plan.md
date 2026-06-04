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

### Шаг 2. Сбор F-PRR-09 evidence (metadata trace)

Для одного и того же заказа собрать **5 узлов одновременно**:

| Узел | Источник | Обязательные поля |
|---|---|---|
| Stripe Checkout Session | Stripe API GET `/v1/checkout/sessions/{cs_test_*}` | `metadata.{order_id, account_code, business_stream, user_id, contact_id, product_id, tariff_id, provider=stripe}` |
| Stripe PaymentIntent | Stripe API GET `/v1/payment_intents/{pi_test_*}` | то же metadata, наследованное |
| `provider_events` | `SELECT payload, account_code FROM provider_events WHERE provider='stripe' AND idempotency_key LIKE '%pi_test_*%'` | `payload.data.object.metadata.*`, `account_code` колонка |
| `payments_v2` | `SELECT id, order_id, meta FROM payments_v2 WHERE meta->>'stripe_payment_intent_id' = 'pi_test_*'` | top-level `meta.{order_id, account_code, business_stream, product_id, tariff_id}` |
| `orders_v2` | `SELECT id, user_id, product_id, tariff_id, offer_id, meta FROM orders_v2 WHERE id = '<order_id>'` | колонки + top-level `meta.{account_code, business_stream}` |

Cross-check: значения `order_id, account_code, business_stream, product_id, tariff_id` **идентичны во всех 5 узлах**. Если хотя бы одно поле отсутствует или различается — finding.

### Шаг 3. Сбор F-PRR-11 evidence (полный CRM маршрут)

Полный маршрут: `Checkout → Contact → Deal → CRM linkage → Order → Payment`.

| Узел | Запрос | Ожидание |
|---|---|---|
| Contact resolution | `SELECT id, email, meta FROM profiles WHERE id = '<user_id>'` (+ contacts via `contact_id` если применимо) | контакт существует ДО checkout, не создан синтетически |
| Order | `SELECT id, user_id, product_id, tariff_id, offer_id, status, meta FROM orders_v2 WHERE id = '<order_id>'` | `offer_id IS NOT NULL`, `user_id` совпадает с Contact, `status='paid'` после webhook |
| Payment | `SELECT id, order_id, status, provider FROM payments_v2 WHERE order_id = '<order_id>'` | `provider='stripe'`, `status='succeeded'` |
| Deal | `SELECT * FROM crm_activity_log WHERE meta->>'order_id' = '<order_id>'` + `SELECT * FROM deals/* canonical table */ WHERE order_id = '<order_id>'` | сделка создана, привязана к pipeline консультации |
| Pipeline linkage | сравнить `deal.pipeline_id` с `tariff_offers.meta.crm_routing.pipeline_id` для оффера консультации | совпадение 1:1 |

### Шаг 4. Anti-orphan проверки

После прогона выполнить SQL:

```sql
-- Orphan Contact: контакт без orders за период прогона
SELECT count(*) FROM profiles p
 WHERE p.id = '<test_user_id>'
   AND NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.user_id = p.id);
-- ожидание: 0

-- Orphan Deal: сделка без order_id или с несуществующим order_id
SELECT d.id FROM /* deals */ d
 WHERE d.created_at > '<run_start>'
   AND (d.order_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.id = d.order_id));
-- ожидание: 0 строк за окно прогона

-- Orphan Order: заказ без payment / без deal
SELECT o.id
  FROM orders_v2 o
 WHERE o.id = '<order_id>'
   AND (NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id = o.id AND p.status='succeeded')
        OR NOT EXISTS (SELECT 1 FROM /* deals */ d WHERE d.order_id = o.id));
-- ожидание: 0 строк
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
- Тестовый `orders_v2` и `payments_v2` НЕ удалять (нужны для PRR v2 re-run). Пометить `meta.prr_fix_01_evidence = true`.
- Тестовая сделка в CRM — также оставить с пометкой в meta.

## Артефакты

- `.lovable/proofs/mp_a2_prr_fix_01_runtime_evidence_v1.md`
  - Section 1: Preconditions (продукт, оффер, connection).
  - Section 2: F-PRR-09 5-node metadata trace table (фактические значения).
  - Section 3: F-PRR-11 full route (Contact → Deal → Order → Payment) + pipeline linkage.
  - Section 4: Anti-orphan SQL + результаты.
  - Section 5: bePaid frozen re-verify.
  - Section 6: Findings (если есть) + предложенные mini-planы (без исполнения).
  - Итог: PASS/FAIL по F-PRR-09, PASS/FAIL по F-PRR-11.
- Обновить `.lovable/proofs/mp_a2_pilot_readiness_review_v1.md` (только Section 9 и Section 11 — статусы по результатам PRR-FIX-01). Остальные 11/13 не трогать.

## DoD PRR-FIX-01

1. Выполнен **один реальный test-mode Stripe Checkout** по продукту `consultation` через продакшен-флоу.
2. Собраны 5 узлов metadata trace (Section 2) с полным совпадением `order_id, account_code, business_stream, user_id, contact_id, product_id, tariff_id` во всех узлах.
3. Подтверждён полный CRM маршрут: Contact (pre-existing) → Order (offer_id IS NOT NULL) → Payment (succeeded) → Deal (pipeline linkage matches `tariff_offers.meta.crm_routing.pipeline_id`).
4. Anti-orphan SQL: 0 строк по каждой из трёх проверок.
5. bePaid frozen verifier exit=1, `payment_links.provider='bepaid'` count >= 106.
6. Никаких изменений вне `.lovable/proofs/` и (при необходимости) точечного top-level meta merge в `stripe-create-checkout` / `stripe-webhook` — каждое изменение задокументировано before/after.
7. Если возник баг, блокирующий evidence — зафиксирован finding с предложенным mini-plan, без молчаливого фикса.

## После закрытия PRR-FIX-01

Подрядчик повторно выпускает **Pilot Readiness Review v2**:
- Все 13 секций перепрогон (read-only, как v1).
- Ожидаемый результат: **13/13 PASS**.
- Только при 13/13 PASS — green-light на Stage C Runtime Pilot.
- При любом FAIL — новый точечный mini-plan, Stage C остаётся заблокирован.

Сейчас green-light на Stage C **не выдаётся**.
