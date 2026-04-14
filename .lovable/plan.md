# да, согласен, с учетом правок:

&nbsp;

1. PipelineManagementPopover делать не только красивым, но и **единым selector/pipeline-manager** для обоих режимов:
  &nbsp;
  - Список
  - Воронка
    Один и тот же компонент, один и тот же порядок, один и тот же active pipeline state.
  &nbsp;
2. В SortablePipelineItem нужно явно зафиксировать **жёсткие delete-guards в UI**:
  &nbsp;
  - Основная — без delete action вообще;
  - pipeline с сделками — delete disabled;
  - pipeline с crm_pipeline_product_bindings — delete disabled;
  - не просто полагаться на service error, а визуально блокировать действие заранее.
  &nbsp;
3. Reorder pipelines должен быть **идемпотентным и безопасным**:
  &nbsp;
  - после drag reorder active pipeline не должна сбрасываться;
  - после refresh порядок должен совпадать;
  - selector в Список и Воронка должен показывать одинаковый порядок;
  - если reorder не изменил фактический порядок, mutation не вызывать.
  &nbsp;
4. В новом UI сделать **явное разделение типов воронок**:
  &nbsp;
  - Основная
  - product-pipelines
    Без визуального мусора, но с понятной иерархией.
    Минимум:
  - default badge у Основной;
  - active pipeline accent;
  - product pipelines ниже/рядом в одном читаемом списке.
  &nbsp;
5. Для reorder нужен **machine-proof**, а не только визуальный скрин:
  &nbsp;
  - изменить порядок 2–3 воронок;
  - refresh;
  - показать, что order_index реально изменился и UI его сохраняет.
  &nbsp;
6. В PipelineManagementPopover добавить **keyboard-safe UX**:
  &nbsp;
  - Escape закрывает popover;
  - Enter работает в rename dialog как submit;
  - focus не теряется при drag/reorder;
  - click outside закрывает popover корректно.
  &nbsp;
7. Rename/Delete dialogs оставить как есть — это правильно, но в plan нужно явно указать:
  &nbsp;
  - popover только открывает callbacks;
  - CRUD-proof по rename/delete обязателен после интеграции нового selector UI.
  &nbsp;
8. Trigger button стилизовать богаче, но без потери читаемости:
  &nbsp;
  - активная pipeline должна читаться сразу;
  - long names не должны ломать layout;
  - Бухгалтерия как бизнес, Подоходный налог с физлиц и т.п. должны влезать нормально или аккуратно truncation с tooltip.
  &nbsp;
9. В DoD добавить ещё два пункта:
  &nbsp;
  - reorder pipelines работает и в Список, и в Воронка;
  - rename/delete/create/reorder собраны в один полноценный pipeline management UI без деградации текущих filters/period/pipeline state.
  &nbsp;
10. Финальный proof по этому patch должен включать:

&nbsp;

&nbsp;

&nbsp;

- новый selector UI;
- active pipeline highlight;
- drag handle;
- reorder до/после refresh;
- rename;
- delete guard;
- create pipeline;
- одинаковый selector в list-view и board-view.

&nbsp;

&nbsp;

План: Pipeline Management UI — redesign selector + reorder

## Диагностика

Текущий selector (AdminDeals.tsx строки 912-974) — стандартный `DropdownMenu` с плоским списком `DropdownMenuItem`. Inline rename/delete кнопки уже есть, но визуал бедный. `reorderPipelines` в `usePipelines` и `pipelineService` уже существует — backend готов, но UI для drag-reorder отсутствует.

## Решение

Заменить `DropdownMenu` на `Popover` с кастомным содержимым: glass-стилизованная панель с `@dnd-kit` sortable list для reorder и inline CRUD.

## Изменения

### 1. Новый компонент `PipelineManagementPopover.tsx`

Отдельный компонент `src/components/admin/deals/PipelineManagementPopover.tsx`:

- **Popover** вместо DropdownMenu — полный контроль над содержимым
- **Glass styling**: `bg-card/60 backdrop-blur-xl border-border/30 shadow-2xl rounded-2xl`
- **DndContext + SortableContext** с `verticalListSortingStrategy` для reorder
- Каждая pipeline — `useSortable` item с:
  - `GripVertical` drag handle слева
  - Название pipeline
  - Badge `default` для Основной
  - Inline кнопки rename / delete (hover-visible), кроме Основной (только rename)
  - Active pipeline: accent border-left + `bg-primary/10` background
- **Create button** внизу: `+ Создать воронку`
- **onDragEnd**: `arrayMove` + вызов `reorderPipelines(orderedIds)`
- **Guards при delete**: проверка через `deletePipeline` в service (уже бросает ошибку для непустых)

Props:

```
pipelines, activePipelineId, onSelect, onRename, onDelete, onCreate, onReorder, canEdit
```

### 2. Sortable pipeline item

Внутренний компонент `SortablePipelineItem` (внутри того же файла):

- `useSortable` от `@dnd-kit/sortable`
- `CSS.Transform.toString(transform)` для drag animation
- Визуал:
  - Active: `border-l-2 border-primary bg-primary/8`
  - Default: `hover:bg-muted/40`
  - Drag: `shadow-lg bg-card/80 backdrop-blur-xl`
  - GripVertical: `h-3.5 w-3.5 text-muted-foreground/50 cursor-grab`
  - Pipeline name: `text-sm font-medium`
  - Action buttons: `opacity-0 group-hover:opacity-100`

### 3. Trigger button стилизация

Trigger (в AdminDeals.tsx):

- `bg-card/40 backdrop-blur-md border-border/30 hover:bg-card/60`
- Активная pipeline показана с subtle accent dot
- `rounded-xl` вместо стандартного `rounded-md`

### 4. AdminDeals.tsx — интеграция

- Удалить текущий `DropdownMenu` selector (строки 912-974)
- Заменить на `<PipelineManagementPopover>`
- Передать `reorderPipelines` из `usePipelines` hook
- Rename/Delete dialogs оставить как есть (уже работают)

### 5. Rename / Delete dialogs

Оставить существующие `Dialog` (rename) и `AlertDialog` (delete) в AdminDeals.tsx — они уже работают. `PipelineManagementPopover` только вызывает `onRename(pipeline)` / `onDelete(pipeline)` callbacks.

## Изменяемые файлы


| Файл                                                       | Что                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/components/admin/deals/PipelineManagementPopover.tsx` | Новый компонент — glass popover с dnd-kit reorder                              |
| `src/pages/admin/AdminDeals.tsx`                           | Заменить DropdownMenu на PipelineManagementPopover, прокинуть reorderPipelines |


## DoD

1. Selector визуально переработан — glass/high-end
2. Active pipeline сразу читается (accent)
3. Drag handle виден, reorder мышью работает
4. Порядок сохраняется в БД, после refresh тот же
5. Selector одинаков в list и board
6. Create/rename/delete/reorder в одном UI
7. Guard: Основную нельзя удалить, непустую нельзя удалить