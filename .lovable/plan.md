
## План: PATCH-GRANT-ACCESS-IDEMPOTENCY-HARD-FIX

---

### Проблема

Повторный вызов `grant-access-for-order(orderId)` не создаёт дубль entitlement, но **продлевает существующую subscription** (обновляет `access_end_at`, `next_charge_at`, добавляет order в `extended_by_orders`). Это делает функцию небезопасной для повторных вызовов.

### Корневая причина

Текущая логика:
- **Entitlement** (L231): ищет по `user_id + product_code` — если найден, обновляет `expires_at` и `order_id`. Нет проверки, что этот entitlement уже создан именно этим order.
- **Subscription** (L311): ищет active sub по `user_id + product_id` — если найдена, продлевает. Нет проверки, что sub уже создана этим order.

### Решение

Добавить **early idempotency guard** сразу после загрузки order (после L148), до любых upsert-операций:

1. Проверить: существует ли `entitlement` с `order_id = orderId` и `user_id = userId`
2. Проверить: существует ли `subscriptions_v2` с `order_id = orderId` и `user_id = userId`
3. Если **оба** найдены → возвращать `{ success: true, already_fulfilled: true }` и **не выполнять** никаких update/insert
4. Записать в `audit_logs` действие `grant-access-for-order.skip_already_fulfilled`

### Что меняется

**Файл:** `supabase/functions/grant-access-for-order/index.ts`

**Вставка после L148** (после проверки `user_id`):

```typescript
// IDEMPOTENCY HARD GUARD: if this order already fulfilled, strict no-op
const { data: existingEntByOrder } = await supabase
  .from("entitlements")
  .select("id, status, expires_at")
  .eq("order_id", orderId)
  .eq("user_id", userId)
  .maybeSingle();

const { data: existingSubByOrder } = await supabase
  .from("subscriptions_v2")
  .select("id, status, access_end_at")
  .eq("order_id", orderId)
  .eq("user_id", userId)
  .maybeSingle();

if (existingEntByOrder && existingSubByOrder) {
  console.log(`[grant-access] IDEMPOTENCY GUARD: order ${orderId} already fulfilled. Entitlement: ${existingEntByOrder.id}, Subscription: ${existingSubByOrder.id}. Strict no-op.`);
  
  await supabase.from("audit_logs").insert({
    action: "grant-access-for-order.skip_already_fulfilled",
    actor_type: "system",
    actor_user_id: null,
    actor_label: "grant-access-for-order",
    target_user_id: userId,
    meta: {
      order_id: orderId,
      existing_entitlement_id: existingEntByOrder.id,
      existing_subscription_id: existingSubByOrder.id,
      entitlement_status: existingEntByOrder.status,
      subscription_status: existingSubByOrder.status,
    },
  });

  return new Response(
    JSON.stringify({
      success: true,
      already_fulfilled: true,
      message: "Доступ по этому заказу уже был выдан ранее",
      existing: {
        entitlement_id: existingEntByOrder.id,
        subscription_id: existingSubByOrder.id,
      },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

### Edge-case: entitlement есть, subscription нет (standalone module без подписки)

Некоторые продукты (standalone modules) создают entitlement + subscription с `auto_renew: false`. В текущей реализации subscription всегда создаётся. Поэтому guard проверяет **оба** артефакта.

Если в будущем появятся продукты без subscription, guard нужно будет расширить до: `existingEntByOrder && (existingSubByOrder || productIsNoSubscription)`.

### DoD

1. Повторный вызов по тем же 4 order_id (e5742761, 3ad48adb, a717d410, 727fe302) **ничего не меняет**
2. Entitlement count не меняется
3. Subscription count не меняется
4. `access_end_at` не меняется
5. Audit log фиксирует `skip_already_fulfilled`
6. Новые первичные вызовы продолжают работать штатно

### Тестирование

После деплоя:
1. Вызвать `grant-access-for-order` с одним из 4 уже выполненных order_id
2. Убедиться, что ответ содержит `already_fulfilled: true`
3. Проверить, что entitlement и subscription не изменились
4. Проверить audit_log на запись `skip_already_fulfilled`

### STOP-guards

- Изменение только в одном файле: `grant-access-for-order/index.ts`
- Только добавление early-return guard, без изменения существующей логики fulfillment
- Без миграций БД
