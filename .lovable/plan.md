да, согласен, с учетом правок:

1. **Убрать** `DELETE` **для** `authenticated`**.**  
Для задач безопаснее: закрытие / отмена / soft-delete через статус.  
`DELETE` оставить только `service_role` или вообще не давать на MVP.
2. **Исправить конфликт** `due_offset=15 мин` **и** `reminder=60 мин` **для T-000074.**  
Если дедлайн через 15 минут, напоминание за 60 минут технически попадает в прошлое.  
Варианты:
  - `due_offset=1440 мин`, `reminder=60 мин`; или
  - `due_offset=15 мин`, `reminder=5 мин`.
3. **Rollback не формулировать как** `drop table crm_tasks*`**.**  
Это слишком опасно. Правильно:
  - rollback UI через `feature.crm_tasks.enabled=false`;
  - automation hook через early return;
  - SQL rollback только точечный и явно перечисленный по таблицам;
  - без wildcard `*`.
4. **Для** `crm_task_apply_automation` **явно закрепить идемпотентность.**  
Добавить уникальный индекс/constraint:
  &nbsp;
  ```sql
  unique (automation_rule_id, deal_id)
  where automation_rule_id is not null and deal_id is not null
  ```
  Иначе автозадача может создаться повторно при вызове из `create_preorder_deal_atomic` и “при оплате”.
5. `assignee_strategy` **не оставлять неопределённым.**  
В MVP либо:
  &nbsp;
  &nbsp;
  - только `assignee_user_id`,  
  либо явно разрешённые стратегии:
  - `fixed_user`
  - `deal_owner`
  - `round_robin`
  Без этого исполнитель может сделать произвольную ad-hoc логику.

Также все таблцицы для пользователя должны быть в каноническом виде всей системы. календарь и время тоже взять канонические.

После этих правок план можно запускать.

&nbsp;

План: Полноценный CRM-раздел «Задачи» (canonical, не узкий deal_tasks)

> Весь план, отчёт и переписка — только на русском языке.

## 0. DIAGNOSE (обязательно до миграций)

Подрядчик до первой миграции делает диагностику и фиксирует результат в `.lovable/discovery/crm-tasks-diagnose.md`:

- SoT сделки: отдельная `deals`-таблица или `orders_v2` (по факту — `orders_v2`, нужно подтвердить).
- SoT контакта: `profiles` vs отдельная `contacts`.
- Есть ли `workspace_id` / `tenant_id` в `orders_v2`, `profiles`, `crm_pipelines` (если нет — план фиксирует tenant из `tenants`/`tenant_memberships`).
- Текущий механизм уведомлений: `notification_outbox`, `pending_telegram_notifications`, `domain_events`/`domain_executions`, есть ли работающий event-worker.
- Источник Telegram chat_id менеджера: `profiles` / `telegram_access` / `tenant_memberships`.
- Существующий `crm_activity_log` — что из него мигрирует в задачи (только связь, без переноса данных).

Выход: матрица «что есть → что используем → где compatibility layer».

## 1. Канонические таблицы (add-only)

### 1.1 `public.crm_task_types` (настраиваемые типы)

Поля: `id`, `workspace_id`, `key`, `label`, `icon`, `color`, `default_due_offset_minutes`, `default_reminder_offset_minutes`, `is_active`, `sort_order`, `metadata jsonb`, `created_at`, `updated_at`. Unique `(workspace_id, key)`.

Seed: `call`, `message`, `meeting`, `payment_control`, `service_delivery`, `crm_fill`, `other`.

### 1.2 `public.crm_tasks` (канон)

Поля:

- `id`, `public_id` (через `public_id_sequences`)
- `workspace_id uuid not null`
- `task_type_id uuid not null → crm_task_types`
- `title text`, `description text`
- `contact_id uuid null → profiles`
- `deal_id uuid null` (FK резолвится по DIAGNOSE; в MVP — `orders_v2.id` под именем `deal_id`, отдельная колонка `order_id uuid null` зарезервирована для будущей миграции на чистый `deals`)
- `pipeline_id`, `pipeline_stage_id` — денорм-снапшот, обновляется при создании
- `offer_id`, `product_id`, `tariff_id` (nullable)
- `assignee_user_id uuid null`
- `due_at timestamptz null`, `remind_at timestamptz null`
- `status text not null default 'open'` — расширяемый, CHECK in (`open`,`in_progress`,`done`,`canceled`) + комментарий «расширять только через миграцию»
- `result_comment text`, `closed_at timestamptz`, `closed_by uuid`
- `source text` (`manual`/`auto`/`system`), `automation_rule_id uuid null`
- `created_by`, `updated_by`, `created_at`, `updated_at`, `meta jsonb`

Просрочка — вычисляемая: `is_overdue := status in ('open','in_progress') and due_at < now()`. Отдельного статуса нет.

Индексы: `(workspace_id, assignee_user_id, status, due_at)`, `(deal_id)`, `(contact_id)`, `(status, due_at)`, GIN `meta`.

### 1.3 `public.crm_task_notifications` (ledger)

Поля: `id`, `task_id`, `notification_type` (`due_soon`/`overdue`/`created`/`assigned`/`reminder`), `channel` (`telegram`/`email`/`in_app`), `recipient_user_id`, `scheduled_at`, `sent_at`, `status` (`pending`/`sent`/`failed`/`skipped`), `error`, `metadata jsonb`. Индексы по `(status, scheduled_at)`, `(task_id)`.

### 1.4 `public.crm_task_automation_rules`

Поля: `id`, `workspace_id`, `offer_id`, `task_type_id`, `title_template`, `description_template`, `assignee_user_id` (или `assignee_strategy`), `due_offset_minutes`, `reminder_offset_minutes`, `is_active`, `metadata`, timestamps.

На первом этапе допустимо параллельно читать `tariff_offers.meta.auto_tasks[]`, но **только через JSON Schema-валидацию** в RPC; план явно фиксирует миграцию данных из `meta.auto_tasks` в `crm_task_automation_rules` как Шаг 9.

### 1.5 RLS / GRANT (обязательно в той же миграции)

Для каждой таблицы: `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated`, `GRANT ALL … TO service_role`, `ALTER TABLE … ENABLE ROW LEVEL SECURITY`. Политики — через `has_role_v2` + `workspace_id ∈ tenant_memberships(auth.uid())`. Без `workspace_id` ни одна таблица не создаётся.

`updated_at` — триггер `public.update_updated_at_column`. `public_id` — триггер по существующему `public_id_sequences`.

## 2. RPC (security definer, `search_path=public`)

- `crm_task_create(payload jsonb) → uuid` — валидация типа/связей/workspace, эмитит `domain_events('crm.task.created')`.
- `crm_task_update_status(task_id, status, result_comment)` — пишет `closed_at/closed_by`, эмитит `crm.task.status_changed`.
- `crm_task_reassign(task_id, assignee_user_id)`.
- `crm_task_apply_automation(offer_id, deal_id, contact_id)` — вызывается из `create_preorder_deal_atomic` и при оплате; идемпотентно по `(automation_rule_id, deal_id)`.
- `crm_tasks_list(filters jsonb)` — для UI (мои/просроченные/по воронке/…).

## 3. Notification worker (не Telegram из RPC)

- RPC только эмитит `domain_events`.
- Edge function `crm-task-notify-worker` потребляет события + крон-проверка `crm_task_notifications.scheduled_at <= now()`, отправляет через существующий Telegram-адаптер (`telegram-send` / pending_telegram_notifications), пишет результат в `crm_task_notifications`.
- Cron: `pg_cron` каждую минуту → `crm-task-reminders-tick` (планирует `due_soon`/`overdue` записи в `crm_task_notifications`).
- Прямой `pg_net` из RPC — запрещён. Если временно нужен bridge — явно помечается `compatibility_layer=true` в meta и в backlog заводится задача на удаление.

## 4. UI

### 4.1 Левое меню админки

Новый раздел **«Задачи»** рядом с CRM, под «Контакты»/«Сделки». Sidebar key `crm-tasks`, секция `crm_tasks` в `app_sections` + права в `admin_section`.

### 4.2 Страница `/admin/tasks`

Режимы:

- **Список** (таблица с сортировкой/пагинацией).
- **Канбан** по бакетам: Просроченные / Сегодня / Завтра / Позже / Без срока.
- Фильтры: мои / все / просроченные / по ответственному / по типу / по воронке / по сделке / по контакту.
- Поиск: клиент, email, телефон, № сделки, № задачи.

### 4.3 Карточка задачи (Drawer/Page)

Поля: тип, название, описание, ответственный, дедлайн, время напоминания, контакт, сделка, воронка/стадия (read-only снапшот), оффер/продукт (если auto), источник (`manual/auto/system`), статус, результат, дата закрытия. Действия: создать/редактировать/закрыть/отменить/переназначить.

### 4.4 Карточка сделки

Вкладка «Задачи»: список открытых/закрытых, кнопка «Создать задачу», inline-закрытие, переход в полную карточку.

### 4.5 Карточка контакта

Вкладка «Задачи»: все задачи контакта + задачи связанных сделок + история выполненных.

### 4.6 Бейджи в списке и канбане сделок

На карточке сделки: количество открытых задач, индикатор просрочки, ближайший `due_at`, иконка типа ближайшей задачи. Данные — через агрегатный view `crm_deal_task_summary_v`.

### 4.7 Настройка автозадач

UI в карточке оффера: CRUD `crm_task_automation_rules` (тип, шаблоны, ответственный, offsets, активность).

## 5. Интеграции

- `create_preorder_deal_atomic`: после создания сделки → `crm_task_apply_automation(offer_id, deal_id, contact_id)`.
- На оффере **T-000074** (Индивидуальный договор): автозадача «Прозвон менеджером», ответственный — выбранный менеджер, `due_offset=15 мин`, `reminder=60 мин`.

## 6. Безопасность и совместимость

- Все миграции **add-only**. Не удаляем поля, не меняем поведение `orders_v2`, `crm_pipelines`, `crm_activity_log`.
- В `orders_v2` ничего не добавляем — связь только через `crm_tasks.deal_id`.
- Rollback plan: `drop table crm_tasks*`, фичефлаг `feature.crm_tasks.enabled` для скрытия UI-раздела и отключения automation hook в `create_preorder_deal_atomic` (early return при выключенном флаге).

## 7. Roadmap (порядок исполнения)

1. DIAGNOSE сущностей (сделки/контакты/роли/workspace/Telegram/уведомления) → артефакт.
2. Миграции `crm_task_types`, `crm_tasks`, `crm_task_notifications`, `crm_task_automation_rules` + RLS/GRANT/индексы/триггеры/public_id + seed типов.
3. RPC `crm_task_*` + JSON-валидация payload.
4. UI-раздел «Задачи» в левом меню + страница со списком/канбаном/фильтрами/поиском.
5. Ручное создание/редактирование/закрытие/отмена/переназначение задач.
6. Вкладка «Задачи» в карточке сделки и карточке контакта.
7. Бейджи задач в списке и канбане сделок (`crm_deal_task_summary_v`).
8. UI настраиваемых типов задач (CRUD `crm_task_types`).
9. UI и движок `crm_task_automation_rules` + миграция `tariff_offers.meta.auto_tasks` в таблицу.
10. Хук в `create_preorder_deal_atomic` → `crm_task_apply_automation`.
11. Notification worker (edge function) + ledger `crm_task_notifications`.
12. Cron reminders (`pg_cron` → tick-функция).
13. Настройка автозадачи для оффера T-000074 (ответственный + шаблоны).
14. End-to-end smoke: заявка «Хочу премиальные условия» → сделка в нужной воронке/стадии → автозадача → Telegram-уведомление менеджеру → менеджер закрывает задачу с результатом → запись в ledger + `crm_activity_log`.

## DoD

- Все таблицы с RLS+GRANT, ни одной без `workspace_id`.
- Раздел «Задачи» виден в левом меню под правами `crm_tasks.view`.
- Создание/редактирование/закрытие/отмена/переназначение работают из UI и из RPC.
- Автозадача на T-000074 создаётся при предзаписи, Telegram-уведомление доходит, факт зафиксирован в `crm_task_notifications`.
- Бейджи на сделке отражают открытые/просроченные задачи и ближайший дедлайн.
- Rollback проверен на staging фичефлагом.
- Отчёт о выполнении — на русском языке.