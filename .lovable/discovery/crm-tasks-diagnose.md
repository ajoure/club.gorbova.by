# DIAGNOSE: CRM-задачи — текущие сущности (Шаг 0)

Дата: 2026-06-29

## 1. SoT сущностей

| Сущность | SoT таблица | Подтверждение |
|---|---|---|
| Сделка | `public.orders_v2` (id, profile_id, pipeline_id, pipeline_stage_id, customer_email) | Отдельной `deals` таблицы нет |
| Контакт | `public.profiles` (id, telegram_user_id) | Отдельной `contacts` таблицы нет |
| Воронка/стадия | `public.crm_pipelines`, `public.crm_pipeline_stages` | OK |
| Оффер/тариф/продукт | `tariff_offers` → `tariffs` → `products_v2` | OK |
| Роли | `roles`, `user_roles_v2`, `has_role_v2()` | OK |

## 2. Workspace / tenant

- `orders_v2`, `profiles`, `crm_pipelines` — **без** `tenant_id`/`workspace_id` (single-deployment).
- `admin_section.workspace_id` = NULL во всех строках.
- Существуют `public.tenants` (255 записей, все `is_personal=true`) и `public.tenant_memberships` — но не используются операционно для CRM.

**Решение:** для соблюдения требования «без `workspace_id` таблицу задач не создавать»:
- В миграции вводим SYSTEM workspace UUID `00000000-0000-0000-0000-000000000001` как DEFAULT.
- `crm_tasks.workspace_id NOT NULL DEFAULT <system>`.
- Создаём служебную запись в `public.tenants` с этим id (`is_personal=false`, `name='system'`).
- RLS-политика проверяет: `has_role_v2(auth.uid(), 'admin'|'super_admin'|'employee')` AND `workspace_id = <system>` (на будущее — расширяемо).

## 3. Уведомления — текущая инфраструктура

| Канал | Что есть | Используем |
|---|---|---|
| Domain events | `public.domain_events`, `public.domain_executions` | Да: эмитим `crm.task.created/status_changed/reassigned` |
| Telegram | `pending_telegram_notifications`, edge function `telegram-send` (через connector gateway) | Да: воркер `crm-task-notify-worker` отправляет через Telegram адаптер |
| Email | `email_logs`, `notification_outbox` | Опционально (фаза 2) |
| In-app | — | Опционально (фаза 2) |

Прямой `pg_net` из RPC — **запрещён**. RPC только эмитит `domain_events` + плановые строки в `crm_task_notifications`. Воркер вызывается по cron-tick.

## 4. Telegram chat_id менеджера

- `profiles.telegram_user_id` — для всех ролей, включая менеджеров.
- `telegram_access` — для участников клубов; для уведомлений менеджеров не используем.

## 5. crm_activity_log

- Существует, используется для трекинга активности по сделкам.
- В новой системе задач **не дублируем** содержимое; пишем туда compact-запись при ключевых переходах (created/closed/canceled) для совместимости с существующей лентой активности.

## 6. T-000074 (ИНДИВИДУАЛЬНЫЙ ДОГОВОР)

- `tariff_id = 6ff1769e-2103-42ab-ab70-c77dff2c2ed5`
- `offer_id = 7b939741-e941-4dbc-b820-803cd7f307bc`
- `offer_type = preregistration`

## 7. Канонические утилиты

- `public.update_updated_at_column()` — есть, используем для триггеров `updated_at`.
- `public.public_id_sequences` (entity_type, prefix, last_value) — используем шаблон существующих триггеров (`trg_set_*_public_id`) для генерации `TASK-XXXXXX`.
- `has_role_v2(uuid, text)` — есть, используем в RLS.

## 8. Compatibility layer (помечено явно)

| Что | Compat-флаг | Удалить когда |
|---|---|---|
| Чтение `tariff_offers.meta.auto_tasks[]` параллельно с `crm_task_automation_rules` | `compatibility_layer=true` в meta правил при миграции | После Шага 9 (миграция meta → таблица) |
| `crm_tasks.deal_id → orders_v2.id` (а не `deals.id`) | колонка `order_id` зарезервирована, FK на `orders_v2(id)` | После выноса сделок в отдельную таблицу |

## 9. Add-only гарантии

Ничего из существующего не меняем:
- `orders_v2` — без изменений.
- `crm_pipelines`, `crm_pipeline_stages` — без изменений.
- `crm_activity_log` — только новые INSERT, без alter.
- `tariff_offers.meta.auto_tasks` — читаем, не пишем (UI правил — отдельная таблица).
- `create_preorder_deal_atomic` — добавим вызов `crm_task_apply_automation` в конце, **за фичефлагом** `feature.crm_tasks.enabled`.
