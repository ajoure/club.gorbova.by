## да, согласен, с учетом правок:

1. **Не делать копию forms-паттерна “по мотивам”**  
В плане правильно найден канон, но нужно ещё жёстче зафиксировать:  
`LiveEventsTable` должен не просто “быть построен как FormsHubTable”, а **максимально переиспользовать существующие building blocks** без нового локального велосипеда:
  &nbsp;
  &nbsp;
  - `SortableResizableTableHead`
  - `ColumnSettings`
  - `useDragSelect`
  - существующий `ColumnConfig` shape
  - тот же table wrapper / sizing / sticky contract  
  Если можно reuse-нуть куски напрямую, не делать новую альтернативную реализацию внутри `LiveEventsTable`.
2. `useLiveEventsColumns.ts`  
Допустимо как отдельный hook, но только как **тонкая адаптация существующего** `useFormsColumns`**-паттерна**, а не новый независимый column-engine.  
Прямо зафиксируй:
  - тот же формат persisted state;
  - тот же resize/drag contract;
  - тот же cross-tab/custom-event sync;
  - те же guard-правила для hidden/locked колонок, если они уже есть в forms-pattern.
3. **Колонка** `checkbox`  
Нужно явно определить, что это **служебная колонка**, которая:
  - не скрывается в `ColumnSettings`;
  - не перетаскивается в середину таблицы;
  - имеет фиксированную ширину.  
  Иначе пользователь сможет сломать базовый selection UX.
4. **Колонка** `actions`  
То же самое:
  - лучше зафиксировать как служебную;
  - не скрывать по умолчанию;
  - не давать утащить в произвольное место, если это ломает UX.  
  Минимум нужно явно определить policy для `checkbox`, `lifecycle`, `actions`.
5. `selectionResetKey={String(events?.length ?? 0)}`  
Этого недостаточно. Если длина списка не изменилась, но изменился состав строк, selection может зависнуть на несуществующих id.  
Нужен более надёжный reset trigger, например:
  - hash/id signature текущего списка;
  - либо явный clear selection после refetch/delete/filter changes.  
  Это важно для bulk-delete и общего consistency.
6. `RoomStateCell` **/** `ActiveParticipantsCell`  
Хорошо, что логика уже есть, но в плане нужно явно зафиксировать:  
не плодить новые дублирующие inline renderers внутри `LiveEventsTable`; reuse существующие ячейки/VM, чтобы снова не получить новый локальный паттерн.
7. **Provider status / source badge**  
Раз уж переносим в канонический shell, зафиксируй, что provider/source-ячейка тоже должна использовать **единый mapper/helper**, а не inline `if/else` в `renderCell`, иначе останется локальная логика в новой таблице.  
То же касается replay label.
8. **Sticky header**  
Нужно явно проверить, что sticky header в канонической реализации работает **внутри горизонтального scroll wrapper** и не ломается с `width: max-content`.  
Это не всегда бесплатно работает. Добавь это как отдельный DoD/guard.
9. `ColumnSettings`  
Если подключаем канонический ColumnSettings, надо явно зафиксировать:
  - какие колонки пользователь может скрывать;
  - какие нельзя скрывать (`checkbox`, возможно `title`, `actions`);
  - что lifecycle/provider critical columns не должны исчезнуть так, чтобы таблица теряла управляемость.  
  Иначе можно получить technically correct, but bad UX.
10. **Удаление старого самописного блока**  
Правильно, но в плане стоит добавить:
  - удалить именно presentation duplication;
  - не ломать уже подключённые `BulkActionsBar`, `LiveEventDeleteDialog`, delete mutations, lifecycle wiring.  
  Это нужно явно прописать, чтобы подрядчик не “пересобрал всё заново”.
11. **Regression порядок**  
После F-CANON сначала короткий **table/admin smoke**:
  - scroll;
  - sticky;
  - resize;
  - reorder;
  - hide/show columns;
  - select-all;
  - single delete;
  - bulk delete.  
  И только потом общий F1 regression по live-модулю целиком. Иначе финальный regression снова будет смешан с незавершённой админкой.
12. **DoD**  
Добавь в DoD ещё 3 пункта:
  - selection не ломается после delete/refetch/filter changes;
  - `checkbox`/`actions` колонки не выпадают и не ломают UX;
  - новая таблица действительно использует канонический column/table shell, а не просто визуально похожа на него.

&nbsp;

В остальном план правильный: он исправляет главное нарушение — не “косметически улучшает самоделку”, а возвращает `/admin/live-events` в настоящий канонический reusable table-pattern проекта.

&nbsp;

План: PATCH F-CANON — перевод `/admin/live-events` на канонический table-shell

### Discovery — что действительно есть в проекте как канон

Канонический reusable table-pattern в проекте — это связка:

1. `**src/components/admin/table/SortableResizableTableHead.tsx**` — `<SortableResizableTableHead>` + `<ResizableTableHead>` (drag-handle + resize-handle).
2. `**src/components/admin/ColumnSettings.tsx**` — `ColumnConfig { key, label, visible, width, order }` + popover «Колонки» с DnD-перестановкой и toggle visibility.
3. `**useFormsColumns`-паттерн** (`src/hooks/useFormsColumns.ts`) — localStorage persist + `handleColumnResize` + `handleDragEnd` + `sortedColumns` / `visibleColumns` + cross-instance sync через CustomEvent.
4. `**useDragSelect**` (`src/hooks/useDragSelect.tsx`) + `**SelectionBox**` — drag-to-select rectangle, tri-state master checkbox, `selectedIds` Set.
5. `**<Table>` из `@/components/ui/table**` + `<colgroup>` с `tableLayout: fixed` + `width: max-content` для горизонтального scroll-а внутри `overflow-x-auto select-none relative`.
6. `**@dnd-kit/core` + `@dnd-kit/sortable**` с `horizontalListSortingStrategy` для перестановки колонок.
7. `**<BulkActionsBar>**` уже подключён, остаётся.

Эталонный референс: `src/components/admin/forms/FormsHubTable.tsx` + `FormsAllTabContent.tsx` + `useFormsColumns`.

Текущая таблица в `AdminLiveEvents.tsx` (lines 880–1037) — **самописная**: фиксированные `<TableHead className="w-32">`, нет resize, нет DnD-перестановки, нет ColumnSettings, нет drag-select. Это именно та дубликация, которую нужно убрать.

---

### Изменения

**Новые файлы:**

1. `src/hooks/useLiveEventsColumns.ts` — точная копия паттерна `useFormsColumns` для эфиров.
  - `LIVE_EVENTS_DEFAULT_COLUMNS: ColumnConfig[]` — 11 колонок (`checkbox`, `title`, `type`, `room_state`, `provider`, `published`, `scheduled_at`, `participants`, `replay`, `lifecycle`, `actions`).
  - localStorage key `admin_live_events_columns_v1`.
  - Экспорт: `columns`, `setColumns`, `sortedColumns`, `visibleColumns`, `handleColumnResize`, `handleDragEnd`.
2. `src/components/admin/live/LiveEventsTable.tsx` — выделенный canonical table-компонент, построенный 1:1 по `FormsHubTable`:
  - `<DndContext>` + `horizontalListSortingStrategy`.
  - `<SortableContext>` для headers.
  - `<colgroup>` + `tableLayout: fixed` + `width: max-content`.
  - `<ResizableTableHead>` для checkbox-колонки + `<SortableResizableTableHead>` для остальных.
  - tri-state master checkbox через `useDragSelect`.
  - Container `overflow-x-auto select-none relative` + `SelectionBox` overlay.
  - `renderCell(col, event)` switch по `col.key` со всеми существующими ячейками (Тип-badge, `RoomStateCell`, provider-source-status, `ActiveParticipantsCell`, replay-badge, `RoomLifecycleActions layout="admin"`, dropdown-меню Edit/Open/Sync/Delete).
  - Props: `events`, `isLoading`, `onEdit(event)`, `onLifecycleAction(...)`, `onDelete(eventId)`, `onSelectionChange(selectedIds)`, `selectionResetKey`.
  - `TableHeader` — `sticky top-0 z-10 bg-card`.

**Изменяемые файлы:**

3. `src/pages/admin/AdminLiveEvents.tsx` (lines 880–1037):
  - Удалить весь самописный `<Table>` блок.
  - Заменить на:
    ```tsx
    <div className="flex items-center justify-end">
      <ColumnSettings columns={columns} onChange={setColumns} />
    </div>
    <LiveEventsTable
      events={events}
      isLoading={isLoading}
      onEdit={handleEdit}
      onLifecycleAction={handleLifecycleAction}
      onDelete={(id) => setDeleteIds([id])}
      onSelectionChange={setSelectedIds}
      selectionResetKey={String(events?.length ?? 0)}
    />
    ```
  - `selectedIds` state (Set) — оставить в странице, передавать reset-callback.
  - `BulkActionsBar` + `LiveEventDeleteDialog` остаются на странице как есть.

**Удаляется (как нарушение duplication-prevention):**

- `<TableHead className="w-XX">` хардкод-колонки в AdminLiveEvents (строки 887–913).
- Inline `<TableRow>`/`<TableCell>` цикл по events (915–1032) — переезжает в `LiveEventsTable.renderCell`.

**Не трогается:**

- `BulkActionsBar.tsx`, `LiveEventDeleteDialog.tsx`, `RoomLifecycleActions.tsx`, `RoomStateCell`, `ActiveParticipantsCell`, `liveRoomLifecycle.ts`, edge functions `live-events-delete`/`kinescope-api`, миграция CASCADE, lifecycle-actions, single+bulk delete, Kinescope delete-flow.

---

### Сохранение функций Sprint F2–F7 (mapping)


| Функция                  | Где остаётся в canonical layout                                                       |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Single delete            | DropdownMenu `Удалить…` → `onDelete(id)` → `setDeleteIds([id])`                       |
| Bulk delete              | `BulkActionsBar.onBulkDelete` → `setDeleteIds(Array.from(selectedIds))`               |
| Delete dialog (2 режима) | `<LiveEventDeleteDialog>` без изменений                                               |
| Lifecycle actions        | Колонка `lifecycle` → `<RoomLifecycleActions layout="admin">`                         |
| Participant count        | Колонка `participants` → `<ActiveParticipantsCell>`                                   |
| Dropdown actions         | Колонка `actions` → `DropdownMenu` (Edit / Open / Sync Kinescope / Delete)            |
| Selection / select-all   | `useDragSelect` + tri-state header checkbox                                           |
| Sync Kinescope (per-row) | DropdownMenuItem с условием `event_type === 'live_stream' && kinescope_live_event_id` |


---

### DoD

- `/admin/live-events` использует **те же** компоненты, что `FormsHubTable`: `SortableResizableTableHead`, `ResizableTableHead`, `ColumnConfig`, `ColumnSettings`, `useDragSelect`, `SelectionBox`, тот же layout `<colgroup>` + `tableLayout: fixed` + `width: max-content` + `overflow-x-auto`.
- Sticky header работает через `sticky top-0 z-10 bg-card` в `<TableHeader>`.
- Tri-state master checkbox + drag-to-select работают через `useDragSelect` (как в Forms).
- Колонки: можно перетащить, ресайзить, скрыть через `ColumnSettings`; ширины/порядок persist в localStorage `admin_live_events_columns_v1`.
- Горизонтальный scroll работает на 1102px viewport без обрезания.
- Все функции Sprint F2–F7 сохранены и работают через canonical контур.
- Ни одного нового `<Table>`/`<TableHead>` markup в `AdminLiveEvents.tsx` — только `<LiveEventsTable>`.
- Sprint 1+2+3 не сломаны: lifecycle actions, room_state badges, theme, participant count, role badges.

После этого — финальный regression F1 и приёмка F8.