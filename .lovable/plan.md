# да, согласен, с учетом правок:

&nbsp;

1. Для invalidation не привязывайся к точечным ключам module-legacy-access-count / module-training-content-rules-count вручную по одному. Добавь единый invalidate-пакет:
  &nbsp;
  - [QUERY_KEY]
  - ["module-legacy-access-count"]
  - ["module-training-content-rules-count"]
  - ["product-name-extended"]
    чтобы зеркальный блок и диагностика обновлялись гарантированно после bind / rebind / unbind.
  &nbsp;
2. В diagnostics считай не только legacy_module_access_count, но и training_content_rules_count по полной глубине дерева тем же рекурсивным сбором IDs. Сейчас проблема не только в legacy.
3. В getAllDescendantIds кроме visited добавь hard-stop guard по числу итераций/узлов, чтобы при поврежденном дереве не уйти в бесконечный цикл даже при странных дублях данных.
4. Для countTreeLessons(node) сразу сделай общий helper и используй в обоих местах без дублирования логики:
  &nbsp;
  - tree view
  - matrix view
  &nbsp;
5. В DoD добавь явный proof:
  &nbsp;
  - deep tree с глубиной минимум 3 уровня,
  - diagnostics count до/после,
  - lesson total до/после,
  - post-action UI refresh без ручного reload.
  &nbsp;

&nbsp;

&nbsp;

План: Финальная доводка PATCH A — diagnostics на полную глубину + cycle guard

## Проблемы

### 1. Diagnostics считают legacy/rules только по root + direct children

**Файл:** `useProductTrainings.ts`, строка 151:

```
const allIds = [root.id, ...root.children.map(c => c.id)];
```

Это занижает `legacy_module_access_count` для глубоких деревьев.

**Решение:** Рекурсивно собрать все IDs из уже построенного дерева (helper `collectAllTreeIds(node)`), не делая лишних запросов к БД — дерево уже построено в памяти.

### 2. `getAllDescendantIds` не защищён от циклов

**Файл:** `useProductTrainings.ts`, строки 56-74.

**Решение:** Добавить `visited: Set<string>`, пропускать уже встреченные IDs. На практике цикл маловероятен, но guard дешёвый.

### 3. `totalLessons` в UI считает только 1 уровень children

**Файл:** `ProductLinkedTrainingsBlock.tsx`:

- Строка 26: `TrainingTreeItem` — `training.children.reduce(...)` не рекурсивный
- Строка 386: `TrainingMatrixView` — аналогично

**Решение:** Рекурсивная функция `countTreeLessons(node)` для подсчёта уроков по всему поддереву.

### 4. Invalidation зеркального блока

После bind/rebind/unbind вызывается `invalidateQueries({ queryKey: [QUERY_KEY] })`. Зеркальный блок в карточке тренинга (`ProductAccessInfoBlock`) использует другой queryKey (`product-name-extended`). Нужно также инвалидировать `module-legacy-access-count` и `module-training-content-rules-count`.

**Решение:** Добавить `invalidateQueries` для ключей зеркального блока в `onSuccess` колбеках bind/rebind/unbind.

---

## Изменения

### `src/hooks/useProductTrainings.ts`

1. В `getAllDescendantIds`: добавить `visited` set для cycle guard
2. В query diagnostics (строка 151): заменить `root.children.map` на рекурсивный сбор всех IDs из дерева
3. В `onSuccess` bind/rebind/unbind: добавить invalidation queryKeys зеркального блока

### `src/components/admin/product/ProductLinkedTrainingsBlock.tsx`

1. Добавить helper `countTreeLessons(node)` — рекурсивный подсчёт
2. Использовать в `TrainingTreeItem` (строка 26) и `TrainingMatrixView` (строка 386)

---

## Что НЕ меняется

- SQL миграции — нет
- Runtime хуки — нет
- `ProductAccessInfoBlock.tsx` — нет (он уже корректно читает свои данные, нужна только invalidation)