# PATCH v23.1.4 — Multi-product access rule + per-product prior purchase filter — В РАБОТЕ

## Discovery результат
- **Projection table**: `entitlements` (user_id, product_code, product_id, status, expires_at, order_id, profile_id)
- **Prior purchase evidence**: `orders_v2` с `status = 'paid'` и `product_id` = целевой продукт
- **Grant contract**: upsert в `entitlements` с `user_id + product_code` unique constraint

## Что сделано

### UI (ProductAccessRulesTab.tsx)
1. ✅ Multi-select для target products (чекбоксы + поиск + chips + счётчик + scroll area)
2. ✅ Condition prior_purchase multi-select с toggle "Проверять эти же продукты" / "Выбрать отдельный список"
3. ✅ Save: `conditions.target_product_ids`, `conditions.required_product_ids`, `match_mode: "per_product"`
4. ✅ Edit restore: восстановление multi-product state из conditions JSONB
5. ✅ Backward-compatible: single target_ref + required_product_id для legacy
6. ✅ Rule card: ProductListBadge с tooltip для multi-product targets и conditions
7. ✅ Label auto-generation для multi-product rules

### Runtime (grant-access-for-order/index.ts)
1. ✅ Новая секция 3b: product_access rules processing
2. ✅ Resolve rules: tariff-level first, fallback to product-level
3. ✅ Multi-target: `conditions.target_product_ids` → массив, fallback на `[target_ref]`
4. ✅ Per-product prior purchase filter: каждый target проверяется индивидуально
5. ✅ Grant executor: upsert в `entitlements` с product_code, product_id, expires_at
6. ✅ Ledger per product: `status: "granted"` / `status: "skipped"`, `reason_code: "condition_not_met"`
7. ✅ Backward-compatible: single target_ref rules работают как массив из одного

### Storage contract (add-only JSONB)
```json
{
  "rule_purpose": "service",
  "target_product_ids": ["uuid-1", "uuid-2"],
  "condition_type": "prior_purchase",
  "required_product_ids": ["uuid-1", "uuid-2"],
  "match_mode": "per_product"
}
```
Precedence: массив → используем массив; нет массива → fallback на старое одиночное поле.

## Scope exclusion
- Domain/section access (email type) — disabled/rollback, не трогаем
- Tariff-level conditions (required_tariff_ids) — deferred
- Модуль `module_access` — не используется в этом патче
- Club и entitlement rules — без изменений

## DoD v23.1.4
1. ✅ Одно правило позволяет выбрать несколько продуктов на выдачу
2. ✅ Condition prior_purchase поддерживает множественный выбор продуктов
3. ✅ Default mode: "проверять эти же продукты" (не нужно выбирать дважды)
4. ✅ Runtime проходит по каждому target product и проверяет prior purchase per product
5. ✅ Продукт A куплен ранее → access granted; Продукт B не куплен → skipped
6. ✅ Ledger entry per product: granted / skipped (reason_code: condition_not_met)
7. ✅ Старые single-target правила не ломаются
8. ✅ Club, entitlement rules не затронуты
9. ✅ В карточке правила видно количество и список продуктов (tooltip)
10. ✅ match_mode = per_product зафиксирован как default
11. ⬜ Runtime proof: stop-guard pending

## Stop-guard (перед финальным approve)
- [ ] product_access rules реально исполняются runtime
- [ ] multi-target не ломает single-target rules
- [ ] per-product filtering реально работает
- [ ] ledger entries корректны
