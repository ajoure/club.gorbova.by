# да, согласен, с учетом правок:

&nbsp;

1. В пункте про renderActionLabel не привязывай навигацию к уже загруженным lessons, иначе кнопки снова будут нестабильными:
  &nbsp;
  - Начать / Продолжить должны работать даже если уроки этого модуля еще не раскрывались и не подгружались
  - правило:
    &nbsp;
    - если lessons уже есть в кеше — использовать их
    - если уроков нет в кеше — fallback сразу на /library/{moduleSlug}
    &nbsp;
  - не делать нерабочую кнопку в ожидании lazy-load
  &nbsp;
2. Для Продолжить уточни порядок выбора:
  &nbsp;
  - сначала первый **незавершенный и не запланированный** урок
  - если таких нет, fallback на первый доступный урок
  - если уроков нет/не загружены — fallback на модуль
  &nbsp;
3. Для flattened single-root группы зафиксируй источник данных:
  &nbsp;
  - progress, lesson_count, action и slug брать из flattenedRoot.module
  - children/lessons рендерить сразу под group row
  - не пересчитывать эти значения из group aggregate, если это single-root flatten case
  &nbsp;
4. В LibraryTableView.tsx добавь явный guard:
  &nbsp;
  - клик по chevron только раскрывает/сворачивает
  - клик по названию строки только навигирует
  - клик по action-column не должен одновременно триггерить expand/collapse строки
  &nbsp;
5. В DoD добавь отдельную проверку для flattened single-root:
  &nbsp;
  - у строки продукта остается только один верхний уровень
  - после раскрытия сразу видны child modules или lessons
  - скрытый root-level не рендерится ни визуально, ни как пустая промежуточная строка
  &nbsp;
6. По localStorage уточни ключи и совместимость:
  &nbsp;
  - не ломать уже сохраненные expandedGroupIds / expandedModuleIds
  - если структура ключей меняется, добавить мягкую миграцию или fallback на старые ключи
  - после flatten старый expanded-state не должен вызывать «призрачное» раскрытие несуществующего промежуточного root-уровня
  &nbsp;
7. Добавь в DoD еще один UX-check:
  &nbsp;
  - в collapsed состоянии список остается компактным
  - в expanded состоянии строки не дублируются
  - ни один single-root продукт не показывает «продукт → такой же root → child»
  &nbsp;
8. Add-only guard:
  &nbsp;
  - не трогать useLibraryLessons.ts
  - не менять lazy-loading уроков
  - не менять search/filter механику, кроме сохранения текущего ручного expanded-state
  - не менять существующие access labels, progress bars и counts
  &nbsp;

&nbsp;

&nbsp;

План: Убрать папки, починить flatten и action-навигацию

## Проблема

1. Иконки папок (`FolderOpen`) и badge с количеством root modules создают визуальный шум
2. Не все single-root группы flatten'ятся — только с совпадающим названием, а нужно все
3. Кнопки «Начать/Продолжить/Завершено» не имеют навигации — мёртвый UI
4. Single-root группы авто-раскрываются (строка 422), нарушая требование «всё свёрнуто»

## Изменения

### 1. `src/hooks/useLibraryTree.ts` — flatten все single-root группы

Изменить `shouldFlattenSingleRoot`: если у группы ровно 1 root module — всегда `flatten: true`, без проверки совпадения названий. Multi-root группы не трогать.

### 2. `src/components/training/LibraryTableView.tsx`

**Убрать визуальный шум:**

- Убрать `FolderOpen` иконку (строка 450)
- Убрать badge с количеством root modules (строки 460-464)
- Все group rows выглядят одинаково — clean строка без папки

**Убрать авто-раскрытие single-root:**

- Строка 422: `effectiveExpanded = isExpanded` (убрать `|| (isSingleRoot && !isFlat)`)
- Первый вход = всё свёрнуто, сохранение через localStorage

**Починить action-навигацию в `renderActionLabel`:**

- Принимать дополнительные параметры: `moduleSlug`, `lessons` (если загружены)
- **Начать**: навигация на первый доступный урок → `/library/{moduleSlug}/{lessonSlug}`, fallback → `/library/{moduleSlug}`
- **Продолжить**: первый незавершённый урок → `/library/{moduleSlug}/{lessonSlug}`, fallback → `/library/{moduleSlug}`
- **Завершено**: рабочая ссылка на модуль → `/library/{moduleSlug}`
- Обернуть в `onClick` с `navigate()`

**Прокинуть навигацию во все вызовы `renderActionLabel`:**

- В `renderGroup` (flattened): slug из `flatRoot.module.slug`, lessons из `getLessons(flatRoot.module.id)`
- В `renderRootModule`: slug из `rm.module.slug`, lessons из `getLessons(rm.module.id)`
- В `renderChildModule`: slug из `child.slug`, lessons из `getLessons(child.id)`

**Гарантировать showGroupRow = true всегда** (строка 427 → убрать условие)

### Файлы


| Файл                                           | Изменения                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `src/hooks/useLibraryTree.ts`                  | `shouldFlattenSingleRoot` → flatten все single-root группы              |
| `src/components/training/LibraryTableView.tsx` | Убрать FolderOpen, badge count, auto-expand; починить action navigation |


### DoD

- Нет иконок папок в таблице
- Single-root product не показывает «папку в папке»
- Multi-root product показывает корректную иерархию
- Все продукты свёрнуты при первом входе
- После раскрытия и refresh — состояние сохраняется
- Поиск не перетирает ручное раскрытие
- Клик «Начать» → первый урок или модуль (работает)
- Клик «Продолжить» → первый незавершённый урок (работает)
- Клик «Завершено» → модуль (работает)
- Нет мёртвых кнопок в action-column
- Маршруты `/library/{slug}` и `/library/{slug}/{lessonSlug}` не изменены
- Progress / lesson counts / access labels не изменены