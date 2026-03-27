# да, согласен, с учетом правок:

&nbsp;

1. Оставить существующий единственный файл как ты указал, но явно добавить в плане, что это PATCH-READ-ONLY (без write в БД) и что link_conflict/meta_order_id/sv2_order_id — это только поля ответа, не запись в таблицы.
2. Уточнить формулу is_linked_full (если она вычисляется в list function):  
is_linked_full = !!(linkedUserId && linkedSubId && linkedOrderId) — и linkedOrderId после фикса считается по новому SoT (sv2→order) + fallback meta. Это нужно, чтобы было понятно, что фиксим именно зелёный бейдж.
3. Добавить STOP-guard на неполные данные v2 order map:  
Если sv2OrderId есть, но orders_v2 по нему не найден (удалён/неконсистентен) — не падать, считать как chain_only_unresolved++ и оставлять linkedOrderId=null (то есть «Не связана»). Добавить в stats chain_only_unresolved.
4. Stats: определить “до/после” без ручного сравнения:  

  - В одном запуске считать оба варианта:  

    - linked_before = по старой логике (только metaOrderId)
    - linked_after = по новой логике (sv2 first + meta fallback)
  - &nbsp;
  - И вывести recovered = linked_after - linked_before + chain_only (по определению).  
  Это даст DoD без необходимости “снимать” прошлые цифры вручную.
5. &nbsp;
6. DoD уточнить:  

  - PASS если recovered ≈ chain_only - chain_only_unresolved и link_conflicts зафиксирован (0 или >0 с sample в ответе/логах).
  - UI-proof оставить как есть (2 примера).
7. &nbsp;

&nbsp;

&nbsp;

После этих правок план готов к выполнению.

&nbsp;

План: Исправить linkedOrderId — добавить путь через sv2.order_id

## Проблема

`linkedOrderId` вычисляется только через meta-поля (`orders_v2.meta->>'bepaid_subscription_id'`, `payments_v2.meta->>'bepaid_subscription_id'`). Реальная цепочка `provider_subscriptions.subscription_v2_id → subscriptions_v2.order_id → orders_v2` **не используется**. Результат: ~91 подписка с полной связкой в БД показывается как «Не связана».

## Ограничения патча

- **Add-only правка чтения.** Никакого data-backfill `orders_v2.meta.bepaid_subscription_id`.
- Никаких изменений UI-компонентов, бейджей, схемы БД.
- Единственный файл: `supabase/functions/bepaid-list-subscriptions/index.ts`.

---

## Изменения

### 1. Добавить `order_id` в select subscriptions_v2 (строка 336)

```typescript
.select('id, next_charge_at, access_end_at, product_id, tariff_id, order_id')
```

Сохранять `order_id` в `subV2DetailsMap`.

### 2. Bulk-загрузка orders по sv2.order_id

После построения `subV2DetailsMap` — собрать все `order_id` из v2-деталей (которые НЕ уже покрыты `bepaidIdToOrder`). Один запрос:

```typescript
const v2OrderIds = [...new Set(
  [...subV2DetailsMap.values()].map(d => d.order_id).filter(Boolean)
)];
// orders_v2.select('id, order_number').in('id', v2OrderIds)
```

Построить `v2OrderIdMap: Map<string, { order_id: string, order_number: string }>`.

### 3. Новый SoT для linkedOrderId (строка 685)

Заменить текущее:

```typescript
const linkedOrderId = linkedOrder?.order_id || linkedPaymentDirect?.order_id || null;
```

На приоритетную цепочку:

```typescript
// Priority 1: sv2.order_id (direct chain)
const sv2OrderId = linkedSubId ? subV2DetailsMap.get(linkedSubId)?.order_id : undefined;
const linkedOrderFromV2 = sv2OrderId ? v2OrderIdMap.get(sv2OrderId) : undefined;

// Priority 2: orders_v2.meta->>'bepaid_subscription_id'
// Priority 3: payments_v2.meta->>'bepaid_subscription_id'
const metaOrderId = linkedOrder?.order_id || linkedPaymentDirect?.order_id || null;

const linkedOrderId = linkedOrderFromV2?.order_id || metaOrderId;
const linkedOrderNumber = linkedOrderFromV2?.order_number || linkedOrder?.order_number || linkedPaymentDirect?.order_number || null;
```

### 4. STOP-guard: конфликт sv2 vs meta

Если `linkedOrderFromV2` и `metaOrderId` оба найдены и **разные** → использовать sv2 (приоритет 1), но добавить в результат:

```typescript
link_conflict: true,
meta_order_id: metaOrderId,
sv2_order_id: sv2OrderId,
```

Счётчик конфликтов вывести в `stats.link_conflicts`. Без исключений/крашей.

### 5. Dry-run счётчики в stats (строка 731)

Добавить в `stats`:

```typescript
chain_only: <count>,   // sv2.order_id есть, meta нет
meta_only: <count>,    // meta есть, sv2.order_id нет
both: <count>,         // оба есть
link_conflicts: <count> // оба есть, но разные
```

---

## Не затрагивается

- UI-компоненты (уже используют `is_linked_full`)
- Data (никакого backfill `orders_v2.meta`)
- Другие edge functions
- Схема БД

## DoD

1. До фикса: `chain_only ≈ 91` (подписки с sv2.order_id, но без meta-маппинга)
2. После фикса: `linked` в stats увеличивается на ~91 (chain_only_recovered)
3. `meta_only` и `both` — не ухудшились (те же числа до/после)
4. `link_conflicts = 0` (ожидание) или зафиксированы в stats
5. UI-proof: Галай и Дурова показывают зелёный бейдж «Связана»