# PATCH C — DIAGNOSE: контракт задач перед bulk actions

Дата: 2026-06-29. Цель — описать текущий контракт `crm_tasks`, чтобы безопасно
спроектировать `crm_task_bulk_update` / `crm_task_bulk_status` и UI канонического
списка с массовыми действиями.

## 1. Таблица `public.crm_tasks`

Миграция: `supabase/migrations/20260629125020_…`.

Колонки (актуально):
- `id uuid PK`, `public_id text UNIQUE` (trigger `set_crm_task_public_id`).
- `workspace_id uuid` (DEFAULT system tenant), `task_type_id uuid → crm_task_types`.
- `title text NOT NULL`, `description text`.
- Связи: `contact_id → profiles`, `deal_id/order_id → orders_v2`,
  `pipeline_id`, `pipeline_stage_id`, `offer_id`, `product_id`, `tariff_id`.
- `assignee_user_id uuid`.
- `due_at`, `remind_at timestamptz`.
- `status text` ∈ `{open,in_progress,done,canceled}` (CHECK).
- `result_comment text`, `closed_at`, `closed_by uuid`.
- `source text` ∈ `{manual,auto,system}` (CHECK), `automation_rule_id uuid`.
- `created_by`, `updated_by`, `created_at`, `updated_at` (BEFORE UPDATE trigger
  `update_crm_tasks_updated_at`).
- `meta jsonb`.

Индексы важные для bulk:
- `crm_tasks_workspace_assignee_status_due_idx`,
  `crm_tasks_status_due_idx`, `crm_tasks_deal_idx`, `crm_tasks_contact_idx`,
  `crm_tasks_meta_gin_idx`.
- UNIQUE `crm_tasks_auto_rule_deal_uniq` (partial, для `source='auto'`).

## 2. RLS

Миграция: `…125020_…`. Политики (table-level):
- `crm_tasks_staff_read` SELECT — employee/admin/super_admin.
- `crm_tasks_staff_insert` INSERT — те же роли.
- `crm_tasks_staff_update` UPDATE (USING + WITH CHECK) — те же роли.
- DELETE политики нет → запрещено для `authenticated` (только service_role
  через `GRANT ALL`). Bulk-delete из UI вне scope.

GRANT: `SELECT, INSERT, UPDATE` для `authenticated`, `ALL` для `service_role`.

Вывод: bulk-mutation через `authenticated` допустим **только** для UPDATE.
Bulk-delete не делаем.

## 3. Существующие RPC

Все `SECURITY DEFINER`, `search_path=public`, гейт
`_crm_tasks_assert_staff()` (employee/admin/super_admin или ошибка
`forbidden_not_staff`).

| RPC | Аргументы | Что меняет |
|---|---|---|
| `crm_task_create(payload jsonb)` | payload | INSERT в `crm_tasks`, дефолты по type, `source ∈ manual/auto/system`, `created_by/updated_by = auth.uid()`. |
| `crm_task_update_status(_task_id uuid, _status text, _result_comment text=null)` | task_id, status, comment? | UPDATE `status`, `result_comment` (COALESCE — не очищает), `closed_at`/`closed_by` (set/clear по терминальности), `updated_by`. Реоткрытие done/canceled → только super_admin (`forbidden_reopen_closed_task`). |
| `crm_task_reassign(_task_id, _assignee uuid)` | task_id, assignee | UPDATE `assignee_user_id`, `updated_by`. |
| `crm_task_apply_automation(_offer_id, _deal_id, _context)` | — | INSERT auto-tasks, idempotent через partial unique. Вне UI bulk. |
| `crm_task_list(_filters jsonb)` | jsonb | SETOF `crm_tasks`. **Фильтры**: assignee_user_id, status[], task_type_id[], deal_id, contact_id, due_from, due_to, bucket(overdue/today/tomorrow/week/later/no_due/closed), search (title/desc/public_id ILIKE). **Лимит**: `limit` default 200, max не ограничен; `offset` default 0. Сортировка: открытые → due_at NULLS LAST → created_at DESC. |

Замечания для bulk:
- `crm_task_update_status` уже атомарен per-row, **но**:
  - `result_comment` подставляется `COALESCE` → bulk-комментарий «приклеит»
    одно и то же значение, не очистит существующее. Это ок для нашего
    требования (общий комментарий при done/canceled обязателен).
  - Реоткрытие закрытых задач блокируется кроме super_admin — bulk должен
    учитывать это (либо пропуск, либо общая ошибка).
- Поле `updated_by` всюду пишется `auth.uid()`.

## 4. Клиентский слой

`src/hooks/useCrmTasks.ts`:
- `useUpdateCrmTaskStatus` → RPC `crm_task_update_status` (per-row).
- `useUpdateCrmTask` → **прямой UPDATE** `crm_tasks` через PostgREST. Patch:
  `title, description, task_type_id, due_at, remind_at, result_comment,
  assignee_user_id, deal_id, contact_id`. RLS staff_update пропускает.
- Инвалидируются `["crm-tasks"]` и `["crm-deal-task-summary"]`.

`crm_task_list` зовут с `limit: 500` из `AdminTasks.tsx`. Этого хватит для
текущих объёмов, но bulk выбор обязан **работать только с уже загруженными
строками** (никаких «select all on server» без подтверждения).

## 5. `crm_activity_log`

Миграция `…20260408192204_…`. Поля:
- `id`, `public_id`, `contact_id?`, `user_id NOT NULL`, `activity_type`,
  `source_entity_id`, `source_entity_type`, `live_event_id?`,
  `title_snapshot`, `text_snapshot`, `author_snapshot`, `visibility_scope`,
  `idempotency_key UNIQUE`, `created_at`, `metadata jsonb`.
- RLS: ALL только для `admin` (has_role_v2). `employee` НЕ может писать.

Вывод для bulk-аудита: писать `crm_activity_log` из bulk RPC возможно
только в `SECURITY DEFINER` (RPC обходит RLS), но `user_id` NOT NULL —
ставим `auth.uid()`. Поля mapping:
- `source_entity_type = 'crm_task'`, `source_entity_id = task.id`.
- `activity_type ∈ {'task_bulk_status','task_bulk_update'}`.
- `idempotency_key` = `bulk:{request_id}:{task_id}` (request_id из payload,
  гарантирует «не дважды»).
- `metadata` = `{ status_from, status_to, patch_keys[], comment? }`.

## 6. Whitelist полей для `crm_task_bulk_update`

Безопасно менять (соответствует существующему `useUpdateCrmTask`):
- `task_type_id`, `assignee_user_id`, `due_at`, `remind_at`,
  `deal_id`, `contact_id`, `description`.

**Запрещено** в bulk (по требованию задачи и здравому смыслу):
- `source`, `automation_rule_id`, `workspace_id`, `created_by`, `created_at`,
  `public_id`, `id`, `status`, `closed_at`, `closed_by`, `result_comment`,
  `meta`, `pipeline_id`, `pipeline_stage_id`, `offer_id`, `product_id`,
  `tariff_id`, `title` (массовое переименование — не нужно сейчас).

Статус меняется только через `crm_task_bulk_status` с обязательным
`result_comment` при `done/canceled` (как в одиночном RPC).

## 7. Контракт для PATCH C.2 (bulk RPC)

### `crm_task_bulk_status(_task_ids uuid[], _status text, _result_comment text, _request_id text)`
- Гейт `_crm_tasks_assert_staff`.
- Validate `_status ∈ {open,in_progress,done,canceled}`.
- Если `_status ∈ {done,canceled}` → `_result_comment` обязателен (NOT NULL,
  trim ≠ '').
- FOR EACH id (или один UPDATE с CTE): применяем те же правила, что и в
  `crm_task_update_status`. Реоткрытие закрытых не super_admin → строка
  пропускается с кодом `skip_reopen_forbidden`.
- Возврат: `jsonb { updated: int, skipped: [{id, reason}], total: int }`.
- Audit: одна запись `task_bulk_status` на каждую успешно обновлённую задачу
  с `idempotency_key = 'bulk_status:'||_request_id||':'||id`. Повтор того же
  `_request_id` → no-op (ON CONFLICT DO NOTHING на `idempotency_key`).

### `crm_task_bulk_update(_task_ids uuid[], _patch jsonb, _request_id text)`
- Гейт `_crm_tasks_assert_staff`.
- Whitelist ключей `_patch`. Любой посторонний ключ → ошибка
  `forbidden_field:<name>`.
- Пустой `_patch` → ошибка `empty_patch`.
- Атомарно: один `UPDATE … WHERE id = ANY(_task_ids)` с COALESCE по
  отсутствующим ключам. `updated_by = auth.uid()`.
- Возврат: `jsonb { updated: int, total: int }`.
- Audit: `task_bulk_update` per row, `metadata.patch_keys = keys(_patch)`,
  `idempotency_key = 'bulk_update:'||_request_id||':'||id`.

Оба RPC: `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated, service_role`.

## 8. Что НЕ трогаем в PATCH C

- Сквозной поиск / статистика по сотрудникам — отдельные патчи.
- Edge functions / cron / Telegram worker — не меняем.
- `crm_task_apply_automation`, partial unique индекс — не меняем.
- Прямой `UPDATE` из `useUpdateCrmTask` в одиночном диалоге — оставляем как
  есть (RLS пропускает, у нас уже работает). Новый bulk использует RPC,
  чтобы дать строгий whitelist + audit.

## 9. Smoke-чеклист для PATCH C.2 / C.3

- SQL: bulk_status с пустым массивом → ошибка `empty_task_ids`.
- SQL: bulk_status `done` без комментария → ошибка `result_comment_required`.
- SQL: повтор bulk_status с тем же `_request_id` → 0 новых строк в
  `crm_activity_log`.
- SQL: bulk_update `{ "source": "manual" }` → ошибка `forbidden_field:source`.
- UI: select-all / indeterminate / sticky batch bar; bulk close требует
  ввести комментарий (модалка), затем зовёт RPC.
- `bunx tsgo --noEmit` зелёный.
