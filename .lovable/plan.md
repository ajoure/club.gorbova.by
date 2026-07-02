## ## План

### 1. Переделать пикер сделки `DealPickerDialog.tsx`)

Сейчас карточка сделки в поиске = «REBILL-… • 250 BYN • paid • Бухгалтерия как бизнес». По ТЗ пользователя: заголовок = контакт (ФИО), под ним мелко и не жирным — продукт/тариф, ещё ниже неброско — короткий ID сделки. Сумма/статус — справа.

- Расширить SELECT в `handleSearch`: подтянуть контакт через FK `profile:profiles!orders_v2_profile_id_fkey ( id, full_name, email, phone )`).

- Расширить `PickedDeal`: `contact_name`, `contact_id`.

- Ветка «поиск по контакту» — если `searchTerm` не UUID и не совпадает с шаблоном номера `ORD-`, `REBILL-`, `INV-`…): выполнить два запроса и объединить —

  1. `orders_v2` по `order_number ilike %term%`;

  2. `profiles` (по `full_name/email/phone ilike %term%`) → взять id → `orders_v2.in('profile_id', ids)`.

  Дедуп по `id`, сортировка по `created_at desc`, лимит 50.

- Карточка результата:

  - строка 1 (крупно, жирным): `full_name` контакта, при пустом — fallback на email/phone/«Без контакта»;

  - строка 2 (обычный текст, muted): продукт `product_name`) + статус-бейдж;

  - строка 3 (ещё мельче, muted, `font-mono`): `order_number` или короткий `id.slice(0,8)` + дата;

  - справа: сумма + валюта.

### 2. Починить «сделка выбирается, но не сохраняется»

DIAGNOSE (первый шаг перед патчем):

- Через `psql` посмотреть последнюю задачу пользователя в `crm_tasks`: сохранился ли `deal_idcontact_id` после save.

- Проверить RLS UPDATE-политику `crm_tasks` — не блокирует ли она изменение колонок `deal_id/contact_id` (у нас update идёт напрямую через `.from('crm_tasks').update(...)`).

- Проверить сериализацию: в `TaskRelationsField` `onChangeDeal(picked.id)` → `setDealId` в EditDialog. Убедиться, что при следующем открытии диалога `task.deal_id` действительно перезаписывается новым значением (мог остаться устаревший кэш `crm-tasks`).

FIX:

- Если проблема в кэше `useTaskRelations` — использовать данные, пришедшие из пикера `picked.public_id/contact_name`) как оптимистичный кэш, чтобы на кнопке мгновенно отображалось «Контакт · продукт», а не «Выбрать сделку…».

- Если проблема в RLS/RPC — перевести редактирование `deal_id/contact_id` через отдельный SECURITY DEFINER RPC `crm_task_set_relations(_task_id, _deal_id, _contact_id)` с проверкой роли staff.

### 3. Симметричный layout «Сделка / Контакт»

В `TaskRelationsField.tsx` заголовки колонок разной высоты (у «Сделки» справа кнопка X, у «Контакта» её нет пока не выбран) → визуально «Контакт ниже». Исправить:

- Обёрнутый заголовок с фиксированной высотой `h-6`) в обеих колонках, чтобы placeholder-X всегда занимал место (renderить disabled/невидимую кнопку когда нечего очищать).

- Одинаковая высота кнопки-триггера `h-9`) и padding.

- В `CreateCrmTaskDialog.tsx` вынести `TaskRelationsField` в тот же `TASK_DIALOG_SECTION`, что и «Дедлайн/Напомнить», чтобы визуальный ритм совпадал с редактированием.

### 4. Уведомление ответственному при создании

DIAGNOSE:

- `psql`: `SELECT * FROM public.crm_task_notifications WHERE task_id='<последняя задача>'` — создалась ли строка `notification_type='assigned'`.

- Проверить триггер `trg_crm_tasks_notify_assigned`: `pg_trigger` + определение функции. Возможные причины отсутствия:

  a) триггер повесили только на `AFTER UPDATE OF assignee_user_id`, но не на `AFTER INSERT`;

  b) в `INSERT` условие `OLD IS NOT DISTINCT FROM NEW` вычисляется некорректно (OLD = NULL при INSERT);

  c) индекс`ON CONFLICT` глотает вставку.

- Проверить, тикнул ли `crm-task-notify-worker` (edge-func logs) и увидел ли строку.

FIX:

- Пересобрать триггер: `AFTER INSERT OR UPDATE OF assignee_user_id` — на INSERT ставить `assigned`, если `NEW.assignee_user_id IS NOT NULL`; на UPDATE — если `NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id AND NEW.assignee_user_id IS NOT NULL`.

- Добавить `RAISE LOG` внутри триггера, чтобы в следующем прогоне видеть исполнение.

- Дернуть воркер вручную `supabase.functions.invoke('crm-task-notify-worker')`) для очистки скопившегося outbox и подтвердить доставку.

### 5. Кнопки внизу редактирования задачи — одна ровная строка

Сейчас в `EditCrmTaskDialog.tsx` футер: `flex flex-row flex-wrap` с «Отмена» слева и группой из 4 кнопок справа `ml-auto`). При узком контенте кнопки уходят на 2 строки, «Готово» висит отдельно, «Отмена» отрывается вверх (видно на скрине).

- Заменить `DialogFooter` на один горизонтальный ряд: слева — «Отмена» (ghost), справа группа `[Отменить задачу] [В работу] [Сохранить] [Готово]`.

- Убрать `flex-wrap`; вместо этого укоротить лейблы («Отменить», «В работу», «Готово», «Сохранить») и использовать `size="sm"` фиксированной высоты `h-9`, `gap-2`.

- Расширить `max-w` диалога до `max-w-xl`, чтобы 5 кнопок гарантированно влезали на десктопе; на мобильной ширине разрешить перенос, но группами: `flex-wrap justify-end` только для правой группы.

- Проверить одинаковый вертикальный ритм (все кнопки одинаковой высоты, иконки `h-3.5 w-3.5`).

### Технические детали

- Файлы: `src/components/admin/shared/pickers/DealPickerDialog.tsx`, `src/components/admin/tasks/TaskRelationsField.tsx`, `src/components/admin/tasks/EditCrmTaskDialog.tsx`, `src/components/admin/tasks/CreateCrmTaskDialog.tsx`, `src/hooks/useTaskRelations.ts` (расширить `TaskDealLite` полями `contact_name`, `product_name`), возможно новая миграция для триггера уведомлений и/или RPC `crm_task_set_relations`.

- Никаких изменений схемы `orders_v2profiles`.

- DoD: (1) при вводе фамилии в пикер выдаются сделки этого контакта; (2) карточка сделки показывает ФИО крупно, продукт мелко, id мелко; (3) выбранная сделка сохраняется — после закрытия/повторного открытия диалога поле заполнено; (4) в `crm_task_notifications` появляется `assigned` сразу после создания задачи и в Telegram приходит сообщение; (5) 4–5 кнопок в футере редактирования лежат одной ровной строкой без переносов на десктопе.

### Порядок работ

1. DIAGNOSE «не сохраняется» + «не приходит уведомление» через psql (не меняя ничего).

2. Патч пикера сделки (поиск по контакту + новая карточка).

3. Симметричный layout relations + фикс сохранения (если найден баг).

4. Триггер/воркер уведомлений (миграция при необходимости).

5. Новый футер EditCrmTaskDialog.

6. VERIFY: создать тестовую задачу, изменить связку, поменять ответственного, дождаться уведомления в TG.

&nbsp;

План

### 1. Переделать пикер сделки (`DealPickerDialog.tsx`)

Сейчас карточка сделки в поиске = «REBILL-… • 250 BYN • paid • Бухгалтерия как бизнес». По ТЗ пользователя: заголовок = контакт (ФИО), под ним мелко и не жирным — продукт/тариф, ещё ниже неброско — короткий ID сделки. Сумма/статус — справа.

- Расширить SELECT в `handleSearch`: подтянуть контакт через FK (`profile:profiles!orders_v2_profile_id_fkey ( id, full_name, email, phone )`).
- Расширить `PickedDeal`: `contact_name`, `contact_id`.
- Ветка «поиск по контакту» — если `searchTerm` не UUID и не совпадает с шаблоном номера (`ORD-`, `REBILL-`, `INV-`…): выполнить два запроса и объединить —
  1. `orders_v2` по `order_number ilike %term%`;
  2. `profiles` (по `full_name/email/phone ilike %term%`) → взять id → `orders_v2.in('profile_id', ids)`.
  Дедуп по `id`, сортировка по `created_at desc`, лимит 50.
- Карточка результата:
  - строка 1 (крупно, жирным): `full_name` контакта, при пустом — fallback на email/phone/«Без контакта»;
  - строка 2 (обычный текст, muted): продукт (`product_name`) + статус-бейдж;
  - строка 3 (ещё мельче, muted, `font-mono`): `order_number` или короткий `id.slice(0,8)` + дата;
  - справа: сумма + валюта.

### 2. Починить «сделка выбирается, но не сохраняется»

DIAGNOSE (первый шаг перед патчем):

- Через `psql` посмотреть последнюю задачу пользователя в `crm_tasks`: сохранился ли `deal_id`/`contact_id` после save.
- Проверить RLS UPDATE-политику `crm_tasks` — не блокирует ли она изменение колонок `deal_id/contact_id` (у нас update идёт напрямую через `.from('crm_tasks').update(...)`).
- Проверить сериализацию: в `TaskRelationsField` `onChangeDeal(picked.id)` → `setDealId` в EditDialog. Убедиться, что при следующем открытии диалога `task.deal_id` действительно перезаписывается новым значением (мог остаться устаревший кэш `crm-tasks`).

FIX:

- Если проблема в кэше `useTaskRelations` — использовать данные, пришедшие из пикера (`picked.public_id/contact_name`) как оптимистичный кэш, чтобы на кнопке мгновенно отображалось «Контакт · продукт», а не «Выбрать сделку…».
- Если проблема в RLS/RPC — перевести редактирование `deal_id/contact_id` через отдельный SECURITY DEFINER RPC `crm_task_set_relations(_task_id, _deal_id, _contact_id)` с проверкой роли staff.

### 3. Симметричный layout «Сделка / Контакт»

В `TaskRelationsField.tsx` заголовки колонок разной высоты (у «Сделки» справа кнопка X, у «Контакта» её нет пока не выбран) → визуально «Контакт ниже». Исправить:

- Обёрнутый заголовок с фиксированной высотой (`h-6`) в обеих колонках, чтобы placeholder-X всегда занимал место (renderить disabled/невидимую кнопку когда нечего очищать).
- Одинаковая высота кнопки-триггера (`h-9`) и padding.
- В `CreateCrmTaskDialog.tsx` вынести `TaskRelationsField` в тот же `TASK_DIALOG_SECTION`, что и «Дедлайн/Напомнить», чтобы визуальный ритм совпадал с редактированием.

### 4. Уведомление ответственному при создании

DIAGNOSE:

- `psql`: `SELECT * FROM public.crm_task_notifications WHERE task_id='<последняя задача>'` — создалась ли строка `notification_type='assigned'`.
- Проверить триггер `trg_crm_tasks_notify_assigned`: `pg_trigger` + определение функции. Возможные причины отсутствия:
a) триггер повесили только на `AFTER UPDATE OF assignee_user_id`, но не на `AFTER INSERT`;
b) в `INSERT` условие `OLD IS NOT DISTINCT FROM NEW` вычисляется некорректно (OLD = NULL при INSERT);
c) индекс/`ON CONFLICT` глотает вставку.
- Проверить, тикнул ли `crm-task-notify-worker` (edge-func logs) и увидел ли строку.

FIX:

- Пересобрать триггер: `AFTER INSERT OR UPDATE OF assignee_user_id` — на INSERT ставить `assigned`, если `NEW.assignee_user_id IS NOT NULL`; на UPDATE — если `NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id AND NEW.assignee_user_id IS NOT NULL`.
- Добавить `RAISE LOG` внутри триггера, чтобы в следующем прогоне видеть исполнение.
- Дернуть воркер вручную (`supabase.functions.invoke('crm-task-notify-worker')`) для очистки скопившегося outbox и подтвердить доставку.

### 5. Кнопки внизу редактирования задачи — одна ровная строка

Сейчас в `EditCrmTaskDialog.tsx` футер: `flex flex-row flex-wrap` с «Отмена» слева и группой из 4 кнопок справа (`ml-auto`). При узком контенте кнопки уходят на 2 строки, «Готово» висит отдельно, «Отмена» отрывается вверх (видно на скрине).

- Заменить `DialogFooter` на один горизонтальный ряд: слева — «Отмена» (ghost), справа группа `[Отменить задачу] [В работу] [Сохранить] [Готово]`.
- Убрать `flex-wrap`; вместо этого укоротить лейблы («Отменить», «В работу», «Готово», «Сохранить») и использовать `size="sm"` фиксированной высоты `h-9`, `gap-2`.
- Расширить `max-w` диалога до `max-w-xl`, чтобы 5 кнопок гарантированно влезали на десктопе; на мобильной ширине разрешить перенос, но группами: `flex-wrap justify-end` только для правой группы.
- Проверить одинаковый вертикальный ритм (все кнопки одинаковой высоты, иконки `h-3.5 w-3.5`).

### Технические детали

- Файлы: `src/components/admin/shared/pickers/DealPickerDialog.tsx`, `src/components/admin/tasks/TaskRelationsField.tsx`, `src/components/admin/tasks/EditCrmTaskDialog.tsx`, `src/components/admin/tasks/CreateCrmTaskDialog.tsx`, `src/hooks/useTaskRelations.ts` (расширить `TaskDealLite` полями `contact_name`, `product_name`), возможно новая миграция для триггера уведомлений и/или RPC `crm_task_set_relations`.
- Никаких изменений схемы `orders_v2`/`profiles`.
- DoD: (1) при вводе фамилии в пикер выдаются сделки этого контакта; (2) карточка сделки показывает ФИО крупно, продукт мелко, id мелко; (3) выбранная сделка сохраняется — после закрытия/повторного открытия диалога поле заполнено; (4) в `crm_task_notifications` появляется `assigned` сразу после создания задачи и в Telegram приходит сообщение; (5) 4–5 кнопок в футере редактирования лежат одной ровной строкой без переносов на десктопе.

### Порядок работ

1. DIAGNOSE «не сохраняется» + «не приходит уведомление» через psql (не меняя ничего).
2. Патч пикера сделки (поиск по контакту + новая карточка).
3. Симметричный layout relations + фикс сохранения (если найден баг).
4. Триггер/воркер уведомлений (миграция при необходимости).
5. Новый футер EditCrmTaskDialog.
6. VERIFY: создать тестовую задачу, изменить связку, поменять ответственного, дождаться уведомления в TG.