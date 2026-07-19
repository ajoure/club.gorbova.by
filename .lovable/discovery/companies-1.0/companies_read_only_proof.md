# companies_read_only_proof.md

Воспроизводимые read-only SQL, подтверждающие, что Discovery 1.0 не изменял БД. PII не включена.

## 1. Schema snapshot — таблицы Phase 1 отсутствуют

```sql
SELECT to_regclass('public.companies'),
       to_regclass('public.company_contacts'),
       to_regclass('public.client_legal_details_company_map'),
       to_regclass('public.company_sync_queue');
-- Ожидание: 4 × NULL. Discovery-only, DDL не применялся.
```

## 2. `public_id_sequences` не содержит `company`

```sql
SELECT entity_type, prefix, last_value
FROM public.public_id_sequences
ORDER BY prefix;
-- Проверено: prefixes = CALL, CDS, FLD, PRD, SDB, SFS, SITE, T, TAG, TASK, TRN, pf-.
-- Строки entity_type='company' / prefix='CMP' нет.
```

## 3. Existing generators — реальные сигнатуры

```sql
SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc
WHERE proname IN ('next_public_id','generate_admin_catalog_public_id');
-- next_public_id(p_entity_type text) → plpgsql SECURITY DEFINER,
--   формат `prefix || '-' || lpad(last_value,6,'0')`.
-- generate_admin_catalog_public_id(_prefix text) → sql,
--   формат `_prefix || '_' || encode(gen_random_bytes(6),'hex')` — не подходит для CMP-000001.
```

## 4. Billing source cardinality (basis для backfill verification §5)

```sql
SELECT
  (SELECT count(*) FROM client_legal_details
     WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur')) AS billing_source_rows,
  (SELECT count(DISTINCT COALESCE(leg_unp, ent_unp)) FROM client_legal_details
     WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur')) AS distinct_unp,
  (SELECT count(DISTINCT profile_id) FROM client_legal_details
     WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur')) AS distinct_profiles;
-- Результат на момент discovery: billing_source_rows=17, distinct_unp=16, distinct_profiles=16.
```

## 5. Role access — basis для permissions matrix §2

```sql
SELECT r.code, count(*) AS resource_access_rows
FROM roles r LEFT JOIN role_admin_resource_access ra ON ra.role_id=r.id
GROUP BY r.code ORDER BY r.code;
-- admin=18, admin_gost=0, editor=0, menedzher=0, super_admin=0, support=1, user=0.

SELECT r.code, s.code, sa.access_level
FROM role_admin_section_access sa
JOIN roles r ON r.id=sa.role_id
JOIN admin_section s ON s.id=sa.section_id
WHERE s.code IN ('crm','contacts','deals','tasks','calls','clients');
-- admin_gost: 0 rows. Подтверждение: у admin_gost нет CRM-доступа сегодня.
```

## 6. Триггеры на `client_legal_details` — без company-* префиксов

```sql
SELECT tgname
FROM pg_trigger
WHERE tgrelid = 'public.client_legal_details'::regclass
  AND tgname LIKE 'trg_company_%';
-- 0 rows. Discovery 1.0 не добавил ни одного триггера.
```

## 7. Список файлов discovery-коммита

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

## 8. Verification в staging (перед Phase 1 execution)

Перечень тех же запросов должен быть выполнен на staging до и после hypothetical Phase 1 миграции. Ожидания:

- До: результаты §1, §2, §6 идентичны production discovery-снепшоту.
- После: §1 — 4 таблицы существуют; §2 — 1 новая строка `(company, CMP, 0)`; §6 — 0 строк (триггер на `client_legal_details` откладывается до Phase 4).
