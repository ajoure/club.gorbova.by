# ADR-0002: External Company IDs — storage strategy

**Status:** `DRAFT / NOT APPROVED / DO NOT EXECUTE`
**Date:** 2026-07-19 (patch v2)
**Phase:** CRM Companies — Phase 2 (Canonical RPC Layer)
**Related:** `.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md`

## 1. Контекст

Архитектурный freeze Phase 1 запрещает автоматически выводить canonical `public.companies` из AmoCRM. До принятия этого ADR запрещено также добавлять колонку `companies.external_ids`, а external ID компаний должны быть сопоставимы с существующей инфраструктурой маппингов интеграций.

Вопрос ADR: **должна ли Phase 2 добавлять новую колонку/таблицу для external company IDs, или достаточно существующей `integration_field_mappings`?**

## 2. Read-only discovery (фактические outputs)

### 2.1 Точная схема `public.integration_field_mappings`

Query:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='integration_field_mappings'
ORDER BY ordinal_position;
```

Actual output:

| column_name | data_type | is_nullable | default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `instance_id` | uuid | NO | — |
| `entity_type` | text | NO | — |
| `project_field` | text | NO | — |
| `external_field` | text | NO | — |
| `field_type` | text | YES | `'text'` |
| `is_required` | boolean | YES | `false` |
| `is_key_field` | boolean | YES | `false` |
| `transform_rules` | jsonb | YES | `'{}'` |
| `created_at` | timestamptz | NO | `now()` |
| `updated_at` | timestamptz | NO | `now()` |

### 2.2 Индексы и уникальные ограничения

Query: `pg_indexes` для `integration_field_mappings`.

Actual output:

```
integration_field_mappings_pkey
  UNIQUE (id)

integration_field_mappings_instance_id_entity_type_project__key
  UNIQUE (instance_id, entity_type, project_field)

idx_integration_field_mappings_instance
  btree  (instance_id)
```

Уникальность — на связке `(instance_id, entity_type, project_field)`. Уникальности по `(instance_id, entity_type, external_field)` нет; уникальности по `(external_field, external_id)` нет **по определению**, так как `external_id` в таблице отсутствует.

### 2.3 Фактическое содержимое

Query:

```sql
SELECT count(*) FROM public.integration_field_mappings;
SELECT DISTINCT entity_type FROM public.integration_field_mappings;
```

Actual output:

```
count = 0
distinct entity_type = (empty)
```

Таблица **пуста** на момент discovery. Никаких строк `entity_type='company'` (или иных) не существует. Provider-scope через связь `instance_id → integration_instances(provider)`; на пустой таблице конкретные provider-значения (Amo/GetCourse/ManyChat) не наблюдаются, что подтверждает: `integration_field_mappings` не является активным lookup идентификаторов.

### 2.4 Семантика

Столбцы `project_field` и `external_field` — это **имена полей**, не значения идентификаторов. Столбец `external_id` отсутствует. Таблица описывает, как поле проекта отображается в поле внешней системы (тип, обязательность, ключевое ли поле, transform-правила).

### 2.5 Writers/readers по code search (patch v3)

Утверждение «writers/readers отсутствуют, потому что таблица пуста» логически некорректно: пустая таблица не значит, что нет кода, читающего/пишущего в неё. Ниже — фактический вывод code search.

Запрос:

```bash
rg -n "integration_field_mappings" src supabase
```

Actual output (агрегировано, полный список):

**Readers (SELECT):**

- `src/hooks/useIntegrationSync.tsx:127` — `.from("integration_field_mappings").select(...)` (админский UI настройки маппингов).
- `src/hooks/useIntegrationSync.tsx:234` — read перед upsert.
- `src/components/integrations/FieldMappingDialog.tsx:141` — read списка маппингов для диалога.
- `supabase/functions/amocrm-webhook/index.ts:125` — `.from('integration_field_mappings').select(...)` — edge function читает маппинги AmoCRM при обработке webhook.
- `supabase/functions/integration-sync/index.ts:49` — edge function читает маппинги при синхронизации.
- `supabase/functions/getcourse-sync/index.ts:96` — edge function читает маппинги при синхронизации GetCourse.
- `src/pages/admin/AdminSystemAudit.tsx:29, 85` — таблица включена в whitelist аудита (read-only каталог).

**Writers (INSERT/UPDATE/DELETE):**

- `src/hooks/useIntegrationSync.tsx:209` — upsert из UI (админский сохранитель маппингов).
- `src/components/integrations/FieldMappingDialog.tsx:185` — write из диалога маппингов.

**SQL-функции public schema:** отсутствуют. Query:

```sql
SELECT n.nspname, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND pg_get_functiondef(p.oid) ILIKE '%integration_field_mappings%';
```

Actual output: `0 rows`. Никакая RPC или триггер не обращается к таблице.

**Вывод:** readers/writers существуют (админский UI-настройщик маппингов + три integration edge functions), но:

1. они оперируют **именами полей**, а не значениями внешних ID;
2. ни один reader/writer не использует таблицу как lookup `(provider, external_id) → canonical company_id`;
3. отсутствие данных на момент discovery отражает состояние, что даже настройщик ещё не заполнялся, но код готов писать/читать имена полей.

Это подтверждает основное решение ADR-0002: `integration_field_mappings` **не является** таблицей внешних идентификаторов и не пригодна как lookup для company external IDs — независимо от того, есть в ней данные или нет.

### 2.6 Семантика (сводно)

## 3. Требования Phase 2 к external IDs

Phase 2 RPC — `crm_company_get_or_create`, `crm_company_upsert_from_billing`, `crm_company_merge`, `crm_company_link_contact`, `search_companies`, `crm_company_archive`, `crm_company_grp_refetch` — canonical resolve выполняют исключительно по `(country, unp_normalized)`. Список RPC Phase 2, зависящих от external IDs: **пустой**.

## 4. Решение

```
ADR-0002 (DRAFT): external company IDs НЕ хранятся в companies.
- Колонка companies.external_ids не добавляется в Phase 2.
- integration_field_mappings — словарь маппинга полей (field-name → field-name),
  а не lookup-таблица идентификаторов; в ней нет external_id и уникальности,
  необходимой для (provider, external_id) → canonical company_id.
- Отдельная lookup-таблица company_external_ids(company_id, provider, external_id, ...)
  BLOCKED / NEEDS SEPARATE DDL APPROVAL и относится к Phase 9
  (external contacts/companies import) с собственным ADR.
```

## 5. Последствия

- Phase 2 не добавляет DDL к `companies`.
- Core RPC Phase 2 остаются исполнимыми и не зависят от нерешённого external mapping (правка 14).
- Backfill/ingest из Amo (Phase 9) должен принести отдельный ADR со схемой lookup-таблицы, unique-ограничением `(provider, external_id, workspace_id)` и merge-поведением (перенос lookup-строк на target при `crm_company_merge`).

## 6. Rollback / reversal

Миграции этот ADR не порождает — reversal не требуется. Изменение решения — новый ADR-000X.
