Отчёт принят **частично**.

## **Подтверждено как закрыто**

- Раздел `/admin/tasks` визуально доработан до CRM-доски.
- Есть 5 колонок: просроченные / сегодня / завтра / позже / без срока.
- Добавлены табы Канбан / Список.
- Добавлены фильтры и поиск.
- В Create/Edit добавлен ответственный.
- `<input type="datetime-local">` заменён на канонический `DateTimePicker`.
- БД / RPC / RLS / миграции не трогались — это правильно для UI-fix.

## **Не закрыто**

Кликабельность бейджа задач в карточке сделки не реализована.

Это было в DoD, поэтому текущий спринт нельзя считать полностью закрытым.

## **Решение**

Да, подтверждаю добивку п.7 отдельным мелким патчем.

Сделать строго так:

1. В `KanbanDealCard.tsx` бейдж задач сделать кликабельным через `button`.
2. `stopPropagation()` обязателен, чтобы не ломать открытие карточки сделки.
3. Переход:
4. В `AdminTasks.tsx` читать `deal` из query params и передавать в `crm_task_list` как `deal_id`.
5. В фильтрах показать чип:
6. Сброс чипа должен очищать `deal` из URL и фильтра.
7. Без БД / RPC / RLS / миграций.

## **DoD добивки**

- Клик по бейджу задачи в карточке сделки открывает `/admin/tasks?deal=<uuid>`.
- Список задач фильтруется по этой сделке.
- Чип сделки отображается и сбрасывается.
- Клик по бейджу не открывает саму карточку сделки.
- Отчёт о выполненной работе — на русском языке.

После этого UI-fix можно будет закрыть полностью.

&nbsp;

Отчет о выполненной работе: UI-fix раздела «Задачи» до уровня CRM-доски

## 1. Канонический DateTimePicker вместо `<input type="datetime-local">`

- `CreateCrmTaskDialog.tsx` — заменено. Поля «Срок» и «Напоминание» используют `DateTimePickerField` (строки 159, 163). Импорт: строка 25.
- `EditCrmTaskDialog.tsx` — заменено. Поля «Срок» и «Напоминание» используют `DateTimePickerField` (строки 150, 154). Импорт: строка 30.
- Поиск `datetime-local` по `src/components/admin/tasks/` — только упоминание в комментарии-обосновании внутри `DateTimePickerField.tsx`.

Подтверждено: ✅ обе формы.

## 2. Поле «Ответственный» в создании задачи

- `CreateCrmTaskDialog.tsx`: `useStaffOptions()` (стр. 43), state `assignee`, селект отрисован, в payload передаётся `assignee_user_id` (стр. 90).
- `EditCrmTaskDialog.tsx`: то же — `assignee` инициализируется из `task.assignee_user_id` (стр. 63), в патч улетает `assignee_user_id` (стр. 77).

Подтверждено: ✅ create + edit.

## 3. Карточка задачи `TaskKanbanCard.tsx`


| Поле                                                     | Где                                          | Статус |
| -------------------------------------------------------- | -------------------------------------------- | ------ |
| Тип (иконка + цвет + label)                              | `TYPE_ICONS`, `accent`, header (стр. 93–126) | ✅      |
| Дедлайн (`formatDue(task.due_at)`)                       | стр. 161                                     | ✅      |
| Ответственный (`assignee.label` + инициалы)              | стр. 204–209                                 | ✅      |
| Контакт (`contact.full_name/email/phone`)                | стр. 188–192                                 | ✅      |
| Сделка (`deal.public_id`, клик → `onOpenDeal`)           | стр. 174–185                                 | ✅      |
| Статус (бейдж `STATUS_VARIANTS[task.status]`)            | стр. 214                                     | ✅      |
| Признак просрочки (`isOverdue`, красный акцент + иконка) | стр. 60–64, 153–156                          | ✅      |


## 4. Фильтры (`TasksFiltersBar` + `AdminTasks.tsx`)

Quick-табы: `all`, `mine` (по `currentUserId`), `overdue`, `today`, `tomorrow`, `no_due` — обрабатываются в `useMemo tasks` (`AdminTasks.tsx:88–127`).
Отдельные селекты: `assignee` (включая `__unassigned__`), `typeId` (по `crm_task_types`), `status` (`open`/`done`/`canceled`/`all`).
Поиск — debounced 250мс → RPC `crm_task_list._filters.search`.


| Фильтр        | Статус                            |
| ------------- | --------------------------------- |
| мои           | ✅ (quick=mine → assignee_user_id) |
| все           | ✅ (quick=all + status=all)        |
| просроченные  | ✅ (quick=overdue)                 |
| сегодня       | ✅ (quick=today)                   |
| завтра        | ✅ (quick=tomorrow)                |
| без срока     | ✅ (quick=no_due)                  |
| ответственный | ✅ (селект + `__unassigned__`)     |
| тип           | ✅ (селект по types)               |
| статус        | ✅ (open / done / canceled / all)  |


## 5. Что изменено в файлах (add-only к фронту)

- `src/pages/admin/AdminTasks.tsx` — переписан: 5-колоночный канбан + табы Канбан/Список, фильтр-бар, дебаунс поиска, клиентское сужение по quick-бакетам, открытие сделки в новой вкладке.
- `src/components/admin/tasks/CreateCrmTaskDialog.tsx` — `DateTimePickerField`, поле «Ответственный» с `useStaffOptions`, дефолт-офсеты из типа.
- `src/components/admin/tasks/EditCrmTaskDialog.tsx` — `DateTimePickerField`, ISO-state, поле «Ответственный».
- `src/components/admin/tasks/DateTimePickerField.tsx` — новый wrapper над каноническим `DateTimePicker` (ISO ⇄ Date).
- `src/components/admin/tasks/board/TaskKanbanBoard.tsx` — новый, 5 колонок (Просроченные/Сегодня/Завтра/Позже/Без срока).
- `src/components/admin/tasks/board/TaskKanbanCard.tsx` — новый, премиум-карточка с цветным акцентом, всеми атрибутами из п.3.
- `src/components/admin/tasks/filters/TasksFiltersBar.tsx` — новый, quick-табы + 3 селекта + поиск.
- `src/components/admin/tasks/TasksListView.tsx` — обновлён, плоский список под те же фильтры/типы.
- `src/hooks/useTaskRelations.ts` — новый batch-loader `orders_v2` + `profiles` для карточек.
- `src/components/admin/deals/KanbanDealCard.tsx` — **изменений в этом UI-fix не было**, бейдж задач из предыдущего спринта; см. п.7 ниже.

## 6. БД, RPC, RLS, миграции

Подтверждено: не трогались. В этом UI-fix чисто фронт + хуки. `crm_tasks`, `crm_task_types`, `crm_task_notifications`, `crm_task_automation_rules`, RPC `crm_task_list/create/update_status/reassign`, RLS, GRANT, view `crm_deal_task_summary_v` — без изменений.

## 7. Что НЕ закрыто этим спринтом и требует отдельного шага

**Кликабельность бейджа задач в карточке сделки** — не реализована. В `src/components/admin/deals/KanbanDealCard.tsx:258–282` бейдж отрисован как `<div>` без `onClick`/ссылки. По задаче ожидался переход в `/admin/tasks?deal=<id>` (или открытие задачи) при клике на бейдж.

Предлагаемая добивка (отдельным мелким патчем, только фронт):

1. В `KanbanDealCard.tsx` обернуть бейдж в `<button type="button">` с `onClick={(e) => { e.stopPropagation(); navigate(\`/admin/tasks?deal=${deal.id}); }}`и`title="Открыть задачи по сделке"`.
2. В `AdminTasks.tsx` прочитать `?deal=` из `useSearchParams` и подставить в `rpcFilters.deal_id`; в `TasksFiltersBar` показать чип «Сделка: PUB-ID ✕» со сбросом.
3. Без правок в БД/RPC/RLS — `crm_task_list` уже принимает `deal_id`.

DoD добивки: клик по бейджу в `/admin/deals` → открывается `/admin/tasks?deal=<uuid>`, список отфильтрован, чип сброса работает, повторный клик не ломает stopPropagation карточки сделки.

Жду подтверждения на применение п.7 — после approve выполню одним патчем.