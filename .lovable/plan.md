# PATCH v23.1.6 — Training/Product access alignment to product SoT

## Статус: ВЫПОЛНЕН

## Архитектурное решение

- **Канонический SoT** = `access_rules` → runtime → `entitlements`
- `module_access` больше не используется как write-path для модулей с `product_id`
- Временно сохраняется только как переходный read/write path для модулей без `product_id`
- Read-path из PATCH v23.1.5 (entitlements) не переписан — сделан реально рабочим через заполнение `product_id`

## Выполненные шаги

### Шаг 1: Dry-run discovery
- 10 модулей с записями в module_access
- Все 10 имеют однозначный маппинг (product_count = 1)
- 0 конфликтных модулей

### Шаг 2: Data patch — product_id проставлен
- 10 модулей получили product_id (идемпотентный UPDATE)
- 6 модулей → Gorbova Club
- 4 модуля → индивидуальные продукты
- 70 модулей без module_access → product_id = NULL (legacy)

### Шаг 3: Readonly UI блок
- `ProductAccessInfoBlock` — новый компонент:
  - Бейдж «Новый контур доступа»
  - Название продукта
  - Кнопка «Открыть продукт» → `/admin/products-v2/{id}`
  - Пояснение про вкладку «Доступы»
- Используется в:
  - `AdminTrainingModules.tsx` (ModuleAccessForm — edit dialog)
  - `ContentCreationWizard.tsx` (access step для lesson и module flows)

### Шаг 4: Write-path guard (все 4 точки)
1. `useTrainingModules.tsx` — createModule/updateModule: skip module_access if effective product_id
2. `ContentCreationWizard.tsx` — handleSubmitLesson: fetch container.product_id, skip if set
3. `ContentCreationWizard.tsx` — handleSaveAccess: fetch module.product_id, skip if set
4. `ContentSectionSelector.tsx` — copy access from container: skip if container.product_id

### Шаг 5: training-copy-move guard
- `training-copy-move/index.ts` — skip module_access copy if source.product_id
- product_id сохраняется при копировании через `...rest` spread

### Шаг 6: Read-path — без изменений
- useTrainingModules, useSidebarModules, useContainerLessons — entitlement read-path уже был

## Файлы изменены

| Файл | Изменение |
|---|---|
| `ProductAccessInfoBlock.tsx` | Новый компонент — readonly info-блок |
| `AdminTrainingModules.tsx` | Import + ModuleAccessForm с product_id guard |
| `ContentCreationWizard.tsx` | Import + UI readonly blocks + write-path guards |
| `ContentSectionSelector.tsx` | Select product_id + skip module_access copy |
| `useTrainingModules.tsx` | createModule/updateModule write-path guards |
| `training-copy-move/index.ts` | Skip module_access copy if product_id |

## Deferred (после v23.1.6)

- Миграция оставшихся 70 модулей без product_id
- Постепенное сворачивание legacy module_access write-path
- Полное удаление прямой записи в module_access
