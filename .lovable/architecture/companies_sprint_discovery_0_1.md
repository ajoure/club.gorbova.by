# CRM Companies — Discovery 0.1 (Phase 0 addendum)

Дата: 2026-07-07. Read-only research. **DDL / migrations / RPC / edge / UI не менялись.**

Полные SQL-выкладки: [`.lovable/proofs/companies_discovery_0_1_sql.md`](../proofs/companies_discovery_0_1_sql.md)
Полная карта зависимостей: [`.lovable/proofs/companies_dependency_map_0_1.md`](../proofs/companies_dependency_map_0_1.md)
Мастер-план фаз: [`companies_master_implementation_plan.md`](./companies_master_implementation_plan.md)

## Контекст (базовое соглашение из Phase 0)

- `companies` + `company_contacts` — отдельные canonical-сущности.
- `profiles` НЕ становится switch contact/company.
- `client_legal_details`, `legal_entities_requisites` — источники + compat-layer.
- `access` / `telegram` / `entitlements` — навсегда за `profile_id`, никогда за `company_id`.

## 1. Карта RPC / edge functions

Полная таблица «функция → чтение/запись → риск → действие» — в `dependency_map §1`.

Кратко по кластерам:

- **document-flows** (`canonical-document-*`, `ai-generate-*`, legacy `generate-invoice-*`, `document-field-resolver-v2*`) — только читают `client_legal_details`/`legal_details_*`/`legal_entities_requisites`. Не трогаем до Phase 10 (compat-layer).
- **payment/order-flows** (`bepaid-*`, `stripe-*`, `direct-charge`, `subscription-*`, `admin-*`) — тяжёлый writer-круг `orders_v2/payments_v2`. `company_id` добавляется только в Phase 5, nullable, без вмешательства в webhooks.
- **access/entitlements** (`grant-access-for-order`, `access-rules-nightly-reconcile`, `telegram-*-access*`, `subscriptions-reconcile`, `repair-module-entitlements`) — **freeze list**, никогда не получают `company_id`.
- **crm-tasks/calls/activity** (`crm-task-notify-worker`, `vochi-call-initiate`) — расширяются в Phase 6, nullable `company_id`.
- **ЛК writers** (`useLegalDetails`, `LegalDetailsPickerDialog`, corporate драфты) — единственная точка, где INSERT/UPDATE `client_legal_details`. Здесь в Phase 4 подключается `crm_company_upsert_from_legal_details`.

## 2. Карта `profile_id` (40 таблиц)

Полная семантика — в `dependency_map §2`.

Ключевой вывод: `profile_id` в кодовой базе имеет 4 разные семантики (**owner / contact / subject / holder**), которые часто путаются. Правило добавления `company_id` — **только к таблицам с семантикой owner или subject-в-бизнес-контексте (заказ, документ)**. К таблицам с семантикой subject-в-access-контексте (`entitlements`, `telegram_*`, `trial_blocks`, `access_grant_ledger`) — никогда.

## 3. Семантика `legal_details_persons.profile_id` — доказано данными

**Данные (`proofs §2.2`):**

| ldp.full_name | ldp.profile_id → profiles.first_name |
|---|---|
| Петров Петр Петрович | Сергей |
| Федорчук Сергей Валерьвич | Сергей |
| Иванов Петр | Сергей |
| Мацкевич Ольга Павловна | Ольга |

`profile_id` в `legal_details_persons` = **владелец ЛК-карточки**, тот, кто добавил персону в своих реквизитах. Это НЕ CRM-контакт самой персоны.

**Решение (v2, принято в Master Plan §3.1):**

`legal_details_persons` и `legal_details_entity_person_links` **полностью исключены из CRM auto-source**. Причина: эти таблицы обслуживают пакеты документов (роли подписантов, договоры, генерация документов) и содержат данные, которые не должны автоматически становиться CRM-контактами компании клиента.

- В Phase 3 backfill НЕ используются.
- В Phase 4 sync НЕ используются.
- В базе прозвона НЕ участвуют.
- `company_contact_person_map` в Phase 1 НЕ создаётся; перенесена в deferred/Phase 10 Documents follow-up (только через отдельный approval).
- Persons matcher (ФИО+phone+email → profiles) и review-очередь — тоже deferred в Phase 10, только через approval.

**Единственный источник `company_contacts` при auto-backfill (Phase 3):** владелец ЛК-карточки `client_legal_details.profile_id` с `relationship_type='billing_contact'`, `is_billing_contact=true`, `source='billing_requisites'`.

## 4. Safety-net sync — решение

- **Основной путь:** синхронный вызов RPC `crm_company_upsert_from_legal_details(legal_details_id)` из UI/edge после INSERT/UPDATE `client_legal_details`.
- **Safety-net:** новая `company_sync_queue` ИЛИ переиспользование `notification_outbox` (окончательный выбор — в Phase 1 плане, с pro/con).
- **Обработчик:** cron-воркер `company-sync-worker`, идемпотентно.
- **Запрещено:** trigger → `pg_net` → RPC. Помечено как deferred (см. Master Plan Open Questions).
- **Конфликты реквизитов:** never silent overwrite. При несовпадении УНП/название — создаётся review-запись, старое поле не перезаписывается.

## 5. Workspace / tenant

Доказано (`proofs §1`):

- Из целевых таблиц колонку `workspace_id` имеют только `crm_tasks`, `calls`, `call_events`, `call_sync_queue`, `crm_task_types`, `crm_task_automation_rules`, `admin_*`, `integrations`, `site_*`, `sms_messages`.
- `crm_pipelines`, `orders_v2`, `profiles`, `client_legal_details`, `crm_activity_log`, `entitlements` — без workspace/tenant.
- Единственный non-personal tenant = `00000000-…-000000000001` («system»).
- `crm_tasks`: 11/11 строк с этим system workspace_id.
- Роли (`user_roles_v2`, `has_role_v2`) — глобальные.

**Вывод:** сейчас CRM = single-workspace. Для `companies` допустим `workspace_id NOT NULL DEFAULT '00000000-…-000000000001'`. Multi-workspace миграция — отдельный follow-up (Master Plan §11).

## 6. Ready-for-Phase-1 checklist (фактические статусы)

| # | Пункт | Статус | Комментарий |
|---|---|---|---|
| 1 | Карта RPC/edge собрана | **yes** | `dependency_map §1` |
| 2 | Карта `profile_id` собрана | **yes** | `dependency_map §2`, 40 таблиц |
| 3 | Семантика `legal_details_persons.profile_id` подтверждена SQL | **yes** | `proofs §2` — доказано, что это owner, не подписант |
| 4 | Safety-net решение зафиксировано (сервис + queue, trigger→pg_net отложен) | **yes** | §4 выше |
| 5 | Workspace-модель подтверждена (single vs multi) | **yes** | single, system tenant |
| 6 | Список «нельзя трогать» составлен (access/telegram/entitlements/purchases) | **yes** | `dependency_map §4` |
| 7 | Master Implementation Plan написан | **yes** | `companies_master_implementation_plan.md` |
| 8 | Open questions зафиксированы | **yes** | Master Plan §11 |

**Итог: все пункты = yes. Готово к формированию отдельного документа «План: CRM Companies — Phase 1 Canonical Data Model».** Тот план ещё не написан — это следующий шаг, отдельным approval.

## 7. Draft: краткое соответствие фазам Master Plan

Полный phase-by-phase план вынесен в отдельный файл: [`companies_master_implementation_plan.md`](./companies_master_implementation_plan.md).

Здесь — только заголовки для быстрой сверки:

1. **Phase 1** — Canonical Data Model (`companies`, `company_contacts`, bridge-таблицы, `company_sync_queue`, RPC-скелеты).
2. **Phase 2** — Backend / RPC / services.
3. **Phase 3** — Backfill / dry-run / mapping.
4. **Phase 4** — ЛК → Company sync.
5. **Phase 5** — Orders / deals integration.
6. **Phase 6** — CRM tasks / calls / activity.
7. **Phase 7** — UI Companies (`/admin/companies`).
8. **Phase 8** — ContactDetailSheet integration.
9. **Phase 9** — Import / call-center база прозвона.
10. **Phase 10** — Documents / corporate module compatibility.
11. **Phase 11** — System health / invariants / final regression.

## Ограничения этой фазы (что НЕ было сделано)

- Не созданы таблицы `companies`, `company_contacts`, `client_legal_details_company_map`, `company_contact_person_map`, `company_sync_queue`.
- Не добавлены колонки `company_id` ни в одну таблицу.
- Не написаны migrations / RPC / edge / UI.
- Не запущен backfill.
- Единственные затронутые файлы — markdown-документы Discovery/плана в `.lovable/architecture/`, `.lovable/proofs/`, `.lovable/plan.md`.
