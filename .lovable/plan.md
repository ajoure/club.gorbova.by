да, согласен, с учетом правок:

&nbsp;

1. Delete оставляем в scope только через переиспользование существующего list-view delete flow.  
Не делать второй отдельный способ удаления для kanban.  
Нужно именно:  

  - вынести текущий inline delete flow в shared hook/service,
  - и list-view, и kanban должны использовать один и тот же путь удаления.
2. &nbsp;
3. Delete в kanban показывать только admin / super_admin.  
Не просто “можно удалить”, а:  

  - bulk delete action виден только администратору;
  - для остальных пользователей action скрыт полностью, а не просто disabled.
4. &nbsp;
5. Bulk mode должен работать в пределах текущего board dataset.  
То есть в рамках уже применённых:  

  - pipeline,
  - period,
  - product,
  - tariffs,
  - search.  
  Формулировать как “выбрать всё в текущем filtered scope текущей воронки”, а не “вообще всё”.
6. &nbsp;
7. Select-all нужно разделить на два уровня и явно показать это в UI:  

  - select all в конкретной стадии;
  - select all в текущем filtered scope всей текущей воронки.  
  Это разные действия, и их надо оставить раздельными.
8. &nbsp;
9. В bulk mode клик по карточке не должен открывать deal.  
Это нужно прямо зафиксировать в DoD:  

  - click по карточке = toggle selection,
  - detail sheet не открывается,
  - drag отключён,
  - Escape снимает выделение.
10. &nbsp;
11. Старую кнопку “Назначить все” пока правильно оставить.  
Убирать её только после proof, что новый bulk flow реально работает стабильно.
12. В KanbanBulkActionsBar для bulk move нужен confirm/preview.  
Перед массовым перемещением показывать:  

  - сколько сделок выбрано,
  - в какую стадию будут перенесены,
  - текущую pipeline.  
  После execute:
  - toast,
  - reset selection,
  - invalidate queries.
13. &nbsp;
14. В delete confirm dialog нужно явно показать, что это реальное удаление.  
Минимум:  

  - count selected deals,
  - текущая pipeline,
  - сколько стадий затронуто, если можно быстро посчитать,
  - текст “это реальное удаление, не архив”.
15. &nbsp;
16. useDealsBulkDelete должен инвалидировать и board, и list, и связанные счётчики.  
Не только:  

  - admin-deals
  - admin-deals-tab-counts
  - deals-board  
  но и всё, что влияет на selector / summary / counts, если такие query уже есть.
17. &nbsp;
18. В KanbanColumnHeader для checkbox нужен indeterminate state и точный count.  
Нужно явно передавать:

&nbsp;

&nbsp;

&nbsp;

- selectedCount
- totalInStage  
и показывать partial selection корректно.

&nbsp;

&nbsp;

&nbsp;

11. Export в bulk mode должен работать по selected ids, а не по всему board.  
Это важно явно зафиксировать.
12. Обновлённый DoD лучше закрепить так:

&nbsp;

&nbsp;

&nbsp;

- можно выделять сделки чекбоксами в kanban;
- select-all в header стадии работает;
- select-all в текущем filtered scope работает;
- floating bulk bar появляется при выделении;
- bulk move работает;
- bulk export работает;
- bulk delete работает;
- delete виден только admin / super_admin;
- delete использует тот же shared flow, что и list-view;
- click по карточке в bulk mode = toggle selection;
- drag отключён в bulk mode;
- Escape снимает выделение;
- invalidate/reset selection после delete/move корректны;
- старая кнопка “Назначить все” пока остаётся.

&nbsp;

&nbsp;

В таком виде план можно отдавать в работу.

&nbsp;

# План: Массовые операции в Kanban (bulk select + move + delete + export)

## Диагностика

**Существующий delete flow** (AdminDeals.tsx строки 657-819): сложная мутация ~160 строк, которая:

- Отменяет GetCourse
- Удаляет subscriptions_v2, installment_schedules
- Отзывает TG-доступ (с проверкой других активных сделок)
- Удаляет access_grant_ledger, entitlements, payments_v2, orders_v2
- Отправляет уведомления
- Инвалидирует `admin-deals` и `admin-deals-tab-counts`

**Permissions**: `usePermissions` уже имеет `isAdmin()` и `isSuperAdmin()`.

**Kanban board** (DealsKanbanBoard.tsx): получает deals через `useDealsBoard`, стадии через `usePipelineStages`. Фильтры (pipeline, search, product, tariff, dateFrom, dateTo) уже прокидываются из AdminDeals.

**List-view bulk**: использует `useDragSelect` + `BulkActionsBar` + inline `useMutation` для delete. Delete mutation **не вынесена** в reusable hook — живёт inline в AdminDeals.tsx.

## Решение

### Шаг 1. Вынести delete mutation в reusable hook

Новый файл `src/hooks/useDealsBulkDelete.ts`:

- Извлечь существующий `deleteMutation` из AdminDeals.tsx (строки 657-819) в отдельный `useBulkDeleteDeals()` hook
- Hook возвращает `{ mutate, mutateAsync, isPending }`
- Инвалидирует: `admin-deals`, `admin-deals-tab-counts`, `deals-board`
- И list-view, и kanban используют один и тот же hook

### Шаг 2. Bulk selection state в DealsKanbanBoard

В `DealsKanbanBoard.tsx` добавить:

- `selectedDealIds: Set<string>` — state выделения
- `bulkMode` = `selectedDealIds.size > 0`
- В bulk mode: drag через `DndContext` отключается (sensors пустые)
- Escape → `selectedDealIds.clear()`
- Прокидывать `isSelected`, `onToggleSelect`, `bulkMode` в `KanbanColumn` → `KanbanDealCard`

### Шаг 3. KanbanDealCard — checkbox + selection

- При `bulkMode=true`: click по карточке = toggle selection (не open deal)
- Checkbox появляется слева от контента (overlay или вместо drag handle)
- `isSelected` → visual accent: `ring-2 ring-primary/40 bg-primary/5`
- При `bulkMode=false`: всё как раньше (drag + click = open)

### Шаг 4. KanbanColumnHeader — select-all checkbox

- Добавить props: `onSelectAll`, `onDeselectAll`, `selectedCount`, `totalInStage`
- Checkbox в header: unchecked / indeterminate / checked
- Click toggles all deals в этой стадии

### Шаг 5. KanbanBulkActionsBar — floating bar

Новый компонент `src/components/admin/deals/KanbanBulkActionsBar.tsx`:

- Glass styling, fixed bottom, animate-in
- Счётчик: «Выбрано: N сделок»
- **Переместить** — dropdown со стадиями текущей воронки → `bulkAssignDealsToStage`
- **Удалить** — только если `isAdmin()` → открывает confirm dialog с:
  - количество сделок
  - текущая воронка
  - текст «реальное удаление, не архив»
  → вызывает `useBulkDeleteDeals`
- **Экспорт** — CSV/Excel через `exportToExcel`/`exportToCSV`
- **Выбрать все** — все deals в текущем filtered scope
- **Снять выделение** (X)

### Шаг 6. AdminDeals.tsx — подключить shared hook

- Заменить inline `deleteMutation` на `useBulkDeleteDeals()`
- Всё остальное (BulkActionsBar, dialogs) продолжает работать как раньше

### Шаг 7. KanbanColumn — прокинуть selection props

- Прокинуть `selectedDealIds`, `onToggleSelect`, `bulkMode` вниз
- Старую кнопку «Назначить все» в колонке оставить пока — убрать после подтверждения работы bulk mode

## Изменяемые файлы


| Файл                                                  | Что                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `src/hooks/useDealsBulkDelete.ts`                     | **Новый** — reusable delete hook, извлечённый из AdminDeals |
| `src/components/admin/deals/KanbanBulkActionsBar.tsx` | **Новый** — floating bulk actions bar для kanban            |
| `src/components/admin/deals/DealsKanbanBoard.tsx`     | Selection state, bulk mode, disable drag, Escape            |
| `src/components/admin/deals/KanbanDealCard.tsx`       | Checkbox, click=toggle, visual selected state               |
| `src/components/admin/deals/KanbanColumnHeader.tsx`   | Select-all checkbox в header стадии                         |
| `src/components/admin/deals/KanbanColumn.tsx`         | Прокинуть selection props                                   |
| `src/pages/admin/AdminDeals.tsx`                      | Заменить inline delete на shared hook                       |


## DoD

1. Можно выделять сделки checkbox-ом в kanban
2. Select-all в header стадии работает (unchecked / indeterminate / checked)
3. Select-all в текущем filtered scope работает
4. Массовое перемещение через floating bar работает
5. Массовое удаление работает (реальный delete, не архив)
6. Delete доступен только admin / super_admin
7. Delete confirm dialog показывает количество, воронку, предупреждение
8. Delete использует тот же flow что и list-view (shared hook)
9. Массовый экспорт выбранных работает
10. Drag отключён в bulk mode
11. Click по карточке в bulk mode = toggle selection
12. Escape снимает выделение
13. Query invalidation после delete/move корректная
14. Старая кнопка «Назначить все» пока остаётся