

## План: PATCH-GRANT-ACCESS-PRIMARY-ENTITLEMENT-EXACT-PRODUCT-FIX — ВЫПОЛНЕН

### Root Cause (кейс cee45419)

`split-multi-module-orders` присвоил `order_id = cee45419` на club entitlement `53a0616a`. 
При вызове `grant-access-for-order(cee45419)` INSERT нового module entitlement упал на unique constraint `idx_entitlements_unique_order_id`, ошибка была молча проглочена (console.error only), функция вернула success без primary entitlement.

### Исправления (выполнены)

**Файл: `supabase/functions/grant-access-for-order/index.ts`**

1. **Lookup по product_id** вместо product_code (ID-first)
2. **order_id collision guard**: проверка перед INSERT, очистка стороннего entitlement с audit log `entitlement.order_id_collision_cleared`; hard STOP при collision от другого пользователя
3. **Hard error на failure**: INSERT/UPDATE entitlement при ошибке → HTTP 500, не silent continue
4. **Post-check verification**: SELECT после INSERT/UPDATE, проверка product_id = order.product_id → `primary_entitlement_verified: true`
5. **Idempotency guard усилен**: проверка product_id match (не только order_id + user_id)
6. **Audit labels**: primary → `granted_by: 'primary_order_fulfillment'`, rules → `granted_by: 'rule_engine_product_access'`
7. **3 entitlements с NULL product_id** исправлены (user 7c53b6af)

**split-multi-module-orders**: не содержит записей в entitlements, изменений не требуется.

### Верификация 14/14

Все 14 orders: active_ent_count=1, active_sub_count=1, wrong_product_ent_id=NULL.
Idempotency proof: cee45419 → `already_fulfilled: true` без изменений.

### Артефакты

- `module_fulfillment_reverification_14_14.csv`
- `grant_access_primary_entitlement_root_cause_cee45419.csv`
