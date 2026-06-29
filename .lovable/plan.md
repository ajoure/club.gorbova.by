## да, согласен, с учетом правок:

## **1. План нельзя запускать как один патч**

Это уже не “визуальный polish”. В плане смешаны:

- UI-redesign карточек;
- изменение UX статусов;
- рефактор платежных picker-dialogs;
- новые bulk RPC;
- новая статистика;
- массовые действия;
- сквозной поиск;
- изменения карточки контакта.

Разбить на **4 независимых патча**, иначе высокий риск регрессии.

## **2. Обязательная разбивка**

### **PATCH A — UI polish без backend**

Входит:

- premium glass-карточка;
- диалоги Create/Edit;
- убрать TASK-ID из UI;
- статусные кнопки в footer;
- обязательный комментарий для `done/canceled`;
- аватар/инициалы ответственного;
- TG-пометка только если поле уже доступно.

**Запрещено в PATCH A:**

- миграции;
- новые RPC;
- рефактор платежей;
- статистика;
- bulk actions.

### **PATCH B — shared pickers без изменения поведения платежей**

Входит:

- вынести `DealPickerDialog`;
- вынести `ContactPickerDialog`;
- платежные `LinkDealDialog` / `LinkContactDialog` оставить тонкими wrapper’ами.

Обязательно:

- regression check платежей;
- старый write-path reconciliation не менять;
- никаких изменений логики `payment_reconcile_queue` / `payments_v2`.

### **PATCH C — список + bulk actions**

Входит:

- канонический список задач;
- чекбоксы;
- batch actions;
- новые RPC:
  - `crm_task_bulk_update`;
  - `crm_task_bulk_status`.

Обязательно:

- atomic update;
- whitelist полей;
- проверка workspace/RLS/role;
- audit в `crm_activity_log`;
- запрет bulk-update чужого workspace;
- частичный failure должен быть невозможен либо возвращать понятный per-row result.

### **PATCH D — статистика + сквозной поиск**

Входит:

- `TasksStaffStatsPanel`;
- RPC `crm_task_stats_by_assignee`;
- автокомплит задачи + контакты.

Это не должно блокировать PATCH A–C.

## **3. Добавить обязательный языковой блок**

В план вставить:

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.
```

## **4. Добавить DIAGNOSE перед каждым патчем**

Перед PATCH A:

- где ещё показывается `task.public_id`;
- какие CSS/Theme-паттерны уже используются в CRM;
- есть ли TG-статус в `useStaffOptions`;
- где используется `result_comment`;
- как сейчас работает `crm_task_update_status`.

Перед PATCH B:

- как сейчас работают `LinkDealDialog` и `LinkContactDialog`;
- какие props/write-path у платежей;
- какие данные реально нужны задачам;
- нет ли уже shared picker-компонентов.

Перед PATCH C:

- текущий контракт `crm_task_update_status`;
- текущий `useUpdateCrmTask`;
- RLS на `crm_tasks`;
- структура `crm_activity_log`;
- допустимые поля bulk patch.

Перед PATCH D:

- какой endpoint поиска контактов уже есть;
- можно ли переиспользовать `crm_task_list`;
- какие статусы нужны для статистики;
- как считать SLA.

## **5. Исправить термин**

В заголовке:

```text
Premium glass-карточка (kanban + диалоги)
```

Не `canban`.

## **6. TG-пометка “нет TG” — только если есть источник**

Добавить ограничение:

```text
Пометку «нет TG» показывать только если существующий staff/contact hook уже возвращает признак Telegram-привязки. Если такого поля нет — не добавлять новый backend contract в этом патче, вынести в follow-up.
```

Иначе это скрыто расширяет backend.



## **7. Статус “Сохранить” не должен принудительно ставить**

`open`

Сейчас в плане:

«Сохранить» (status=open, без смены статуса)

Это противоречие. Если задача уже `in_progress`, простое сохранение не должно возвращать её в `open`.

Исправить:

```text
«Сохранить» сохраняет поля без изменения текущего статуса.
```



## **8. Комментарий для**

`done/canceled`

Нужно уточнить:

- если задача уже `done/canceled`, повторное сохранение не должно снова требовать комментарий;
- комментарий обязателен только при переходе в `done` или `canceled`;
- bulk `done/canceled` требует общий комментарий.

## **9. Shared pickers — без “создать ghost” в этом патче**

Режим `ContactPickerDialog: Создать ghost` — это отдельный риск, потому что создаёт/меняет сущности контактов.

Для текущего патча оставить:

```text
ContactPickerDialog: только поиск и выбор существующего контакта.
Создание ghost-контакта — отдельный follow-up после отдельного плана.
```

## **10. Сортировка списка**

Client-side сортировка допустима только если загружен весь набор задач. Если есть пагинация / лимит RPC, сортировка должна быть серверной или явно помечена как сортировка текущей страницы.

Добавить:

```text
Если crm_task_list возвращает пагинированные данные, сортировка по всем колонкам должна передаваться в RPC или считаться сортировкой текущей страницы с явной пометкой.
```

## **11. Bulk RPC — нужен строгий контракт**

Добавить в backend-раздел:

```text
crm_task_bulk_update:
- принимает только whitelist полей;
- запрещает изменение source, automation_rule_id, workspace_id, created_by, created_at, closed_at напрямую;
- для каждого task_id проверяет доступ через workspace + роль;
- возвращает count updated + список skipped/failed, либо выполняется атомарно all-or-nothing.

crm_task_bulk_status:
- разрешает только in_progress/done/canceled/open;
- done/canceled требуют result_comment;
- done/canceled ставят closed_at/closed_by;
- open/in_progress очищают closed_at/closed_by только если это явно разрешено правилами.
```

## **12. Статистика по сотруднику — не писать “история комментариев из meta-аудита”, если её нет**

Фраза:

последние 5 из meta-аудита, если пишем

Опасная и мутная. Либо есть audit source, либо нет.

Исправить:

```text
В текущем патче показывать только текущий result_comment. Историю комментариев не делать, если нет канонической таблицы/лога комментариев.
```

## **13. Не менять глобальную тему**

В glassmorphism добавить ограничение:

```text
Не менять глобальный Tailwind theme, shadcn theme, CSS variables и общую палитру проекта. Все стили локальны для задач.
```

## **14. Добавить anti-regression DoD**

Добавить:

```text
Anti-regression:
- платежные LinkDeal/LinkContact сценарии работают как до рефактора;
- карточка сделки открывается как раньше;
- клик по бейджу задач не ломает stopPropagation;
- существующее создание/редактирование задач работает;
- существующие фильтры задач не сломаны;
- DateTimePicker остался канонический;
- TASK-ID скрыт только в UI, но не удалён из БД/типов.
```

## **15. Добавить технические проверки**

В DoD добавить:

```text
- tsgo --noEmit PASS;
- поиск по проекту подтверждает отсутствие TASK-XXXXXX в пользовательском UI задач;
- SQL migrations проверены отдельно;
- RLS/GRANT для новых RPC проверены;
- нет новых таблиц без workspace_id;
- нет прямого Telegram-вызова из UI/RPC;
- нет изменений edge/cron без отдельного плана.
```

## **16. Итоговый вердикт**

План хороший по направлению, но **слишком большой для одного прохода**.

Запускать можно только после разделения на:

1. PATCH A — premium UI/status/TASK-ID.
2. PATCH B — shared pickers.
3. PATCH C — list + bulk RPC/actions.
4. PATCH D — stats + global autocomplete.

Первым делать **PATCH A**, потому что он даёт видимый результат и почти не трогает архитектуру.

&nbsp;

План: премиум-карточка задачи + связки/список/массовые действия

### 1. Premium glass-карточка (canban + диалоги)

- `taskUiTheme.ts`: переключить палитру бакетов на «дорогие» цвета — emerald/teal/amber/rose/violet с насыщенными accent'ами и более тонким стеклом (border `white/40`, blur-xl, layered gradient + soft glow по accent). Карточка получает `bg-gradient-to-br from-{accent}-50/60 via-white/40 to-{accent}-100/30`, ring `{accent}-200/50`.
- `TaskKanbanCard.tsx`: усилить прозрачность (backdrop-blur-xl, bg-white/45), цветной hover-glow по type.color, цветная мягкая обводка по бакету.
- Тип задачи рендерится цветным пиллом (по `crm_task_types.color`), статусные пиллы перекрашены в emerald/amber/slate/rose с лёгкой заливкой.

### 2. Редактор задачи: статус «снизу», без отдельного селекта

- В `EditCrmTaskDialog.tsx` убрать `Select` статуса из шапки формы.
- В `DialogFooter` сделать 3 уровня действий:
  - слева: «Отмена» (закрыть без изменений)
  - центр: «Отменить задачу» (status=canceled, требует комментарий) и «В работу» (status=in_progress) — показываются по контексту
  - справа: «Сохранить» (status=open, без смены статуса) и «Готово» (status=done, требует комментарий)
- Для `done`/`canceled` поле «Результат / комментарий» становится обязательным (валидация + подсветка).
- В заголовке диалога — компактный бейдж текущего статуса (read-only chip), чтобы было видно состояние.

### 3. Связки задачи: сделка + контакт (reuse из платежей)

- Рефактор `LinkDealDialog` и `LinkContactDialog` (`src/components/admin/payments/*`):
  - вынести **чистый picker** в `src/components/admin/shared/`:
    - `DealPickerDialog.tsx` — поиск по `order_number`, UUID, имени; возвращает выбранный order/deal через `onSelect(order)`.
    - `ContactPickerDialog.tsx` — режимы «Найти» / «Создать ghost», возвращает `onSelect(contact)`.
  - Существующие LinkDeal/LinkContactDialog становятся тонкими обёртками: рендерят picker + дописывают write-path в payment_reconcile_queue/payments_v2 (поведение в платежах не меняется).
- В `CreateCrmTaskDialog`/`EditCrmTaskDialog` добавить секцию «Связи» с двумя полями:
  - «Сделка» — chip с `public_id` + product, кнопки «Изменить»/«Отвязать», открывает `DealPickerDialog`.
  - «Контакт» — chip с именем/телефоном, открывает `ContactPickerDialog`.
- Запись через существующий `useUpdateCrmTask` (поля `deal_id`, `contact_id` уже есть в `crm_tasks`).

### 4. Канонический список задач (как в платежах)

- `TasksListView.tsx` переписать на канон таблицы (тот же tabular pattern: sticky header, sortable columns, density, фиксированная высота, hover-row).
- Колонки: чекбокс, Дата (due_at), Ответственный, Тип, Задача (title + краткое описание), Контакт, Сделка, Статус, Действия.
- Сортировка по любой колонке (client-side над уже загруженным batch). Сохранение сортировки в URL `?sort=...&dir=...`.
- В шапке — переключатель плотности и `Колонки…` (как в платежах), если в платежах это есть.

### 5. Массовый выбор + bulk actions (Floatage-style)

- Чекбоксы в списке + select-all с indeterminate.
- Sticky-плашка снизу `TasksBatchActions.tsx` (паттерн `PaymentsBatchActions`):
  - Сменить ответственного (StaffOptionRow)
  - Сменить тип
  - Перенести дедлайн (DateTimePicker, либо «+1 день / +3 / +неделя»)
  - Сменить статус → В работу / Готово / Отменить (с обязательным общим комментарием для done/canceled)
  - Удалить связку (сделка/контакт)
- Бэкенд: добавить RPC `crm_task_bulk_update(_task_ids uuid[], _patch jsonb)` и `crm_task_bulk_status(_task_ids uuid[], _status, _comment)` — атомарно, с проверкой прав через RLS/has_role, audit в `crm_activity_log`.

### 6. Сквозной поиск (задачи + контакты)

- В шапке `/admin/tasks` поиск уже есть (`TasksFiltersBar`). Расширить: при вводе ≥2 символов под полем показывать **2 секции автокомплита**:
  - «Задачи» — top-5 по title/public_id (через текущий `crm_task_list`).
  - «Контакты» — top-5 через тот же endpoint, что `ContactPickerDialog`.
  - Клик по контакту → открывает `ContactDetailSheet` с вкладкой «Задачи» (она уже есть).
- Поведение и API повторяют поиск из `LinkContactDialog`/`LinkDealDialog`.

### 7. Статистика по сотруднику

- Новый компонент `TasksStaffStatsPanel.tsx` (collapsible над списком/доской) или отдельная вкладка «Аналитика»:
  - Группировка по `assignee_user_id`: открытых, в работе, просрочено, сделано за 7/30 дней, отменено, среднее время закрытия.
  - Источник: RPC `crm_task_stats_by_assignee(_from, _to)` (новый), читает `crm_tasks` с фильтрами по правам.
  - При закрытии задача сохраняет `result_comment`, `closed_at`, `closed_by` (уже в схеме) — статистика опирается на это; в карточке задачи показывается история комментариев (последние 5 из meta-аудита, если пишем; иначе только текущий `result_comment`).

### 8. Контакт-карточка

- Привязка уже отображается (CrmTasksSection в `ContactDetailSheet` есть, item 62bb8f82). Проверить, что в карточке контакта виден полный CRUD задач и пробрасывается `contactId` в Create/Edit dialogs. При создании из контакта — поле «Контакт» предзаполнено и заблокировано.

---

### Технический раздел

**Файлы для изменения:**

- `src/components/admin/tasks/taskUiTheme.ts` — новая палитра.
- `src/components/admin/tasks/board/TaskKanbanCard.tsx` — premium glass.
- `src/components/admin/tasks/EditCrmTaskDialog.tsx`, `CreateCrmTaskDialog.tsx` — футер-статусы, связки сделка/контакт, валидация comment.
- `src/components/admin/tasks/TasksListView.tsx` — канон-таблица, sort, density, selection.
- `src/components/admin/tasks/TasksBatchActions.tsx` — новый.
- `src/components/admin/tasks/TasksStaffStatsPanel.tsx` — новый.
- `src/components/admin/tasks/filters/TasksFiltersBar.tsx` — двухсекционный автокомплит.
- `src/pages/admin/AdminTasks.tsx` — интеграция selection, batch bar, stats panel.

**Новые/выделенные shared:**

- `src/components/admin/shared/DealPickerDialog.tsx`
- `src/components/admin/shared/ContactPickerDialog.tsx`
- `src/components/admin/payments/LinkDealDialog.tsx`, `LinkContactDialog.tsx` — оборачивают picker + write-path к платежам (regression-free).

**Backend (миграции):**

- RPC `crm_task_bulk_update(_task_ids uuid[], _patch jsonb)` — белый список полей `{assignee_user_id, task_type_id, due_at, deal_id, contact_id}`; пишет `updated_by`, инвалидация cache на клиенте.
- RPC `crm_task_bulk_status(_task_ids uuid[], _status crm_task_status, _result_comment text)` — для `done`/`canceled` требует `_result_comment NOT NULL`; ставит `closed_at`/`closed_by`.
- RPC `crm_task_stats_by_assignee(_from timestamptz, _to timestamptz)` — агрегаты по статусам и SLA. SECURITY DEFINER, фильтрация по правам через `has_role_v2`.
- Все RPC: `GRANT EXECUTE TO authenticated`.

**Контракты UI:**

- Footer-кнопки скрываются по статусу: «В работу» прячется, если уже `in_progress`; «Готово» прячется, если `done`; «Отменить задачу» — если `canceled`. «Сохранить» всегда сохраняет правки без смены статуса.
- Bulk «Готово»/«Отмена» открывают модалку с textarea для общего комментария — комментарий пишется в `result_comment` каждой задачи.

**DoD:**

- Премиум-карточка с зелёно/янтарно/тил палитрой видна на канбане; диалог открывается с тем же стеклом.
- Статус меняется только кнопками в футере; для done/canceled требуется комментарий.
- В задаче можно привязать/отвязать сделку и контакт через те же пикеры, что и в платежах.
- Список задач сортируется по всем колонкам, поддерживает чекбоксы и массовые действия (ответственный/тип/срок/статус).
- Сквозной поиск находит и задачи, и контакты; клик по контакту открывает его карточку с вкладкой «Задачи».
- Панель статистики показывает по сотруднику open/in_progress/overdue/done/canceled и средний SLA.
- В карточке контакта видны его задачи; создание из контакта предзаполняет связь.