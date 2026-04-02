# План: PATCH F + C + D + G + E + B — цепочка доступа + нормализация

## Главная цель

Починить цепочку **продукт → тариф → тренинг → сделка → доступ → срок доступа**.
PATCH G (split multi-module) — поддерживающая нормализация, не замена PATCH E/F/C/B.

## Статус

### ✅ Сделано

- PATCH F: display_purchase_name resolution — все 6 файлов
- PATCH F: warning badge «⚠ Historical name missing» — все 6 экранов
- PATCH F: badge «Модульная покупка» — AdminDeals + DealDetailSheet
- PATCH G: Edge function (dry_run/execute_children_only/finalize_parents) — создана
- PATCH G: dry_run выполнен (7 parent → 22 child)
- PATCH C: dropdown, multi-rule selector (tariff_name, access_mode, is_active, target_label), soft-disable, confirmation с impact preview
- PATCH E: child name matching + standalone_safe cohort
- PATCH D: proof tables собраны (deal_display, mapping, standalone_users, runtime_access)

### ⏳ Осталось

1. PATCH G: execute_children_only
2. PATCH G: post_check
3. PATCH E: dry_run на актуальных данных
4. PATCH E: execute approved standalone_safe cohort
5. PATCH G: finalize_parents
6. PATCH B: browser proof admin + superadmin

### ➡️ Следующее действие

PATCH G execute_children_only → post_check → PATCH E dry_run

## Execution Order

1. ~~PATCH F — display names + warning badges~~ ✅
2. ~~PATCH C — tariff name в selector/confirmation~~ ✅
3. ~~PATCH D — proof tables~~ ✅
4. PATCH G — execute_children_only
5. PATCH G — post_check
6. PATCH E — dry_run repair
7. PATCH E — execute approved cohort
8. PATCH G — finalize_parents (только после post-check)
9. PATCH B — browser proof

## DoD

### Основная цепочка (приоритет 1)

- ✅ Сделка показывает правильный продукт/модуль на всех экранах
- ✅ Warning badge при пустом display_purchase_name
- ⬜ Entitlement создаётся с expires_at = business_access_end_at
- ⬜ Training visibility соответствует покупке
- ⬜ No-access case подтверждён
- ⬜ Царёва разобрана end-to-end

### PATCH G (supporting)

- ⬜ 7 parent → ~22 child, product_id = module_product_id
- ⬜ Parent не cancel до post-check
- ⬜ Двусторонняя связь parent/child в meta

### PATCH C ✅

- ✅ Rule-linked edit/delete с impact preview
- ✅ Tariff name в selector и confirmation
- ✅ Owner не меняется через rule-linked actions

### PATCH B

- ⬜ Browser proof admin + superadmin lesson editing

## Scope boundary

- Никаких новых products/tariffs/training_modules
- PATCH E работает и до, и после split
- Split только 7 target parent orders
