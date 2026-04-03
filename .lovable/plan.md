# да, согласен, с учетом правок:

&nbsp;

1. Оставь scope патча строго минимальным:
  &nbsp;
  - менять только src/components/training/LibraryTableView.tsx
  - useLibraryTree.ts, useLibraryLessons.ts, search/filter, progress/count/access label не трогать, если верификация подтверждает текущее корректное поведение
  &nbsp;
2. Добавь явную проверку stale localStorage state:
  &nbsp;
  - после flatten скрытый root больше не рендерится отдельной строкой
  - старые expandedModuleIds, указывающие на скрытый root, не должны ломать отображение
  - если такой id остался в storage, UI должен либо корректно игнорировать его, либо безопасно использовать только для показа children без артефактов
  &nbsp;
3. В логике action-навигации зафиксируй exact fallback:
  &nbsp;
  - Начать → первый незапланированный урок → любой первый урок → модуль
  - Продолжить → первый незавершенный и незапланированный урок → первый незавершенный урок → любой первый урок → модуль
  - Завершено → всегда модуль
  - ни один action не должен зависеть от того, раскрыта строка или нет
  &nbsp;
4. В DoD добавь не только общие проверки, но и 2 конкретных proof-кейса:
  &nbsp;
  - Подоходный налог ИП — без промежуточной root-строки
  - Закрой год — иерархия multi-root сохранена
  &nbsp;
5. Добавь проверку кликов:
  &nbsp;
  - chevron раскрывает/сворачивает
  - название строки навигирует
  - action-column навигирует
  - ни один из этих кликов не вызывает соседнее действие по bubbling
  &nbsp;
6. Итоговый отчет потребуй в формате proof:
  &nbsp;
  - до/после по single-root
  - до/после по multi-root
  - proof сохранения состояния после refresh
  - proof рабочей навигации Начать / Продолжить / Завершено
  &nbsp;

&nbsp;

&nbsp;

План: Верификация и доработка flatten + action-навигации

## Текущее состояние

Код уже реализует основные требования:

- `shouldFlattenSingleRoot` в `useLibraryTree.ts` (строка 37-45) — flatten всех single-root групп без проверки названий ✓
- Нет иконок папок и badge с количеством root modules ✓
- Action-навигация с fallback на модуль если уроки не загружены ✓
- Разделение кликов: chevron → expand, название → navigate, action → navigate ✓
- localStorage persistence для expandedGroups/Modules ✓
- Все продукты свёрнуты при первом входе ✓

## Что нужно проверить и при необходимости починить

### 1. `src/components/training/LibraryTableView.tsx`

**Action-навигация — уточнить логику «Продолжить»** (строки 213-218):

- Текущий код: `lessons.find(l => !l.is_completed && !l.isScheduled)` — корректно
- Добавить второй fallback: если все незавершённые запланированы → первый доступный урок → fallback на модуль

**Guard: action-column не триггерит expand** (строки 229-231):

- `e.stopPropagation()` уже есть ✓

**Flattened group row** (строки 454-530):

- progress/lesson_count из `flattenedRoot.module` ✓
- children рендерятся на depth=1 (через `renderChildModule`) ✓
- lessons без children рендерятся на depth=1 ✓

### 2. Без изменений (add-only guard)

- `useLibraryLessons.ts` — не трогать
- `useLibraryTree.ts` — структура уже корректна, flatten работает
- search/filter — логика поиска по скрытому root title уже есть (строка 169-173)
- progress/count/access label расчёты — без изменений
- маршруты `/library/{slug}` и `/library/{slug}/{lessonSlug}` — без изменений

## Файлы


| Файл                                           | Изменения                                     |
| ---------------------------------------------- | --------------------------------------------- |
| `src/components/training/LibraryTableView.tsx` | Минимальная доработка fallback в «Продолжить» |


## DoD

- Single-root продукт не показывает промежуточную root-строку
- Multi-root продукт сохраняет иерархию
- Все продукты свёрнуты при первом входе
- После refresh раскрытое состояние сохраняется
- Клик «Начать» → первый доступный урок или модуль
- Клик «Продолжить» → первый незавершённый незапланированный урок → первый доступный → модуль
- Клик «Завершено» → модуль
- Нет мёртвых кнопок
- Поиск по скрытому root title находит группу
- Нет иконок папок, нет badge count
- progress/lesson_count/access labels не изменены