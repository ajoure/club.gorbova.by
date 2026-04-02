# да, согласен, с учетом правок:

&nbsp;

1. Для runtime_preview используй **тот же реальный runtime path**, что и фронтенд:
  &nbsp;
  - тот же resolver scope
  - тот же способ расчёта visible_module_count
  - тот же recursive lesson count
    Нельзя делать отдельный “упрощённый preview-алгоритм”, который потом расходится с UI.
  &nbsp;
2. Для mapping_confidence добавь ещё поле:
  &nbsp;
  - mapping_reason
  &nbsp;
  Чтобы по каждому module product было видно, **почему** он попал в exact_fk / exact_code / exact_name / inferred / no_match.
3. Для exact_name добавь жёсткий guard:
  &nbsp;
  - exact_name допустим **только если match уникален**
  - если по названию найдено 2+ кандидата → это не exact_name, а manual_review
  &nbsp;
4. В SAFE EXECUTE NOW не включать кейсы module_scope_only даже если после dedupe они выглядят чисто, пока не будет отдельного proof:
  &nbsp;
  - mapping_confidence допустим
  - runtime_preview.visible_module_count > 0
  - runtime_preview.visible_recursive_lesson_count > 0
  - preview совпадает с ожидаемым business-result
    До этого все standalone-only остаются в HOLD.
  &nbsp;
5. В dry-run response добавь отдельный список:
  &nbsp;
  - execute_candidates_safe[]
  - hold_candidates[]
  &nbsp;
  Не только summary counts, а именно полные строки кандидатов с reason.
6. Для всех repair_metadata_only / repair_metadata_and_align / align_to_business добавь в dry-run явное поле:
  &nbsp;
  - target_expires_at
  &nbsp;
  Чтобы было видно, к какому конечному сроку будет приведён entitlement.
7. Для execute потом обязателен **partial execute only**:
  &nbsp;
  - отдельный флаг execute_cohort = 'safe_only'
  - функция не должна уметь случайно исполнить HOLD cohort одним вызовом
  &nbsp;
8. Для post-check добавь ещё одно обязательное условие:
  &nbsp;
  - executed_users_scope_mode_invalid = 0
  &nbsp;
  То есть после execute не должно остаться записей, где:
  &nbsp;
  - scope_resolution_mode IS NULL
  - или scope_resolution_mode не соответствует dry-run classification
  &nbsp;
9. В .lovable/[plan.md](http://plan.md) зафиксируй отдельно:
  &nbsp;
  - **standalone_only сейчас не approve на execute**
  - **первый execute допускается только по SAFE cohort**
  - после него нужен отдельный follow-up dry-run для HOLD cohort
  &nbsp;
10. Документацию обновить не только статусом NO-GO, но и двумя явными таблицами:

&nbsp;

&nbsp;

&nbsp;

- **SAFE cohort**
- **HOLD / MANUAL REVIEW cohort**

&nbsp;

&nbsp;

Чтобы потом не пересобирать это заново вручную.

&nbsp;

11. Итоговый критерий следующего шага:

&nbsp;

&nbsp;

&nbsp;

- после доработки вернуть
  &nbsp;
  - обновлённую матрицу
  - полный mapping_confidence
  - 3 create-кейса с runtime_preview
  - execute_candidates_safe[]
  - hold_candidates[]
  &nbsp;
- только после этого можно approve execute_cohort='safe_only'

&nbsp;

&nbsp;

План: Доработка dry-run Phase F — dedupe fix, mapping confidence, safe/risky cohort split

## Текущий статус: NO-GO на execute

Execute Phase F заблокирован до выполнения всех доработок ниже.

---

## Что нужно сделать

### 1. Исправить dedupe historical orders

**Файл**: `supabase/functions/repair-cb20-entitlements/index.ts` (строки 100-136)

**Баг**: Дедупликация по `profile_id:user_id:tariff_id` теряет несколько standalone-заказов одного пользователя с разными модулями (у всех `tariff_id = null` → одинаковый ключ).

**Фикс**:

- В select добавить `id` (order UUID)
- Дедуплицировать по `id` заказа вместо composite key
- После этого полностью пересчитать dry-run

Строки 102-126 заменить:

```typescript
const { data: historicalOrders } = await supabase
  .from('orders_v2')
  .select('id, profile_id, user_id, tariff_id, product_id, purchase_snapshot, status')
  .eq('product_id', CB20_PRODUCT_ID)
  .eq('status', 'paid')
  .in('profile_id', businessUserIds)
  .order('created_at', { ascending: false });

const { data: historicalOrdersByUser } = await supabase
  .from('orders_v2')
  .select('id, profile_id, user_id, tariff_id, product_id, purchase_snapshot, status')
  .eq('product_id', CB20_PRODUCT_ID)
  .eq('status', 'paid')
  .in('user_id', businessUserIds)
  .order('created_at', { ascending: false });

// Deduplicate by order ID, not composite key
const allOrders = [...(historicalOrders || []), ...(historicalOrdersByUser || [])];
const seenOrderIds = new Set<string>();
const uniqueOrders = allOrders.filter(o => {
  if (seenOrderIds.has(o.id)) return false;
  seenOrderIds.add(o.id);
  return true;
});
```

### 2. Добавить mapping confidence proof

**Файл**: `supabase/functions/repair-cb20-entitlements/index.ts`

После построения repair plans, для всех кейсов с `scope_bucket = module_scope_only`, выполнить mapping proof:

```typescript
// For each unique historical_module_product_id across all module_scope_only plans:
// 1. Query products_v2 for product name
// 2. Query training_modules WHERE product_id = module_product_id
// 3. Classify confidence:
//    - exact_fk: training_module.product_id = module_product_id (direct FK match)
//    - exact_code: matched by product_code
//    - exact_name: matched by name (only if unambiguous)
//    - inferred: partial name match or heuristic
//    - no_match: no training_module found for this product_id
```

В response добавить секцию `mapping_confidence`:

```json
{
  "mapping_confidence": [
    {
      "module_product_id": "...",
      "module_product_name": "...",
      "matched_training_module_id": "..." | null,
      "matched_training_module_title": "..." | null,
      "mapping_confidence": "exact_fk" | "no_match",
      "allowed_in_execute": true | false
    }
  ]
}
```

Правило: `exact_fk` / `exact_code` → `allowed_in_execute = true`. `inferred` / `no_match` → `false`.

### 3. Разделить cohorts: SAFE EXECUTE NOW vs HOLD

В response добавить разделение plans на два списка:

**SAFE EXECUTE NOW** (все условия одновременно):

- `historical_class` ∈ {`base_tariff_purchase`, `base_tariff_plus_standalone`}
- ИЛИ `planned_action` ∈ {`align_to_business`, `repair_metadata_only`, `repair_metadata_and_align`} при `scope_bucket` ∈ {`full_tariff_scope`, `union_scope`}
- `business_access_end_at IS NOT NULL`
- email resolved
- не staff

**HOLD / MANUAL REVIEW** (любое из):

- `scope_bucket = module_scope_only` (standalone_only) — пока mapping confidence не доказан
- `business_access_end_at IS NULL`
- `historical_class = unclassified`
- `scope_bucket = manual_review`
- `email IS NULL` / identity unresolved
- staff

### 4. Identity/staff guard

Добавить в dry-run response:

- `email_null_count`: сколько BUSINESS users без email
- `denylist_unresolvable_count`: сколько не проверено по staff denylist
- Все с `email IS NULL` автоматически → `manual_review`

### 5. Runtime preview для create-кейсов

Для каждого create-кандидата добавить секцию `runtime_preview`:

```json
{
  "historical_module_product_ids": [...],
  "derived_allowed_module_ids": [...],
  "derived_allowed_module_titles": [...],
  "visible_module_count": N,
  "visible_recursive_lesson_count": N
}
```

Если `derived_allowed_module_ids = []` или `visible_module_count = 0` → автоматически перевести в `manual_review`.

### 6. Обновить dry-run response structure

Добавить cohort summary:

```json
{
  "cohort_summary": {
    "safe_execute_count": N,
    "manual_review_count": N,
    "staff_skip_count": N,
    "identity_unresolved_count": N,
    "standalone_only_blocked_count": N
  }
}
```

### 7. Расширить post-check (для будущего execute)

Три дополнительных условия:

- `executed_standalone_only_with_no_match = 0`
- `executed_users_with_null_business_end = 0`
- `executed_users_with_email_unresolved = 0`

---

## Файлы для изменения


| Файл                                                   | Изменение                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `supabase/functions/repair-cb20-entitlements/index.ts` | Dedupe fix, mapping confidence, cohort split, identity guard, runtime preview, extended response |
| `.lovable/plan.md`                                     | Обновить статус: NO-GO, документировать dedupe fix и cohort split                                |


## Порядок

1. Исправить dedupe → redeploy
2. Добавить mapping confidence + cohort split + runtime preview → redeploy
3. Запустить dry-run с `dry_run: true`
4. Показать: обновлённую матрицу, 3 create-кейса с mapping proof, SAFE vs HOLD списки
5. Только после approval SAFE cohort → GO на partial execute

## Go/No-Go для execute

- **GO** только для SAFE cohort, если: dedupe исправлен, mapping confidence доказан, email resolved, business_end != NULL
- **NO-GO** для standalone_only до mapping confidence proof
- **NO-GO** для любого кейса с email IS NULL / unclassified / manual_review