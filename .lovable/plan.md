# да, согласен, с учетом правок:

&nbsp;

1. **Не подключать PreregistrationsTabContent к новому table parity-патчу.**
  Для нового домена /admin/forms canonical list-view уже должен быть только через FormsHubTable + useFormsHubData.
  Старый PreregistrationsTabContent не трогать, не тянуть в новый UI как второй источник табличной логики.
2. **ColumnSettings не в FormsHubFilters.tsx, а на уровне tab-content/header, как в контактах.**
  Фильтры должны остаться фильтрами.
  Настройки колонок должны жить в том же UX-месте, что и в /admin/contacts, без смешивания двух разных control-zones.
3. **useColumnsState вводить только если он реально 1:1 повторяет текущий persistence contract контактов.**
  Если есть риск сломать /admin/contacts, то в этом PATCH допустимо:
  &nbsp;
  - вынести только header components,
  - а columns state/persistence оставить как есть в contacts,
  - для forms использовать тот же формат state и тот же storage contract, но без рефактора contacts глубже необходимого.
  &nbsp;
4. **FormsHubTable должен поддерживать 2 режима явно и без дублирования логики:**
  &nbsp;
  - full — с drag/resize/ColumnSettings/select
  - embedded — без toolbar/column controls, но на том же row/cell standard
    Нельзя делать вторую упрощённую таблицу рядом.
  &nbsp;
5. **В embedded-режиме для вкладки По продуктам не делать drag/resize внутри каждой группы.**
  Там нужен reuse visual row-standard, но без повторения полного column-management UI в каждой секции.
6. **Selection state должен быть локален только для текущей таблицы/вкладки и сбрасываться предсказуемо при смене tab/data-source.**
  Нельзя допустить, чтобы выделение из “Все” протекало в “Обучение” или “Анкеты сайта”.
7. **Нужен отдельный guard для mixed-source строк.**
  Составной row key использовать строго в формате:
  &nbsp;
  - ${source_type}:${id}
    и этот же ключ использовать для selection, drag-select, checkbox state и row identity.
  &nbsp;
8. **Не трогать sorting/data-layer PATCH 1 в этом PATCH.**
  UI parity-патч не должен менять:
  &nbsp;
  - useFormsHubData
  - серверные фильтры
  - пагинацию
  - exportMode
  - detail routing
    Только подключение нового table shell поверх уже принятого data layer.
  &nbsp;
9. **Zero-regression для /admin/contacts сделать обязательным блоком DoD, а не просто пожеланием.**
  Отдельно подтвердить:
  &nbsp;
  - drag columns,
  - resize,
  - show/hide,
  - selection,
  - localStorage restore
    именно на /admin/contacts после extract.
  &nbsp;
10. **В proof обязательно показать parity не только визуально, но и по interaction-наборам.**
  Для /admin/forms нужны пруфы:
  &nbsp;
  - drag column
  - resize column
  - hide/show column
  - select all
  - multi-select
  - row click → detail
    отдельно на Все и минимум ещё на одном single-source tab.
  &nbsp;
11. **BulkActionsBar — только оболочка, без новых действий.**
  В этом PATCH не добавлять никаких bulk-delete, bulk-export, bulk-link и т.д.
12. **Если extract shared headers из AdminContacts.tsx требует изменения большого количества кода, дробить на 2 безопасных подпатча:**
  &nbsp;
  - PATCH 2A: extract shared header primitives + zero-regression contacts
  - PATCH 2B: forms parity wiring
    Это лучше, чем рискованный “большой взрыв”.
  &nbsp;

&nbsp;

&nbsp;

Копируемый блок для [lovable.dev](http://lovable.dev):

```
Дополни план следующими правками:

1. Не подключать `PreregistrationsTabContent` к новому table parity-патчу. В новом `/admin/forms` canonical list-view должен быть только через `FormsHubTable` + `useFormsHubData`. Старый prereg component не использовать как второй list-engine.
2. `ColumnSettings` размещать не внутри `FormsHubFilters.tsx`, а в том же UX-паттерне/зоне, что и в `/admin/contacts`.
3. `useColumnsState` вводить только если он 1:1 сохраняет текущий persistence contract contacts. Если есть риск регрессии, в этом PATCH допустимо ограничиться extract shared header primitives без глубокого рефактора contacts state.
4. `FormsHubTable` должен иметь 2 режима:
   - `full` — drag/resize/ColumnSettings/select
   - `embedded` — тот же row/cell standard без toolbar/column controls
   Никакой второй параллельной таблицы.
5. Для вкладки `По продуктам` в `embedded`-режиме не включать drag/resize внутри каждой группы. Нужен reuse row-standard, но без полного column-management UI в каждой секции.
6. Selection state должен быть локален текущей таблице/вкладке и не протекать между `Все`, `Анкеты сайта`, `Предзаписи`, `Обучение`.
7. Row identity везде строго `${source_type}:${id}` — один и тот же ключ для selection / drag-select / row identity.
8. PATCH 2 не должен менять PATCH 1 data-layer: `useFormsHubData`, server filters, pagination, exportMode, redirects, detail routing — не трогать.
9. Zero-regression `/admin/contacts` сделать обязательным DoD-блоком с proof:
   - drag columns
   - resize
   - show/hide
   - selection
   - localStorage restore
10. В финальном proof для `/admin/forms` показать не только визуальную parity, но и interaction parity:
   - drag column
   - resize column
   - hide/show column
   - select all
   - multi-select
   - row click -> detail
   минимум на `Все` и ещё на одном single-source tab.
11. `BulkActionsBar` в этом PATCH только count + clear. Никаких новых bulk-операций.
12. Если extract shared headers из `AdminContacts.tsx` получается слишком рискованным/большим, разделить на:
   - PATCH 2A: extract shared header primitives + proof zero-regression contacts
   - PATCH 2B: wiring этих primitives в `/admin/forms`
```

План в целом сильный. Эти правки нужны, чтобы не получить второй параллельный табличный слой и не сломать контакты.

&nbsp;

План: PATCH 2 — UI Parity `/admin/forms` ↔ `/admin/contacts`

## Диагностика

**Текущее состояние:**

- `/admin/contacts` использует Table из `@/components/ui/table` с локально определёнными `SortableResizableTableHead` (drag+resize via `@dnd-kit`) + `ColumnSettings` (show/hide/reorder) + `useDragSelect` (multi-select+drag-select+select all) + localStorage persistence порядка/ширин.
- `/admin/forms` сейчас использует упрощённый `FormsHubTable.tsx` без drag/resize/select/colsettings, с фиксированными `<TableHead className="w-[180px]">`.
- **Ключевой блокер:** `SortableResizableTableHead` и `ResizableTableHead` определены **локально внутри** `AdminContacts.tsx` (строки 199-290), не вынесены в shared. Это нужно extract в shared layer (add-only, без переписывания контактов).

**Группировка By-Product уже соответствует** approved pattern из `ContactArtifactsTab` (`border-l-4 border-l-indigo-300` + `Layers` icon + `Collapsible`). Менять не надо.

## Шаги

### 1. Extract shared table primitives (add-only)

Создать `src/components/admin/table/SortableResizableTableHead.tsx`:

- Перенести логику из `AdminContacts.tsx` (строки 199-290) в shared компонент
- Экспортировать `SortableResizableTableHead`, `ResizableTableHead` 
- В `AdminContacts.tsx` заменить локальные определения на импорт (zero behavior change)

Создать `src/hooks/useColumnsState.ts`:

- Reusable hook для localStorage persistence колонок
- Сигнатура: `useColumnsState(storageKey: string, defaults: ColumnConfig[])`
- Возвращает: `{ columns, setColumns, handleResize, handleDragEnd, sortedColumns }`
- В `AdminContacts.tsx` опционально мигрировать на этот хук в этом же PATCH (минимально, без рисков)

### 2. Переписать `FormsHubTable.tsx` на canonical table pattern

Использовать тот же набор импортов, что в `AdminContacts.tsx`:

- `Table/TableHeader/TableBody/TableRow/TableCell/TableHead` из `@/components/ui/table`
- `DndContext`, `SortableContext`, `horizontalListSortingStrategy` из `@dnd-kit`
- Новые shared `SortableResizableTableHead` / `ResizableTableHead`
- `ColumnSettings` из `@/components/admin/ColumnSettings`
- `useDragSelect` + `SelectionBox` + `BulkActionsBar`
- `useColumnsState` с ключом `admin_forms_columns_v1`

**Колонки (DEFAULT_COLUMNS для forms):**

```
checkbox      | 40
client        | 200  (Имя)
email         | 220
phone         | 140
type          | 100  (Тип: Анкета / Предзапись / Обучение)
product       | 200  (Продукт)
source        | 180  (Источник: source_entity)
status        | 110
created_at    | 110  (Дата)
has_deal      | 60   (Сделка)
has_account   | 60   (Аккаунт)
```

### 3. Multi-select + select all

Подключить `useDragSelect` с `getItemId: row => \`${row.source_type}-${row.id}`. Чекбоксы в первой колонке + master-чекбокс в header.` BulkActionsBar`пока показывает только`count` + clear (никаких bulk-операций в этом PATCH — scope guard).

### 4. Row click → detail (стабильно)

В `<TableRow onClick={() => onOpenDetail(row)} className="cursor-pointer">`. Чекбокс-cell с `onClick={e => e.stopPropagation()}`. Никакой отдельной кнопки `ExternalLink`.

### 5. FormsByProductTabContent — оставить группировку

Единственное изменение: внутри `<CollapsibleContent>` вызывать обновлённый `FormsHubTable` с `compact` режимом (без header drag/resize, без ColumnSettings — только rows в стиле основной таблицы). Добавить пропс `variant: "full" | "embedded"` в `FormsHubTable`.

### 6. Wiring в Tab Contents

`FormsAllTabContent`, `FormsSiteTabContent`, `FormsTrainingTabContent`, `PreregistrationsTabContent` — все используют тот же обновлённый `FormsHubTable` с одинаковыми DEFAULT_COLUMNS. ColumnSettings рендерится рядом с фильтрами (как в контактах).

### 7. Detail viewers — НЕ трогать

`FormsDetailOpener.tsx` уже маршрутизирует:

- training → `StudentProgressModal` (через `loadTrainingDetailContext`)
- preorder → existing `PreregistrationDetailSheet`
- site_form → existing form detail dialog

Не менять.

## Файлы


| Файл                                                           | Действие                                              |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| `src/components/admin/table/SortableResizableTableHead.tsx`    | NEW: extract из AdminContacts                         |
| `src/hooks/useColumnsState.ts`                                 | NEW: reusable localStorage hook                       |
| `src/pages/admin/AdminContacts.tsx`                            | Минимальная замена локальных def на импорты из shared |
| `src/components/admin/forms/FormsHubTable.tsx`                 | Полный rewrite на canonical pattern                   |
| `src/components/admin/forms/FormsHubFilters.tsx`               | Добавить ColumnSettings рядом с фильтрами             |
| `src/components/admin/forms/FormsAllTabContent.tsx`            | Wiring columns state                                  |
| `src/components/admin/forms/FormsSiteTabContent.tsx`           | Wiring columns state                                  |
| `src/components/admin/forms/FormsTrainingTabContent.tsx`       | Wiring columns state                                  |
| `src/components/admin/forms/FormsByProductTabContent.tsx`      | Передавать `variant="embedded"`                       |
| `src/components/admin/payments/PreregistrationsTabContent.tsx` | Wiring columns state (если использует тот же стиль)   |


## Scope guard

- НЕ создавать новый table engine — только extract существующего
- НЕ переписывать `/admin/contacts` поведение (только заменить локальные определения на импорты)
- НЕ трогать data-layer PATCH 1: `useFormsHubData`, серверные фильтры, пагинация, `exportMode`, redirects
- НЕ дублировать detail viewers
- BulkActionsBar пока без bulk-операций (отдельный PATCH)

## DoD

1. Shared `SortableResizableTableHead` существует и используется и в contacts, и в forms
2. `/admin/forms` поддерживает: drag&drop колонок, resize колонок, show/hide колонок, multi-select чекбоксами, select all
3. Порядок и ширины колонок сохраняются в localStorage (`admin_forms_columns_v1`)
4. Row click стабильно открывает detail (без двойных handlers)
5. Detail viewers не изменены: training=StudentProgressModal, preorder=existing sheet, site_form=existing dialog
6. Вкладки `Все / Анкеты сайта / Предзаписи / Обучение` визуально соответствуют `/admin/contacts`
7. Вкладка `По продуктам` сохраняет grouped/collapsible паттерн (`border-l-4 border-l-indigo-300` + `Layers`)
8. По каждому source проверка прохождения: site_form, preorder, training (filters/sorting/details/export)
9. PATCH 1 не сломан: filters/pagination/export/redirects работают как раньше
10. `/admin/contacts` ведёт себя идентично (zero regression от extract'а)