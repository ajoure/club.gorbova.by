## да, согласен, с учетом правок:

1. **Фильтрацию не делать только на клиенте, если данные пагинируются.**  
Если `crm_tasks_list` возвращает не все задачи, фильтры должны уходить в RPC через `CrmTaskListFilters`. Клиентская фильтрация допустима только для уже загруженных map’ов/лейблов, но не как основной SoT фильтрации.
2. **Ответственный должен быть полноценным полем в Create и Edit.**  
Можно оставить вариант «Не назначен», но поле должно быть явно видно и доступно при создании и редактировании задачи.
3. **Канонический** `DateTimePicker` **— обязательный gate.**  
В отчёте отдельно указать, что `<input type="datetime-local">` полностью убран из `CreateCrmTaskDialog` и `EditCrmTaskDialog`.
4. **Не добавлять новые RPC/DDL под контакт/сделку.**  
Если существующего combobox/search-хука нет, временно использовать уже существующий источник данных, но без создания новых SQL/RPC в этом UI-fix.
5. **Бейджи на сделках не должны ломать карточку сделки.**  
Только довести существующий `DealTaskSummary`-рендер. Без переписывания `KanbanDealCard` и без изменения логики канбана сделок.

После этих правок можно запускать.

&nbsp;

План: UI-fix раздела «Задачи» до уровня CRM-доски

Только UI/UX-доработка существующего раздела `/admin/tasks`. БД, RPC, RLS, роуты — не трогаем. Канонические компоненты переиспользуем.

### 0. DIAGNOSE (фиксируем перед правками, попадёт в отчёт)

- Канбан сделок: `src/components/admin/deals/` — `DealsKanbanBoard.tsx`, `KanbanColumn.tsx`, `KanbanColumnHeader.tsx`, `KanbanDealCard.tsx`, `DealsFiltersBar.tsx`, `KanbanSummaryStrip.tsx`. Цветовая палитра — `src/lib/stagePalette.ts` (`STAGE_PALETTE`, `getCardAccentColor`).
- Канонический календарь: `src/components/ui/datetime-picker.tsx` (используется в `IndividualDetailsForm`, `BulkExtendAccessDialog`, `AdvancedFilters`, `BroadcastsTabContent` и др.). Текущая форма задач использует `<input type="datetime-local">` — заменим.
- Выбор сотрудника: `useStaffOptions` уже используется в `EditCrmTaskDialog`; в `CreateCrmTaskDialog` поле «Ответственный» отсутствует — добавим.
- Бейджи задач на сделках: `KanbanDealCard.tsx` уже принимает `DealTaskSummary` (есть `useDealTaskSummary` и view `crm_deal_task_summary_v`) — нужно проверить отрисовку и довести до DoD.
- Сделки/контакты в задаче: используем существующие селекторы (`useDealsBoard`/поиск сделок, `useContactSearch` если есть; иначе — `Combobox` поверх RPC, без новых таблиц).

### 1. Канбан задач (`src/pages/admin/AdminTasks.tsx` + новые компоненты в `src/components/admin/tasks/board/`)

- Колонки в порядке: **Просроченные → На сегодня → На завтра → Позже → Без срока** (колонку «На этой неделе» убираем; «Закрытые» — отдельная сворачиваемая секция под доской).
- Новый `TaskKanbanBoard.tsx` по образцу `DealsKanbanBoard.tsx`: горизонтальный скролл, фикс-ширина колонок.
- `TaskKanbanColumn.tsx` + `TaskKanbanColumnHeader.tsx` — цветная верхняя полоса (палитра: overdue=red, today=amber, tomorrow=blue, later=slate, no_due=muted), счётчик задач, пустое состояние.
- Drag-and-drop между колонками **не вводим** в этом UI-fix (меняет due_at-семантику, выходит за рамки). Перенос — через действие в карточке/диалоге.

### 2. Карточка задачи (`TaskKanbanCard.tsx`)

Визуально в стиле `KanbanDealCard`:

- Левый цветной акцент по типу задачи (`crm_task_types.color`).
- Иконка типа + label типа (бейдж).
- Заголовок задачи (truncate, 2 строки).
- Описание (1 строка, muted).
- Строка метаданных: дедлайн (с `AlertTriangle` при overdue), напоминание (если задано).
- Связи: бейдж сделки (`public_id` сделки) и бейдж контакта (имя), кликабельные → открыть `DealDetailSheet`/`ContactDetailSheet`.
- Аватар + имя ответственного (если есть; иначе «Не назначен»).
- Статус-бейдж (`open`/`in_progress`/`done`/`canceled`).
- Клик по карточке → открыть `EditCrmTaskDialog` как drawer-подобный диалог.

### 3. Форма создания/редактирования (расширяем `CreateCrmTaskDialog` и сверяем `EditCrmTaskDialog`)

Поля в обеих формах (единый layout):

- Тип задачи, Название, Описание.
- **Ответственный** (`useStaffOptions`, с возможностью «Не назначен» — оставляем разрешённым).
- **Дедлайн** и **Напомнить** — заменить `<input type="datetime-local">` на канонический `DateTimePicker` из `src/components/ui/datetime-picker.tsx`.
- **Контакт** — Combobox с поиском (по существующему хук-поиску контактов; если такого нет — лёгкий wrapper над RPC `search_*`/`profiles` уже используемым в проекте, без новых RPC).
- **Сделка** — Combobox с поиском по `orders_v2` (используем уже существующие хуки, например из `useDealsBoard`/`useDealSearch`, либо переиспользуем то, что применяется в Email/Broadcasts).
- Статус (в Edit), Результат/комментарий при закрытии.

### 4. Фильтры и поиск (верхняя панель `AdminTasks`)

Заменить текущий минимальный фильтр-бар на компонент `TasksFiltersBar.tsx` в духе `DealsFiltersBar`:

- Быстрые табы: **Мои · Все · Просроченные · Сегодня · Завтра · Без срока**.
- Popover-фильтры: Ответственный, Тип задачи, Статус, Воронка, Сделка, Контакт.
- Поиск (debounced) по: названию, описанию, `public_id` задачи, имени/email/телефону клиента, `public_id` сделки. Фильтрация на клиенте поверх результатов `crm_task_list` (RPC уже отдаёт `search`); связи клиент/сделка резолвим уже подгруженными map'ами.

### 5. Режим «Список»

Оставить вкладку «Список», переоформить таблицу в духе CRM (Card-обёртка, hover, плотные строки):
Колонки: Дата исполнения · Ответственный (аватар+имя) · Тип (иконка+бейдж) · Текст задачи · Контакт · Сделка · Воронка/стадия · Статус · Действия (Готово/Изменить/Открыть).

### 6. Связь со сделками (бейджи задач на канбане сделок)

- Проверить и довести `KanbanDealCard` рендер `DealTaskSummary`: открытые/просроченные, ближайший дедлайн, иконка ближайшего типа.
- Клик по бейджу — открывает `DealDetailSheet` на секции «Задачи» (через query-параметр `?tab=tasks` или scroll-to).

### 7. Add-only гарантии

- Не трогаем: RPC, `crm_task_*` таблицы, RLS, роут `/admin/tasks`, раздел сделок (кроме мелкого UI-рендера бейджей задач в существующем `KanbanDealCard`).
- Все новые компоненты — в `src/components/admin/tasks/board/` и `src/components/admin/tasks/filters/`.
- Тип `CrmTaskListFilters` уже поддерживает нужные поля (`assignee_user_id`, `task_type_id[]`, `status[]`, `deal_id`, `contact_id`, `bucket`, `search`).

### 8. DoD

- Канбан задач с 5 колонками, цветными хедерами, счётчиками, пустыми состояниями.
- Карточки задач красивые, с типом/дедлайном/ответственным/связями; клик открывает редактор.
- Создание/редактирование задачи включает ответственного и канонический `DateTimePicker`.
- Фильтры и поиск работают по перечисленным полям.
- Бейджи задач видны в карточках сделок и кликабельны.
- Список — аккуратный CRM-стиль.
- Отчёт о выполнении на русском с блоком DIAGNOSE.

### Технические детали

Новые файлы:

- `src/components/admin/tasks/board/TaskKanbanBoard.tsx`
- `src/components/admin/tasks/board/TaskKanbanColumn.tsx`
- `src/components/admin/tasks/board/TaskKanbanColumnHeader.tsx`
- `src/components/admin/tasks/board/TaskKanbanCard.tsx`
- `src/components/admin/tasks/filters/TasksFiltersBar.tsx`
- `src/components/admin/tasks/TasksListView.tsx` (вынос таблицы из `AdminTasks.tsx`)

Правки:

- `src/pages/admin/AdminTasks.tsx` — собрать новый layout (фильтры + Tabs Канбан/Список).
- `src/components/admin/tasks/CreateCrmTaskDialog.tsx` — добавить поля ответственного, контакта, сделки; заменить datepicker.
- `src/components/admin/tasks/EditCrmTaskDialog.tsx` — заменить datepicker; синхронизировать layout с Create.
- `src/components/admin/deals/KanbanDealCard.tsx` — проверить/довести рендер бейджей задач + клик-навигация в `DealDetailSheet` на таб задач.

Никаких миграций, RPC и изменений RLS.