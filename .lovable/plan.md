да, согласен, с учетом правок:

1. **Добавить обязательный блок языка для Lovable**
  &nbsp;
  В начало плана добавить:
  План должен быть составлен на русском языке.  
  Отчет о выполненной работе должен быть составлен на русском языке.  
  Вся переписка, пояснения, diff-summary, proof и результаты должны быть только на русском языке.
2. **Явно зафиксировать UI-only scope**
  &nbsp;
  Добавить в начало:
  Это UI-only patch. Не создаём новые таблицы, RPC, edge-functions, миграции, RLS-политики, document generation pipeline, token registry, новые сущности реквизитов или новые бизнес-правила. Меняется только презентационный слой двух существующих таблиц реквизитов.
  Это соответствует принципам add-only, переиспользования существующих решений и запрету на параллельные механизмы.  
3. **Перед созданием новых хуков добавить read-only discovery**
  &nbsp;
  Добавить обязательный шаг:
  - проверить фактические API `useFormsColumns.ts`, `useLiveEventsColumns.ts`;
  - проверить тип `ColumnConfig`, если он уже общий;
  - проверить, есть ли общий reusable hook/pattern, чтобы не копировать логику полностью;
  - проверить, какие props реально принимает `ColumnSettings`;
  - проверить, какие props реально принимает `SortableResizableTableHead`;
  - проверить, есть ли уже общий `ResizableTableHead`;
  - проверить, как `FormsHubTable` реализует `colgroup`, `SortableContext`, `DndContext`, `sensors`, `closestCenter`.
4. **Не плодить дублирующую column-hook логику без необходимости**
  &nbsp;
  Сейчас план предлагает два новых хука по образцу существующих. Это допустимо, но нужно добавить:
  Если в проекте уже есть общий helper/hook для column settings, использовать его. Если его нет — новые хуки допускаются, но структура должна быть максимально идентична существующему канону и без отдельной альтернативной реализации DnD/resize/localStorage.
5. **Уточнить типы колонок и служебные признаки**
  &nbsp;
  В новых хуках добавить явные признаки:
  - `draggable: false` для `actions`;
  - `resizable: false` для `actions`;
  - `hideable: false` для `actions`;
  - минимальная ширина для каждой колонки, если такой параметр поддерживается каноническим типом;
  - `actions` всегда последняя и всегда видимая.
6. **Правку** `ColumnSettings.tsx` **сделать не через hardcode одного нового ключа, а через общий признак**
  &nbsp;
  Вместо расширения:
  ```ts
  column.key === "checkbox" || column.key === "actions"
  ```
  лучше:
  ```ts
  if (column.hideable === false || column.key === "checkbox") return null;
  ```
  Если текущий тип колонок не поддерживает `hideable`, допустим временный вариант с `actions`, но тогда добавить комментарий/TODO на унификацию. Иначе при следующей служебной колонке снова появится локальный hardcode.
7. **DnD должен учитывать только draggable-колонки**
  &nbsp;
  Добавить:
  - `SortableContext.items` должен получать только колонки, которые можно таскать;
  - `actions` не должна попадать в DnD items;
  - при `handleDragEnd` нельзя позволять перенести `actions` в середину;
  - после любого reorder `actions` остаётся последней.
8. **ColumnSettings не должен позволять скрыть все рабочие колонки**
  &nbsp;
  Добавить guard:
  - минимум одна неслужебная колонка должна оставаться видимой;
  - `actions` не считается рабочей колонкой для этого guard.
9. **LocalStorage migration/fallback**
  &nbsp;
  Добавить:
  - если в `localStorage` лежит битый JSON — сброс к default;
  - если после будущих изменений появился новый column key — он должен добавиться из default;
  - если старый key исчез — он игнорируется;
  - reset возвращает полный default порядок/ширины/видимость.
10. **Cross-instance sync указать как обязательный**

Раз в контексте указан канон с `window` event, добавить в DoD:

- изменение колонок в одной вкладке/инстансе обновляет вторую таблицу того же типа после события синхронизации;
- `entities` и `persons` используют разные storage keys и не конфликтуют.

11. **Мобильный horizontal scroll не должен ломать DnD/resize**

Добавить:

- на мобильной ширине DnD заголовков либо работает корректно внутри горизонтального скролла, либо не мешает скроллу;
- resize-handle не перекрывает сортировку/клик;
- таблица не растягивает всю страницу, скролл только внутри `.table-scroll-x`.

12. **Сохранить клики по строке и action-кнопки**

В план добавить:

- action-кнопки в строке должны иметь `e.stopPropagation()`;
- клик по `Открыть`, `Архив`, `Обновить` не должен дополнительно срабатывать как клик по строке;
- row click продолжает открывать sheet как раньше.

13. **Для** `PersonsTableView` **добавить колонку действий, если она есть сейчас**

В плане для физлиц перечислены только:

- `name`
- `document`
- `phone`
- `email`
- `status`

Нужно проверить текущий UI. Если сейчас у физлиц есть действия в строке, должна быть колонка `actions` по тем же правилам, иначе можно потерять кнопки. Если действий нет и всё открывается только кликом по строке — оставить без `actions`, но явно подтвердить в discovery.

14. **Сохранить текущие пустые/ошибочные состояния**

Добавить:

- loading-state не меняется;
- error-state не меняется;
- empty-state не меняется;
- skeleton/loader, если есть, сохраняется.

15. **Добавить STOP-guards**

Включить:

- STOP, если для внедрения канонической таблицы требуется менять `useAiEntities` / `useAiPersons`;
- STOP, если потребуется менять структуру данных `client_legal_details` / `legal_details_persons`;
- STOP, если `ColumnSettings` окажется несовместимым без изменения существующих таблиц `/admin/forms`, `/admin/payments`, `/admin/contacts`, `/admin/live-events`;
- STOP, если resize/DnD требует изменения глобальных table-компонентов с риском регрессии;
- STOP, если правка затрагивает БД, RLS, RPC, edge-functions.

16. **DoD дополнить regression-проверкой существующих канонических таблиц**

После изменения `ColumnSettings.tsx` обязательно проверить:

- `/admin/forms` — колонки открываются, DnD/visibility/reset работают;
- `/admin/payments → автопродления` — не сломались колонки;
- `/admin/contacts` — если использует этот компонент, не сломалась настройка колонок;
- `/admin/live-events` — не сломалась настройка колонок.

17. **Verify дополнить конкретными viewport**

Добавить:

- desktop 1440px;
- tablet 768px;
- mobile 390px / 414px / 480px;
- на mobile нет горизонтального скролла всей страницы, только скролл внутри таблицы.

18. **Финальный отчет должен содержать diff-summary и proof**

Добавить в DoD отчета:

- список измененных файлов;
- подтверждение, что БД/RLS/RPC/edge-functions не изменялись;
- localStorage keys;
- скрины `/document-generation` для ЮЛ/ИП и Физлиц;
- скрины `/admin/documents` для ЮЛ/ИП и Физлиц;
- regression proof по `ColumnSettings` в уже существующих таблицах.

В остальном план корректный: он переиспользует существующий UI-канон, не меняет бизнес-логику и не создает новый домен данных.

&nbsp;

План: каноническая таблица реквизитов (ЮЛ/ИП и Физлица)

## Контекст

Сейчас в `/document-generation` → «Реквизиты» две собственные таблицы:

- `src/components/ai-requisites/EntityTableView.tsx` — Юрлица / ИП
- `src/components/ai-requisites/PersonsTableView.tsx` — Физлица

Они используют обычный `<Table>` без DnD-колонок, без resize, без настройки видимости. В остальном проекте уже есть каноническая реализация (используется в `/admin/forms`, `/admin/payments` → автопродления, `/admin/contacts`, `/admin/live-events`):

- `src/components/admin/ColumnSettings.tsx` — popover «Колонки» с DnD-списком и toggle видимости
- `src/components/admin/table/SortableResizableTableHead.tsx` — заголовки с горизонтальным DnD и ручкой ресайза
- `src/hooks/useFormsColumns.ts` / `useLiveEventsColumns.ts` — паттерн хука: `columns / sortedColumns / visibleColumns / handleColumnResize / handleDragEnd` + `localStorage` + cross-instance sync через `window` event
- `src/components/admin/forms/FormsHubTable.tsx` — эталонная сборка (colgroup, `SortableContext` + `horizontalListSortingStrategy`, рендер ячеек по `col.key`)

Задача — переиспользовать ровно этот канон для двух таблиц реквизитов, **ничего не меняя в бизнес-логике, хуках данных, диалогах редактирования, фильтрах, поиске, архиве, bulk-обновлении реестра, RLS и БД**.

## Что меняется (только UI/презентация)

### 1. Новый хук колонок ЮЛ/ИП

Файл: `src/hooks/useEntitiesColumns.ts` (новый)

- По образцу `useFormsColumns.ts`: `ENTITIES_DEFAULT_COLUMNS`, `STORAGE_KEY = "ai_entities_columns_v1"`, `SYNC_EVENT`.
- Колонки по умолчанию (порядок и ширины — те же, что сейчас):
  - `name` — «Название», 320
  - `type` — «Тип», 80 (бейдж ЮЛ/ИП)
  - `unp` — «УНП», 140 (моно)
  - `status` — «Статус», 120 (Активный / Архив)
  - `actions` — «Действия», 160 (Открыть + Архив, не таскается/не ресайзится — как `checkbox` в Forms)
- Возвращает `columns / sortedColumns / visibleColumns / handleColumnResize / handleDragEnd` + `setColumns` для сброса.

### 2. Новый хук колонок Физлиц

Файл: `src/hooks/usePersonsColumns.ts` (новый)

- `STORAGE_KEY = "ai_persons_columns_v1"`.
- Колонки:
  - `name` — «ФИО», 280
  - `document` — «Документ», 200 (моно)
  - `phone` — «Телефон», 160
  - `email` — «Email», 220
  - `status` — «Статус», 120

### 3. EntityTableView → каноническая разметка

Файл: `src/components/ai-requisites/EntityTableView.tsx` (редактируется)

- Сохраняем целиком: пропсы, поиск, пилюли-фильтры, диалог bulk dry-run, RBAC-кнопка «Обновить реестр», empty-state, счётчик «Показано N из M», логику клика по строке и архива.
- В шапке рядом с «Обновить реестр»/«Добавить» добавляется `<ColumnSettings columns onChange onReset>`.
- Тело таблицы переписывается на паттерн `FormsHubTable`:
  - `<div className="table-scroll-x ..."><DndContext><Table style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>`
  - `<colgroup>` по `visibleColumns`
  - заголовки: `SortableResizableTableHead` для всех колонок, кроме `actions` → `ResizableTableHead` без DnD
  - ячейки рендерятся в `renderCell(col, entity)` по `col.key`, используются те же `getEntityShortName / getEntityTypeBadge / getEntityUnp` и те же бейджи статусов
- Никаких изменений в `useAiEntities`, `EntityRecordSheet`, бизнес-правилах архивации.

### 4. PersonsTableView → каноническая разметка

Файл: `src/components/ai-requisites/PersonsTableView.tsx` (редактируется)

- Аналогично: сохраняем поиск, пилюли, empty-state, счётчик, клик-открытие; добавляем `ColumnSettings`, DnD-заголовки и ресайз через `usePersonsColumns`.
- Ячейки используют существующие `getPersonDisplayName / getPersonDocumentSummary`.

### 5. Мобильная безопасность

- Контейнер таблицы получает `table-scroll-x` (уже используется в проекте) → горизонтальный скролл на узких экранах без поломок.
- Тулбар (поиск + пилюли + «Колонки» + «Добавить») остаётся `flex-wrap`, как сейчас.

## Технические детали

- Колонка `actions` исключается из DnD/видимости (по аналогии с `checkbox` в Forms): `SortableItem` уже умеет это через ключ; используем тот же приём — фильтруем `key === "actions"` в `ColumnSettings` (минимальная правка ниже).
- Минимальная правка в `src/components/admin/ColumnSettings.tsx`: расширить условие `if (column.key === "checkbox") return null;` до `if (column.key === "checkbox" || column.key === "actions") return null;`. Это не ломает существующие таблицы (там нет колонки `actions`).
- Никаких миграций БД, edge functions, RPC, RLS, типов из `supabase/types` не трогаем.
- Никаких изменений в `AiPageContent`, `DocumentGeneration.tsx`, `AdminDocuments.tsx`, sidebar, роутинге.

## Файлы

Новые:

- `src/hooks/useEntitiesColumns.ts`
- `src/hooks/usePersonsColumns.ts`

Редактируются:

- `src/components/ai-requisites/EntityTableView.tsx` — только разметка таблицы и шапки
- `src/components/ai-requisites/PersonsTableView.tsx` — только разметка таблицы и шапки
- `src/components/admin/ColumnSettings.tsx` — добавить `actions` в список служебных ключей

## DoD

- В `/document-generation` (user) и `/admin/documents` (admin) на обеих вкладках реквизитов:
  - Виден тулбар-кнопка «Колонки» (popover с DnD + чекбоксами + «Сброс»), визуально идентичная `/admin/forms` и `/admin/payments → автопродления`.
  - Колонки можно перетаскивать в шапке (горизонтальный DnD) и ресайзить за правую границу.
  - Состояние сохраняется в `localStorage` (`ai_entities_columns_v1`, `ai_persons_columns_v1`) и переживает перезагрузку.
  - На мобильной ширине (≤480 px) таблица скроллится горизонтально, тулбар переносится по строкам.
- Поиск, фильтры-пилюли, открытие записи кликом, архивация, bulk-обновление реестра, empty-state, счётчик «Показано N из M» работают как раньше.
- Никаких изменений в данных, edge functions, RLS, типах БД.