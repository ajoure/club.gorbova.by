# companies_phase1_runnable_plan.md

Статус: **DRAFT / NOT APPROVED / DO NOT EXECUTE**

Runnable-план Phase 1. Восстановлен строго по approved `companies_phase1_execution_plan.md` (commit `8649e2ba7d649a303e3a8e50c553ecd679d59acf`). Любые расхождения с approved DDL/RPC/RLS запрещены — новые поля, FK actions, значения enum, upsert-логика и DELETE-права для admin не вводятся.

История:
- v1 (commit `824ec4538`) — отклонён consolidated review: расхождения с approved моделью, admin DELETE, upsert в skeleton RPC, риск коллизии public_id, недоказуемый RLS runtime proof.
- v2 (текущий) — правки по 8 пунктам consolidated review: восстановлены approved DDL, DELETE только super_admin, RPC-skeleton без записи, запрещён явно передаваемый public_id, preflight assertions продублированы в forward migration через DO/RAISE, verification переведена на именные проверки, RLS runtime proof — fixture-based с rollback-only транзакциями и реальной таблицей `public.user_roles_v2`.

## 0. Файловый scope

Единственный измененный markdown относительно approved base — этот файл. `.lovable/plan.md` возвращён к состоянию commit `8649e2ba…`. Никакие другие документы, миграции, RPC, edge functions, БД и код не изменяются.

## 1. Preflight (read-only, для отчёта)

Все запросы — только `SELECT`. Выполняются оператором до forward migration и прикладываются к отчёту исполнения. Критические ассертации продублированы в §3 forward migration через `DO $$ … RAISE EXCEPTION … $$` — pass/fail preflight не является stop-guard самим по себе.

```sql
-- 1.1 Baseline schema hash (SQL идентичен companies_read_only_proof.md §7)
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
-- Ожидается ровно: c41160b83c8e15c3d3c41a13028700d5
-- (companies_read_only_proof.md §7). Любое другое значение — HARD STOP.

-- 1.2 Объекты, обязанные отсутствовать
SELECT to_regclass('public.companies'),
       to_regclass('public.client_legal_details_company_map'),
       to_regclass('public.company_contacts'),
       to_regclass('public.company_sync_queue');
-- Ожидается: NULL, NULL, NULL, NULL.

SELECT proname
FROM pg_proc
WHERE proname IN (
  'crm_company_get_or_create',
  'crm_company_link_contact',
  'set_companies_public_id'
);
-- Ожидается: пустой результат.

-- 1.3 Обязательные helpers — точные сигнатуры
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('next_public_id','update_updated_at_column','has_role_v2')
ORDER BY proname, args;
-- Ожидается ровно:
--   has_role_v2              | _user_id uuid, _role_code text
--   next_public_id           | p_entity_type text
--   update_updated_at_column | (пустая строка аргументов)

-- 1.4 public_id namespace: ни одна из двух коллизий не должна существовать
SELECT entity_type, prefix, last_value
FROM public.public_id_sequences
WHERE entity_type='company' OR prefix='CMP';
-- Ожидается: 0 rows.

-- 1.5 SYSTEM tenant соответствует контракту (id + name + is_personal)
SELECT id::text, name, is_personal
FROM public.tenants
WHERE id = '00000000-0000-0000-0000-000000000001';
-- Ожидается ровно: 00000000-0000-0000-0000-000000000001 | system | false.

-- 1.6 Все 7 канонических ролей присутствуют
SELECT array_agg(code ORDER BY code) FROM public.roles
WHERE code IN ('admin','admin_gost','editor','menedzher','super_admin','support','user');
-- Ожидается: {admin,admin_gost,editor,menedzher,super_admin,support,user}.

-- 1.7 Schema hash (та же формула) обязан вернуть baseline и после rollback
-- (см. §9 верификация). Дрейф значения = блокер release.
```

## 2. Файлы миграций

```
supabase/migrations/<ts>_companies_phase1_forward.sql   (§3–§6)
supabase/migrations/<ts>_companies_phase1_rollback.sql  (§8, готовится и хранится, но не применяется)
```

Rollback-миграция подготавливается заранее и хранится в staging; применяется отдельным relase-шагом только по решению оператора.

## 3. Forward migration (полный SQL, из approved execution plan)

Все блоки идентичны approved DDL. Изменения фиксируются только в добавленных preflight assertions (DO/RAISE) — без модификации approved полей, constraints и FK actions.

```sql
BEGIN;

-- 3.0 Assertions, дублирующие preflight (stop-guard)
DO $$
BEGIN
  IF to_regclass('public.companies') IS NOT NULL
     OR to_regclass('public.client_legal_details_company_map') IS NOT NULL
     OR to_regclass('public.company_contacts') IS NOT NULL
     OR to_regclass('public.company_sync_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: one of target tables already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN (
      'crm_company_get_or_create','crm_company_link_contact','set_companies_public_id'
  )) THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: target function already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='next_public_id') THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: helper next_public_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='update_updated_at_column') THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: helper update_updated_at_column missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='has_role_v2') THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: helper has_role_v2 missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.public_id_sequences WHERE prefix='CMP' AND entity_type<>'company') THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: prefix CMP already reserved by another entity_type';
  END IF;
END $$;

-- 3.1 Регистрация public_id namespace
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('company', 'CMP', 0)
ON CONFLICT (entity_type) DO NOTHING;

-- 3.2 companies (approved DDL)
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL,
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
  grp_status_code text,
  grp_status_name text,
  grp_short_name text,
  grp_registration_date date,
  grp_tax_office_code text,
  grp_tax_office_name text,
  grp_liquidation_date date,
  grp_liquidation_reason text,
  grp_last_fetched_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
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

-- 3.3 client_legal_details_company_map (approved DDL, создаётся ДО company_contacts)
CREATE TABLE public.client_legal_details_company_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_legal_details_id uuid NOT NULL UNIQUE
    REFERENCES public.client_legal_details(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX cld_company_map_company_idx
  ON public.client_legal_details_company_map(company_id);

-- 3.4 company_contacts (approved DDL, полный контракт)
CREATE TABLE public.company_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  external_full_name text,
  external_email text,
  external_phone text,
  relationship_type text NOT NULL
    CHECK (relationship_type IN (
      'billing_contact','signatory','director','representative','external_contact','other'
    )),
  is_billing_contact boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  source text NOT NULL
    CHECK (source IN (
      'billing_requisites','manual','import','call_center','admin_link','document_review'
    )),
  source_client_legal_details_map_id uuid
    REFERENCES public.client_legal_details_company_map(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
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
  CONSTRAINT company_contacts_unique_profile_rel
    UNIQUE (company_id, profile_id, relationship_type)
);
CREATE INDEX company_contacts_company_idx ON public.company_contacts(company_id);
CREATE INDEX company_contacts_profile_idx ON public.company_contacts(profile_id);
CREATE INDEX company_contacts_billing_idx
  ON public.company_contacts(company_id) WHERE is_billing_contact = true;

-- 3.5 company_sync_queue (approved DDL)
CREATE TABLE public.company_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid,
  entity_type text NOT NULL
    CHECK (entity_type IN ('client_legal_details','company')),
  run_reason text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','skipped')),
  attempts int NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  locked_by text,
  locked_at timestamptz,
  idempotency_key text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
CREATE INDEX csq_status_next_idx
  ON public.company_sync_queue(status, next_run_at)
  WHERE status IN ('queued','running');

COMMIT;
```

## 4. Public ID: `set_companies_public_id` (запрет ручного public_id)

Единый безопасный контракт: явно переданный `public_id` в INSERT запрещён. Номер всегда выделяется через `next_public_id('company')`. Это исключает рассинхронизацию `public_id_sequences.last_value` с фактическими номерами.

Используем `CREATE FUNCTION` (не `CREATE OR REPLACE`): при повторном запуске сработает preflight assertion §3.0 и migration остановится.

```sql
BEGIN;

CREATE FUNCTION public.set_companies_public_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.public_id IS NOT NULL THEN
    RAISE EXCEPTION
      'companies.public_id must not be provided explicitly; use next_public_id(''company'')';
  END IF;
  NEW.public_id := public.next_public_id('company');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_companies_public_id
BEFORE INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.set_companies_public_id();

CREATE TRIGGER update_companies_updated_at
BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_legal_details_company_map_updated_at
BEFORE UPDATE ON public.client_legal_details_company_map
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_company_contacts_updated_at
BEFORE UPDATE ON public.company_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_company_sync_queue_updated_at
BEFORE UPDATE ON public.company_sync_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;
```

## 5. GRANT + RLS (строго по approved)

DELETE разрешён **только** `super_admin` для всех трёх CRM-таблиц. `admin` DELETE **запрещён**.

```sql
BEGIN;

-- companies
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies read for CRM staff"
  ON public.companies FOR SELECT TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR
    has_role_v2(auth.uid(),'admin') OR
    has_role_v2(auth.uid(),'menedzher') OR
    has_role_v2(auth.uid(),'support')
  );

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

-- company_sync_queue — только service_role
GRANT ALL ON public.company_sync_queue TO service_role;
ALTER TABLE public.company_sync_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_sync_queue service only"
  ON public.company_sync_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMIT;
```

## 6. RPC-скелеты (Phase 1 — контракт сигнатуры, без бизнес-логики)

Оба RPC — SECURITY DEFINER, `SET search_path=public`, guard `has_role_v2`. Никаких INSERT/UPDATE/UPSERT. `crm_company_link_contact` возвращает NULL. Полная реализация — Phase 2. Используем `CREATE FUNCTION` — повторный запуск падает по preflight §3.0.

```sql
BEGIN;

CREATE FUNCTION public.crm_company_get_or_create(
  _country text,
  _unp text,
  _full_name text,
  _company_kind text,
  _source text,
  _source_client_legal_details_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- Skeleton: lookup only. Полная реализация (create + backfill lineage) — Phase 2.
  SELECT id INTO v_id
  FROM public.companies
  WHERE country = _country AND unp_normalized = _unp AND status <> 'merged'
  LIMIT 1;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.crm_company_link_contact(
  _company_id uuid,
  _profile_id uuid,
  _relationship_type text,
  _is_billing_contact boolean,
  _source text,
  _source_client_legal_details_map_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- Skeleton only (Phase 1). Никаких INSERT/UPDATE/UPSERT. Полная реализация — Phase 2.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) TO authenticated;

COMMIT;
```

## 7. Verification (именные проверки, не counts)

Проверяется контракт, а не количественные агрегаты. Все запросы возвращают конкретные значения; расхождение — блокер release.

### 7.1 Колонки companies

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='companies'
ORDER BY ordinal_position;
```
Ожидаемый набор — 33 колонки в порядке §3.2, с `NOT NULL` на: `id, public_id, workspace_id, company_kind, country, full_name, status, metadata, created_at, updated_at`; defaults на: `id=gen_random_uuid()`, `workspace_id='00000000-0000-0000-0000-000000000001'`, `company_kind='unknown'`, `country='BY'`, `status='active'`, `metadata='{}'::jsonb`, `created_at/updated_at=now()`.

### 7.2 Именные проверки для остальных 3 таблиц

Тот же запрос с `table_name IN ('client_legal_details_company_map','company_contacts','company_sync_queue')`; ожидаемые наборы колонок и NOT NULL/defaults — по §3.3–§3.5.

### 7.3 Constraints и FK actions (поимённо)

```sql
SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       rc.delete_rule, rc.update_rule
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.table_schema='public'
  AND tc.table_name IN (
    'companies','client_legal_details_company_map','company_contacts','company_sync_queue'
  )
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
```

Ожидаемые FK actions:
- `client_legal_details_company_map.client_legal_details_id → client_legal_details(id)` — `ON DELETE CASCADE`.
- `client_legal_details_company_map.company_id → companies(id)` — `ON DELETE RESTRICT`.
- `company_contacts.company_id → companies(id)` — `ON DELETE CASCADE`.
- `company_contacts.profile_id → profiles(id)` — `ON DELETE CASCADE`.
- `company_contacts.source_client_legal_details_map_id → client_legal_details_company_map(id)` — `ON DELETE RESTRICT`.
- `companies.merged_into_company_id → companies(id)` — без каскада.

Ожидаемые CHECK constraints (по имени):
- `company_contacts_profile_or_external`
- `company_contacts_billing_requires_source`
- `company_contacts_billing_requires_profile`
- unnamed CHECK на `company_kind`, `status` (companies), `entity_type`, `status` (queue), `relationship_type`, `source` (contacts).

Ожидаемые UNIQUE:
- `companies_public_id_key`
- `companies_unp_unique` (partial)
- `company_contacts_unique_profile_rel`
- `client_legal_details_company_map.client_legal_details_id` UNIQUE
- `company_sync_queue.idempotency_key` UNIQUE

### 7.4 Индексы (поимённо)

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN (
    'companies','client_legal_details_company_map','company_contacts','company_sync_queue'
  )
ORDER BY tablename, indexname;
```

Ожидаемые non-PK индексы (без учёта PK и UNIQUE constraints, которые создают собственные индексы):
- `companies_public_id_key`, `companies_unp_unique`, `companies_status_idx`, `companies_kind_idx`, `companies_created_at_idx`.
- `cld_company_map_company_idx`.
- `company_contacts_company_idx`, `company_contacts_profile_idx`, `company_contacts_billing_idx` (partial WHERE `is_billing_contact = true`).
- `csq_status_next_idx` (partial WHERE `status IN ('queued','running')`).

Итог сверки — по именам, не по количеству; count-контроль отдельно не выполняется.

### 7.5 Policies (поимённо, с cmd/roles/qual/with_check)

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN (
    'companies','client_legal_details_company_map','company_contacts','company_sync_queue'
  )
ORDER BY tablename, policyname;
```

Ожидаемые 13 policies (список — §5). Для каждой сверяется:
- `cmd` (SELECT/INSERT/UPDATE/DELETE/ALL);
- `roles` = `{authenticated}` (для queue = `{service_role}`);
- `qual` / `with_check` содержат правильный набор `has_role_v2(...)` вызовов;
- `companies delete for super_admin`, `company_contacts delete for super_admin`, `client_legal_details_company_map delete for super_admin` — единственные, где условие сводится к `has_role_v2(auth.uid(),'super_admin')`.

### 7.6 Grants (поимённо)

```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN (
    'companies','client_legal_details_company_map','company_contacts','company_sync_queue'
  )
ORDER BY table_name, grantee, privilege_type;
```

Ожидания:
- 3 CRM-таблицы: `authenticated` = SELECT/INSERT/UPDATE/DELETE; `service_role` = ALL; `anon` = отсутствует.
- `company_sync_queue`: только `service_role` = ALL; `authenticated` и `anon` отсутствуют.

### 7.7 Signatures функций

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS returns,
       p.prosecdef AS security_definer,
       p.provolatile
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'set_companies_public_id','crm_company_get_or_create','crm_company_link_contact'
  );
```

Ожидания:
- `set_companies_public_id() RETURNS trigger`, security_definer=false.
- `crm_company_get_or_create(_country text,_unp text,_full_name text,_company_kind text,_source text,_source_client_legal_details_id uuid) RETURNS uuid`, security_definer=true.
- `crm_company_link_contact(_company_id uuid,_profile_id uuid,_relationship_type text,_is_billing_contact boolean,_source text,_source_client_legal_details_map_id uuid) RETURNS uuid`, security_definer=true.

### 7.8 Trigger inventory

```sql
SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema='public'
  AND event_object_table IN (
    'companies','client_legal_details_company_map','company_contacts','company_sync_queue'
  )
ORDER BY event_object_table, trigger_name;
```

Ожидания:
- `companies`: `trg_set_companies_public_id` (BEFORE INSERT), `update_companies_updated_at` (BEFORE UPDATE).
- Остальные 3 таблицы: только `update_*_updated_at` (BEFORE UPDATE).
- Отсутствуют триггеры на `client_legal_details` с префиксом `trg_company_*` (Phase 1 не трогает billing-домен).

### 7.9 Baseline

`SELECT count(*) FROM companies` = 0; аналогично для `company_contacts`, `client_legal_details_company_map`, `company_sync_queue`.

## 8. RLS runtime proof (fixture-based, rollback-only)

Проверка `has_role_v2` подтверждена read-only: функция читает `public.user_roles_v2` через join с `public.roles(code)`. Preview роли: `super_admin`, `admin`, `menedzher`, `support`, `admin_gost`, `editor`, `user`.

Правило stagingа: **вся проверка выполняется в одной транзакции с финальным `ROLLBACK`**. Fixture-строки (`companies`, `map`, `contacts`, `queue`) не остаются в БД. Никакие prod-строки не создаются и не изменяются.

Матрица ожиданий синхронизирована с §5:
- `service_role` для 3 CRM-таблиц: полный CRUD, для queue — тоже.
- `authenticated` + `super_admin`: SELECT/INSERT/UPDATE/DELETE на CRM-таблицы; queue — deny (GRANT отсутствует).
- `authenticated` + `admin` | `menedzher`: SELECT/INSERT/UPDATE — allow; DELETE — deny (RLS); queue — deny (GRANT).
- `authenticated` + `support`: SELECT — allow; INSERT/UPDATE/DELETE — deny; queue — deny.
- `authenticated` + `admin_gost` | `editor` | `user`: любой CRUD — deny; queue — deny.
- `anon`: любое чтение/запись — permission denied (GRANT отсутствует).

RPC expectations:
- `crm_company_get_or_create`, `crm_company_link_contact`: EXECUTE разрешён `authenticated`; guard в теле пропускает только `super_admin`/`admin`/`menedzher`.
- `service_role` в matrix RPC не участвует (GRANT EXECUTE ему не выдавался; SECURITY DEFINER означает исполнение с owner-правами, а не с service_role-правами).

Runnable-скрипт proof (сокращён по повторам; полная 4-таблица × 7 ролей матрица разворачивается однотипно). Идентификаторы ролей резолвятся через `public.roles.code`, чтобы избежать hard-coded UUID.

```sql
BEGIN;

-- 8.1 Резолвим id ролей из фактической таблицы roles
DO $$
DECLARE
  v_super uuid; v_admin uuid; v_menedzher uuid; v_support uuid;
  v_admin_gost uuid; v_editor uuid; v_user uuid;
  v_uid_super uuid := gen_random_uuid();
  v_uid_admin uuid := gen_random_uuid();
  v_uid_menedzher uuid := gen_random_uuid();
  v_uid_support uuid := gen_random_uuid();
  v_uid_admin_gost uuid := gen_random_uuid();
  v_uid_editor uuid := gen_random_uuid();
  v_uid_user uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_super FROM public.roles WHERE code='super_admin';
  SELECT id INTO v_admin FROM public.roles WHERE code='admin';
  SELECT id INTO v_menedzher FROM public.roles WHERE code='menedzher';
  SELECT id INTO v_support FROM public.roles WHERE code='support';
  SELECT id INTO v_admin_gost FROM public.roles WHERE code='admin_gost';
  SELECT id INTO v_editor FROM public.roles WHERE code='editor';
  SELECT id INTO v_user FROM public.roles WHERE code='user';

  IF v_super IS NULL OR v_admin IS NULL OR v_menedzher IS NULL
     OR v_support IS NULL OR v_admin_gost IS NULL OR v_editor IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'RLS proof aborted: one of expected roles missing in public.roles';
  END IF;

  -- Временные user_roles_v2 (rollback уничтожит).
  INSERT INTO public.user_roles_v2(user_id, role_id) VALUES
    (v_uid_super, v_super),
    (v_uid_admin, v_admin),
    (v_uid_menedzher, v_menedzher),
    (v_uid_support, v_support),
    (v_uid_admin_gost, v_admin_gost),
    (v_uid_editor, v_editor),
    (v_uid_user, v_user);

  -- Экспортируем UID'ы в session-переменные для последующих SET LOCAL.
  PERFORM set_config('phase1_proof.uid_super',       v_uid_super::text, true);
  PERFORM set_config('phase1_proof.uid_admin',       v_uid_admin::text, true);
  PERFORM set_config('phase1_proof.uid_menedzher',   v_uid_menedzher::text, true);
  PERFORM set_config('phase1_proof.uid_support',     v_uid_support::text, true);
  PERFORM set_config('phase1_proof.uid_admin_gost',  v_uid_admin_gost::text, true);
  PERFORM set_config('phase1_proof.uid_editor',      v_uid_editor::text, true);
  PERFORM set_config('phase1_proof.uid_user',        v_uid_user::text, true);
END $$;

-- 8.2 Fixture под service_role (обходит RLS)
SET LOCAL ROLE service_role;
INSERT INTO public.companies (id, full_name)
VALUES ('11111111-1111-1111-1111-111111111111','Fixture Co')
RETURNING id AS fixture_company_id;

-- Требуется реальный client_legal_details_id из билинга; для proof используем существующий billing row.
-- Оператор подставляет CLD_ID и PROFILE_ID из preflight (§1). Если не найдены — proof пропускается с явным маркером.
-- INSERT INTO public.client_legal_details_company_map(...) VALUES (..., '11111111-...');
-- INSERT INTO public.company_contacts(company_id, profile_id, relationship_type, source, is_billing_contact, source_client_legal_details_map_id)
--   VALUES ('11111111-...', <PROFILE_ID>, 'billing_contact','billing_requisites', true, <MAP_ID>);
INSERT INTO public.company_sync_queue(entity_type, run_reason)
VALUES ('company','manual');

-- 8.3 Role scenario template (повторяется для каждого uid)
-- Пример: super_admin
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('phase1_proof.uid_super'))::text, true);

-- SELECT видимость конкретной fixture-строки
SELECT count(*) AS visible_company
FROM public.companies WHERE id='11111111-1111-1111-1111-111111111111';
-- Ожидание super_admin/admin/menedzher/support: 1; admin_gost/editor/user: 0.

-- INSERT
INSERT INTO public.companies(full_name) VALUES ('probe insert') RETURNING id;
-- Ожидание super_admin/admin/menedzher: success; support/admin_gost/editor/user: permission denied.

-- UPDATE
UPDATE public.companies SET short_name='probe'
WHERE id='11111111-1111-1111-1111-111111111111';
-- Ожидание аналогично INSERT.

-- DELETE
DELETE FROM public.companies WHERE id='11111111-1111-1111-1111-111111111111';
-- Ожидание: только super_admin. Для admin, menedzher, support, admin_gost, editor, user — deny (0 rows affected либо permission denied в зависимости от path).

-- queue (deny для authenticated независимо от роли — GRANT отсутствует)
SELECT count(*) FROM public.company_sync_queue;
-- Ожидание: permission denied для всех authenticated ролей.

-- Тот же блок 4 CRUD-операций повторяется для uid_admin, uid_menedzher, uid_support,
-- uid_admin_gost, uid_editor, uid_user; ожидания — по матрице выше.

-- 8.4 anon scenario
SET LOCAL ROLE anon;
SELECT count(*) FROM public.companies;      -- permission denied
SELECT count(*) FROM public.company_contacts; -- permission denied
SELECT count(*) FROM public.company_sync_queue; -- permission denied

-- 8.5 RPC scenario (guard + EXECUTE)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('phase1_proof.uid_menedzher'))::text, true);
SELECT public.crm_company_get_or_create('BY','000000000','probe','unknown','manual',NULL);
-- Ожидание: NULL (нет matching company) — success.
SELECT public.crm_company_link_contact(
  '11111111-1111-1111-1111-111111111111',
  gen_random_uuid(),
  'external_contact', false, 'manual', NULL
);
-- Ожидание: NULL — skeleton не пишет, только возвращает.

SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('phase1_proof.uid_support'))::text, true);
SELECT public.crm_company_get_or_create('BY','000000000','probe','unknown','manual',NULL);
-- Ожидание: RAISE EXCEPTION 'forbidden'.

-- 8.6 Итог: откат
ROLLBACK;

-- 8.7 Постпроверка после ROLLBACK
SELECT count(*) FROM public.companies;              -- 0
SELECT count(*) FROM public.company_contacts;        -- 0
SELECT count(*) FROM public.client_legal_details_company_map; -- 0
SELECT count(*) FROM public.company_sync_queue;      -- 0
SELECT count(*) FROM public.user_roles_v2
  WHERE user_id IN (
    -- проверка чистоты fixtures опускается: транзакция откачена
  );
```

Оператор фиксирует по каждой (роль × таблица × операция) фактический результат в отчёте исполнения. Расхождение с ожиданием — блокер release.

## 9. Rollback (готовится, не применяется)

Порядок строго обратный созданию, без CASCADE. Соответствует approved §8 execution plan.

```sql
BEGIN;

-- 9.1 RPC (создан в §6)
DROP FUNCTION IF EXISTS public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid);
DROP FUNCTION IF EXISTS public.crm_company_get_or_create(text,text,text,text,text,uuid);

-- 9.2 Triggers (созданы в §4)
DROP TRIGGER IF EXISTS trg_set_companies_public_id ON public.companies;
DROP TRIGGER IF EXISTS update_companies_updated_at ON public.companies;
DROP TRIGGER IF EXISTS update_company_contacts_updated_at ON public.company_contacts;
DROP TRIGGER IF EXISTS update_client_legal_details_company_map_updated_at ON public.client_legal_details_company_map;
DROP TRIGGER IF EXISTS update_company_sync_queue_updated_at ON public.company_sync_queue;

-- 9.3 Trigger function (создана в §4)
DROP FUNCTION IF EXISTS public.set_companies_public_id();

-- 9.4 Policies (созданы в §5)
DROP POLICY IF EXISTS "companies read for CRM staff" ON public.companies;
DROP POLICY IF EXISTS "companies insert for admin+manager" ON public.companies;
DROP POLICY IF EXISTS "companies update for admin+manager" ON public.companies;
DROP POLICY IF EXISTS "companies delete for super_admin" ON public.companies;
DROP POLICY IF EXISTS "company_contacts read for CRM staff" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts insert for admin+manager" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts update for admin+manager" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts delete for super_admin" ON public.company_contacts;
DROP POLICY IF EXISTS "client_legal_details_company_map read for CRM staff" ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS "client_legal_details_company_map insert for admin+manager" ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS "client_legal_details_company_map update for admin+manager" ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS "client_legal_details_company_map delete for super_admin" ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS "company_sync_queue service only" ON public.company_sync_queue;

-- 9.5 Таблицы: company_contacts удаляется ДО map (FK на map)
DROP TABLE public.company_sync_queue;
DROP TABLE public.company_contacts;
DROP TABLE public.client_legal_details_company_map;
DROP TABLE public.companies;

-- 9.6 public_id namespace
DELETE FROM public.public_id_sequences WHERE entity_type='company';

COMMIT;
```

Helper-функции (`update_updated_at_column`, `has_role_v2`, `next_public_id`) созданы вне Phase 1 и rollback не затрагивает. `client_legal_details` не тронут. `admin_section`/`admin_resource`/`role_admin_*`/`app_settings` в Phase 1 не изменялись.

## 10. DoD Phase 1 runnable

- [ ] Preflight §1 выполнен на prod-реплике; результаты приложены к отчёту.
- [ ] Forward migration §3–§6 применена в staging; assertion-блок §3.0 не сработал.
- [ ] Verification §7 (7.1–7.9) — все проверки прошли поимённо.
- [ ] RLS runtime proof §8 выполнен в staging с ROLLBACK; матрица ожиданий совпала.
- [ ] Rollback §9 подготовлен как отдельная migration и smoke-проверен в staging.
- [ ] Никаких изменений `.lovable/plan.md`, других discovery-документов, кода, БД prod.

## 11. Sync-сверка по 8 пунктам consolidated review

| # | Замечание | Как закрыто в v2 |
|---|---|---|
| 1 | DDL расходится с approved | §3 полностью восстановлен из approved execution plan commit 8649e2ba. |
| 2 | RLS расширяла DELETE до admin | §5: DELETE только `has_role_v2(auth.uid(),'super_admin')` для всех 3 CRM-таблиц. |
| 3 | `crm_company_link_contact` содержал UPSERT | §6: тело — только guard + `RETURN NULL`; INSERT/UPDATE удалены. |
| 4 | Public ID мог рассинхронизировать sequence | §4: `set_companies_public_id` явно запрещает переданный `public_id`, всегда вызывает `next_public_id('company')`. |
| 5 | Preflight не stop-guard | §3.0: assertions продублированы через `DO … RAISE EXCEPTION`; критические объекты создаются через `CREATE FUNCTION` (не `CREATE OR REPLACE`). |
| 6 | Verification проверяла counts | §7: перешла на именные проверки колонок, defaults, constraints, FK actions, индексов, policies, grants, function signatures. |
| 7 | RLS proof на пустой таблице | §8: fixture-based в BEGIN/ROLLBACK, real `user_roles_v2` (подтверждено `pg_get_functiondef(has_role_v2)`); проверяется видимость конкретного ID; service_role убран из RPC-matrix. |
| 8 | Изменён `.lovable/plan.md` | §0: `.lovable/plan.md` возвращён к состоянию commit 8649e2ba; итоговый diff содержит только этот файл. |
