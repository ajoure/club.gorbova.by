

# План: PATCH LIVE-EVENTS-TABLE-RESET — каноническая шапка таблицы /admin/live-events

## 1. Diagnose (зафиксировано)

На скриншоте `/admin/live-events` заголовки колонок наезжают друг на друга:
- «Комната» накладывается на «Источник»
- «Опубликован» накладывается на «Дата»
- «Активные» накладывается на «Запись»

При этом ячейки тела отрисованы корректно и в правильном порядке. Значит, данные/рендер cell — ок, ломается шапка.

Корневая причина: устаревший snapshot колонок в `localStorage` под ключом `admin_live_events_columns_v1`. После добавления новых колонок (`room_state`, `provider`, `participants`, `replay`) в `LIVE_EVENTS_DEFAULT_COLUMNS` старая запись содержит:
- частично отсутствующие/повторяющиеся `order`,
- `width` от прежней схемы,
- порядок ключей, конфликтующий с новыми defaults.

`loadColumns()` в `useLiveEventsColumns.ts` мерджит сохранённые поля поверх defaults без нормализации `order`. В результате `SortableContext` (dnd-kit) получает массив с дублирующимися/смешанными `order`, transform-ы для соседних `<th>` накладываются — визуально шапка «слипается».

Тело таблицы рендерится напрямую через `style={{ width: col.width }}` без dnd-transform, поэтому строки выглядят правильно — отсюда расхождение шапки и тела.

`root_cause = stale_localstorage_columns_snapshot_v1`.

## 2. Бизнес-правило

Каноническая таблица `/admin/live-events` должна:
1. Рендериться с дефолтными ширинами и порядком, заданными в `LIVE_EVENTS_DEFAULT_COLUMNS`.
2. Шапка и тело строго синхронизированы по числу/порядку/ширине колонок.
3. Любая ломаная/устаревшая запись в `localStorage` не должна ломать рендер — fallback на defaults.

## 3. Изменения

### A. `src/hooks/useLiveEventsColumns.ts`
- Bump `STORAGE_KEY` с `admin_live_events_columns_v1` → `admin_live_events_columns_v2`. Старый кеш игнорируется автоматически, пользователи получают чистые defaults.
- В `loadColumns()` добавить нормализацию:
  - если у сохранённой колонки `order` отсутствует или не число → брать `order` из defaults;
  - если `width` отсутствует/≤ 0/не число → брать `width` из defaults;
  - убедиться, что итоговый массив содержит ровно те ключи, что в defaults (без дублей и без посторонних), и `order` уникален (повторно проиндексировать после сортировки).
- (Опционально) добавить «cleanup»: при первом запуске v2 удалить ключ v1 из `localStorage`.

### B. Никаких других правок
- `LiveEventsTable.tsx` не трогаем — он канонический.
- `SortableResizableTableHead` не трогаем.
- `LIVE_EVENTS_DEFAULT_COLUMNS` остаются как есть (значения уже корректные: 40/280/110/140/140/110/160/90/100/200/60).

## 4. Файлы

| Файл | Изменение |
|---|---|
| `src/hooks/useLiveEventsColumns.ts` | bump storage key до v2 + нормализация `order`/`width` в `loadColumns`, чистка v1 |

## 5. Не трогаем

- схему таблиц БД, RLS, edge functions;
- `LiveEventsTable.tsx`, `SortableResizableTableHead.tsx`, `ColumnSettings.tsx`;
- любую логику lifecycle/Kinescope/replay;
- другие admin-таблицы и их storage-ключи.

## 6. Verify

1. После деплоя зайти на `/admin/live-events`, **localStorage очищать вручную не нужно** — v2 ключ создаётся пустым.
2. Шапка отрисовывается без наложений: колонки «Название · Тип · Комната · Источник · Опубликован · Дата · Активные · Запись · Lifecycle · ⋯» расположены подряд, заголовки не пересекаются.
3. Каждая ячейка тела находится строго под своим заголовком.
4. Drag-reorder и resize работают; после reload порядок/ширина сохраняются под ключом v2.
5. Скрытие/показ колонок через `ColumnSettings` работает; locked-колонки (`checkbox`, `actions`) недоступны для скрытия.

## 7. STOP-guards

- Не менять структуру `ColumnConfig` и контракт `useFormsColumns`-подобных хуков.
- Не трогать другие таблицы (`/admin/contacts`, `/admin/forms`, `/admin/payments/links`) — у них свои storage-ключи.
- Если после v2 проблема воспроизводится — это значит дефект в `SortableResizableTableHead`, тогда отдельный патч.

## 8. DoD

1. Шапка `/admin/live-events` рендерится без наложений на свежем сеансе и при наличии старого `v1` кеша.
2. Storage-ключ переключён на `admin_live_events_columns_v2`, старый `v1` удаляется при первом запуске.
3. `loadColumns` устойчив к мусору в localStorage (нормализация `order`/`width`).
4. Resize/reorder/visibility работают, изменения сохраняются.
5. Скриншот mobile 440×798 + desktop с корректной шапкой приложен.

