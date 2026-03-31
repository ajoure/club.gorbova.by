# PATCH v23.1.7 — Продолжение перевода training access на продуктовый SoT

## Статус: ВЫПОЛНЕН

## Архитектурное решение

- **Канонический SoT** = `access_rules` → runtime → `entitlements`
- `module_access` = переходный legacy/fallback path, только для модулей без `product_id`
- Read-path через entitlements не менялся — работает из v23.1.5

## Результат

| Категория | До патча | После патча |
|---|---|---|
| product SoT | 10 | **29** |
| legacy (NO_MAPPING) | 70 | **51** |
| conflict | 0 | 0 |
| unresolved | — | **51** |

## Выполненные шаги

### Шаг 1: Dry-run — 19 дочерних модулей для наследования product_id

Все 70 legacy-модулей не имеют записей в `module_access` → автомаппинг через tariff→product невозможен.
Однако 19 модулей являются дочерними к модулям с уже установленным `product_id`:

| Родитель | Продукт | Дочерних |
|---|---|---|
| Вебинары | Gorbova Club | 11 |
| Закрой год 2025-2026 | ЗАКРОЙ ГОД | 6 |
| Квесты | Gorbova Club | 2 |

Конфликтов: 0. Все 19 маппятся однозначно.

### Шаг 2: Execute — UPDATE product_id для 19 модулей

```sql
UPDATE training_modules child
SET product_id = parent.product_id
FROM training_modules parent
WHERE child.parent_module_id = parent.id
  AND parent.product_id IS NOT NULL
  AND child.product_id IS NULL;
```

Результат: 19 строк обновлено. Post-check: 29 product SoT, 51 legacy.

### Шаг 3: Write-path guards — proof (код не менялся)

| Write-point | Guard | product_id != null | product_id == null |
|---|---|---|---|
| `useTrainingModules` / createModule | `if (!effectiveProductId && tariff_ids...)` | skip module_access | legacy insert |
| `useTrainingModules` / updateModule | `if (tariff_ids !== undefined && !effectiveProductId)` | skip module_access | legacy delete+insert |
| `ContentCreationWizard` / handleSubmitLesson | fetch container.product_id → `if (!containerProductId)` | skip module_access | legacy delete+insert |
| `ContentCreationWizard` / handleSaveAccess | fetch mod.product_id → `skipModuleAccess = !!mod?.product_id` | skip module_access | legacy delete+insert |
| `ContentSectionSelector` | `if (newModule && !containerModule.product_id)` | skip copy | legacy copy |
| `training-copy-move` | `if (!mod.product_id)` | skip copy | legacy copy |

### Шаг 4: Readonly UI — proof (код не менялся)

Все 3 точки используют единый `ProductAccessInfoBlock`:

1. `AdminTrainingModules.tsx` (строка 346-348): `effectiveProductId` → `ProductAccessInfoBlock`
2. `ContentCreationWizard.tsx` (строка 947-948): `targetModuleProduct` → `ProductAccessInfoBlock`
3. `ContentCreationWizard.tsx` (строка 1053-1054): `targetModuleProduct` → `ProductAccessInfoBlock`

Один компонент, единый UX: бейдж «Новый контур доступа», название продукта, кнопка «Открыть продукт», пояснение.

### Шаг 5: Unresolved list — 51 модуль

**Top-level контейнеры без product_id (12):**
- Бонус-вебинар, Бухгалтер маркетплейсов, Деньги BY, Деньги BY 2, Марафон, Подоходный налог для физ лиц, ТЕСТ, Ценный бухгалтер | 1 ступень 2.0, Ценный бухгалтер | 2 ступень | 3 поток, и др.

**Дочерние без product_id (39):**
- ~20 подмодулей «Ценный бухгалтер | 1 ступень 2.0»
- 3 подмодуля «Подоходный налог для физ лиц»
- остальные — подмодули неактивных контейнеров

Причина: нет записей в `module_access`, нет связи с products_v2, нет родителя с product_id.

## Файлы изменены

| Файл | Изменение |
|---|---|
| SQL (data patch) | UPDATE product_id для 19 дочерних модулей |
| `.lovable/plan.md` | Обновлён отчёт |

Код НЕ менялся — все guards и readonly UI работают из v23.1.6.

## Deferred (следующий патч)

- Ручное решение по привязке 51 оставшегося модуля к продуктам
- Для «Ценный бухгалтер 1 ступень 2.0» — создать/найти продукт в products_v2 и привязать
- Постепенное сворачивание legacy module_access
