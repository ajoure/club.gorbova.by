## да, согласен, с учетом правок:

&nbsp;

1. **Primary entitlement только по product_id, не по product_code.**
  Это оставить как обязательное правило во всей функции. product_code только как display/secondary metadata.
2. **order_id collision clearing делать только с жёстким guard.**
  Нельзя просто очищать любой entitlement с тем же order_id. Разрешить очистку только если одновременно:
  &nbsp;
  - entitlements.user_id = orders_v2.user_id
  - entitlements.product_id != orders_v2.product_id
  - найденный entitlement не является уже корректным primary entitlement этого заказа
  - писать отдельный audit entitlement.order_id_collision_cleared
  - сохранять в meta: previous_entitlement_id, previous_product_id, previous_product_code, cleared_by_patch
  &nbsp;
3. **Если collision найден у entitlement другого пользователя — hard STOP.**
  Не чистить, не продолжать, вернуть 500 с order_id_collision_foreign_user.
4. **Silent fail полностью запретить.**
  После блока primary entitlement:
  &nbsp;
  - если exact entitlement по user_id + product_id не найден, функция обязана завершиться ошибкой;
  - subscription и rule-based grants не должны выполняться, если primary entitlement не подтверждён.
  &nbsp;
5. **Разделить audit для primary и rule-based grant.**
  В primary entitlement явно писать granted_by = 'primary_order_fulfillment'.
  Для вторичных rule-based выдач — granted_by = 'rule_engine_product_access' или аналогичный отдельный label.
  Это нужно, чтобы больше не смешивались основной продукт и побочные grants.
6. **По split-multi-module-orders не делать слепой execute без точного proof.**
  В этот патч добавить минимум read-proof:
  &nbsp;
  - точная строка/ветка, где split пишет order_id в entitlement;
  - какие именно entitlement он трогает;
  - на каком условии.
    Только если proof есть — убрать этот write. Если proof нет, split не менять в этом патче.
  &nbsp;
7. **Обязательный post-check для cee45419 и всех 14 orders.**
  После фикса прогнать reverification:
  &nbsp;
  - exact entitlement на exact product_id
  - exact subscription на exact product_id
  - нет entitlement на club вместо модуля
  - нет новых side-effect entitlements
  - counts без scope leakage
  &nbsp;
8. **Добавить отдельный артефакт root-cause proof.**
  Не только общий before/after, а отдельный файл:
  &nbsp;
  - grant_access_primary_entitlement_root_cause_cee45419.csv
    с полями: order_id, user_id, expected_product_id, wrong_entitlement_id, wrong_product_id, wrong_product_code, collision_index, code_path, repair_action.
  &nbsp;
9. **DoD дополнить.**
  Патч считается закрытым только если:
  &nbsp;
  - повторный execute для cee45419 и одного из остальных order после фикса даёт already_fulfilled: true
  - никаких продлений/изменений дат не происходит
  - exact product entitlement verified = true для всех 14/14.
  &nbsp;
10. **ID-first правило явно вписать в патч.**
  Во всех решениях по fulfillment использовать:
  &nbsp;
  - order_id
  - user_id
  - product_id
  - subscription_id
    product_code не использовать как ключ принятия решения.
  &nbsp;

&nbsp;

&nbsp;

План: PATCH-GRANT-ACCESS-PRIMARY-ENTITLEMENT-EXACT-PRODUCT-FIX

### Root Cause (кейс cee45419)

Полная цепочка сбоя:

1. Функция `split-multi-module-orders` при разделении родительского заказа `19ff6e2b` создала дочерний order `cee45419` и установила его `order_id` на **club** entitlement `53a0616a` (вместо создания нового entitlement для модуля).
2. Когда `grant-access-for-order(cee45419)` был вызван:
  - **L283-288**: Поиск entitlement по `user_id + product_code = 'cb_module_production'` → не найден
  - **L314-330**: INSERT нового entitlement с `order_id = cee45419`
  - **FAIL**: Unique index `idx_entitlements_unique_order_id` заблокировал INSERT, т.к. club entitlement `53a0616a` уже занял этот `order_id`
  - **L332-333**: Ошибка молча залогирована, функция продолжила как ни в чём не бывало
  - Subscription создана корректно (65c0691e), ledger записан как "granted"
3. Результат: **primary entitlement не создан**, subscription создана, функция вернула success.

```text
Точная ветка:    L314-330 INSERT → unique constraint idx_entitlements_unique_order_id → silent fail
Какой rule:      не rule — order_id collision от split-multi-module-orders  
Почему club:     split присвоил order_id на club entitlement, заблокировав INSERT для модуля
Почему нет module: INSERT failed, ошибка проглочена (L332 console.error only)
```

### Два дефекта для исправления

**Дефект 1** (в `grant-access-for-order`):

- Primary entitlement INSERT молча проглатывает ошибку и продолжает
- Lookup по `product_code` вместо `product_id` — ненадёжно
- Нет проверки, что после INSERT/UPDATE entitlement реально существует с correct product_id

**Дефект 2** (в `split-multi-module-orders`):

- При создании дочерних заказов устанавливает order_id на НЕ связанные entitlements (club вместо модуля)
- Это блокирует последующий штатный fulfillment

### Исправления

#### Файл 1: `supabase/functions/grant-access-for-order/index.ts`

**Изменение A — L282-337**: Переписать primary entitlement блок:

1. Lookup по `user_id + product_id` (вместо `product_code`) — использовать unique index `idx_entitlements_user_product_id`
2. Перед INSERT: проверить, не занят ли `order_id` другим entitlement. Если занят — очистить (`SET order_id = NULL`) у чужого entitlement с audit log `entitlement.order_id_collision_cleared`
3. При INSERT failure — **hard error**: вернуть HTTP 500 с деталями, НЕ продолжать
4. После INSERT/UPDATE — post-check: SELECT entitlement по `user_id + product_id`, убедиться что `product_id = orders_v2.product_id`

**Изменение B — L807-1121** (product_access rules): Добавить audit label `granted_by: 'rule_engine_product_access'` в meta для отличия от primary. Уже не ставят order_id — OK.

**Изменение C** — Добавить поле `results.primary_entitlement_verified = true/false` в ответ для трассировки.

#### Файл 2: `supabase/functions/split-multi-module-orders/index.ts`

**Изменение**: При создании split-order НЕ устанавливать `order_id` на существующие entitlements. Split создаёт только orders — fulfillment делает `grant-access-for-order`.

### Конкретная логика Изменения A (pseudocode)

```typescript
// BEFORE (L282-288): lookup by product_code
const { data: existingEntitlement } = await supabase
  .from("entitlements")
  .select("id, expires_at")
  .eq("user_id", userId)
  .eq("product_code", productCode)  // ← WRONG: should be product_id
  .maybeSingle();

// AFTER: lookup by product_id (canonical unique index)
const { data: existingEntitlement } = await supabase
  .from("entitlements")
  .select("id, expires_at, product_code, product_id")
  .eq("user_id", userId)
  .eq("product_id", productId)
  .maybeSingle();

// Pre-INSERT: clear order_id collision
const { data: orderIdCollision } = await supabase
  .from("entitlements")
  .select("id, product_code, product_id")
  .eq("order_id", orderId)
  .neq("product_id", productId)  // only if it's a DIFFERENT product
  .maybeSingle();

if (orderIdCollision) {
  await supabase.from("entitlements")
    .update({ order_id: null, updated_at: now.toISOString() })
    .eq("id", orderIdCollision.id);
  // audit: entitlement.order_id_collision_cleared
}

// INSERT с hard error check
if (insertError) {
  return new Response(JSON.stringify({
    success: false,
    error: "primary_entitlement_creation_failed",
    details: insertError.message,
  }), { status: 500, headers: corsHeaders });
}

// Post-check: verify entitlement exists with correct product_id
const { data: verifyEnt } = await supabase
  .from("entitlements")
  .select("id, product_id")
  .eq("user_id", userId)
  .eq("product_id", productId)
  .single();

if (!verifyEnt) {
  return new Response(JSON.stringify({
    success: false, error: "primary_entitlement_verification_failed",
  }), { status: 500, headers: corsHeaders });
}
```

### DoD

1. Root-cause proof по cee45419 зафиксирован (выше)
2. Primary entitlement всегда создаётся на `orders_v2.product_id`
3. При collision по `order_id` — collision cleared + audit log
4. При failure INSERT — hard error 500, не silent continue
5. Rule-based grants не подменяют primary (уже так, но добавить audit label)
6. Re-verification 14/14 order_id: exact product entitlement + exact subscription + no wrong replacement + no scope leakage
7. Before/after proof + root-cause proof по cee45419 как артефакт

### Файлы

1. `supabase/functions/grant-access-for-order/index.ts` — изменения A, B, C
2. `supabase/functions/split-multi-module-orders/index.ts` — убрать установку order_id на entitlements (если есть)

### STOP-guards

- Без миграций БД
- Без изменения subscription логики
- Без изменения club/telegram grant логики
- Без revoke существующих entitlements
- Split-функция: только убрать entitlement order_id write, без изменения order creation логики