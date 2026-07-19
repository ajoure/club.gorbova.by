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

Read-only проверка: `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_task_automation_rules' AND column_name='trigger_event'` — `trigger_event` имеет тип `text` (не jsonb). Формулировка «если это jsonb-поле» из ранней версии отозвана.

- `company.created` → задача «Проверить реквизиты новой компании» (assign to CRM manager). Расширение — Phase 6: добавить строки в `crm_task_automation_rules` с `trigger_event='company.created.v1'` (без DDL, `text` не имеет CHECK constraint).
- `company.linked_to_deal` → Phase 6: правила company-scope.

**Вердикт:** существующая инфраструктура правил переиспользуется. В Phase 6 `crm_task_apply_automation` расширяется обработкой `company.*`. Новых таблиц не нужно.

## 3. `tariff_offers.meta.auto_tasks[]` (compatibility layer)

Для Companies не используется. Auto-tasks остаются привязанными к оффер/сделке.

## 4. Триггеры на `orders_v2`

`orders_v2.company_id` — Phase 5. Триггер на UPDATE `company_id` эмитит `domain_event company.linked_to_deal.v1`.

## 5. Sync events (Phase 4, не Phase 1)

Trigger `AFTER INSERT/UPDATE ON client_legal_details` **отсутствует в Phase 1** — прямая cross-domain связь Billing → CRM запрещена платформенным правилом «междоменные действия — через события». Поток:

```
save billing details in client_legal_details
  → guarded RPC crm_company_upsert_from_billing (Phase 2)
  → domain_event company.upserted_from_billing.v1
  → safety-net trigger enqueue в company_sync_queue (Phase 4)
  → company-sync-worker (Phase 4)
  → emit crm_activity_log (compact) + domain_events
```

Ретраи: `attempts`, `next_run_at`, `last_error`, `locked_by`. Canonical `idempotency_key` — см. `companies_migration_strategy.md` §6.

## 6. Notifications

- Уведомления идут через `notification_outbox` (Telegram) — единственный существующий канал уведомлений для admin/menedzher. Payload: `channel='telegram'`, `message_type='company.new'`, `meta.company_id`.
- Триггер уведомления — воркер `company-sync-worker` при `status_changed='created'` эмитит row в `notification_outbox`.

## 7. Что запрещено

- Не эмитить `domain_events` для каждой строки backfill (шум); использовать `domain_executions` для lineage.
- Не писать backfill-строки в `crm_activity_log` — только реальные бизнес-события.
- Не создавать новый `company_activity_log` — переиспользовать `crm_activity_log`.
