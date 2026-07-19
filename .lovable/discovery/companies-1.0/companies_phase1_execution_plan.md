# companies_phase1_execution_plan.md

Статус: **DRAFT / NOT APPROVED / DO NOT EXECUTE**

Документ фиксирует Phase 1 в границах утверждённого Master Plan v2 и APPROVED / FROZEN architecture freeze (commit `04f85026c3458cdd3c8398c1841c1e4371e3dbfa`). Ни одна миграция не запускается до отдельного approval после проверки всех discovery-документов.

История: v2 — коррекция по итогам ревью Discovery 1.0. Расширения scope (trigger на billing, feature flag, registry inserts, enqueue существующих строк) отозваны и перенесены в Phase 4. Восстановлены минимальные RPC-скелеты согласно Master Plan v2. v3 (правки после approval architecture freeze): `company_contacts.source_client_legal_details_map_id` переведён на `ON DELETE RESTRICT` (согласование с CHECK `company_contacts_billing_requires_source`); полностью раскрыты `CREATE POLICY` и `DROP POLICY` для `client_legal_details_company_map` и `company_contacts` — формулировка «аналогичный набор» устранена.

## 1. Scope Phase 1 (core, не расширять)

Внутри Phase 1:

- Таблицы (создавать строго в этом порядке из-за FK `company_contacts.source_client_legal_details_map_id → client_legal_details_company_map(id)`):
  1. `companies`
  2. `client_legal_details_company_map`
  3. `company_contacts`
  4. `company_sync_queue`
  (только структура, без enqueue). Альтернатива при желании инвертировать: создать `company_contacts` без FK и добавить FK на map отдельным `ALTER TABLE ... ADD CONSTRAINT` после создания map — в Phase 1 не используется, зафиксировано как опция.
- Триггеры `updated_at` на все 4 таблицы (у всех есть `updated_at`, см. §2.2–§2.4).
- Триггер `trg_set_companies_public_id` через `next_public_id('company')`.
- Регистрация entity_type в `public_id_sequences` (`entity_type='company'`, `prefix='CMP'`).
- RLS + policies (см. `companies_permissions_matrix.md`).
- Минимальные RPC-скелеты (§4): `crm_company_get_or_create`, `crm_company_link_contact`. Скелеты — SECURITY DEFINER, без бизнес-логики backfill/sync; используются как контракт для Phase 2/3.

Вне Phase 1 (явно перенесено):

- **AFTER INSERT/UPDATE trigger на `client_legal_details` → Phase 4** (см. `companies_automation_map.md` §5). Прямая cross-domain связь Billing → CRM запрещена; поток идёт через RPC/domain events + safety-net queue.
- **Feature flag `feature_companies_enabled` → Phase 7** (гейт UI, а не DDL).
- **Inserts в `admin_section` / `admin_resource` / `role_admin_*_access` → Phase 7** (вместе с введением UI-точек входа).
- **Enqueue существующих billing-строк / любой backfill → Phase 3.**
- **Sync worker `company-sync-worker` → Phase 4.**
- **`orders_v2.company_id` → Phase 5.** `crm_tasks.company_id` → Phase 6.
- **UI (`/admin/companies`, `CompanyDetailSheet`, вкладка «Компании» в контакте) → Phase 7/8.**

## 2. Предполагаемые DDL (черновик, не для запуска)

### 2.1. `companies`

```sql
-- Регистрация public_id
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('company', 'CMP', 0)
ON CONFLICT (entity_type) DO NOTHING;

CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL,                    -- заполняется триггером trg_set_companies_public_id → next_public_id('company') → 'CMP-000001'
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  company_kind text NOT NULL DEFAULT 'unknown'
    CHECK (company_kind IN ('legal_entity','entrepreneur','foreign','unknown')),
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
  -- external_ids intentionally NOT in Phase 1 DDL (см. §6, freeze §7)
  grp_status_code text,
  grp_status_name text,
  grp_short_name text,
  grp_registration_date date,       -- было text → зафиксировано как date
  grp_tax_office_code text,
  grp_tax_office_name text,
  grp_liquidation_date date,        -- было text → date
  grp_liquidation_reason text,
  grp_last_fetched_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,  -- platform standard: metadata, не meta
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
CREATE INDEX companies_kind_idx ON public.companies(company_kind);
CREATE INDEX companies_created_at_idx ON public.companies(created_at DESC);
```

`company_kind` — canonical различие, сохраняет исходный `client_legal_details.client_type` без потери сведений об ИП / юрлице / foreign.

### 2.2. `client_legal_details_company_map`

Создаётся **до** `company_contacts`, поскольку `company_contacts.source_client_legal_details_map_id` содержит FK на эту таблицу.

```sql
CREATE TABLE public.client_legal_details_company_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_legal_details_id uuid NOT NULL UNIQUE
    REFERENCES public.client_legal_details(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by uuid,
  -- Полный audit-набор (правка B9 review): created_by/updated_by выравнены с companies/company_contacts.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX cld_company_map_company_idx ON public.client_legal_details_company_map(company_id);
```

Правка ревью: `updated_at` присутствует → триггер `update_updated_at_column` исполним; `meta` → `metadata`; полный audit-набор совпадает с DoD §9.

### 2.3. `company_contacts` — утверждённый контракт

Возвращён утверждённый Master Plan v2 контракт: связь `profile ↔ company` описывается через `relationship_type`, `source` и `is_billing_contact`. `role` **не используется** и удалён из DDL. Внешний импортированный контакт из Phase 9 поддерживается через nullable `profile_id` и внешние поля. Создаётся **после** `client_legal_details_company_map` (FK ниже).

```sql
CREATE TABLE public.company_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- profile_id nullable — допускает внешний импортированный контакт (Phase 9),
  -- для которого profile ещё не создан. Билинг-контакт всегда имеет profile_id.
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Внешние поля для импортированных контактов без profile.
  external_full_name text,
  external_email text,
  external_phone text,

  relationship_type text NOT NULL
    CHECK (relationship_type IN (
      'billing_contact',
      'signatory',
      'director',
      'representative',
      'external_contact',
      'other'
    )),
  is_billing_contact boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,

  source text NOT NULL
    CHECK (source IN (
      'billing_requisites',
      'manual',
      'import',
      'call_center',
      'admin_link',
      'document_review'
    )),

  -- Machine-checkable source lineage для source='billing_requisites'.
  -- FK на map-запись даёт детерминированный путь client_legal_details → company_contacts.
  -- Требует, чтобы client_legal_details_company_map была создана раньше (см. §2.2).
  -- ON DELETE RESTRICT: billing lineage нельзя удалить, пока существует billing-contact.
  -- SET NULL здесь недопустим — нарушил бы CHECK company_contacts_billing_requires_source
  -- (для is_billing_contact=true source_client_legal_details_map_id IS NOT NULL).
  source_client_legal_details_map_id uuid
    REFERENCES public.client_legal_details_company_map(id) ON DELETE RESTRICT,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,

  -- Инварианты
  CONSTRAINT company_contacts_profile_or_external CHECK (
    profile_id IS NOT NULL
    OR (external_full_name IS NOT NULL AND relationship_type = 'external_contact')
  ),
  CONSTRAINT company_contacts_billing_requires_source CHECK (
    NOT is_billing_contact
    OR (source = 'billing_requisites' AND source_client_legal_details_map_id IS NOT NULL)
  ),
  CONSTRAINT company_contacts_billing_requires_profile CHECK (
    NOT is_billing_contact OR profile_id IS NOT NULL
  ),
  CONSTRAINT company_contacts_unique_profile_rel UNIQUE (company_id, profile_id, relationship_type)
);
CREATE INDEX company_contacts_company_idx ON public.company_contacts(company_id);
CREATE INDEX company_contacts_profile_idx ON public.company_contacts(profile_id);
CREATE INDEX company_contacts_billing_idx
  ON public.company_contacts(company_id) WHERE is_billing_contact = true;
```

Правило импорта Phase 9 (внешний контакт): импорт-worker сначала пытается найти/создать `profiles` по (email/phone). Только если совпадений нет и профиль намеренно не создаётся — вставляет запись `relationship_type='external_contact'` с `profile_id=NULL`. Для `is_billing_contact=true` `profile_id` обязателен (CHECK выше).

### 2.4. `company_sync_queue`

Создаётся структурно, но **enqueue в Phase 1 не выполняется** (нет trigger'а на `client_legal_details`, нет backfill). Первая запись появится в Phase 3 (backfill) / Phase 4 (sync trigger).

```sql
CREATE TABLE public.company_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid,
  entity_type text NOT NULL
    CHECK (entity_type IN ('client_legal_details','company')),
  run_reason text NOT NULL,       -- 'backfill','cld_upsert','cld_update','grp_refetch','manual'
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','skipped')),
  attempts int NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  locked_by text,
  locked_at timestamptz,
  idempotency_key text UNIQUE,    -- канонический формат см. companies_migration_strategy.md §5
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Полный audit-набор (правка B9 review): created_by/updated_by выравнены с остальными Phase 1 таблицами.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
CREATE INDEX csq_status_next_idx
  ON public.company_sync_queue(status, next_run_at)
  WHERE status IN ('queued','running');
```

## 3. GRANT + RLS

```sql
-- companies
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
-- НЕ грантим anon.
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies read for CRM staff"
  ON public.companies FOR SELECT TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher') OR
    has_role_v2(auth.uid(),'support')
  );
-- admin_gost исключён из CRM RLS: у роли нет row в role_admin_resource_access
-- и role_admin_section_access для CRM (см. companies_permissions_matrix.md §2).

CREATE POLICY "companies insert for admin+manager"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY "companies update for admin+manager"
  ON public.companies FOR UPDATE TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY "companies delete for super_admin"
  ON public.companies FOR DELETE TO authenticated
  USING (has_role_v2(auth.uid(),'super_admin'));

-- client_legal_details_company_map
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_legal_details_company_map TO authenticated;
GRANT ALL ON public.client_legal_details_company_map TO service_role;
ALTER TABLE public.client_legal_details_company_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_legal_details_company_map read for CRM staff"
  ON public.client_legal_details_company_map FOR SELECT TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher') OR
    has_role_v2(auth.uid(),'support')
  );

CREATE POLICY "client_legal_details_company_map insert for admin+manager"
  ON public.client_legal_details_company_map FOR INSERT TO authenticated
  WITH CHECK (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY "client_legal_details_company_map update for admin+manager"
  ON public.client_legal_details_company_map FOR UPDATE TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY "client_legal_details_company_map delete for super_admin"
  ON public.client_legal_details_company_map FOR DELETE TO authenticated
  USING (has_role_v2(auth.uid(),'super_admin'));

-- company_contacts
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_contacts TO authenticated;
GRANT ALL ON public.company_contacts TO service_role;
ALTER TABLE public.company_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_contacts read for CRM staff"
  ON public.company_contacts FOR SELECT TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher') OR
    has_role_v2(auth.uid(),'support')
  );

CREATE POLICY "company_contacts insert for admin+manager"
  ON public.company_contacts FOR INSERT TO authenticated
  WITH CHECK (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY "company_contacts update for admin+manager"
  ON public.company_contacts FOR UPDATE TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY "company_contacts delete for super_admin"
  ON public.company_contacts FOR DELETE TO authenticated
  USING (has_role_v2(auth.uid(),'super_admin'));

-- company_sync_queue — только service_role.
GRANT ALL ON public.company_sync_queue TO service_role;
-- authenticated НЕ имеет никаких прав (deny by default + отсутствие GRANT).
ALTER TABLE public.company_sync_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_sync_queue service only"
  ON public.company_sync_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

Единый контракт queue permissions зафиксирован здесь и в `companies_migration_strategy.md` §8 (правка B8 review).


## 4. Минимальные RPC-скелеты Phase 1

Возвращены согласно Master Plan v2. Скелеты — SECURITY DEFINER, `SET search_path=public`, guard `has_role_v2`; они не выполняют backfill/sync, а формируют контракт для Phase 2/3.

```sql
CREATE OR REPLACE FUNCTION public.crm_company_get_or_create(
  _country text,
  _unp text,
  _full_name text,
  _company_kind text,
  _source text,
  _source_client_legal_details_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_id uuid; BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Скелет: находит existing по (country, unp_normalized) либо создаёт.
  -- Полная реализация — Phase 2. Здесь только контракт сигнатуры и guard.
  SELECT id INTO v_id
  FROM companies
  WHERE country = _country AND unp_normalized = _unp AND status <> 'merged'
  LIMIT 1;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_company_link_contact(
  _company_id uuid,
  _profile_id uuid,
  _relationship_type text,
  _is_billing_contact boolean,
  _source text,
  _source_client_legal_details_map_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_id uuid; BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- Скелет; полная реализация — Phase 2.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) TO authenticated;
```

Остальные RPC (`crm_company_upsert_from_billing`, `search_companies`, `crm_company_merge`, `crm_company_archive`, `crm_company_grp_refetch`) — Phase 2. См. согласованную matrix в `companies_rpc_inventory.md` §7.

## 5. Triggers (только в scope Phase 1)

- `update_updated_at_column` — на `companies`, `company_contacts`, `client_legal_details_company_map` (после добавления `updated_at`, см. §2.3), `company_sync_queue`.
- `trg_set_companies_public_id` — BEFORE INSERT ON `companies`: если `public_id IS NULL` → `SELECT next_public_id('company')` → формат `CMP-000001`.
- **Явно вне Phase 1:** триггер на `client_legal_details`. Переносится в Phase 4 (см. `companies_automation_map.md` §5 и Rollback ниже). Прямая cross-domain связь Billing → CRM в Phase 1 запрещена.

## 6. Незакрытые решения — статус

- **`external_ids` / integration-mapping** — исключено из Phase 1 DDL. Решение (колонка jsonb на `companies` vs. `integration_field_mappings`) принимается в Phase 2 через отдельный ADR-0002. Freeze §7 приведён в соответствие: колонка `external_ids` не создаётся в Phase 1.

## 7. Verification (после DDL)

- `SELECT COUNT(*) FROM companies` = 0 (backfill только в Phase 3).
- `SELECT COUNT(*) FROM company_contacts` = 0.
- `SELECT COUNT(*) FROM client_legal_details_company_map` = 0.
- `SELECT COUNT(*) FROM company_sync_queue` = 0 (в Phase 1 нет enqueue).
- `SELECT next_public_id('company')` возвращает `CMP-000001` (тест в staging; в prod — не вызывать, чтобы не занять номер).
- RLS: под ролью `anon` `SELECT * FROM companies` возвращает `permission denied` (нет GRANT).
- `authenticated` без CRM-роли: `SELECT` возвращает 0 rows (RLS block).
- В `client_legal_details` изменений нет: `SELECT to_regclass('client_legal_details')` + `pg_get_ruledef` без новых триггеров с префиксом `trg_company_*`.

## 8. Rollback

Порядок строго обратный созданию (без CASCADE). `company_contacts.source_client_legal_details_map_id → client_legal_details_company_map(id)`, поэтому `company_contacts` удаляется раньше `client_legal_details_company_map`.

1. `DROP FUNCTION IF EXISTS public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid);`
2. `DROP FUNCTION IF EXISTS public.crm_company_get_or_create(text,text,text,text,text,uuid);`
3. Триггеры (точные имена):
   - `DROP TRIGGER IF EXISTS trg_set_companies_public_id ON public.companies;`
   - `DROP TRIGGER IF EXISTS update_companies_updated_at ON public.companies;`
   - `DROP TRIGGER IF EXISTS update_company_contacts_updated_at ON public.company_contacts;`
   - `DROP TRIGGER IF EXISTS update_client_legal_details_company_map_updated_at ON public.client_legal_details_company_map;`
   - `DROP TRIGGER IF EXISTS update_company_sync_queue_updated_at ON public.company_sync_queue;`
4. Policies (точные имена, по таблицам):
   - `DROP POLICY IF EXISTS "companies read for CRM staff" ON public.companies;`
   - `DROP POLICY IF EXISTS "companies insert for admin+manager" ON public.companies;`
   - `DROP POLICY IF EXISTS "companies update for admin+manager" ON public.companies;`
   - `DROP POLICY IF EXISTS "companies delete for super_admin" ON public.companies;`
   - Аналогичные 4 политики для `public.company_contacts` (имена: `"company_contacts read for CRM staff"`, `... insert for admin+manager"`, `... update for admin+manager"`, `... delete for super_admin"`).
   - Аналогичные 4 политики для `public.client_legal_details_company_map`.
   - `DROP POLICY IF EXISTS "company_sync_queue service only" ON public.company_sync_queue;`
5. Helper-функции создаются вне Phase 1 (`update_updated_at_column`, `has_role_v2`, `next_public_id`) — **не удаляются** rollback'ом Phase 1.
6. Таблицы, строго в этом порядке (обратно созданию, с учётом FK):
   1. `DROP TABLE public.company_sync_queue;`
   2. `DROP TABLE public.company_contacts;`  — удаляется раньше map (FK на map).
   3. `DROP TABLE public.client_legal_details_company_map;`
   4. `DROP TABLE public.companies;`
7. `DELETE FROM public.public_id_sequences WHERE entity_type='company';`

CASCADE **не** использовать. `client_legal_details` не затронут (в Phase 1 нет FK и триггеров на него). `admin_section`, `admin_resource`, `role_admin_*`, `app_settings` не затронуты (записи не создавались в Phase 1). `orders_v2`, `crm_tasks`, `profiles`, `crm_activity_log`, `domain_events`, `audit_logs` — без изменений схемы, откат не требуется.

Проверка read-only: см. `companies_read_only_proof.md`.

## 9. DoD Phase 1

- [ ] Все 4 таблицы созданы с полным audit-набором (`created_at`, `updated_at`, `created_by`, `updated_by`, `metadata`).
- [ ] GRANT для `authenticated` (только 3 таблицы) и `service_role` (все 4). `company_sync_queue` — только service_role.
- [ ] RLS ENABLED + policies применены, `admin_gost` явно исключён из CRM RLS (см. permissions matrix §2).
- [ ] `trg_set_companies_public_id` возвращает `CMP-000001` формат.
- [ ] `next_public_id('company')` существует, `public_id_sequences` содержит `('company','CMP',0)`.
- [ ] 2 RPC-скелета созданы с EXECUTE grants и SECURITY DEFINER guard.
- [ ] Нет триггера на `client_legal_details`.
- [ ] Нет записей в `app_settings`, `admin_section`, `admin_resource`, `role_admin_*_access`.
- [ ] Нет UI, нет edge functions.
- [ ] Rollback-скрипт из §8 подготовлен как отдельная migration и проверен в staging.

## 10. Что запрещено в Phase 1

- Backfill (Phase 3).
- Sync trigger на `client_legal_details` (Phase 4).
- Sync worker `company-sync-worker` (Phase 4).
- Изменения `orders_v2` (Phase 5).
- Изменения `crm_tasks` (Phase 6).
- Любой UI (Phase 7+).
- `feature_companies_enabled` в `app_settings` (Phase 7).
- Inserts в `admin_section` / `admin_resource` / `role_admin_*_access` (Phase 7).
- `parent_company_id` / `hierarchy_type` (см. `companies_future_extensions.md`).
- Автосоздание companies из AmoCRM webhook (см. freeze §7).
- `external_ids` колонка на `companies` (решение отложено до ADR-0002 в Phase 2, см. §6).
