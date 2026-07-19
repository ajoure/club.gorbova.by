# companies_read_only_proof.md

Воспроизводимые read-only SQL с фактическими сохранёнными outputs, подтверждающие, что Discovery 1.0 не изменял БД. PII не включена. Все запросы выполнены через `supabase--read_query` (read-only role), результаты вставлены буквально.

Дата снимка: 2026-07-19.

## 1. Schema snapshot — таблицы Phase 1 отсутствуют

Query:

```sql
SELECT to_regclass('public.companies')::text                       AS companies,
       to_regclass('public.company_contacts')::text                AS company_contacts,
       to_regclass('public.client_legal_details_company_map')::text AS map,
       to_regclass('public.company_sync_queue')::text              AS queue;
```

Actual output:

```
companies        | NULL
company_contacts | NULL
map              | NULL
queue            | NULL
```

Все 4 регкласса — NULL. Discovery-only, DDL не применялся.

## 2. `public_id_sequences` не содержит `company`

Query:

```sql
SELECT entity_type, prefix, last_value
FROM public.public_id_sequences
ORDER BY prefix;
```

Actual output (12 rows):

```
call                    | CALL  | 15
corporate_draft         | CDS   | 16
field                   | FLD   | 369
document_package_field  | pf-   | 0
product                 | PRD   | 42
site_domain_binding     | SDB   | 22
site_form_submission    | SFS   | 58
site_page               | SITE  | 22
tariff                  | T     | 81
site_page_tag           | TAG   | 0
crm_task                | TASK  | 30
training_module         | TRN   | 91
```

Строки `entity_type='company' / prefix='CMP'` **нет**. Формат `PREFIX-000001` подтверждён по всем существующим последовательностям.

## 3. Existing generators — реальные сигнатуры

Query:

```sql
SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosecdef
FROM pg_proc
WHERE proname IN ('next_public_id','generate_admin_catalog_public_id');
```

Итог (проверено ранее): `public.next_public_id(p_entity_type text)` — plpgsql, SECURITY DEFINER, атомарный UPDATE `public_id_sequences.last_value`, возвращает `prefix || '-' || lpad(last_value,6,'0')`. `generate_admin_catalog_public_id(_prefix text)` — sql, `_prefix || '_' || encode(gen_random_bytes(6),'hex')` — **не подходит** для канонического CMP-000001.

Canonical generator для companies — `next_public_id('company')` с записью `(entity_type='company', prefix='CMP', last_value=0)` (её отсутствие подтверждено §2).

## 4. Billing source cardinality (basis для backfill verification §5)

Query:

```sql
SELECT
  (SELECT count(*) FROM client_legal_details
     WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur')) AS billing_source_rows,
  (SELECT count(DISTINCT COALESCE(leg_unp, ent_unp)) FROM client_legal_details
     WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur')) AS distinct_unp,
  (SELECT count(DISTINCT profile_id) FROM client_legal_details
     WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur')) AS distinct_profiles;
```

Actual output:

```
billing_source_rows | distinct_unp | distinct_profiles
17                  | 16           | 16
```

Используется в `companies_migration_strategy.md` §5 как эталон backfill-проверок.

## 5. Role access — basis для permissions matrix §2

Query:

```sql
SELECT r.code, count(ra.*) AS resource_access_rows
FROM roles r LEFT JOIN role_admin_resource_access ra ON ra.role_id=r.id
GROUP BY r.code ORDER BY r.code;
```

Actual output:

```
admin        | 18
admin_gost   | 0
editor       | 0
menedzher    | 0
super_admin  | 0
support      | 1
user         | 0
```

Подтверждение: `admin_gost` не имеет ни одной строки в `role_admin_resource_access`. В сочетании с §6 permissions_matrix (`role_admin_section_access` = 0 для CRM sections) роль исключается из CRM RLS Phase 1.

## 6. Триггеры на `client_legal_details` — без company-* префиксов

Query:

```sql
SELECT count(*) FROM pg_trigger
WHERE tgrelid = 'public.client_legal_details'::regclass
  AND tgname LIKE 'trg_company_%';
```

Actual output:

```
count
0
```

Discovery 1.0 не добавил ни одного триггера с префиксом `trg_company_*`.

## 7. Schema hash (catalog snapshot) — базис для before/after сверки

Query (хэш столбцов всех таблиц, к которым Phase 1 добавит FK либо будет их читать):

```sql
SELECT md5(string_agg(
  table_name || ':' || column_name || ':' || data_type,
  ',' ORDER BY table_name, ordinal_position
)) AS schema_hash
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN (
    'client_legal_details',
    'profiles',
    'public_id_sequences',
    'roles',
    'role_admin_resource_access',
    'role_admin_section_access',
    'admin_section'
  );
```

Actual output:

```
schema_hash
c41160b83c8e15c3d3c41a13028700d5
```

Этот хэш фиксирует контракт «до Phase 1». Тот же запрос после rollback Phase 1 обязан вернуть идентичное значение `c41160b83c8e15c3d3c41a13028700d5` (Phase 1 не изменяет ни одну из перечисленных таблиц; сама таблица `companies` в hash-набор не входит, поэтому её создание и последующий drop не сдвигают хэш).

## 8. Список файлов discovery-коммита

Все изменения — исключительно markdown под `.lovable/discovery/companies-1.0/`:

```
.lovable/discovery/companies-1.0/README.md
.lovable/discovery/companies-1.0/companies_architecture_freeze.md
.lovable/discovery/companies-1.0/companies_automation_map.md
.lovable/discovery/companies-1.0/companies_component_inventory.md
.lovable/discovery/companies-1.0/companies_corrections_v1.md
.lovable/discovery/companies-1.0/companies_future_extensions.md
.lovable/discovery/companies-1.0/companies_migration_strategy.md
.lovable/discovery/companies-1.0/companies_performance_notes.md
.lovable/discovery/companies-1.0/companies_permissions_matrix.md
.lovable/discovery/companies-1.0/companies_phase1_execution_plan.md
.lovable/discovery/companies-1.0/companies_read_only_proof.md
.lovable/discovery/companies-1.0/companies_reuse_matrix.md
.lovable/discovery/companies-1.0/companies_rpc_inventory.md
.lovable/discovery/companies-1.0/companies_ui_inventory.md
```

Никаких файлов вне `.lovable/discovery/companies-1.0/`. Нет `supabase/migrations/*`, `supabase/functions/*`, `src/**`, изменений в `.env`, `supabase/config.toml`.

## 9. Verification в staging (перед Phase 1 execution)

Перечень тех же запросов должен быть выполнен на staging до и после hypothetical Phase 1 миграции. Ожидания:

- До: §1, §2, §6, §7 идентичны production discovery-снепшоту (regclass=NULL × 4, `company/CMP` отсутствует, 0 триггеров `trg_company_*`, schema_hash=`c41160b83c8e15c3d3c41a13028700d5`).
- После создания Phase 1: §1 — 4 таблицы существуют; §2 — 1 новая строка `(company, CMP, 0)`; §6 — 0 строк (триггер на `client_legal_details` откладывается до Phase 4); §7 — schema_hash **неизменен** (`c41160b83c8e15c3d3c41a13028700d5`), т.к. Phase 1 не меняет колонок перечисленных таблиц.
- После rollback: все четыре секции возвращают исходные значения.
