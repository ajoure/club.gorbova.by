# companies_automation_map.md

Automation, activity, domain events, audit для Companies.

## 1. Разделение по таблицам (копия §4 из freeze)

| Событие | crm_activity_log | domain_events | audit_logs |
|---|---|---|---|
| `company.created` (auto из billing) | ✅ `source_entity_type='company'` | ✅ `event_type='company.created.v1'` | ❌ |
| `company.created` (admin manual) | ✅ | ✅ | ✅ action=`company.create` |
| `company.updated` (admin) | ✅ | conditionally | ✅ |
| `company.updated` (auto sync) | ✅ compact | ✅ | ❌ |
| `company.merged` | ✅ | ✅ | ✅ |
| `company.archived` | ✅ | ✅ | ✅ |
| `company.link_contact` | ✅ | ✅ | ❌ |
| `company.unlink_contact` | ✅ | ✅ | ✅ (если admin) |
| `company.link_deal` | ✅ | ✅ | ❌ |
| `company.field_conflict_resolved` | ✅ | ❌ | ✅ |
| `company.grp_refetched` | ✅ compact | ✅ | ❌ |
| Backfill batch | ❌ (шум) | ✅ (lineage/executions) | ❌ |

## 2. Existing automation rules

`db: public.crm_task_automation_rules` — 16 колонок, 3 policies. Триггерят создание задач при событиях сделки/контакта.

**Проверка покрытия для Companies:**

- `company.created` → создать задачу «Проверить реквизиты новой компании» (assign to CRM manager) — **требуется расширение** `crm_task_automation_rules` набором триггерных источников. В текущей модели правил источник — event bus (см. `applier: crm_task_apply_automation`). Расширение: добавить в `trigger_event` набор `company.*` (data-only, без DDL, если это jsonb-поле).
- `company.linked_to_deal` → пере-назначить существующие задачи сделки на company-scope (Phase 6).

**Вердикт:** существующая инфраструктура правил переиспользуется. В Phase 6 добавить в `crm_task_apply_automation` обработку `company.*` событий. Новых таблиц не нужно.

## 3. `tariff_offers.meta.auto_tasks[]` (compatibility layer)

Для Companies не используется. Auto-tasks остаются привязанными к оффер/сделке.

## 4. Триггеры на `orders_v2`

`orders_v2` — SoT сделок. Компания фигурирует как FK `orders_v2.company_id` (nullable, Phase 5). Триггер на UPDATE `company_id` эмитит `domain_event company.linked_to_deal.v1`.

## 5. Sync events

Собственная очередь `company_sync_queue` (см. freeze §5). Воркер `company-sync-worker`:

- pull batch → apply → emit `crm_activity_log` (compact) + `domain_events` (`company.synced.v1`, `company.grp_refetched.v1`).
- Ретраи: `attempts`, `next_run_at`, `last_error`, `locked_by`.

## 6. Notifications

- Уведомления идут через `notification_outbox` (Telegram) — единственный существующий канал уведомлений для admin/menedzher. Payload: `channel='telegram'`, `message_type='company.new'`, `meta.company_id`.
- Триггер уведомления — воркер `company-sync-worker` при `status_changed='created'` эмитит row в `notification_outbox`.

## 7. Что запрещено

- Не эмитить `domain_events` для каждой строки backfill (шум); использовать `domain_executions` для lineage.
- Не писать backfill-строки в `crm_activity_log` — только реальные бизнес-события.
- Не создавать новый `company_activity_log` — переиспользовать `crm_activity_log`.
