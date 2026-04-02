# Да, согласен, с учетом правок:

&nbsp;

1. Сначала зафиксируй главный разрыв как root cause:
  &nbsp;
  - write-side уже пишет entitlement.meta (scope_resolution_mode, historical_*, business_subscription_id),
  - но read-side это пока не использует.
    Это нужно явно вынести в начало плана как основной незакрытый дефект: **grant-path частично исправлен, runtime-path ещё нет**.
  &nbsp;
2. По useTrainingContentRules.ts нужно не просто “читать meta”, а оформить это как отдельный канонический runtime resolver:
  &nbsp;
  - либо внутри useTrainingContentRules.ts,
  - либо отдельным shared hook useBonusAccessScope.ts.
    Но итог должен быть один:
  - full_tariff_scope
  - module_scope_only
  - union_scope
  - no_scope
  - manual_review
    должны реально участвовать в выдаче effective scope.
    Просто чтение meta без явного resolver недостаточно.
  &nbsp;
3. В плане явно зафиксируй приоритет runtime resolution:
  &nbsp;
  1. admin bypass
  2. product-linked entitlement path
  3. training_content scope resolver
  4. legacy module_access только для модулей без product_id
    И отдельно напиши: **для product-linked cb20 модулей legacy module_access не имеет права расширять доступ**.
  &nbsp;
4. По useSidebarModules.ts нужен не просто “быстрый фикс”, а обязательная синхронизация всех read-path:
  &nbsp;
  - useTrainingModules.tsx
  - useSidebarModules.ts
  - всё, что ещё показывает список модулей/уроков/разделов по cb20
    Нужно отдельно сделать discovery всех read-path, чтобы не получилось, что один экран уже исправлен, а второй всё ещё живёт по старой OR-логике.
  &nbsp;
5. По grant-access-for-order уточни SoT для срока:
  &nbsp;
  - не просто active + past_due,
  - а один канонический расчёт business_effective_end_at,
  - с одинаковым использованием в create / repair / rerun.
    Нужно явно потребовать:
  - какой именно запрос/алгоритм выбран,
  - почему он канонический,
  - где он переиспользуется,
  - чем отличается subscription.status от effective access window.
  &nbsp;
6. В DoD добавь обязательный proof, что **после фикса bonus entitlement без tariff context больше не даёт full access**.
  Не только кодом, а фактом:
  &nbsp;
  - entitlement есть,
  - historical_purchase_type = module_only_standalone,
  - effective scope ограничен,
  - лишние модули не открываются.
  &nbsp;
7. По module_scope_only добавь обязательный mapping proof:
  &nbsp;
  - какие historical_module_product_ids сматчены в training_module_ids точно,
  - какие только по имени,
  - какие не сматчены.
    Все inferred_name и no_match должны идти в manual_review, а не в execute.
    Это нужно явно включить в STOP-guard.
  &nbsp;
8. По 4 user classes добавь обязательный end-to-end proof в одном формате:
  &nbsp;
  - что в orders_v2
  - что в entitlements.meta
  - какой scope_resolution_mode
  - какой effective scope вернул resolver
  - какие module_ids доступны
  - какой visible_recursive_lesson_count
  - что реально видит UI
    То есть не просто SQL отдельно и UI отдельно, а один связанный proof на пользователя.
  &nbsp;
9. По багу “0 уроков” зафиксируй, что он считается закрытым только если будут доказаны оба слоя:
  &nbsp;
  - runtime scope корректен,
  - recursive lesson count считается по **эффективно доступному дереву**, а не по всему дереву.
    И отдельно:
  - если scope пустой, root не должен показываться как “0 уроков”,
  - это должно трактоваться как “нет доступа”, а не “пустой тренинг”.
  &nbsp;
10. По legacy module_access добавь отдельный итоговый decision block:

&nbsp;

&nbsp;

&nbsp;

- keep as secondary fallback only for modules without product_id
- или убрать из cb20 runtime entirely
  Но оставлять текущую двусмысленную архитектуру после патча нельзя.
  Нужен явный итоговый выбор и proof, что cb20 path больше не зависит от legacy.

&nbsp;

&nbsp;

&nbsp;

11. По документации:

&nbsp;

&nbsp;

&nbsp;

- после Phase C нужно сразу обновить trainings_access и products_sales,
- не ждать конца всех фаз.
  В документации обязательно добавить машинно-проверяемые таблицы:
- historical purchase validity matrix
- BUSINESS → historical type → effective scope
- target products reality check
- module product → training subtree mapping with confidence (exact / inferred / no_match)

&nbsp;

&nbsp;

&nbsp;

12. В итоговый DoD добавь ещё 4 пункта:

&nbsp;

&nbsp;

&nbsp;

- после execute не осталось cb20 bonus entitlements без scope_resolution_mode
- после execute не осталось cb20 bonus entitlements без business_subscription_id
- после execute не осталось expires_mismatch, кроме manual_review
- standalone_only не получают full cb20 access ни при каком rerun или fallback

&nbsp;

&nbsp;

&nbsp;

13. Порядок фаз зафиксируй жёстко:

&nbsp;

&nbsp;

&nbsp;

- сначала sync всех read-path,
- потом runtime resolver,
- потом duration/source alignment,
- потом dry-run buckets,
- только потом execute.
  Массовый repair до полного proof read-side запрещён.

&nbsp;

&nbsp;

&nbsp;

14. В конце плана отдельно зафиксируй главный бизнес-вывод:

&nbsp;

&nbsp;

&nbsp;

- **Variant B подтверждён окончательно**:
  если у клиента есть только historical purchase отдельного модуля, он получает доступ только к соответствующему модулю/поддереву, а не ко всему cb20.
- Полный доступ допустим только при подтверждённой base tariff purchase или другом доказанном полном основании.

&nbsp;

&nbsp;

План: Доведение Phase C / E / F до рабочего end-to-end результата

## Проблема

Сделана только write-side (grant-access-for-order пишет meta с `scope_resolution_mode`, `historical_module_product_ids` и т.д.), но **read-side (runtime) эти данные не читает и не использует**.

Конкретные разрывы:

1. `**useTrainingContentRules.ts**` — читает только `access_rules` таблицу. Не читает `entitlement.meta`. Не знает про `scope_resolution_mode`. Bonus entitlement cb20 без tariff context по-прежнему даёт full access (filter = null → всё открыто).
2. `**useSidebarModules.ts**` (строки 130-134) — по-прежнему использует legacy OR-path: `module_access OR entitlement`. Для product-linked модулей `module_access` может молча расширять доступ.
3. `**useTrainingModules.tsx**` — исправлен для product-linked (строки 178-186), но `useSidebarModules` нет. Два read-path рассинхронизированы.
4. Нет runtime proof по 4 user classes.

---

## Что нужно сделать

### Шаг 1. Создать runtime bonus scope resolver

Новый shared hook/функция: `resolveBonusScopeFromEntitlement`.

Логика:

- При загрузке entitlements для cb20, читать `meta` (через `.select("product_id, expires_at, meta")`)
- Если `meta.scope_resolution_mode === "module_scope_only"`, создать partial filter из `meta.historical_module_product_ids` → маппинг в `training_module_ids`
- Если `meta.scope_resolution_mode === "full_tariff_scope"`, оставить full access
- Если `meta.scope_resolution_mode === "no_scope"` или meta пуста, скрыть модуль
- Если `meta.scope_resolution_mode === "manual_review"`, скрыть (безопасный default)

Этот resolver должен интегрироваться в `useActiveTrainingContentRules` или вызываться параллельно и мержиться с существующими `access_rules` фильтрами.

### Шаг 2. Интеграция resolver в `useTrainingContentRules.ts`

В `useActiveTrainingContentRules`:

- Добавить `.select("product_id, expires_at, meta")` при загрузке entitlements
- Для entitlements с `meta.scope_resolution_mode` отличным от `full_tariff_scope`, генерировать синтетический `TrainingContentRule` с `access_mode: "partial"` и `allowed_module_ids` из маппинга `historical_module_product_ids → training_module_ids`
- Маппинг: нужна lookup-таблица или runtime query `training_modules WHERE product_id IN (...)` для резолва module product → training module

В `resolveTrainingContentFilter`:

- Учитывать синтетические rules из entitlement meta наравне с DB rules
- Приоритет: tariff rule > product rule > entitlement meta rule > null (full)

### Шаг 3. Исправить `useSidebarModules.ts`

Применить ту же логику что в `useTrainingModules.tsx` строки 178-186:

- Если модуль имеет `product_id`, доступ определяется ТОЛЬКО через entitlement path
- `module_access` используется ТОЛЬКО для модулей без `product_id`

Текущий код (строка 131):

```
const hasAccess = isAdminUser || 
  moduleAccess.tariffIds.length === 0 || 
  moduleAccess.tariffIds.some(tid => userTariffIds.includes(tid)) ||
  (effectiveProductId != null && userEntitlementProductIds.has(effectiveProductId));
```

Нужно заменить на:

```
let hasAccess: boolean;
if (effectiveProductId != null) {
  hasAccess = isAdminUser || userEntitlementProductIds.has(effectiveProductId);
} else {
  hasAccess = isAdminUser || 
    moduleAccess.tariffIds.length === 0 || 
    moduleAccess.tariffIds.some(tid => userTariffIds.includes(tid));
}
```

### Шаг 4. Runtime proof по 4 user classes

После имплементации — SQL-запросы для proof по каждому классу:

- `base_only`: entitlement meta.scope_resolution_mode = full_tariff_scope → full access
- `base+standalone`: union_scope → full + mapped modules
- `standalone_only`: module_scope_only → только mapped modules
- `no_cb_purchase`: no_scope → модуль не показывается

Для каждого: что в БД → что вернул resolver → что видно в UI.

### Шаг 5. Выравнивание SoT для business_effective_end_at

Текущий код ищет source subscription с `status = 'active'`. Расширить до `IN ('active', 'past_due')` и взять `MAX(access_end_at)` — это канонический SoT.

---

## Файлы для изменения


| Файл                                                 | Что меняется                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/hooks/useTrainingContentRules.ts`               | Чтение entitlement.meta, генерация синтетических rules для bonus scope |
| `src/hooks/useSidebarModules.ts`                     | Исправление legacy OR-path для product-linked модулей (строки 130-134) |
| `supabase/functions/grant-access-for-order/index.ts` | Расширение поиска source subscription до `active + past_due`           |


## Порядок выполнения

1. Исправить `useSidebarModules.ts` (legacy path) — быстрый фикс
2. Добавить bonus scope resolver в `useTrainingContentRules.ts` — ключевой фикс
3. Расширить SoT в grant-access-for-order — minor fix
4. SQL proof по 4 user classes
5. Документация update

## DoD

- `useTrainingContentRules.ts` читает `entitlement.meta.scope_resolution_mode` и применяет partial filter
- `useSidebarModules.ts` не использует `module_access` для product-linked модулей
- Bonus entitlement cb20 без tariff context больше не даёт full access
- standalone_only видит только свои module_scope_only
- Runtime proof по 4 user classes приведён
- SoT для business_effective_end_at = MAX(access_end_at) из active+past_due