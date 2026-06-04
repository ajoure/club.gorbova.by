# План: Phase 3.1.1 — Price Mapping Validation STOP-GATE

## Цель
Зафиксировать единственный канонический способ связи Stripe `Price` ↔ `tariff_offer` до старта Stripe Subscription MVP. Только read-only discovery + конфигурация данных пилотного тарифа. Никакого checkout, миграций, webhook, bePaid-изменений, новых таблиц.

## Порядок: Diagnose → Plan → Dry run → Execute (read-only) → Verify

### Шаг 1. Discovery SOT (read-only)
1.1 Grep по коду на все упоминания `stripe.price_id`, `price_id`, `stripe_price`, `provider_product_mappings`, `bepaid_product_mappings`, `tariff_offers.meta.stripe`, legacy `tariff_prices`, hidden admin settings.
1.2 Сверка с `acquiring_connections`, `provider_subscriptions.meta`, `tariff_offers.meta`, `products_v2.meta`.
1.3 Зафиксировать единственный SOT-канон:
- `tariff_offers.meta.stripe.product_id` = `prod_*`
- `tariff_offers.meta.stripe.price_id` = `price_*`
- `tariff_offers.meta.stripe.price_id_history[]` (audit)
- альтернативные источники — явно отвергнуты (с цитатами из кода).

DoD: ровно один SOT.

### Шаг 2. Pilot tariff_offer выбор
2.1 SQL (read-only) на `tariff_offers` + `tariffs` + `products_v2`: найти кандидатов с `meta.recurring.is_recurring=true`, channel = `pay_now`, активный оффер.
2.2 Зафиксировать пилот: `tariff_offer_id`, `product_id`, `tariff_id`, `currency`, `amount`.
2.3 Проверить полноту `meta.recurring`: `is_recurring`, `interval`, `interval_count`. Если отсутствует — пометить как pre-requisite gap (без правок в этом шаге).

DoD: recurring-конфигурация пилота описана.

### Шаг 3. Stripe Dashboard Inventory (test mode)
3.1 Через `STRIPE_SECRET_KEY` (test) read-only вызовы: `products.retrieve`, `prices.retrieve`/`prices.list`.
3.2 Зафиксировать: `prod_*`, `price_*`, `currency`, `unit_amount`, `recurring.interval`, `recurring.interval_count`, `active`, `livemode=false`.
3.3 Если Price отсутствует — отдельной задачей (вне этого STOP-GATE) создать в Stripe Dashboard вручную и повторить retrieve.

DoD: реальный пилотный `price_*` найден.

### Шаг 4. Validation Matrix
Таблица сверки `tariff_offer` ↔ Stripe Price:
| Field | tariff_offer | Stripe Price | Match |
|---|---|---|---|
| currency | offer.currency | price.currency | ✅/❌ |
| amount | offer.amount*100 | price.unit_amount | ✅/❌ |
| interval | meta.recurring.interval | price.recurring.interval | ✅/❌ |
| interval_count | meta.recurring.interval_count | price.recurring.interval_count | ✅/❌ |
| active | (n/a) | price.active=true | ✅/❌ |
| account_code | acquiring_connections | webhook secret resolve | ✅/❌ |

### Шаг 5. Validation Contract (документ, без кода)
Спецификация runtime-резолвера для будущего MVP:
- любой mismatch → HTTP 422, `code=price_mismatch`, `manual_review`, checkout НЕ создаётся;
- inactive price → HTTP 422, `code=price_inactive`;
- отсутствие `meta.stripe.price_id` → HTTP 422, `code=price_not_mapped`;
- audit запись обязательна.

### Шаг 6. Price Rotation Strategy (документ)
- Разрешено: писать новый `meta.stripe.price_id`, push старого в `meta.stripe.price_id_history[]` со snapshot (`old_price_id`, `rotated_at`, `actor`, `reason`).
- Запрещено: изменять существующий Stripe Price (immutable per Stripe); держать несколько активных Price для одного оффера в одном аккаунте.
- Supersede при смене цены: archive старого Price в Stripe → create new Price → swap pointer в SOT.

### Шаг 7. Multi-account Readiness (только дизайн)
Future-ready схема:
```
meta.stripe.accounts = {
  "stripe_poland": { "product_id": "prod_*", "price_id": "price_*", "price_id_history": [] }
}
```
MVP читает `meta.stripe.accounts['stripe_poland']` с фолбэком на плоский `meta.stripe.{product_id,price_id}` (single-account legacy). Никакой реализации/миграции в этом шаге.

### Шаг 8. Runtime Validation Proof
Read-only вызовы Stripe test API:
- `stripe.products.retrieve(prod_*)`
- `stripe.prices.retrieve(price_*)`
Сохранить JSON snapshot (отредактированный) и приложить к proof. Никакого checkout/subscription create.

### Шаг 9. Артефакт
Создать `.lovable/proofs/stripe_phase_3_1_1_price_mapping_v1.md` с разделами:
1. SOT решение (Шаг 1)
2. Pilot tariff_offer (Шаг 2)
3. Stripe Inventory (Шаг 3)
4. Validation Matrix (Шаг 4)
5. Validation Contract (Шаг 5)
6. Price Rotation Strategy (Шаг 6)
7. Multi-account future schema (Шаг 7)
8. Runtime proof JSON (Шаг 8)
9. PASS/FAIL итог + STOP-GATE статус

Обновить `.lovable/plan.md`: Phase 3.1.1 статус по итогу (PASS → unblock Phase 3.1 MVP, FAIL → перечень gap-задач).

## Что НЕ делаем
- Никаких `CREATE`/`ALTER` миграций.
- Никаких новых edge functions, RPC, таблиц, колонок.
- Никаких изменений в `stripe-create-checkout`, `stripe-webhook`, `subscription-conflict`, bePaid, frontend.
- Никаких новых secrets/connectors.
- Никакого Stripe Subscription/Checkout create.

## DoD STOP-GATE
- Единственный SOT для Stripe Price утверждён и зафиксирован цитатами из кода.
- Пилотный recurring `price_*` найден, retrieve успешен, `livemode=false`, `active=true`.
- Validation Matrix заполнена, все строки = ✅ (иначе FAIL и список fix-задач).
- Validation Contract и Price Rotation Strategy задокументированы.
- Multi-account future-схема описана (без реализации).
- bePaid не затронут (grep-доказательство).
- Proof-файл создан, `.lovable/plan.md` обновлён.

## После PASS
Разблокируется Phase 3.1 — Infinite Subscription MVP (Execution).

## После FAIL
Перечень gap-задач (например: «добавить `meta.recurring.interval` в пилотный оффер», «создать Stripe Price в Dashboard», «выбрать другой пилот»). Каждая — отдельный mini-plan. MVP остаётся заблокированным.
