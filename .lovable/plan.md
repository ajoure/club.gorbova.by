# да, согласен, с учетом правок:

&nbsp;

1. **Сохранять фильтры не только в state, но и в URL как source of truth.**
  Прямо зафиксировать:
  &nbsp;
  - product
  - tariffs
  - view
  - pipeline
    должны жить в query params, чтобы:
  - refresh не сбрасывал состояние,
  - list/board делили один filter-state,
  - можно было дать ссылку на конкретный filtered view.
  &nbsp;
2. **Тарифы должны фильтроваться по выбранному продукту, но без поломки сценария “Все продукты”.**
  Нужно явно прописать поведение:
  &nbsp;
  - если продукт не выбран → блок тарифов скрыт или disabled;
  - если выбран продукт → показываются только тарифы этого продукта;
  - если продукт сменился → невалидные тарифы сбрасываются автоматически;
  - если выбран “Все продукты” → тарифный фильтр очищается.
  &nbsp;
3. **Multi-select по тарифам сделать с явными выбранными значениями в UI.**
  Не просто чекбоксы внутри popover, а показать снаружи:
  &nbsp;
  - либо count selected,
  - либо компактные chips/summary вида Тарифы: 2.
    Иначе пользователь не понимает, что фильтр активен.
  &nbsp;
4. **PATCH 2 должен затрагивать не только board query, но и все counts/summaries.**
  Нужно прямо дописать:
  &nbsp;
  - list counters,
  - board summary,
  - totals по колонкам
    считают данные уже с учетом product/tariff filters.
    Иначе цифры сверху и карточки снова разъедутся.
  &nbsp;
5. **Bulk assign для “Без стадии” делать не только “все”, но и безопасно.**
  Минимум:
  &nbsp;
  - confirm step,
  - count затрагиваемых сделок,
  - target stage preview,
  - toast с результатом,
  - audit с количеством и target stage.
    Иначе легко сделать массовое ошибочное назначение.
  &nbsp;
6. **В bulkAssignDealsToStage нужен batched/safe execution, а не один огромный update без guard.**
  Прямо дописать:
  &nbsp;
  - dry-run count,
  - execute,
  - affected rows count,
  - audit meta: deal_ids_count, pipeline_id, stage_id.
    Это особенно важно при сотнях unassigned deals.
  &nbsp;
7. **Summary strip нужно сделать максимально ясным, без двусмысленной “Активной воронки”.**
  Лучше сразу утвердить новый состав:
  &nbsp;
  - Всего
  - Сумма
  - Без стадии
  - В стадиях
  - Успешно
  - Отказ
    Если отдельный показатель “Активная воронка” остаётся, он должен быть вторичным, а не главным.
  &nbsp;
8. **Product binding UI нельзя считать закрытым, но в proof-отчёте нужно явно пометить как deferred.**
  В плане уже написано, что binding UI остаётся follow-up — это правильно.
  Нужно только отдельно зафиксировать в финальном отчёте, что:
  &nbsp;
  - multi-pipeline UI есть,
  - product binding backend/model есть,
  - полноценный binding management UI отложен и не заявляется как завершённый.
  &nbsp;
9. **Remap dialog — не просто заменить сырой select, а привести к стилю платформы и проверить keyboard flow.**
  Нужно:
  &nbsp;
  - glass-styled select/popover,
  - focus state,
  - enter/escape,
  - disabled delete button, пока target stage не выбран.
  &nbsp;
10. **DoD дополнить proof-пунктами.**
  Добавить обязательно:

&nbsp;

&nbsp;

&nbsp;

- скрин/filter popover с продуктом и тарифами;
- скрин active filters state;
- proof, что list-view и board-view показывают одинаковый filtered dataset;
- proof bulk assign из “Без стадии”;
- proof refresh persistence с выбранными product + tariffs + pipeline + view.

&nbsp;

&nbsp;

После этих правок план можно исполнять как финальный patch для закрытия спринта.

&nbsp;

План: ФИНАЛЬНЫЙ PATCH — фильтры, summary, tariff, proofs

## Диагностика текущего состояния


| Элемент                  | Статус                  | Проблема                                                    |
| ------------------------ | ----------------------- | ----------------------------------------------------------- |
| Board query              | ✅ Работает              | Default pipeline показывает NULL сделки                     |
| Product filter           | ⚠️ Отдельный dropdown   | Нужно переместить внутрь filter popover                     |
| Tariff filter            | ❌ Отсутствует           | Нет ни в UI, ни в useDealsBoard                             |
| Summary strip            | ⚠️ Вводит в заблуждение | Не учитывает `__unassigned`, показывает только staged deals |
| Filter popover           | ❌ Не существует         | Нужен единый compact filter рядом с поиском                 |
| Drag & drop              | ✅ Код есть              | Нужен runtime proof                                         |
| Menu move                | ✅ Код есть              | `onMoveTo` в KanbanDealCard работает                        |
| Stage CRUD               | ✅ Код есть              | create/rename/delete/remap — всё реализовано                |
| Multi-pipeline           | ✅ Код есть              | Dialog создания, selector, seed                             |
| Audit                    | ✅ Код есть              | `writeAudit` в pipelineService.ts                           |
| Bulk assign "Без стадии" | ❌ Отсутствует           | Нет UI для массового назначения                             |


## Изменения

### PATCH 1 — Единый Filter Popover вместо отдельного Product dropdown

**Файл**: `src/pages/admin/AdminDeals.tsx`

Заменить текущий `DropdownMenu` для продуктов (строки 873-916) на кнопку **«Фильтры»** с Popover:

- Кнопка `Filter` рядом с поиском (иконка `SlidersHorizontal`)
- При наличии активных фильтров — badge с count
- Внутри Popover:
  - **Продукт**: single-select с поиском, "Все продукты"
  - **Тариф**: multi-select, зависимый от выбранного продукта
  - Кнопка "Сбросить фильтры"
- Состояние фильтров сохраняется при переключении list/board через URL params (`product`, `tariffs`)

### PATCH 2 — Добавить фильтр тарифов

**Файл**: `src/pages/admin/AdminDeals.tsx`

- Добавить state `selectedTariffIds: string[]`
- Fetch тарифов: query `tariffs` filtered by `product_id` когда выбран продукт
- При смене продукта — сбрасывать невалидные тарифы
- Передать `tariffIds` в `useDealsBoard` и в list-view query (`buildDealsQuery`)

**Файл**: `src/hooks/useDealsBoard.ts`

- Добавить `tariffIds?: string[]` в `UseDealsBoardOpts`
- Добавить фильтр `.in("tariff_id", tariffIds)` в query когда массив непустой
- Добавить в queryKey

**Файл**: `src/pages/admin/AdminDeals.tsx` (list query)

- Добавить tariff filter в `buildDealsQuery`

### PATCH 3 — Исправить Summary Strip

**Файл**: `src/components/admin/deals/KanbanSummaryStrip.tsx`

- Переделать props: `totalDeals`, `totalSum`, `unassignedCount`, `assignedCount`, `wonCount`, `wonSum`, `lostCount`
- Показать: «Всего сделок: N», «Сумма: X», «Без стадии: N», «Успешно: N (X)», «Отказ: N»

**Файл**: `src/components/admin/deals/DealsKanbanBoard.tsx`

- Пересчитать summary включая `__unassigned` deals
- `totalActive` = сумма всех open stages + unassigned

### PATCH 4 — Bulk assign для колонки "Без стадии"

**Файл**: `src/components/admin/deals/KanbanColumn.tsx`

- Для `stageId === "__unassigned"` добавить кнопку "Назначить все в стадию" в header
- По клику — dropdown с выбором целевой стадии
- Вызов bulk update через pipelineService

**Файл**: `src/services/pipelineService.ts`

- Добавить `bulkAssignDealsToStage(dealIds: string[], pipelineId: string, stageId: string)`
- Audit log: `deal.bulk_stage_assigned`

### PATCH 5 — Мелкие UX-правки

- В `KanbanColumnHeader.tsx` строка 169: заменить `<select>` на styled Select/RadioGroup в remap dialog
- Убедиться, что filter popover не ломает layout

## Файлы


| Действие | Файл                                                                        |
| -------- | --------------------------------------------------------------------------- |
| Edit     | `src/pages/admin/AdminDeals.tsx` — filter popover, tariff state, URL params |
| Edit     | `src/hooks/useDealsBoard.ts` — tariffIds filter                             |
| Edit     | `src/components/admin/deals/DealsKanbanBoard.tsx` — summary fix             |
| Edit     | `src/components/admin/deals/KanbanSummaryStrip.tsx` — новые метрики         |
| Edit     | `src/components/admin/deals/KanbanColumn.tsx` — bulk assign для unassigned  |
| Edit     | `src/components/admin/deals/KanbanColumnHeader.tsx` — styled select в remap |
| Edit     | `src/services/pipelineService.ts` — bulkAssignDealsToStage                  |


## Что НЕ делаем

- Новые таблицы / миграции
- Изменения в pipeline/stage CRUD логике
- Product binding UI (остаётся в follow-up)
- Автоматическое назначение сделок в воронки

## DoD

1. Единый filter popover рядом с поиском (продукт + тариф)
2. Multi-select тарифов, зависимый от продукта
3. Фильтры работают одинаково в list и board view
4. Summary strip показывает корректные данные включая unassigned
5. Bulk assign "Без стадии" → стадия работает
6. Нет отдельного product dropdown вне filter popover
7. Remap dialog использует styled компонент вместо `<select>`
8. Состояние фильтров сохраняется при переключении view и refresh