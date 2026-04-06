

## План: PATCH-GRANT-ACCESS-IDEMPOTENCY-HARD-FIX

### Проблема

Повторный вызов `grant-access-for-order(orderId)` не дублирует entitlement, но **продлевает subscription** (`access_end_at`, `next_charge_at`, `extended_by_orders`). Функция небезопасна для повторных вызовов.

### Корневая причина

- **Entitlement** (L231): поиск по `user_id + product_code` → обновляет `expires_at` и `order_id` без проверки, что fulfillment уже выполнен этим order.
- **Subscription** (L311): поиск active sub по `user_id + product_id` → продлевает без проверки привязки к order.

### Решение

Одна вставка: **early idempotency guard** после L150 (`const userId = order.user_id`), до любых upsert-операций.

Логика:
1. Проверить `entitlements` где `order_id = orderId AND user_id = userId`
2. Проверить `subscriptions_v2` где `order_id = orderId AND user_id = userId`
3. Если **оба** найдены → `return { success: true, already_fulfilled: true }` — strict no-op
4. Записать в `audit_logs` действие `grant-access-for-order.skip_already_fulfilled` с мета: order_id, existing entitlement/subscription ids, статусы, даты

### Файл

`supabase/functions/grant-access-for-order/index.ts` — одна вставка ~50 строк после L150.

### DoD

1. Повторный вызов по 4 order_id (e5742761, 3ad48adb, a717d410, 727fe302) → `already_fulfilled: true`, ничего не меняется
2. Entitlement count = без изменений
3. Subscription count = без изменений
4. `access_end_at` = без изменений
5. Audit log содержит `skip_already_fulfilled`
6. Новые первичные вызовы работают штатно

### Тестирование после деплоя

Вызвать `curl_edge_functions` с одним из 4 fulfilled order_id → проверить ответ `already_fulfilled: true` → проверить БД что ничего не изменилось → проверить audit_log.

### STOP-guards

- Один файл, одна вставка
- Без изменения существующей fulfillment-логики
- Без миграций БД

