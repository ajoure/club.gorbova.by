# companies_phase1_execution_plan.md

Статус: **DRAFT / NOT APPROVED / DO NOT EXECUTE**

Документ фиксирует предполагаемое содержание Phase 1. Ни одна миграция не запускается до отдельного approval после проверки всех discovery-документов.

## 1. Scope Phase 1 (core, не расширять)

- Таблицы: `companies`, `company_contacts`, `client_legal_details_company_map`, `company_sync_queue`.
- Триггеры: `updated_at`, `public_id`, sync-эмиттер на `client_legal_details`.
- RLS + policies (см. `companies_permissions_matrix.md`).
- Аудит: события `company.*` в `audit_logs`, `crm_activity_log`, `domain_events`.
- Feature flag `feature.companies.enabled` в `app_settings`.

**Вне Phase 1:** RPC (Phase 2), backfill (Phase 3), sync worker (Phase 4), UI (Phase 7+), связь с `orders_v2`/`crm_tasks` (Phase 5-6).

## 2. Предполагаемые DDL (черновик, не для запуска)

### 2.1. `companies`

```sql
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL DEFAULT generate_public_id('co'),  -- через public_id_sequences
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  country text NOT NULL DEFAULT 'BY',
  unp_normalized text,
  full_name text NOT NULL,
  short_name text,
  legal_form text,
  legal_address text,
  legal_address_structured jsonb,
  email text,
  phone text,
  director_name text,
  director_position text,
  acts_on_basis text,
  bank_account text,
  bank_name text,
  bank_code text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived','merged')),
  merged_into_company_id uuid REFERENCES public.companies(id),
  archived_at timestamptz,
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  grp_status_code text,
  grp_status_name text,
  grp_short_name text,
  grp_registration_date text,
  grp_tax_office_code text,
  grp_tax_office_name text,
  grp_liquidation_date text,
  grp_liquidation_reason text,
  grp_last_fetched_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
CREATE UNIQUE INDEX companies_public_id_key ON public.companies(public_id);
CREATE UNIQUE INDEX companies_unp_unique
  ON public.companies(country, unp_normalized)
  WHERE unp_normalized IS NOT NULL AND status <> 'merged';
CREATE INDEX companies_status_idx ON public.companies(status);
CREATE INDEX companies_created_at_idx ON public.companies(created_at DESC);
```

GRANT/RLS — см. §3.

### 2.2. `company_contacts`

```sql
CREATE TABLE public.company_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'billing'
    CHECK (role IN ('billing','signatory','contact','director','other')),
  is_primary boolean NOT NULL DEFAULT false,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  UNIQUE (company_id, profile_id, role)
);
CREATE INDEX company_contacts_company_idx ON public.company_contacts(company_id);
CREATE INDEX company_contacts_profile_idx ON public.company_contacts(profile_id);
```

### 2.3. `client_legal_details_company_map`

```sql
CREATE TABLE public.client_legal_details_company_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_legal_details_id uuid NOT NULL UNIQUE
    REFERENCES public.client_legal_details(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX cld_company_map_company_idx ON public.client_legal_details_company_map(company_id);
```

### 2.4. `company_sync_queue`

```sql
CREATE TABLE public.company_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid,                       -- client_legal_details.id или companies.id
  entity_type text NOT NULL
    CHECK (entity_type IN ('client_legal_details','company')),
  run_reason text NOT NULL,             -- 'backfill','cld_upsert','cld_update','grp_refetch','manual'
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','skipped')),
  attempts int NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  locked_by text,
  locked_at timestamptz,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX csq_status_next_idx
  ON public.company_sync_queue(status, next_run_at)
  WHERE status IN ('queued','running');
```

## 3. GRANT + RLS (шаблон, не запускать)

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
-- НЕ грантим anon.

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies read for CRM staff"
  ON public.companies FOR SELECT TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'admin_gost') OR
    has_role_v2(auth.uid(),'menedzher') OR
    has_role_v2(auth.uid(),'support')
  );

CREATE POLICY "companies write for admin+manager"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'admin_gost') OR
    has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY "companies update for admin+manager"
  ON public.companies FOR UPDATE TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'admin_gost') OR
    has_role_v2(auth.uid(),'menedzher')
  );

-- Delete — только super_admin
CREATE POLICY "companies delete for super_admin"
  ON public.companies FOR DELETE TO authenticated
  USING (has_role_v2(auth.uid(),'super_admin'));
```

Аналогичные политики для `company_contacts`, `client_legal_details_company_map`.

`company_sync_queue` — только service_role (`deny all clients`, аналогично `notification_outbox`).

## 4. Triggers

- `update_updated_at_column` — на `companies`, `company_contacts`, `client_legal_details_company_map`, `company_sync_queue`.
- `trg_set_companies_public_id` — если `public_id` NULL, сгенерировать через `public_id_sequences` c prefix `co`.
- AFTER INSERT/UPDATE на `client_legal_details` WHERE `purpose='billing' AND client_type IN ('legal_entity','entrepreneur')` → INSERT в `company_sync_queue` (idempotency_key = `cld:{id}:{updated_at}`).

## 5. Verification (после DDL)

- `SELECT COUNT(*) FROM companies` = 0 (backfill только в Phase 3).
- `SELECT COUNT(*) FROM company_sync_queue` = число billing legal_entity/entrepreneur (queued for backfill) — если триггер запустится на существующие; иначе backfill стартует явно.
- RLS: `SET ROLE anon; SELECT * FROM companies;` → error.
- GRANT: `authenticated` роль имеет доступ.

## 6. Rollback

- DROP всех 4 таблиц (все новые, cascade безопасен).
- DROP триггера на `client_legal_details`.
- Feature flag OFF.

## 7. DoD Phase 1

- [ ] Все 4 таблицы существуют.
- [ ] GRANT для authenticated и service_role.
- [ ] RLS ENABLED + policies применены.
- [ ] Триггеры работают (updated_at, public_id, sync enqueue).
- [ ] `pg_trgm` подключён (уже).
- [ ] `feature.companies.enabled` в `app_settings` = false (по умолчанию).
- [ ] `admin_section` + `admin_resource` для Companies созданы, но `is_active=false` до Phase 7.
- [ ] Никаких изменений в `client_legal_details`, `orders_v2`, `crm_tasks`, `profiles`, `crm_pipelines`, `crm_activity_log`.
- [ ] Никаких новых RPC (это Phase 2).
- [ ] Никакого UI (это Phase 7+).

## 8. Что запрещено в Phase 1

- Backfill (Phase 3).
- Sync worker (Phase 4).
- Изменения `orders_v2` (Phase 5).
- Изменения `crm_tasks` (Phase 6).
- Любой UI (Phase 7+).
- `parent_company_id` / `hierarchy_type` без approval (см. `companies_future_extensions.md`).
- Автосоздание companies из AmoCRM webhook (см. freeze §7).
