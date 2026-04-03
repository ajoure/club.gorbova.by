# да, согласен, с учетом правок:

&nbsp;

1. shouldFlatten сделай **строже**, без агрессивного startsWith в обе стороны по умолчанию. Иначе можно случайно схлопнуть разные сущности с похожими названиями. Безопасное правило:
  &nbsp;
  - у группы ровно 1 root module
  - root.product_id === group.productId
  - normalize(groupName) === normalize(rootTitle)
  - опционально: разрешить ещё один very-safe case, когда различие только в декоративных символах/хвостах типа |, —, двойных пробелах
  - если точного безопасного совпадения нет — **не flatten**
  &nbsp;
2. В flattened-режиме **не делай всю group row кликабельной целиком**. Сохрани текущее UX:
  &nbsp;
  - chevron/иконка = expand/collapse
  - клик по названию = navigate в flattenedRoot.module.slug
  - это нужно, чтобы не ломать раскрытие и не делать конфликт между expand и navigation
  &nbsp;
3. Для flattened group перенеси на group row не только color_gradient, но и:
  &nbsp;
  - access label
  - action label
  - progress
  - lesson_count
    Источник истины — flattenedRoot.module, не group aggregate “на глаз”
  &nbsp;
4. При рендере children/lessons у flattened group обязательно сохрани корректный moduleSlug:
  &nbsp;
  - для child module → его собственный slug
  - для lesson row → slug именно того модуля, внутри которого лежит урок
  - не подставлять group/product slug вместо module slug
  &nbsp;
5. Поиск и фильтр проверь отдельно для flattened group:
  &nbsp;
  - поиск по названию скрытого root всё равно должен находить группу
  - при match в child/lesson группа должна авто-раскрываться как раньше
  - showOnlyIncomplete не должен скрывать flattened group, если незавершённость есть в её child/lessons
  &nbsp;
6. expanded state не должен дублироваться между group и скрытым root:
  &nbsp;
  - для flattened case хранить раскрытие только на уровне group
  - скрытый root не должен создавать второй невидимый expanded-key, иначе будут странные состояния после refresh
  &nbsp;
7. В DoD добавь ещё 3 проверки:
  &nbsp;
  - flattened group с **children** показывает сразу child modules без промежуточной root-строки
  - flattened group **без children** показывает сразу lessons без промежуточной root-строки
  - группа с похожим, но не идентичным названием **не** flatten’ится ошибочно
  &nbsp;
8. Add-only guard:
  &nbsp;
  - не менять структуру данных хуков вне isFlattenable/flattenedRoot
  - не ломать multi-root группы
  - не менять маршруты /library/{slug} и /library/{slug}/{lessonSlug}
  &nbsp;

&nbsp;

&nbsp;

План: Flatten single-root duplicate group в LibraryTableView

## Проблема

Когда у product-group ровно один root-модуль и его название совпадает с названием группы, таблица показывает «папку в папке» — лишний промежуточный уровень, не несущий информации.

## Решение

### 1. Добавить helper `shouldFlattenSingleRoot` в `useLibraryTree.ts`

Добавить в `LibraryGroup` новое поле:

```ts
isFlattenable: boolean;  // true = skip root module row, show children directly
flattenedRoot?: LibraryRootModule; // the single root (for navigation/data)
```

Логика:

- У группы ровно 1 root module
- `normalize(rootModule.title)` ≈ `normalize(group.productName)` (trim, lowercase, убрать спецсимволы `|`, лишние пробелы)
- Если совпадает — `isFlattenable = true`

Helper нормализации:

```ts
function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[|·—–\-]/g, '').replace(/\s+/g, ' ').trim();
}
function shouldFlatten(groupName: string, rootTitle: string): boolean {
  const a = normalizeTitle(groupName);
  const b = normalizeTitle(rootTitle);
  return a === b || a.startsWith(b) || b.startsWith(a);
}
```

### 2. Изменить `renderGroup` в `LibraryTableView.tsx`

Для `isFlattenable` групп:

- Group row рендерится как обычно (название продукта, chevron, progress)
- **НЕ** рендерить `renderRootModule` — пропустить этот уровень
- При раскрытии группы сразу показывать:
  - Если у root есть children → `renderChildModule` для каждого child (с depth=1 вместо depth=2)
  - Если у root нет children → `renderModuleLessons` напрямую (depth=1)

Progress/lesson_count/action в group row берутся из `flattenedRoot.module`.

Клик по названию group row → навигация в `flattenedRoot.module.slug`.

Color gradient accent из root module переносится на group row.

### 3. Для групп с несколькими root modules — без изменений

Текущее поведение сохраняется полностью.

### 4. Файлы для изменения


| Файл                                           | Что меняется                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/useLibraryTree.ts`                  | Добавить `isFlattenable`, `flattenedRoot` в `LibraryGroup`, helper `shouldFlatten`                                                       |
| `src/components/training/LibraryTableView.tsx` | В `renderGroup`: если `isFlattenable`, пропустить root level и рендерить children/lessons напрямую; group row кликабельный для навигации |


### 5. DoD

- «Подоходный налог ИП» не показывает папку-в-папке
- «Ценный бухгалтер 2.0» с несколькими root modules — без изменений
- Навигация по slug работает: клик по flattened group → `/library/{rootSlug}`
- Progress и lesson_count корректны
- Expand state в localStorage не ломается
- Поиск работает корректно для flattened групп