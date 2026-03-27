# да, согласен, с учетом правок:

&nbsp;

1. **PATCH-1: “missingOrderIds” считать строго по тем же SoT-полям, что и итоговый linkedOrderId**
  &nbsp;
  - В предварительном проходе нельзя использовать “упрощённый” расчет, иначе mismatch будет расходиться с реальным .map().
  - Правка: вынести вычисление linkedOrderId/linkedSubId в общий helper (локальная функция внутри файла) и использовать **одинаково** в pre-pass и в .map().
  &nbsp;
2. **PATCH-1: Recovery по order_id только для строк, где linkedOrderId уже финальный (после конфликт-решения sv2 vs meta)**
  &nbsp;
  - Иначе можешь восстановить linkedSubId по “metaOrderId”, а затем финальный SoT переключит order на sv2 → появится новый mismatch.
  - Правка: pre-pass должен применять тот же conflict-resolution (sv2 приоритет), и в missingOrderIds включать только **итоговый** linkedOrderId.
  &nbsp;
3. **PATCH-1: DoD-P0 “deal_link_mismatch_after = 0” считать только для активного контура и только для строк, где linked_order_id != null**
  &nbsp;
  - Иначе метрика будет ломаться на “no order at all” и на canceled/expired.
  - Правка: явный фильтр в вычислении метрик: activeContour && linkedOrderId != null.
  &nbsp;
4. **PATCH-2: raw_data.transactions?.[0] — нельзя, если не гарантирован порядок**
  &nbsp;
  - Правка: если raw_data.transactions массив, брать **последнюю по времени**, только если есть поле created_at/paid_at/processed_at; иначе fallback только на last_transaction_uid/last_transaction.uid.
  - Если времени нет — не выбирать [0], ставить provider_raw_ambiguous=true и payment_id_source='none'.
  &nbsp;
5. **PATCH-2: payment_id_source должен отражать реальный приоритет**
  &nbsp;
  - Если payments_v2.order_id дал provider_payment_id → source=payments_v2.order_id
  - else если payments_v2.meta → payments_v2.meta
  - else если provider_raw → provider_raw
  - else none
  - И добавить provider_payment_id_raw (что именно взяли из raw) — **только в ответ**, без записи.
  &nbsp;
6. **PATCH-3: sv2_pm_no_order считать не из subV2DetailsMap, а из результата выборки sv2, который реально загружается**
  &nbsp;
  - Сейчас ты загружаешь sv2 по v2Ids и дополнительно по missingOrderIds. Метрика должна учитывать обе партии.
  - Правка: вести отдельный счетчик sv2_loaded_total и sv2_loaded_no_order прямо в момент построения subV2DetailsMap + при загрузке по missingOrderIds.
  &nbsp;

&nbsp;

&nbsp;

Если эти правки внести, план полностью корректен: read-only, без риска ложных привязок, и DoD метрики будут честно отражать устранение “Сделка есть / Связь красная” для active контура.

&nbsp;

План: 3 PATCHа — recovery linkedSubId, ID платежа, SQL-контроль

## Единственный файл: `supabase/functions/bepaid-list-subscriptions/index.ts`

**Режим: PATCH-READ-ONLY** — никаких записей в БД. `link_conflict`, `meta_order_id`, `sv2_order_id` — только поля ответа, не запись в таблицы.

---

## PATCH-1 (P0): Recovery `linkedSubId` через `order_id`

### Проблема

Строка 666: `linkedSubId = ourSub?.id || providerSub?.subscription_v2_id || null` — покрывает только sv2, уже привязанные через `provider_subscriptions`. Для ~194 ambiguous подписок `linkedSubId = null`, даже если `linkedOrderId` найден → `is_linked_full = false` → красный бейдж при наличии сделки.

### Решение

**Двухпроходная схема:**

1. **Первый проход** (после строки 394, перед `.map()`): вычислить `missingOrderIds` — пройтись по `allSubscriptions`, определить для каждой `linkedOrderId` (по текущей sv2+meta логике) и `linkedSubId`. Собрать `order_id` тех строк активного контура (`active/trial/past_due/pending/failed_attempt`), где `linkedOrderId != null` и `linkedSubId == null`.
2. **Отдельный bulk-запрос** (НЕ из `subV2DetailsMap`):

```typescript
subscriptions_v2.select('id, order_id, user_id').in('order_id', missingOrderIds)
```

Построить `orderIdToSv2: Map<order_id, sv2_id>` — **только если по данному `order_id` найден ровно 1 sv2** (STOP-guard: `>1` → ambiguous, не трогать, увеличить `ambiguous_order_to_sv2_count`).

3. **Применение в `.map()**` (строка 666): если `linkedSubId == null && linkedOrderId != null` → `linkedSubId = orderIdToSv2.get(linkedOrderId) || null`
4. **Ограничение**: recovery только для активного контура (не expired/canceled).

### Stats (обязательные, строка 798)

- `deal_link_mismatch_before` — строки где `linkedOrderId != null` но `linkedSubId == null` (до recovery)
- `sub_recovered_via_order` — сколько `linkedSubId` восстановлено
- `deal_link_mismatch_after` — остаток после recovery
- `ambiguous_order_to_sv2_count` — сколько пропущено из-за >1 sv2 на order_id

### Формула `is_linked_full`

```typescript
is_linked_full = !!(linkedUserId && linkedSubId && linkedOrderId)
```

Где `linkedOrderId` считается по SoT:

- Приоритет 1: `subscriptions_v2.order_id` через `provider_subscriptions.subscription_v2_id`
- Приоритет 2: `orders_v2.meta->>'bepaid_subscription_id'`
- Приоритет 3: `payments_v2.meta->>'bepaid_subscription_id'`

### STOP-guards

- `>1 sv2` на `order_id` → не восстанавливать, `ambiguous_order_to_sv2_count++`
- sv2OrderId есть, но order не найден → `chain_only_unresolved++`, `linkedOrderId=null`
- Конфликт sv2 vs meta (разные order_id) → sv2 побеждает, `link_conflict=true` в ответе

### DoD-P0

- `deal_link_mismatch_after = 0` для активного контура
- Платонова, Маргалик → зелёный бейдж
- `sub_recovered_via_order >= 1`

---

## PATCH-2 (P1): Fallback «ID платежа» из `raw_data`

Строка ~728: после текущего `linkedProviderPaymentId` добавить safe-extract:

```typescript
const rawData = providerSub?.raw_data as any;
const providerLastTxn = rawData?.transactions?.[0]?.uid 
  || rawData?.last_transaction_uid 
  || rawData?.last_transaction?.uid 
  || null;
const finalProviderPaymentId = linkedProviderPaymentId || providerLastTxn;
```

Добавить `payment_id_source` в ответ (read-only):

- `'payments_v2.order_id'` | `'payments_v2.meta'` | `'provider_raw'` | `'none'`

**STOP-guard**: fallback из `raw_data` **не влияет** на `is_linked_full`.

---

## PATCH-3 (P1): SQL-контроль «остатка дыр» в stats

Добавить в stats (из уже загруженных данных):

- `ps_active_no_sv2` — `provider_subscriptions` с активным state и `subscription_v2_id IS NULL`
- `sv2_pm_no_order` — из `subV2DetailsMap` записи с `order_id == null`
- `sv2_order_not_in_map` — алиас `chain_only_unresolved`

---

## Технические детали реализации

### Порядок вычисления (двухпроходный)

1. После строки 394 — **предварительный проход** по `allSubscriptions` для сбора `missingOrderIds` (нужен тот же код вычисления `linkedOrderId`/`linkedSubId`, но без построения результата)
2. Bulk-запрос `subscriptions_v2` по `missingOrderIds`
3. Построение `orderIdToSv2` (1:1 only)
4. Основной `.map()` (строка 652) — с использованием `orderIdToSv2` как fallback для `linkedSubId`

### Полный список stats

```typescript
stats: {
  // existing
  total, active, trial, pending, canceled, not_linked, linked,
  chain_only, meta_only, both, link_conflicts, chain_only_unresolved,
  linked_before, linked_after, recovered,
  // PATCH-1 new
  deal_link_mismatch_before,
  sub_recovered_via_order,
  deal_link_mismatch_after,
  ambiguous_order_to_sv2_count,
  // PATCH-3 new
  ps_active_no_sv2,
  sv2_pm_no_order,
}
```

## Не затрагивается

- UI-компоненты, бейджи, фильтры
- Другие edge functions
- Схема БД, данные (никакого backfill)