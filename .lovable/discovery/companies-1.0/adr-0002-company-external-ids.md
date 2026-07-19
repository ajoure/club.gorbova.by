# ADR-0002: External Company IDs — storage strategy

**Status:** `DRAFT / NOT APPROVED / DO NOT EXECUTE`
**Date:** 2026-07-19
**Phase:** CRM Companies — Phase 2 (Canonical RPC Layer)
**Related:** `.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md`

## 1. Контекст

Архитектурный freeze Phase 1 запрещает автоматически выводить canonical `public.companies` из AmoCRM. До принятия этого ADR запрещено также добавлять колонку `companies.external_ids` (jsonb или массив), а external ID компаний должны быть сопоставимы с существующей инфраструктурой маппингов интеграций.

Вопрос ADR: **должна ли Phase 2 добавлять новую колонку/таблицу для external company IDs, или достаточно существующей `integration_field_mappings`?**

## 2. Read-only discovery

Все запросы — только `SELECT`. Никакой DDL/DML.

### 2.1 Схема `public.integration_field_mappings`

| column | type | nullable |
|---|---|---|
| `id` | uuid | NO |
| `instance_id` | uuid | ? (references `integration_instances`) |
| `entity_type` | text | ? |
| `project_field` | text | ? |
| `external_field` | text | ? |
| `field_type` | text | ? |
| `is_required` | boolean | ? |
| `is_key_field` | boolean | ? |
| `transform_rules` | jsonb | ? |
| `created_at` | timestamptz | ? |
| `updated_at` | timestamptz | ? |

### 2.2 Индексы

```
integration_field_mappings_pkey                                  UNIQUE (id)
integration_field_mappings_instance_id_entity_type_project__key  UNIQUE (instance_id, entity_type, project_field)
idx_integration_field_mappings_instance                          btree  (instance_id)
```

Ключевое наблюдение: unique-constraint покрывает `(instance_id, entity_type, project_field)`. Нет уникальности по `(instance_id, entity_type, external_field)`.

### 2.3 Семантика

`integration_field_mappings` — это **словарь маппинга полей** между внешней системой (Amo/GetCourse/ManyChat) и project-полями. Он **не является** таблицей хранения пар `(external_id → companies.id)`.

## 3. Требования Phase 2 к external IDs

Phase 2 RPC (`crm_company_get_or_create`, `crm_company_upsert_from_billing`, `crm_company_merge`, `crm_company_link_contact`, `search_companies`, `crm_company_archive`, `crm_company_grp_refetch`) **не читают и не пишут** external ID: canonical resolve выполняется исключительно по `(country, unp_normalized)`.

Список RPC Phase 2, зависящих от external IDs: **пустой**.

## 4. Решение

```
ADR-0002 (DRAFT): external company IDs НЕ хранятся в companies.
Колонка companies.external_ids не добавляется в Phase 2.
integration_field_mappings — это словарь маппинга полей, а не lookup-таблица идентификаторов.
Отдельная lookup-таблица `company_external_ids(company_id, provider, external_id, ...)`
BLOCKED / NEEDS SEPARATE DDL APPROVAL и относится к Phase 9 (external contacts/companies import).
```

## 5. Последствия

- Phase 2 не добавляет DDL к таблице `companies`.
- Phase 2 RPC остаются исполнимыми и не зависят от нерешённого external mapping (правка 14 плана).
- Backfill/ingest из Amo (Phase 9) должен принести отдельный ADR со схемой lookup-таблицы, unique-ограничением `(provider, external_id, workspace_id)` и merge-поведением (перенос lookup-строк на target при `crm_company_merge`).

## 6. Rollback / reversal

Никакой миграции этот ADR не порождает — reversal не требуется. Изменение решения — новый ADR-000X.
