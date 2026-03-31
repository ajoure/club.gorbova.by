# да, согласен, с учетом правок:

&nbsp;

1. **Исправить SQL guard от неоднозначного маппинга**
  &nbsp;
  - В текущем виде:
    &nbsp;
    - GROUP BY ma.module_id, [p.id](http://p.id)
    - HAVING COUNT(DISTINCT [p.id](http://p.id)) = 1
    &nbsp;
  - это некорректно как защита от конфликта, потому что при группировке по [p.id](http://p.id) условие почти всегда будет тривиально истинным.
  - Нужен двухшаговый подход:
    &nbsp;
    - сначала отдельный dry-run, где для каждого module_id считается число разных product_id;
    - потом UPDATE только для модулей, у которых product_count = 1.
    &nbsp;
  &nbsp;
2. **В dry-run таблице добавить явный флаг конфликта**
  &nbsp;
  - Колонки:
    &nbsp;
    - module_id
    - module_title
    - current_product_id
    - resolved_product_id
    - resolved_product_name
    - product_count
    - conflict = product_count > 1
    &nbsp;
  - Без этого подтверждение маппинга будет недостаточно прозрачным.
  &nbsp;
3. **SQL patch делать как идемпотентный data patch / migration**
  &nbsp;
  - Не разовый ad-hoc SQL.
  - Нужно, чтобы был:
    &nbsp;
    - dry-run output,
    - execute patch,
    - post-check output.
    &nbsp;
  - Иначе не будет нормального proof.
  &nbsp;
4. **Навигацию к продукту исправить**
  &nbsp;
  - Ссылка должна вести в актуальный маршрут продукта:
    &nbsp;
    - /admin/products-v2/:id
    &nbsp;
  - а не в старый /admin/products/:id.
  &nbsp;
5. **Readonly-блок для модулей с product_id должен быть одинаковым во всех training UI**
  &nbsp;
  - Не только в AdminTrainingModules.tsx,
  - но и в ContentCreationWizard.tsx.
  - Формулировка и UX должны быть едиными:
    &nbsp;
    - бейдж нового контура,
    - название продукта,
    - переход к продукту,
    - пояснение, что доступ меняется через вкладку «Доступы» продукта.
    &nbsp;
  &nbsp;
6. **Write-path guard формулировать через effective product_id**
  &nbsp;
  - Не только data.product_id,
  - а фактический effective product_id сущности:
    &nbsp;
    - из текущего модуля,
    - из контейнера,
    - из source при copy/move.
    &nbsp;
  - Это особенно важно для wizard и copy/move flows.
  &nbsp;
7. **Для новых модулей уточнить поведение**
  &nbsp;
  - Если новый модуль создаётся уже с product_id, legacy запись в module_access не должна происходить.
  - Если новый модуль без product_id, legacy path временно допустим.
  - Это надо явно закрепить в плане и proof.
  &nbsp;
8. **training-copy-move описать жёстче**
  &nbsp;
  - Если source/module имеет product_id, target сохраняет этот product_id, и копирование module_access для него запрещено.
  - Это должен быть отдельный proof-пункт, а не просто реализация “по пути”.
  &nbsp;
9. **Read-path в этом патче не переписываем, но обязателен post-proof**
  &nbsp;
  - После заполнения product_id нужно доказать:
    &nbsp;
    - useTrainingModules реально матчится по entitlement;
    - useContainerLessons реально матчится;
    - useSidebarModules реально матчится.
    &nbsp;
  - Не только “код уже есть”, а факт работы на данных.
  &nbsp;
10. **DoD усилить**

&nbsp;

&nbsp;

&nbsp;

- Добавить:
  &nbsp;
  - post-check после UPDATE: сколько модулей получили product_id;
  - список конфликтных модулей, которые не были обновлены;
  - proof, что для модуля с product_id запись в module_access больше не происходит;
  - proof, что legacy-модуль без product_id всё ещё использует старый путь;
  - proof, что readonly UI действительно ведёт в продукт и не даёт редактировать доступ локально.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

11. **Финальную архитектурную формулировку оставить жёсткой**

&nbsp;

&nbsp;

&nbsp;

- Новый продуктовый контур = canonical SoT.
- module_access не основной механизм.
- Для переведённых модулей — только продуктовый контур.
- Для непереведённых — временный legacy path до следующей миграции.

&nbsp;

&nbsp;

План: PATCH v23.1.6 — Training/Product access alignment to product SoT

## Архитектурное решение

- **Канонический SoT** = `access_rules` → runtime → `entitlements`
- `**module_access**` больше не используется как write-path для модулей с `product_id`. Временно сохраняется только как переходный read/write path для модулей без `product_id`
- Read-path из PATCH v23.1.5 (entitlements) уже работает во всех трёх хуках — его не переписываем, а делаем реально рабочим через заполнение `product_id`

## Подтверждённые факты из discovery

### useSidebarModules — entitlement read-path УЖЕ есть

Строки 92-107: читает `entitlements`, строит `userEntitlementProductIds`, проверяет `effectiveProductId`. **Не нужно добавлять — уже синхронизирован с v23.1.5.**

### Write-points в module_access (все найдены)

1. `useTrainingModules.tsx` — `createModule`, `updateModule` (delete+insert)
2. `ContentCreationWizard.tsx` — строка 593 (handleSubmitLesson), строка 775 (handleSaveAccess)
3. `ContentSectionSelector.tsx` — строка 246-259 (copy access from container)
4. `training-copy-move/index.ts` — строка 208-222 (copy module_access)

### training-copy-move уже сохраняет product_id

Строка 194-203: `...rest` spread включает `product_id` из source модуля. Product_id при копировании не теряется.

---

## Шаги реализации

### Шаг 1: Dry-run discovery маппинга

Перед любым UPDATE — **показать таблицу маппинга** через SQL-запрос:

```sql
SELECT DISTINCT
  tm.id as module_id,
  tm.title as module_title,
  tm.product_id as current_product_id,
  p.id as resolved_product_id,
  p.name as resolved_product_name,
  COUNT(DISTINCT p.id) OVER (PARTITION BY tm.id) as product_count
FROM training_modules tm
JOIN module_access ma ON ma.module_id = tm.id
JOIN tariffs t ON t.id = ma.tariff_id
JOIN products_v2 p ON p.id = t.product_id
ORDER BY tm.title;
```

**Guard от неоднозначности**: если `product_count > 1` для модуля — он попадает в **conflict list** и НЕ обновляется автоматически. Только модули с `product_count = 1` получают `product_id`.

Результат: таблица с колонками `module_id | module_title | current_product_id | resolved_product_id | product_name | conflict?`

### Шаг 2: SQL migration для product_id

Идемпотентная миграция (не insert tool):

```sql
-- Только для модулей с однозначным маппингом (1 product через module_access)
UPDATE training_modules tm
SET product_id = sub.resolved_product_id
FROM (
  SELECT ma.module_id, p.id as resolved_product_id
  FROM module_access ma
  JOIN tariffs t ON t.id = ma.tariff_id
  JOIN products_v2 p ON p.id = t.product_id
  GROUP BY ma.module_id, p.id
  HAVING COUNT(DISTINCT p.id) = 1  -- guard: только однозначный маппинг
) sub
WHERE tm.id = sub.module_id
  AND tm.product_id IS NULL;  -- idempotent: не перезаписывать
```

Конфликтные модули (>1 product) выводятся отдельным SELECT и остаются без product_id до ручного решения.

### Шаг 3: Training UI — readonly блок для модулей с product_id

`**AdminTrainingModules.tsx**` — компонент `ModuleAccessForm`:

Если у `editingModule` есть `product_id`:

- Вместо `ProductTariffAccessSelector` показать info-блок:
  - Бейдж: "Новый контур доступа"
  - Текст: "Доступ управляется через продукт: **{название продукта}**"
  - Кнопка: "Открыть продукт" → навигация к `/admin/products/{product_id}`
  - Пояснение: "Для изменения доступа используйте вкладку «Доступы» в настройках продукта"
- `ProductTariffAccessSelector` НЕ рендерится

Если `product_id` нет — legacy selector остаётся.

`**ContentCreationWizard.tsx**` — в двух местах рендеринга selector:

- Аналогичная логика: если у контейнера/модуля есть `product_id` → readonly info-блок
- Если нет → legacy selector

**Для создания нового модуля**:

- Если админ при создании привязывает product (через `product_id` в форме) — запись в `module_access` не используется
- Если `product_id` не выбран — legacy write-path временно допустим

### Шаг 4: Write-path guard

Во всех write-points проверять **effective product_id** (из модуля/контейнера, не только из формы):

`**useTrainingModules.tsx**` (`createModule`, `updateModule`):

```
if (data.product_id || existingModule?.product_id) → skip module_access delete+insert
```

`**ContentCreationWizard.tsx**` (строки 591-606, 773-784):

```
// Перед записью: fetch product_id контейнера
if (container.product_id) → skip module_access write
```

`**ContentSectionSelector.tsx**` (строки 246-259):

```
if (containerModule.product_id) → skip module_access copy
```

`**training-copy-move/index.ts**` (строки 208-222):

- Source с `product_id` → target сохраняет `product_id` (уже работает через `...rest`)
- Если `product_id` у source есть → skip копирования `module_access` записей
- Добавить guard:

```
if (mod.product_id) {
  // skip module_access copy — access managed via product
} else {
  // legacy: copy module_access as before
}
```

### Шаг 5: Read-path — без изменений

Явная фиксация:

- `useTrainingModules` — entitlement read-path из v23.1.5 **уже есть**, начнёт реально работать после заполнения `product_id`
- `useSidebarModules` — entitlement read-path **уже есть** (строки 92-107)
- `useContainerLessons` — entitlement read-path **уже есть**
- Read-path **не переписывается заново** в этом патче

---

## Файлы и изменения


| Файл                          | Изменение                                                       |
| ----------------------------- | --------------------------------------------------------------- |
| SQL migration                 | UPDATE product_id для однозначно маппимых модулей               |
| `AdminTrainingModules.tsx`    | `ModuleAccessForm`: readonly info-блок для product_id модулей   |
| `ContentCreationWizard.tsx`   | 2 места: readonly info + skip module_access write if product_id |
| `useTrainingModules.tsx`      | createModule/updateModule: skip module_access if product_id     |
| `ContentSectionSelector.tsx`  | Skip module_access copy if product_id                           |
| `training-copy-move/index.ts` | Skip module_access copy if product_id                           |


## Что НЕ делаем

- Не удаляем таблицу `module_access`
- Не меняем `grant-access-for-order`
- Не меняем `access_rules`
- Не переписываем read-path
- Не ломаем v23.1.4/v23.1.5/v23.1.5A
- Не делаем скрытой синхронизации module_access ↔ access_rules
- Не обновляем модули с неоднозначным маппингом

## DoD

1. Dry-run таблица маппинга показана и подтверждена перед UPDATE
2. `product_id` проставлен только для модулей с однозначным маппингом
3. Нет модулей, автоматически обновлённых при неоднозначном маппинге
4. Есть список конфликтных модулей (если найдены)
5. Training UI для модулей с `product_id` показывает readonly блок с навигацией к продукту
6. Для модулей с `product_id` не происходит записи в `module_access` (все 4 write-points)
7. Для модулей без `product_id` legacy path работает как раньше
8. `useSidebarModules` подтверждённо синхронизирован с entitlement read-path
9. Proof: модуль с `product_id` читает доступ через entitlements
10. Proof: legacy модуль без `product_id` работает по старому пути
11. `module_access` = переходный legacy/fallback, не основной SoT

## Deferred (после v23.1.6)

- Миграция оставшихся модулей без `product_id` (включая конфликтные — после ручного решения)
- Постепенное сворачивание legacy `module_access` write-path
- Полное удаление прямой записи в `module_access` как механизма