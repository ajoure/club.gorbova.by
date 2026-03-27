

# План: Исправить linkedOrderId — добавить путь через sv2.order_id

## Статус: ВЫПОЛНЕНО

## Проблема

`linkedOrderId` вычислялся только через meta-поля (`orders_v2.meta->>'bepaid_subscription_id'`, `payments_v2.meta->>'bepaid_subscription_id'`). Реальная цепочка `provider_subscriptions.subscription_v2_id → subscriptions_v2.order_id → orders_v2` **не использовалась**. Результат: ~91 подписка с полной связкой в БД показывалась как «Не связана».

## Ограничения патча (PATCH-READ-ONLY)

- **Add-only правка чтения.** Никакого data-backfill `orders_v2.meta.bepaid_subscription_id`.
- `link_conflict`, `meta_order_id`, `sv2_order_id` — только поля ответа, НЕ запись в таблицы.
- Никаких изменений UI-компонентов, бейджей, схемы БД.
- Единственный файл: `supabase/functions/bepaid-list-subscriptions/index.ts`.

## Выполненные изменения

### 1. `order_id` добавлен в select subscriptions_v2
### 2. Bulk-загрузка orders по sv2.order_id (v2OrderIdMap)
### 3. Новый SoT для linkedOrderId:
- Приоритет 1: `subscriptions_v2.order_id` (через `provider_subscriptions.subscription_v2_id`)
- Приоритет 2: `orders_v2.meta->>'bepaid_subscription_id'`
- Приоритет 3: `payments_v2.meta->>'bepaid_subscription_id'`

### 4. STOP-guards:
- Конфликт sv2 vs meta: если оба найдены и разные → sv2 побеждает, `link_conflict=true` в ответе
- sv2OrderId есть, но order не найден → `chain_only_unresolved++`, `linkedOrderId=null`

### 5. Stats: `chain_only`, `meta_only`, `both`, `link_conflicts`, `chain_only_unresolved`, `linked_before`, `linked_after`, `recovered`

### 6. `is_linked_full` = `!!(linkedUserId && linkedSubId && linkedOrderId)` — с новым SoT

## DoD

- PASS если `recovered ≈ chain_only - chain_only_unresolved` и `link_conflicts` зафиксирован
- UI-proof: Галай и Дурова показывают зелёный бейдж «Связана»
