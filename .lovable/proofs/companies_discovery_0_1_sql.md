# Proofs: SQL для Companies Discovery 0.1

Дата: 2026-07-07. Все запросы — read-only.

## 1. Workspace / tenant model

### 1.1 Колонки `workspace_id` / `tenant_id`

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema='public' AND column_name IN ('workspace_id','tenant_id')
ORDER BY table_name;
```

**Результат (21 строка):**

| table_name | column |
|---|---|
| admin_resource | workspace_id |
| admin_section | workspace_id |
| call_events | workspace_id |
| call_sync_queue | workspace_id |
| calls | workspace_id |
| crm_task_automation_rules | workspace_id |
| crm_task_types | workspace_id |
| **crm_tasks** | **workspace_id** |
| individual_requisites | tenant_id |
| integration_credentials | workspace_id |
| integrations | workspace_id |
| **legal_entities_requisites** | **tenant_id** |
| role_admin_resource_access | workspace_id |
| role_admin_section_access | workspace_id |
| site_domain_bindings | workspace_id |
| site_form_submissions | workspace_id |
| site_page_folders | workspace_id |
| site_page_tags | workspace_id |
| site_pages | workspace_id |
| sms_messages | workspace_id |
| tenant_memberships | tenant_id |

**Важно:** `crm_pipelines`, `orders_v2`, `profiles`, `client_legal_details`, `crm_activity_log`, `entitlements` — колонки нет вообще.

### 1.2 Реальное заполнение

```sql
SELECT workspace_id, COUNT(*) FROM crm_tasks GROUP BY 1;
-- 00000000-0000-0000-0000-000000000001 | 11   (единственное значение)

SELECT COUNT(*), COUNT(*) FILTER (WHERE is_personal) AS personal,
       COUNT(*) FILTER (WHERE NOT is_personal) AS non_personal
FROM tenants;
-- 256 | 255 | 1

SELECT id, name, is_personal FROM tenants WHERE NOT is_personal;
-- 00000000-0000-0000-0000-000000000001 | system | f
```

**Вывод:** CRM-контур сейчас фактически single-workspace. Существует единственный «system» tenant `00000000-…-000000000001`, к нему привязаны все `crm_tasks`. `tenants` в остальном заполнены personal-строками (255), но операционно они НЕ используются для CRM (`crm_pipelines/orders_v2/profiles` без tenant-колонки). Multi-workspace = dormant.

### 1.3 Роли

`user_roles_v2`, `has_role_v2()` — глобальные (нет workspace-скоупа в сигнатуре). Подтверждено ранее в `.lovable/discovery/crm-tasks-diagnose.md`.

**Решение для Phase 1:** `companies.workspace_id NOT NULL DEFAULT '00000000-…-000000000001'` допустим. Multi-workspace миграция — отдельный follow-up (см. Master Plan §11).

## 2. Семантика `legal_details_persons.profile_id` — КРИТИЧНО

### 2.1 Распределение

```sql
SELECT COUNT(*) total, COUNT(*) FILTER (WHERE profile_id IS NULL) null_pid,
       COUNT(*) FILTER (WHERE profile_id IS NOT NULL) with_pid,
       COUNT(DISTINCT profile_id) distinct_pids
FROM legal_details_persons;
-- 4 | 0 | 4 | 2
```

### 2.2 Что реально хранится

```sql
SELECT ldp.id, ldp.profile_id, p.user_id, p.telegram_username, p.first_name, ldp.full_name
FROM legal_details_persons ldp
LEFT JOIN profiles p ON p.id = ldp.profile_id;
```

| ldp.id | ldp.profile_id | profiles.first_name | ldp.full_name |
|---|---|---|---|
| 9f6a564a… | a4b7c8c9… | Сергей | **Петров Петр Петрович** |
| 26402449… | a4b7c8c9… | Сергей | **Федорчук Сергей Валерьвич** |
| 77aa175a… | a4b7c8c9… | Сергей | **Иванов Петр** |
| 1149bcb3… | 3c148831… | Ольга  | **Мацкевич Ольга Павловна** |

**Вывод — доказано данными:**

`legal_details_persons.profile_id` = **владелец ЛК-карточки** (тот, кто добавил персону в своих реквизитах), а НЕ CRM-контакт самого физлица. Один Сергей завёл 3 персоны (Петров/Федорчук/Иванов), у всех трёх `profile_id` = Сергея.

Автоматически мапить `legal_details_persons.profile_id` → `company_contacts.profile_id` **ЗАПРЕЩЕНО** — иначе директор «Петров» окажется привязан к профилю Сергея. В Phase 2 backfill для `company_contacts.profile_id` нужен отдельный matcher (по ФИО+email+phone против `profiles`), либо оставляем `profile_id = NULL` для внешних персон.

## 3. Схемы источников

### 3.1 `client_legal_details` (54 колонки)

Юр-поля: `client_type` (ind/ent/leg), `ind_*` (паспорт/адрес физлица), `ent_*` (ИП: `ent_name/ent_unp/ent_address/ent_acts_on_basis`), `leg_*` (юрлицо: `leg_org_form/leg_name/leg_unp/leg_address/leg_director_position/leg_director_name/leg_acts_on_basis`), банковские (`bank_account/bank_name/bank_code`), GRP-обогащение (`grp_*`), `profile_id` (владелец ЛК), `is_default`, `validation_status`.

**Ключ для companies:** `ent_unp` XOR `leg_unp` → нормализованный УНП.

### 3.2 `legal_entities_requisites` (13 колонок)

Мультитенантная (`tenant_id`), поля: `owner_user_id`, `owner_profile_id`, `scope`, `subject_type`, `is_default`, `data jsonb` (все реквизиты внутри JSON), `source_legacy_id` (связь с `client_legal_details.id`).

### 3.3 `legal_details_entity_person_links` (17 колонок)

`legal_details_id` → `client_legal_details.id`, `person_id` → `legal_details_persons.id`, `role_type/role_catalog_id`, `position_catalog_id/custom_position_text`, `share_percent`, `acts_on_basis`, `is_primary`, `start_date/end_date`, `profile_id` (владелец, аналогично LDP).

**Это уже готовая bridge-таблица** «карточка реквизитов ↔ персоны/роли». Она станет источником для `company_contacts` в Phase 2 backfill.

### 3.4 `companies` — не существует

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name ILIKE '%compan%';
-- 0 rows
```

Namespace свободен.

## 4. `profile_id` — полный список таблиц (40)

Ниже — все таблицы с колонкой `profile_id`. Полная семантическая карта — в `.lovable/proofs/companies_dependency_map_0_1.md` §2.

```
access_grant_ledger, ai_document_generation_batches, ai_generated_documents,
ban_cases, card_profile_links, client_duplicates, client_legal_details,
corporate_draft_sessions, document_package_sessions, document_package_templates,
email_logs, email_threads, entitlements, generated_documents, instagram_contacts,
legal_details_entity_person_links, legal_details_persons, marketing_insights,
orders_v2, payments_v2, provider_subscriptions, site_form_submissions,
subscriptions_v2, support_tickets, telegram_club_members, telegram_invite_links,
trial_blocks
(+ 13 backup/rev таблиц — не в скоупе)
```
