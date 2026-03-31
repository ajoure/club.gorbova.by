# да, согласен, с учетом правок:

&nbsp;

1. Для getAllDescendantIds(rootId) зафиксируй одно правило использования: **preview и execute обязаны использовать один и тот же helper**, чтобы число descendants в preview всегда совпадало с фактическим execute.
2. В rebindTraining деактивацию rules ограничь не только target_ref = trainingId и product_id = oldProductId, но и явно grant_target_type = 'training_content' и is_active = true оставить как обязательные guard-условия. В отчёте показать deactivated_rule_ids и deactivated_rules_count.
3. В unbindTraining guard на active rules должен проверять именно **root training target_ref = trainingId** и только grant_target_type = 'training_content'. Это нужно явно зафиксировать в плане, чтобы unbind не блокировался посторонними rules.
4. Для descendants proof добавь два обязательных post-check:
  &nbsp;
  - после bind/rebind: COUNT(*) модулей в полном descendant tree со старым/NULL product_id = 0;
  - после unbind: COUNT(*) модулей в полном descendant tree с ненулевым product_id = 0.
  &nbsp;
5. По naming зафиксируй результат заранее:
  &nbsp;
  - если проверка показывает, что primary label уже человеческий (target_label, e.label, [product.name](http://product.name), title) — **код не менять**, только отметить proof;
  - если найдётся хотя бы одно место, где primary label = technical code, исправить точечно в этом же PATCH A без расширения scope.
  &nbsp;

&nbsp;

&nbsp;

План: Финализация PATCH A — глубокая иерархия, scoped deactivation, proof

## Диагноз

Проверка кода выявила 4 конкретных проблемы:

### 1. Обновление descendants только на 1 уровень глубины

В `bindTraining`, `unbindTraining`, `rebindTraining` — все три используют `.eq("parent_module_id", trainingId)`, что обновляет только прямых детей. Если есть child → grandchild, grandchild не получит новый `product_id`.

**Исправление**: использовать рекурсивный подход — сначала собрать ВСЕ descendant IDs через recursive query (или итерацию по уровням), затем обновить `.in("id", allDescendantIds)`.

### 2. Деактивация rules при rebind не ограничена старым продуктом

Строки 405-411 в `useProductTrainings.ts`: деактивируются ВСЕ active `training_content` rules по `target_ref = trainingId`, без фильтра `product_id = oldProductId`. Если по какой-то причине есть rule нового продукта — он тоже деактивируется.

**Исправление**: добавить `.eq("product_id", oldProductId)` в запрос деактивации.

### 3. Preview-функции тоже считают descendants на 1 уровень

`getRebindPreview` (строка 251-254) и `getUnbindPreview` (строка 320-323) — тот же `.eq("parent_module_id", trainingId)`.

**Исправление**: собирать полное дерево descendants рекурсивно (или поуровнево до исчерпания).

### 4. Naming в wizard — нужна проверка

`ProductAccessRulesTab.tsx` — нужно проверить что primary label в списке правил и в селекторах показывает человеческое название.

---

## Что будет сделано

### Файл: `src/hooks/useProductTrainings.ts`

**A. Добавить helper `getAllDescendantIds(rootId)`:**

- Итерирует по уровням: загружает children → children of children → ... пока не закончатся
- Возвращает массив всех descendant IDs (без root)

**B. Обновить `bindTraining`:**

- Вместо `.eq("parent_module_id", trainingId)` → собрать все descendant IDs через helper → `.in("id", descendantIds)`

**C. Обновить `unbindTraining`:**

- То же: рекурсивные descendants → `.in("id", descendantIds)` для `SET product_id = NULL`

**D. Обновить `rebindTraining`:**

- Рекурсивные descendants → `.in("id", descendantIds)` для `SET product_id = newProductId`
- Деактивация rules: добавить `.eq("product_id", oldProductId)` — только rules старого продукта

**E. Обновить `getRebindPreview` и `getUnbindPreview`:**

- Использовать тот же helper для подсчёта всех descendants

### Файл: `src/components/admin/product/ProductAccessRulesTab.tsx`

- Проверить naming в списке правил и селекторах (скорее всего уже ок, но нужна верификация)

---

## Что НЕ меняется

- UI компоненты в `ProductLinkedTrainingsBlock.tsx` — логика диалогов уже корректна
- SQL миграции — не нужны
- Runtime хуки — не трогаем
- `useAccessRules.ts` — без изменений (PATCH B scope)

## DoD

1. bind/rebind/unbind обновляют product_id у ВСЕЙ иерархии, не только 1 уровень
2. Деактивация rules при rebind ограничена старым продуктом
3. Preview показывает корректное число ALL descendants
4. Primary labels в wizard — человеческие названия