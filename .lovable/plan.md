# да, согласен, с учетом правок:

&nbsp;

1. **Проверка маршрутизации новых сделок**
  &nbsp;
  - Недостаточно только SQL-проверки последних записей.
  - Нужен именно **runtime-proof** на реальных новых сделках после патча:
    &nbsp;
    - новый успешный платёж по Gorbova Club;
    - новый неуспешный / pending платёж по Gorbova Club;
    - новый успешный платёж по другому продукту;
    - новый неуспешный / pending платёж по другому продукту.
    &nbsp;
  - Нужно доказать:
    &nbsp;
    - в какую pipeline попала сделка;
    - в какую stage попала сделка;
    - что routing работает и для success, и для non-success.
    &nbsp;
  &nbsp;
2. **Цвета existing open-стадий**
  &nbsp;
  - Не просто обновить seed для новых стадий.
  - Нужно привести **все уже существующие open-стадии** к новой палитре, чтобы после патча интерфейс сразу выглядел цельно.
  - closed_won и closed_lost оставить жёстко semantic-only.
  &nbsp;
3. **Автовыбор цвета**
  &nbsp;
  - getNextStageColor(existingColors) должен учитывать только open-цвета текущей pipeline.
  - Не должен выбирать зелёный/красный и вообще не должен пересекаться с semantic-цветами.
  - При исчерпании палитры — безопасный cycle по palette, но без выбора closed_won/closed_lost цветов.
  &nbsp;
4. **Смена цвета стадии**
  &nbsp;
  - Добавить не просто пункт “Сменить цвет”, а компактный preset-picker с красивыми swatch-кнопками.
  - Менять цвет можно только для open-стадий.
  - Для Успешно и Отказ ручную смену цвета не давать, чтобы не ломать семантику.
  &nbsp;
5. **Режим выделения**
  &nbsp;
  - Согласен, что он должен включаться отдельной кнопкой, а не автоматически.
  - Но при этом сохранить поддержку:
    &nbsp;
    - select-all по стадии,
    - partial selection по одной карточке,
    - комбинированное выделение по нескольким стадиям.
    &nbsp;
  - При выключении режима — выделение очищается полностью.
  - В обычном режиме чекбоксы не должны занимать место и не должны влиять на drag/click.
  &nbsp;
6. **Карточка сделки**
  &nbsp;
  - Убрать order_number полностью.
  - Добавить:
    &nbsp;
    - название сделки,
    - продукт,
    - тариф,
    - контакт,
    - сумму.
    &nbsp;
  - Важно не дублировать одно и то же дважды. Если название сделки и продукт совпадают, нужен аккуратный fallback, чтобы карточка не выглядела как повтор текста.
  - Карточку лучше перестроить так:
    &nbsp;
    - 1 строка: название сделки;
    - 2 строка: продукт / тариф;
    - 3 строка: контакт;
    - 4 строка: сумма + статусы.
    &nbsp;
  &nbsp;
7. **Foundation под будущую настройку полей**
  &nbsp;
  - Верно, но зафиксировать явно:
    &nbsp;
    - сейчас только внутренняя подготовка структуры;
    - никакого UI-конструктора полей в этом патче не делать.
    &nbsp;
  &nbsp;
8. **Tinted background**
  &nbsp;
  - Подсветка должна применяться ко всей колонке стадии.
  - Карточки внутри стадии — только слегка гармонизировать тоном, без потери контраста и без превращения в однотонную “кашу”.
  - Нельзя ухудшить читаемость текста и бейджей.
  &nbsp;
9. **Изменяемые файлы**
  &nbsp;
  - Согласен с набором файлов.
  - Новый stagePalette.ts — нормальный вариант.
  - Но отдельную миграцию делать только если реально нужен persist для existing stage colors. Если можно обойтись data patch/update без новой схемы — так лучше.
  &nbsp;
10. **DoD дополнить**

&nbsp;

&nbsp;

&nbsp;

- Добавить в DoD:
  &nbsp;
  - runtime-proof по новым сделкам;
  - existing open-стадии перекрашены в новую палитру;
  - semantic stages не потеряли свои fixed colors;
  - partial selection удобен без необходимости сначала “выбрать всё” в колонке.
  &nbsp;

&nbsp;

&nbsp;

Итог: план хороший, но без **реального runtime-proof по новым сделкам** и без **массового приведения existing open-стадий к новой палитре** патч считать закрытым нельзя.

&nbsp;

План: Visual polish стадий + selection mode + карточка сделки

## Диагностика текущего состояния

1. **Цвета стадий**: Все pipelines имеют одинаковые 4 стадии с одними и теми же цветами (`#3b82f6` Новая, `#f59e0b` В работе, `#22c55e` Успешно, `#ef4444` Отказ). Tinted background применяется только к `closed_won` и `closed_lost` через CSS-классы в `KanbanColumn.tsx`. Open-стадии не имеют tinted background.
2. **Автовыбор цвета**: `createStage()` в `pipelineService.ts` использует hardcoded `#6366f1` по умолчанию. Нет палитры.
3. **Смена цвета**: Нет функции `updateStageColor` — только `renameStage`.
4. **Bulk mode**: Вход через первый клик по checkbox в header стадии. Нет отдельной кнопки.
5. **Карточка**: Показывает `product_name`, `contact`, `amount`, `order_number`. Не показывает `tariff_name`. Показывает `order_number` (ID).
6. **BoardDeal**: Уже содержит `tariff_name` — данные есть, просто не отображаются.

## Изменяемые файлы

### 1. `src/lib/stagePalette.ts` (новый)

Палитра приглушённых цветов для open-стадий + утилиты:

- `STAGE_PALETTE` — 8 цветов: slate-blue `#6366f1`, amber `#d97706`, teal `#0d9488`, indigo `#4f46e5`, violet `#7c3aed`, cyan `#0891b2`, rose-slate `#64748b`, sky `#0284c7`
- `getNextStageColor(existingColors: string[])` — возвращает первый неиспользованный цвет
- `getStageBackgroundStyle(color: string, stageType)` — возвращает `{ backgroundColor, borderColor }` для tinted block
- `SEMANTIC_COLORS = { closed_won: '#22c55e', closed_lost: '#ef4444' }`

### 2. `src/services/pipelineService.ts`

- Добавить `updateStageColor(id: string, color: string)` — update + audit
- В `createStage()`: вместо hardcoded `#6366f1` — вызвать `getNextStageColor()` с учётом существующих стадий (уже загружены в этой функции)
- В `createPipeline()` seed stages: использовать разные цвета из палитры для open-стадий

### 3. `src/hooks/usePipelineStages.ts`

- Добавить мутацию `updateColor` через новый `updateStageColor`

### 4. `src/components/admin/deals/KanbanColumn.tsx`

- Заменить hardcoded CSS-классы `bg-green-500/5 border-green-500/20` и `bg-red-500/5 border-red-500/20` на динамический tinted background из `getStageBackgroundStyle(color, stageType)` — применяется ко ВСЕМ стадиям, не только closed
- Карточки внутри получают гармоничный тон через prop `stageColor`

### 5. `src/components/admin/deals/KanbanColumnHeader.tsx`

- В dropdown меню стадии добавить пункт «Сменить цвет» (для open-стадий)
- По клику — показать небольшой popover/dialog с preset-палитрой из `STAGE_PALETTE`
- Передать `onChangeColor?: (color: string) => void` prop

### 6. `src/components/admin/deals/KanbanDealCard.tsx`

- Убрать `order_number` (строка 165-167)
- Добавить `tariff_name` рядом с `product_name`
- Переструктурировать layout:
  - Верх: product + status icon
  - Под ним: tariff (мелким текстом)
  - Контакт
  - Сумма + badges
- Подготовить данные карточки как массив `CardField[]` для будущей настройки видимости (пока все поля показываются, но структура ready)
- Добавить опциональный `stageColor` prop для гармонизации (например, subtle left border accent)

### 7. `src/components/admin/deals/DealsKanbanBoard.tsx`

- Добавить кнопку-тумблер «Режим выделения» в toolbar (между summary strip и board)
- `bulkMode` управляется этой кнопкой, а не автоматически от `selectedDealIds.size > 0`
- При выключении режима — `clearSelection()`
- Escape — выход из режима выделения
- Передать `stageColor` в `KanbanColumn` → `KanbanDealCard`
- Передать `onChangeColor` в `KanbanColumn` → `KanbanColumnHeader`

### 8. Миграция — обновить существующие цвета open-стадий

SQL-миграция для обновления цветов существующих стадий:

- Для каждого pipeline: «Новая» → slate-blue, «В работе» → amber/teal (разные)
- `closed_won` и `closed_lost` оставить как есть

## Проверка авторазмещения новых сделок

Runtime-proof через SQL-запросы к `orders_v2` + `crm_pipeline_product_bindings`:

- Проверить последние сделки и их pipeline_id/stage_id
- Подтвердить корректность routing

## Что НЕ меняется

- SQL-схема таблиц (только данные — цвета)
- Логика CRUD стадий
- Bulk delete / move / export
- List-view
- Deal routing / assignment logic
- DragOverlay

## DoD

1. Все open-стадии имеют tinted background в разных приглушённых цветах
2. Новая стадия получает цвет автоматически из палитры (не дублируя)
3. Цвет стадии можно сменить через меню в header
4. Весь stage block окрашен, не только точка
5. Карточки гармонируют с цветом стадии
6. Есть отдельная кнопка «Режим выделения»
7. Чекбоксы видны только в этом режиме
8. Escape выходит из режима
9. ID/номер сделки убран с карточки
10. Тариф добавлен на карточку
11. Drag-and-drop не сломан
12. Новые сделки корректно маршрутизируются