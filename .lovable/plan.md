# да, согласен, с учетом правок:

&nbsp;

1. **Period filter в board и list должен быть единым source of truth через URL.**
  Поддержать в searchParams:
  &nbsp;
  - period_preset
  - date_from
  - date_to
  - вместе с view, pipeline, product, tariffs.
    Нельзя оставлять period только как локальный useState.
  &nbsp;
2. **В board и list должна применяться одинаковая логика default pipeline.**
  Не просто .eq("pipeline_id", pipelineId) для list-view.
  Для Основной нужно сохранить уже принятую логику:
  &nbsp;
  - показывать pipeline_id = activePipelineId
  - **и** pipeline_id IS NULL
    иначе list и board снова будут расходиться.
  &nbsp;
3. **Добавить activePipelineId в list-query не только в buildDealsQuery, но и в RPC-ветку поиска.**
  Если search uses search_deal_rows, а pipeline filter не передаётся туда, то search results будут отличаться от обычного list-view.
  Нужно либо:
  &nbsp;
  - расширить RPC параметром p_pipeline_id и default-pipeline semantics,
  - либо после RPC применять тот же pipeline-filter safely.
  &nbsp;
4. **Date filtering в useDealsBoard делать по тем же полям и границам, что и в list-view.**
  То есть same contract:
  &nbsp;
  - gte(...T00:00:00Z)
  - lte(...T23:59:59Z)
    без второй, “похожей, но другой” логики.
  &nbsp;
5. **Machine-check proof сделать не только для counts, но и для sums.**
  Для сценариев:
  &nbsp;
  - all
  - this week
  - this month
  - last month
  - custom range
    показать:
  - total deals
  - paid deals
  - total sum
    и отдельно list vs board equality.
  &nbsp;
6. **Pipeline selector redesign — ок, но не сломать текущие CRUD и guards.**
  В новом selector UI обязательно сохранить:
  &nbsp;
  - create
  - rename
  - delete
  - delete guard для non-empty / bound pipelines
  - Основная без удаления.
  &nbsp;
7. **Reorder pipelines должен быть idempotent и сохранять active selection.**
  После reorder:
  &nbsp;
  - активная воронка остаётся активной;
  - refresh сохраняет новый порядок;
  - list-view и board-view используют один и тот же порядок.
  &nbsp;
8. **Для reorder pipelines нужен отдельный DoD-proof.**
  Показать:
  &nbsp;
  - изменить порядок;
  - refresh;
  - порядок сохранился;
  - selector в list и board показывает одинаковый порядок.
  &nbsp;
9. **Gorbova Club = 1001 не просто “подтвердить”, а явно вынести в verify как закрытый вопрос.**
  Чтобы больше к нему не возвращаться:
  &nbsp;
  - DB count = pipeline count = filtered all-period count.
  &nbsp;
10. **Обновлённый final DoD:**

&nbsp;

&nbsp;

&nbsp;

- period filter работает в list и board;
- period сохраняется в URL;
- pipeline selector есть в list и board;
- list и board используют одинаковую pipeline semantics, включая Основную + NULL;
- reorder pipelines работает;
- selector визуально переработан;
- machine-check по counts и sums совпадает для list/board на одинаковых фильтрах;
- Gorbova Club = 1001 закрыт как подтверждённый факт.

&nbsp;

&nbsp;

План: Period filter fix + Pipeline selector в list-view + Pipeline management UI

## Диагностика


| Проблема                                  | Root cause                                                                                 | Файл / строка                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Period filter не работает в board-view    | `DealsKanbanBoard` не получает `dateFilter` props; `useDealsBoard` не принимает date range | `AdminDeals.tsx:1159`, `useDealsBoard.ts` |
| Period filter не сохраняется в URL        | `dateFilter` хранится в `useState`, не в `searchParams`                                    | `AdminDeals.tsx:245`                      |
| Pipeline selector отсутствует в list-view | Условие `viewMode === "board" &&` скрывает selector                                        | `AdminDeals.tsx:876`                      |
| List-view не фильтрует по pipeline        | `buildDealsQuery` не принимает `pipelineId`                                                | `AdminDeals.tsx:159`                      |
| Нет reorder pipelines                     | Функционал отсутствует (есть только `reorderStages`)                                       | `pipelineService.ts`                      |
| Pipeline selector визуально бедный        | Стандартный `DropdownMenu` без стилизации                                                  | `AdminDeals.tsx:877-938`                  |


**Gorbova Club = 1001** подтверждено по БД: `paid_gorbova_total = paid_gorbova_in_pipeline = 1001`. Это корректное значение.

## Изменения

### 1. Добавить `dateFilter` в board-view

`**useDealsBoard.ts**`: добавить `dateFrom?: string; dateTo?: string` в `UseDealsBoardOpts`. Применять `.gte("deal_date", ...)` / `.lte("deal_date", ...)` в query builder (аналогично list-view `buildDealsQuery`).

`**DealsKanbanBoard.tsx**`: добавить props `dateFrom`, `dateTo`, прокинуть в `useDealsBoard`.

`**AdminDeals.tsx:1159**`: передать `dateFrom={dateFilter.from}` `dateTo={dateFilter.to}` в `<DealsKanbanBoard>`.

### 2. Сохранить `dateFilter` в URL

`**AdminDeals.tsx**`: убрать `useState<DateFilter>`, вместо этого читать/писать `date_from` и `date_to` из `searchParams` (аналогично `pipeline`, `product`, `tariffs`). Добавить `setDateFilter` через `setSearchParams`.

### 3. Pipeline selector в обоих режимах

`**AdminDeals.tsx:876**`: убрать условие `viewMode === "board" &&`. Показывать pipeline selector всегда, когда `pipelines.length > 0`.

### 4. Фильтрация list-view по pipeline

`**buildDealsQuery**`: добавить параметр `pipelineId`. Если задан — `.eq("pipeline_id", pipelineId)`. Для default pipeline — `.or(pipeline_id.eq.X,pipeline_id.is.null)`.

`**useInfiniteQuery` queryKey**: добавить `activePipelineId`.

### 5. Reorder pipelines

`**pipelineService.ts**`: добавить `reorderPipelines(orderedIds: string[])` — аналогичная логика как `reorderStages` (temporary negative index, then set final).

`**usePipelines.ts**`: добавить `reorderMutation`.

### 6. Pipeline management UI redesign

Заменить текущий `DropdownMenu` на более полноценный `Popover` / dialog-based management panel:

- Список pipelines с drag handles для reorder (используя `@dnd-kit`)
- Inline rename/delete кнопки
- Create внизу
- Active pipeline выделена визуально (accent border/bg)
- Glass/high-end styling: `bg-card/60 backdrop-blur-xl`, gradient accents для active

### 7. Machine-check proof

После реализации — запустить SQL-проверки:

- Count/sum deals в board vs list для одного периода/pipeline/product
- Gorbova Club counts по разным period presets
- Verify URL persistence после refresh

## Изменяемые файлы


| Файл                   | Что                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `useDealsBoard.ts`     | Добавить dateFrom/dateTo фильтрацию                                                                           |
| `DealsKanbanBoard.tsx` | Прокинуть dateFrom/dateTo props                                                                               |
| `AdminDeals.tsx`       | URL-based dateFilter, pipeline selector в обоих режимах, pipeline filter в list query, redesigned selector UI |
| `pipelineService.ts`   | Добавить `reorderPipelines`                                                                                   |
| `usePipelines.ts`      | Добавить reorder mutation                                                                                     |


## DoD

1. Period filter применяется и в list, и в board
2. Period filter сохраняется в URL
3. Pipeline selector виден в обоих режимах
4. List-view фильтрует по pipeline
5. Reorder pipelines работает и сохраняется
6. Pipeline selector визуально переработан
7. Gorbova Club = 1001 подтверждено
8. Machine-check: list и board дают одинаковый dataset на одном периоде
9. Комбинации pipeline + period + product + tariff корректны