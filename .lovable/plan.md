# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 1 сформулировать точнее на уровне query-логики.**
  Для default pipeline нужно не просто “показывать NULL”, а явно зафиксировать правило:
  &nbsp;
  - default pipeline показывает:
    &nbsp;
    - сделки с pipeline_id = selectedDefaultPipelineId
    - **и** сделки с pipeline_id IS NULL
    &nbsp;
  - не-default pipeline показывает только свои сделки.
    Это правило нужно сохранить и для search/product filter, чтобы OR pipeline_id IS NULL не ломал остальные фильтры.
  &nbsp;
2. **Dropdown по продуктам делать не как одноразовый “Продукт”, а как заготовку под общий filter popover.**
  Сейчас можно реализовать только блок “Продукт”, но сам контейнер лучше сразу назвать и сверстать как **Фильтры**, чтобы потом туда без переделки добавить:
  &nbsp;
  - тариф,
  - статус,
  - owner,
  - и другие поля.
    То есть сейчас внутри только продукт, но архитектурно это уже не временный костыль.
  &nbsp;
3. **После PATCH 1 нужно явно показать bucket “Без стадии” как первый-class state.**
  Раз все 2847 сделок без pipeline_stage_id, колонка Без стадии должна:
  &nbsp;
  - явно отображаться первой,
  - иметь count/sum,
  - быть визуально нормальной колонкой, а не скрытым fallback.
    Это теперь центральный сценарий для default pipeline.
  &nbsp;
4. **Нужно проверить summary strip после фикса query.**
  Сейчас после включения NULL сделок в default pipeline summary может начать считать их некорректно.
  Нужно отдельно зафиксировать:
  &nbsp;
  - totalDeals
  - total active pipeline value
  - won/lost counts
    считаются на том же dataset, что и board, без расхождений.
  &nbsp;
5. **Dialog вместо prompt() должен быть не inline-костылём, а нормальным reusable UI.**
  Нужны:
  &nbsp;
  - glass dialog,
  - input,
  - validation пустого имени,
  - loading state,
  - create/cancel,
  - autofocus.
    И не через window.prompt, не через window.confirm.
  &nbsp;
6. **Product cloud нужно не просто удалить, а убрать весь лишний вертикальный разрыв после toolbar.**
  В DoD добавить визуальный критерий:
  &nbsp;
  - board начинается сразу под compact toolbar,
  - верхняя часть не съедает экран,
  - без большой пустой зоны между управлением и колонками.
  &nbsp;
7. **Нужен proof после фикса, не только описание.**
  В DoD добавить обязательные пруфы:
  &nbsp;
  - сколько сделок показано в default pipeline,
  - сколько в колонке Без стадии,
  - скрин board с реальными карточками,
  - скрин compact toolbar без product cloud,
  - скрин dialog создания pipeline вместо prompt().
  &nbsp;
8. **PATCH 5 “нет backfill” оставить обязательно.**
  Это правильное решение. Массовый апдейт всех сделок сейчас не делать.
  Но надо прямо дописать, что при перемещении конкретной сделки из Без стадии в стадию:
  &nbsp;
  - ей уже назначаются pipeline_id и pipeline_stage_id,
  - после refresh она остаётся в выбранной стадии.
  &nbsp;

&nbsp;

&nbsp;

После этих правок patch можно исполнять как **внутренний fix-патч текущего спринта**, без остановки основного scope.

&nbsp;

План: PATCH-фикс воронки — пустой board + layout + prompt()

## Диагностика — доказано


| Факт                       | Значение                              |
| -------------------------- | ------------------------------------- |
| Всего сделок в `orders_v2` | 2847                                  |
| С `pipeline_id`            | **0**                                 |
| С `pipeline_stage_id`      | **0**                                 |
| Pipeline "Основная"        | создан (id: `e8606cb2...`)            |
| Стадии                     | 4 шт: Новая, В работе, Успешно, Отказ |


**Root cause пустого board**: запрос в `useDealsBoard.ts` строка 50 фильтрует `.eq("pipeline_id", pipelineId)` — все 2847 сделок имеют `pipeline_id = NULL`, поэтому возвращается 0 записей.

**Дополнительные проблемы**:

1. Product chips (строки 818-851 `AdminDeals.tsx`) — огромное облако 20+ кнопок, занимает полэкрана
2. `prompt()` на строке 774 — создание воронки через browser prompt
3. Toolbar раздут: view toggle + pipeline selector + product cloud + period + search — 4-5 рядов

## Изменения

### PATCH 1 — Board query: показывать сделки без pipeline

**Файл**: `src/hooks/useDealsBoard.ts`

Строка 50: изменить `.eq("pipeline_id", pipelineId)` на логику, которая также включает сделки с `pipeline_id IS NULL` когда выбран default pipeline. Конкретно:

- Если выбранный pipeline — `is_default`, то фильтр: `pipeline_id.eq.{pipelineId},pipeline_id.is.null` (через `.or()`)
- Иначе: `.eq("pipeline_id", pipelineId)` как сейчас

Сделки без `pipeline_stage_id` попадают в `__unassigned` колонку (уже реализовано в `groupByStage`).

Передать `isDefault` флаг как параметр в hook.

### PATCH 2 — Убрать product cloud, заменить на компактный dropdown

**Файл**: `src/pages/admin/AdminDeals.tsx`

Строки 818-851: удалить `GlassFilterPanel` с chip-cloud продуктов. Вместо этого добавить компактную кнопку-dropdown «Продукт» прямо в верхний toolbar (рядом с поиском). Внутри dropdown — список продуктов с search, single-select, «Все продукты».

### PATCH 3 — Уплотнить верхний toolbar

**Файл**: `src/pages/admin/AdminDeals.tsx`

Собрать в одну компактную строку:

- View toggle (Список/Воронка)
- Pipeline selector (в board mode)
- Search input
- Product dropdown
- Period selector + export + refresh

Убрать лишние вертикальные отступы между блоками. Цель — board начинается максимально высоко.

### PATCH 4 — Заменить `prompt()` на Dialog

**Файл**: `src/pages/admin/AdminDeals.tsx`

Строка 774: `prompt("Название новой воронки:")` — заменить на glass Dialog с Input + кнопками Создать/Отмена. Добавить state `showCreatePipelineDialog` + `newPipelineName`. Использовать существующий Dialog компонент.

### PATCH 5 — Нет backfill

Массовый backfill (`UPDATE orders_v2 SET pipeline_id = ...`) **не делаем** — по требованию пользователя: сделки остаются с `pipeline_id = NULL`, отображаются в default pipeline через PATCH 1.

## Файлы


| Действие | Файл                                                                              |
| -------- | --------------------------------------------------------------------------------- |
| Edit     | `src/hooks/useDealsBoard.ts` — query с OR для default pipeline                    |
| Edit     | `src/pages/admin/AdminDeals.tsx` — layout, product dropdown, dialog вместо prompt |


## НЕ делаем

- Массовый backfill/mapping сделок
- Новые таблицы/миграции
- Изменения в `pipelineService.ts`
- Новые компоненты (всё inline в существующих файлах)

## DoD

1. Board показывает реальные сделки (2847 в колонке "Без стадии" для default pipeline)
2. Product cloud убран, заменён на компактный dropdown
3. Toolbar в 1-2 строки, board начинается выше
4. `prompt()` заменён на Dialog
5. Totals пересчитываются корректно
6. List-view не сломан