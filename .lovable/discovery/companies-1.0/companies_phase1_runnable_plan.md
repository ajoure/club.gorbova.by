# companies_phase1_runnable_plan.md

```
Status: DRAFT / NOT APPROVED / DO NOT EXECUTE
Scope:  Phase 1 Canonical Data Model (schema + public ID + RLS + 2 RPC skeletons)
Base:   Freeze  04f85026c3458cdd3c8398c1841c1e4371e3dbfa (APPROVED / FROZEN)
        Amend.  8649e2ba7d649a303e3a8e50c553ecd679d59acf (APPROVED)
```

Документ содержит готовый к исполнению SQL для Phase 1. Исполнение запрещено без отдельного approval. Архитектура заморожена; любые отклонения — только через ADR.

## Границы Phase 1 (жёсткие запреты)

Запрещено: backfill; trigger на `client_legal_details`; company-sync-worker; изменения `orders_v2`, `crm_tasks`; UI, `AdminCompanies`, `CompanyDetailSheet`; feature flag; `admin_section` / `admin_resource`; `role_admin_*` access; создание companies из AmoCRM; `external_ids`, `parent_company_id`, `hierarchy_type`; изменения document-flow; `company_contact_person_map`; любые работы Phase 2–11.

---

## §1. Preflight (read-only)

Каждый запрос выполняется до начала транзакции миграции. Любое расхождение — HARD STOP, execution не начинается.

### 1.1. Отсутствие 4 Phase 1 таблиц

```sql
SELECT
  to_regclass('public.companies')::text                        AS companies,
  to_regclass('public.client_legal_details_company_map')::text AS map,
  to_regclass('public.company_contacts')::text                 AS company_contacts,
  to_regclass('public.company_sync_queue')::text               AS company_sync_queue;
```

Ожидание: 4 NULL. Иначе — STOP.

### 1.2. Prefix CMP свободен и не занят чужим entity

```sql
SELECT entity_type, prefix, last_value
FROM public.public_id_sequences
WHERE entity_type = 'company' OR prefix = 'CMP';
```

Ожидание: 0 строк. При наличии строки с `entity_type='company'` и `prefix<>'CMP'` — STOP. При наличии строки с `prefix='CMP'` и `entity_type<>'company'` — STOP. `ON CONFLICT DO NOTHING` не используется.

### 1.3. Helper functions существуют с ожидаемыми сигнатурами

```sql
SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosecdef
FROM pg_proc
WHERE proname IN ('next_public_id','has_role_v2','update_updated_at_column')
ORDER BY proname;
```

Ожидание (проверено read-only 2026-07-19):

```
next_public_id           | p_entity_type text                       | true
has_role_v2              | _user_id uuid, _role_code text           | true
update_updated_at_column | (no args)                                | (any)
```

Отсутствие любой строки — STOP.

### 1.4. SYSTEM tenant существует

```sql
SELECT id, name, is_personal
FROM public.tenants
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;
```

Ожидание ровно одной строки: `id=00000000-0000-0000-0000-000000000001`, `name='system'`, `is_personal=false` (проверено 2026-07-19). Иначе — STOP. Phase 1 не создаёт SYSTEM tenant; его отсутствие означает несовместимую среду.

### 1.5. Все требуемые роли существуют

```sql
SELECT count(*) AS present
FROM public.roles
WHERE code IN ('super_admin','admin','menedzher','support','admin_gost','editor','user');
```

Ожидание: `present = 7`. Иначе — STOP.

### 1.6. Отсутствие конфликтующих объектов

```sql
-- функции
SELECT count(*) AS conflict_funcs
FROM pg_proc
WHERE proname IN ('crm_company_get_or_create','crm_company_link_contact','set_companies_public_id');

-- триггеры
SELECT count(*) AS conflict_triggers
FROM pg_trigger
WHERE tgname IN (
  'trg_set_companies_public_id',
  'update_companies_updated_at',
  'update_client_legal_details_company_map_updated_at',
  'update_company_contacts_updated_at',
  'update_company_sync_queue_updated_at'
);

-- индексы / policies на будущих таблицах отсутствуют потому,
-- что таблицы отсутствуют (см. §1.1)
```

Ожидание: все `count = 0`. Иначе — STOP.

### 1.7. Baseline schema hash

```sql
SELECT md5(string_agg(
  table_name || ':' || column_name || ':' || data_type,
  ',' ORDER BY table_name, ordinal_position
)) AS schema_hash
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN (
    'client_legal_details','profiles','public_id_sequences',
    'roles','role_admin_resource_access','role_admin_section_access',
    'admin_section'
  );
```

Ожидание: `c41160b83c8e15c3d3c41a13028700d5`. Иначе — STOP.

---

## §2. Migration files

- **Forward migration:** один файл `supabase/migrations/<timestamp>_phase1_companies_core.sql`. Все DDL, INSERT в `public_id_sequences`, GRANT/REVOKE, `ENABLE RLS`, `CREATE POLICY`, `CREATE FUNCTION`, `CREATE TRIGGER` внутри одного `BEGIN … COMMIT`. Атомарность гарантируется транзакцией Postgres.
- **Rollback:** отдельный SQL-документ `.lovable/discovery/companies-1.0/companies_phase1_rollback.sql` (не migration). Применяется вручную по §9 в отдельной транзакции.
- **Поведение при ошибке forward:** любой `RAISE` внутри транзакции → полный `ROLLBACK`, БД возвращается в pre-Phase-1 состояние, `schema_hash` §1.7 остаётся равным `c41160b83c8e15c3d3c41a13028700d5`.

---

## §3. DDL

Порядок фиксированный: `companies` → `client_legal_details_company_map` → `company_contacts` → `company_sync_queue`.

### 3.1. companies

```sql
CREATE TABLE public.companies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id           text NOT NULL,
  tenant_id           uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
                        REFERENCES public.tenants(id) ON DELETE RESTRICT,
  company_kind        text NOT NULL,
  country             text NOT NULL,
  unp                 text NULL,
  unp_normalized      text NULL,
  full_name           text NOT NULL,
  short_name          text NULL,
  status              text NOT NULL DEFAULT 'active',
  archived_at         timestamptz NULL,
  archived_reason     text NULL,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL,
  updated_by          uuid NULL,
  CONSTRAINT uq_companies_public_id UNIQUE (public_id),
  CONSTRAINT uq_companies_country_unp UNIQUE (country, unp_normalized),
  CONSTRAINT ck_companies_public_id_format CHECK (public_id ~ '^CMP-[0-9]{6}$'),
  CONSTRAINT ck_companies_company_kind CHECK (company_kind IN ('legal_entity','entrepreneur','foreign','unknown')),
  CONSTRAINT ck_companies_status CHECK (status IN ('active','archived','merged'))
);

CREATE INDEX idx_companies_tenant_id     ON public.companies (tenant_id);
CREATE INDEX idx_companies_company_kind  ON public.companies (company_kind);
CREATE INDEX idx_companies_status        ON public.companies (status);
CREATE INDEX idx_companies_created_at    ON public.companies (created_at DESC);
CREATE INDEX idx_companies_full_name_lc  ON public.companies (lower(full_name));
```

### 3.2. client_legal_details_company_map

```sql
CREATE TABLE public.client_legal_details_company_map (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL
                                REFERENCES public.companies(id) ON DELETE RESTRICT,
  client_legal_details_id     uuid NOT NULL
                                REFERENCES public.client_legal_details(id) ON DELETE RESTRICT,
  is_primary                  boolean NOT NULL DEFAULT false,
  source                      text NOT NULL DEFAULT 'billing',
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL,
  updated_by                  uuid NULL,
  CONSTRAINT uq_cldcm_cld UNIQUE (client_legal_details_id),
  CONSTRAINT ck_cldcm_source CHECK (source IN ('billing','manual','import'))
);

CREATE INDEX idx_cldcm_company_id ON public.client_legal_details_company_map (company_id);
```

### 3.3. company_contacts

Создаётся после map, потому что `source_client_legal_details_map_id` ссылается на map.

```sql
CREATE TABLE public.company_contacts (
  id                                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                            uuid NOT NULL
                                          REFERENCES public.companies(id) ON DELETE RESTRICT,
  profile_id                            uuid NULL
                                          REFERENCES public.profiles(id) ON DELETE SET NULL,
  relationship_type                     text NOT NULL,
  is_billing_contact                    boolean NOT NULL DEFAULT false,
  source                                text NOT NULL DEFAULT 'manual',
  source_client_legal_details_map_id    uuid NULL
                                          REFERENCES public.client_legal_details_company_map(id)
                                          ON DELETE RESTRICT,
  metadata                              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                            timestamptz NOT NULL DEFAULT now(),
  updated_at                            timestamptz NOT NULL DEFAULT now(),
  created_by                            uuid NULL,
  updated_by                            uuid NULL,
  CONSTRAINT uq_company_contacts_triplet
    UNIQUE (company_id, profile_id, relationship_type),
  CONSTRAINT ck_company_contacts_relationship_type
    CHECK (relationship_type IN ('billing_contact','director','signatory','representative','external_contact')),
  CONSTRAINT ck_company_contacts_source
    CHECK (source IN ('billing_requisites','manual','import','external')),
  CONSTRAINT ck_company_contacts_profile_required
    CHECK (relationship_type = 'external_contact' OR profile_id IS NOT NULL)
);

CREATE INDEX idx_company_contacts_company_id ON public.company_contacts (company_id);
CREATE INDEX idx_company_contacts_profile_id ON public.company_contacts (profile_id);
CREATE INDEX idx_company_contacts_billing    ON public.company_contacts (company_id) WHERE is_billing_contact = true;
```

### 3.4. company_sync_queue

```sql
CREATE TABLE public.company_sync_queue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid NOT NULL,
  entity_kind         text NOT NULL DEFAULT 'client_legal_details',
  run_reason          text NOT NULL,
  idempotency_key     text NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  attempts            integer NOT NULL DEFAULT 0,
  last_error          text NULL,
  scheduled_at        timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz NULL,
  finished_at         timestamptz NULL,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL,
  updated_by          uuid NULL,
  CONSTRAINT uq_csq_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_csq_status CHECK (status IN ('pending','running','done','failed')),
  CONSTRAINT ck_csq_entity_kind CHECK (entity_kind = 'client_legal_details')
);

CREATE INDEX idx_csq_status_scheduled ON public.company_sync_queue (status, scheduled_at);
```

### 3.5. updated_at триггеры

```sql
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
```

---

## §4. Public ID

Существующая реализация `public.next_public_id(p_entity_type text)` (SECURITY DEFINER, plpgsql, атомарный UPDATE, формат `PREFIX-000001`) переиспользуется без изменений.

### 4.1. Регистрация namespace

```sql
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('company', 'CMP', 0);
-- без ON CONFLICT DO NOTHING; preflight §1.2 гарантирует отсутствие строки.
```

### 4.2. Trigger function

```sql
CREATE OR REPLACE FUNCTION public.set_companies_public_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.public_id IS NULL THEN
    NEW.public_id := public.next_public_id('company');
  ELSE
    IF NEW.public_id !~ '^CMP-[0-9]{6}$' THEN
      RAISE EXCEPTION 'invalid_public_id_format: %', NEW.public_id
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_companies_public_id() FROM PUBLIC;
```

### 4.3. Trigger binding

```sql
CREATE TRIGGER trg_set_companies_public_id
  BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_companies_public_id();
```

### 4.4. Защита от дубликатов

Уникальность гарантирована `uq_companies_public_id` (§3.1). При коллизии — исключение `unique_violation` (23505).

### 4.5. Staging без расхода production ID

Staging — отдельная реплика БД. Инкремент `last_value` в staging не влияет на production. В production Phase 1 стартует с `last_value=0`; первый реальный INSERT произойдёт только в Phase 3 (backfill).

---

## §5. GRANT / REVOKE / RLS (13 policies)

### 5.1. REVOKE + GRANT

```sql
REVOKE ALL ON public.companies                         FROM PUBLIC;
REVOKE ALL ON public.client_legal_details_company_map  FROM PUBLIC;
REVOKE ALL ON public.company_contacts                  FROM PUBLIC;
REVOKE ALL ON public.company_sync_queue                FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies                        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_legal_details_company_map TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_contacts                 TO authenticated;
-- company_sync_queue: no authenticated grant

GRANT ALL ON public.companies                        TO service_role;
GRANT ALL ON public.client_legal_details_company_map TO service_role;
GRANT ALL ON public.company_contacts                 TO service_role;
GRANT ALL ON public.company_sync_queue               TO service_role;
```

### 5.2. Enable RLS

```sql
ALTER TABLE public.companies                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_legal_details_company_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_contacts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_sync_queue               ENABLE ROW LEVEL SECURITY;
```

### 5.3. Policies (13)

**companies (4):**

```sql
CREATE POLICY companies_select ON public.companies
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
    OR public.has_role_v2(auth.uid(),'support')
  );

CREATE POLICY companies_insert ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY companies_update ON public.companies
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY companies_delete ON public.companies
  FOR DELETE TO authenticated
  USING (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
  );
```

**client_legal_details_company_map (4):** идентичная матрица, имена `cldcm_select|insert|update|delete`. SELECT: super_admin/admin/menedzher/support. INSERT/UPDATE: super_admin/admin/menedzher. DELETE: super_admin/admin.

```sql
CREATE POLICY cldcm_select ON public.client_legal_details_company_map
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
    OR public.has_role_v2(auth.uid(),'support')
  );

CREATE POLICY cldcm_insert ON public.client_legal_details_company_map
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY cldcm_update ON public.client_legal_details_company_map
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY cldcm_delete ON public.client_legal_details_company_map
  FOR DELETE TO authenticated
  USING (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
  );
```

**company_contacts (4):** идентичная матрица, имена `company_contacts_select|insert|update|delete`.

```sql
CREATE POLICY company_contacts_select ON public.company_contacts
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
    OR public.has_role_v2(auth.uid(),'support')
  );

CREATE POLICY company_contacts_insert ON public.company_contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY company_contacts_update ON public.company_contacts
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'menedzher')
  );

CREATE POLICY company_contacts_delete ON public.company_contacts
  FOR DELETE TO authenticated
  USING (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
  );
```

**company_sync_queue (1):** только service_role.

```sql
CREATE POLICY company_sync_queue_service_role ON public.company_sync_queue
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

Итого: 4 + 4 + 4 + 1 = **13 policies**.

### 5.4. Матрица ожидаемого доступа (проверяется §8)

| Роль                                | companies / map / contacts        | company_sync_queue |
|-------------------------------------|-----------------------------------|--------------------|
| super_admin                         | SELECT/INSERT/UPDATE/DELETE       | 0 (RLS)            |
| admin                               | SELECT/INSERT/UPDATE/DELETE       | 0 (RLS)            |
| menedzher                           | SELECT/INSERT/UPDATE              | 0 (RLS)            |
| support                             | SELECT                            | 0 (RLS)            |
| admin_gost / editor / user          | 0                                 | 0                  |
| authenticated без CRM-роли          | 0                                 | 0                  |
| anon                                | 0 (no GRANT)                      | 0 (no GRANT)       |
| service_role                        | bypass                            | bypass             |

---

## §6. RPC-контракты (Phase 1 skeletons)

### 6.1. crm_company_get_or_create

```sql
CREATE OR REPLACE FUNCTION public.crm_company_get_or_create(
  _country        text,
  _unp            text,
  _full_name      text,
  _company_kind   text,
  _source         text,
  _source_cld_id  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF NOT (
    public.has_role_v2(v_uid,'super_admin')
    OR public.has_role_v2(v_uid,'admin')
    OR public.has_role_v2(v_uid,'menedzher')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _company_kind NOT IN ('legal_entity','entrepreneur','foreign','unknown') THEN
    RAISE EXCEPTION 'invalid_company_kind: %', _company_kind USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id
  FROM public.companies
  WHERE country = _country
    AND unp_normalized = lower(regexp_replace(coalesce(_unp,''), '\s+', '', 'g'));

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  RAISE EXCEPTION 'phase1_skeleton_no_create' USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) TO authenticated;
```

Граница: Phase 1 — только lookup + guard. Полное создание — Phase 2.

### 6.2. crm_company_link_contact

```sql
CREATE OR REPLACE FUNCTION public.crm_company_link_contact(
  _company_id             uuid,
  _profile_id             uuid,
  _relationship_type      text,
  _is_billing_contact     boolean,
  _source                 text,
  _source_map_id          uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF NOT (
    public.has_role_v2(v_uid,'super_admin')
    OR public.has_role_v2(v_uid,'admin')
    OR public.has_role_v2(v_uid,'menedzher')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _relationship_type NOT IN ('billing_contact','director','signatory','representative','external_contact') THEN
    RAISE EXCEPTION 'invalid_relationship_type: %', _relationship_type USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.company_contacts (
    company_id, profile_id, relationship_type,
    is_billing_contact, source, source_client_legal_details_map_id,
    created_by, updated_by
  )
  VALUES (
    _company_id, _profile_id, _relationship_type,
    coalesce(_is_billing_contact,false),
    coalesce(_source,'manual'),
    _source_map_id,
    v_uid, v_uid
  )
  ON CONFLICT (company_id, profile_id, relationship_type) DO UPDATE
    SET is_billing_contact = EXCLUDED.is_billing_contact,
        source             = EXCLUDED.source,
        source_client_legal_details_map_id = EXCLUDED.source_client_legal_details_map_id,
        updated_by         = v_uid,
        updated_at         = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) TO authenticated;
```

Идемпотентна через `ON CONFLICT`. Ошибки: `forbidden`, `invalid_relationship_type`, `foreign_key_violation` (23503) — если `_company_id` не существует.

---

## §7. Verification (post-migration SQL)

```sql
-- 7.1. 4 таблицы существуют
SELECT
  to_regclass('public.companies') IS NOT NULL AS t1,
  to_regclass('public.client_legal_details_company_map') IS NOT NULL AS t2,
  to_regclass('public.company_contacts') IS NOT NULL AS t3,
  to_regclass('public.company_sync_queue') IS NOT NULL AS t4;
-- ожидание: 4 × true

-- 7.2. FK actions
SELECT conname, confdeltype
FROM pg_constraint
WHERE conrelid = 'public.company_contacts'::regclass
  AND conname LIKE '%source_client_legal_details_map%';
-- ожидание: confdeltype = 'r' (RESTRICT)

-- 7.3. Индексы
SELECT count(*) AS idx_count
FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN ('companies','client_legal_details_company_map','company_contacts','company_sync_queue');
-- ожидание: >= 11 (5 + 1 + 3 + 1 non-PK + 4 PK)

-- 7.4. RLS enabled
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('companies','client_legal_details_company_map','company_contacts','company_sync_queue');
-- ожидание: 4 × true

-- 7.5. Policies = 13
SELECT tablename, count(*) FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('companies','client_legal_details_company_map','company_contacts','company_sync_queue')
GROUP BY tablename ORDER BY tablename;
-- ожидание: companies=4, client_legal_details_company_map=4, company_contacts=4, company_sync_queue=1

-- 7.6. GRANTs
SELECT grantee, privilege_type, table_name
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN ('companies','client_legal_details_company_map','company_contacts','company_sync_queue')
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY table_name, grantee, privilege_type;
-- ожидание: authenticated имеет S/I/U/D на 3 таблицы, 0 строк для company_sync_queue;
-- service_role — full на все 4; anon — 0 строк

-- 7.7. RPC signatures
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('crm_company_get_or_create','crm_company_link_contact','set_companies_public_id')
ORDER BY proname;
-- ожидание: 3 строки с точными сигнатурами §6

-- 7.8. public_id namespace
SELECT entity_type, prefix, last_value FROM public.public_id_sequences WHERE entity_type='company';
-- ожидание: (company, CMP, 0)

-- 7.9. Все 4 таблицы пусты
SELECT
  (SELECT count(*) FROM public.companies)                        AS c1,
  (SELECT count(*) FROM public.client_legal_details_company_map) AS c2,
  (SELECT count(*) FROM public.company_contacts)                 AS c3,
  (SELECT count(*) FROM public.company_sync_queue)               AS c4;
-- ожидание: 0,0,0,0

-- 7.10. client_legal_details не изменена (нет trg_company_* триггеров)
SELECT count(*) FROM pg_trigger
WHERE tgrelid='public.client_legal_details'::regclass AND tgname LIKE 'trg_company_%';
-- ожидание: 0

-- 7.11. orders_v2 / crm_tasks не изменены
SELECT count(*) FROM information_schema.columns
WHERE table_schema='public' AND
  ((table_name='orders_v2' AND column_name='company_id') OR
   (table_name='crm_tasks' AND column_name='company_id'));
-- ожидание: 0

-- 7.12. admin registries чистые
SELECT count(*) FROM public.admin_section WHERE code ILIKE '%compan%';
SELECT count(*) FROM public.admin_resource WHERE code ILIKE '%compan%';
SELECT count(*) FROM public.app_settings WHERE key ILIKE '%companies%';
-- ожидание: 0, 0, 0

-- 7.13. schema hash неизменен
SELECT md5(string_agg(
  table_name || ':' || column_name || ':' || data_type,
  ',' ORDER BY table_name, ordinal_position
)) AS schema_hash
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN (
    'client_legal_details','profiles','public_id_sequences',
    'roles','role_admin_resource_access','role_admin_section_access',
    'admin_section'
  );
-- ожидание: c41160b83c8e15c3d3c41a13028700d5
```

---

## §8. RLS runtime proof (mechanism)

### 8.1. Механизм проверки

Ролевые ассёрты выполняются на staging через **`SET LOCAL ROLE` внутри транзакции с `SET LOCAL request.jwt.claims`**. Это стандартный Supabase-совместимый паттерн: RLS видит `auth.uid()` из claims, а грант-матрица — из PostgreSQL role.

Никаких дополнительных staging-аккаунтов не создаётся. Тестовая админ-учётка `1@ajoure.by` уже существует; её пароль в документе не сохраняется — при необходимости UI-smoke используется через существующий staging-механизм авторизации (форма «Login as Developer»).

Шаблон одной проверки:

```sql
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" = '{"sub":"<user-uuid>","role":"authenticated"}';
  -- ассёрт:
  SELECT count(*) FROM public.companies;   -- ожидание зависит от роли
ROLLBACK;
```

Гарантия возврата исходной роли: каждая проверка обёрнута `BEGIN … ROLLBACK`; `SET LOCAL` действует только внутри транзакции. Никаких `SET ROLE` вне транзакции.

Для `service_role` и `anon` — те же `SET LOCAL ROLE service_role|anon` без jwt claims.

Для проверки конкретной role_code (`admin`, `menedzher`, `support`, `admin_gost`, `editor`, `user`) на staging создаётся временный тест-пользователь и вставляется соответствующая строка в `user_roles_v2` **внутри той же транзакции**, которая откатывается — production `user_roles_v2` не изменяется:

```sql
BEGIN;
  INSERT INTO auth.users (id) VALUES ('11111111-1111-1111-1111-111111111111');  -- staging only
  INSERT INTO public.user_roles_v2 (user_id, role_id)
    SELECT '11111111-1111-1111-1111-111111111111', id FROM public.roles WHERE code='menedzher';
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  -- ассёрты SELECT/INSERT/UPDATE/DELETE/EXECUTE
ROLLBACK;
```

Все staging-инъекции откатываются транзакцией. Production не затрагивается.

### 8.2. Ассёрт-матрица

Для каждой из 8 ролей + `service_role` выполняется набор:

| Ассёрт                                                            | super_admin | admin | menedzher | support | admin_gost | editor | user | anon | authenticated (no CRM) | service_role |
|-------------------------------------------------------------------|:-----------:|:-----:|:---------:|:-------:|:----------:|:------:|:----:|:----:|:----------------------:|:------------:|
| `SELECT FROM companies`                                           | ok(0)       | ok(0) | ok(0)     | ok(0)   | ok(0)      | ok(0)† | ok(0)†| deny‡| ok(0)†                 | ok(0)        |
| `INSERT INTO companies`                                           | ok          | ok    | ok        | rls     | rls        | rls    | rls  | deny | rls                    | ok           |
| `UPDATE companies`                                                | ok          | ok    | ok        | rls     | rls        | rls    | rls  | deny | rls                    | ok           |
| `DELETE FROM companies`                                           | ok          | ok    | rls       | rls     | rls        | rls    | rls  | deny | rls                    | ok           |
| То же для `client_legal_details_company_map` и `company_contacts` | идентично   |       |           |         |            |        |      |      |                        |              |
| `SELECT FROM company_sync_queue`                                  | rls         | rls   | rls       | rls     | rls        | rls    | rls  | deny | rls                    | ok           |
| `INSERT INTO company_sync_queue`                                  | rls         | rls   | rls       | rls     | rls        | rls    | rls  | deny | rls                    | ok           |
| `EXECUTE crm_company_get_or_create`                               | ok/skel     | ok/skel| ok/skel  | forbid  | forbid     | forbid | forbid| —    | forbid                 | ok/skel      |
| `EXECUTE crm_company_link_contact`                                | ok          | ok    | ok        | forbid  | forbid     | forbid | forbid| —    | forbid                 | ok           |

Обозначения:
- `ok(0)` — SELECT проходит, возвращает 0 строк (таблица пуста).
- `ok(0)†` — SELECT проходит по GRANT, RLS фильтрует до 0. Это ожидаемо: чтение не даёт данных.
- `deny‡` — отказ по отсутствию GRANT (`permission denied for table`).
- `rls` — RLS-отказ (`new row violates row-level security policy`) для write либо 0 строк для SELECT после фильтра.
- `forbid` — RPC возвращает `forbidden` (42501).
- `ok/skel` — guard пройден; при отсутствии matching company возвращается `phase1_skeleton_no_create` — это ожидаемое поведение skeleton, а не провал.

Каждый ассёрт логируется в отчёт `.lovable/discovery/companies-1.0/companies_phase1_runtime_proof.md` (создаётся отдельным шагом, не в этом плане).

---

## §9. Rollback (без CASCADE)

Правильный порядок: **triggers → RPC/trigger functions → policies → tables → sequence row**. Триггеры удаляются раньше их функций.

```sql
BEGIN;

-- 9.1. Triggers
DROP TRIGGER IF EXISTS trg_set_companies_public_id                              ON public.companies;
DROP TRIGGER IF EXISTS update_companies_updated_at                              ON public.companies;
DROP TRIGGER IF EXISTS update_client_legal_details_company_map_updated_at       ON public.client_legal_details_company_map;
DROP TRIGGER IF EXISTS update_company_contacts_updated_at                       ON public.company_contacts;
DROP TRIGGER IF EXISTS update_company_sync_queue_updated_at                     ON public.company_sync_queue;

-- 9.2. RPC + trigger function
DROP FUNCTION IF EXISTS public.crm_company_get_or_create(text,text,text,text,text,uuid);
DROP FUNCTION IF EXISTS public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid);
DROP FUNCTION IF EXISTS public.set_companies_public_id();

-- 9.3. Policies (13)
DROP POLICY IF EXISTS companies_select ON public.companies;
DROP POLICY IF EXISTS companies_insert ON public.companies;
DROP POLICY IF EXISTS companies_update ON public.companies;
DROP POLICY IF EXISTS companies_delete ON public.companies;

DROP POLICY IF EXISTS cldcm_select ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS cldcm_insert ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS cldcm_update ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS cldcm_delete ON public.client_legal_details_company_map;

DROP POLICY IF EXISTS company_contacts_select ON public.company_contacts;
DROP POLICY IF EXISTS company_contacts_insert ON public.company_contacts;
DROP POLICY IF EXISTS company_contacts_update ON public.company_contacts;
DROP POLICY IF EXISTS company_contacts_delete ON public.company_contacts;

DROP POLICY IF EXISTS company_sync_queue_service_role ON public.company_sync_queue;

-- 9.4. Tables (child → parent, без CASCADE)
DROP TABLE IF EXISTS public.company_sync_queue;
DROP TABLE IF EXISTS public.company_contacts;
DROP TABLE IF EXISTS public.client_legal_details_company_map;
DROP TABLE IF EXISTS public.companies;

-- 9.5. Sequence row
DELETE FROM public.public_id_sequences WHERE entity_type='company' AND prefix='CMP';

COMMIT;
```

Helper functions `update_updated_at_column`, `has_role_v2`, `next_public_id` **не удаляются** — они разделены с другими доменами.

### 9.6. Post-rollback verification

```sql
SELECT
  to_regclass('public.companies'),
  to_regclass('public.client_legal_details_company_map'),
  to_regclass('public.company_contacts'),
  to_regclass('public.company_sync_queue');
-- ожидание: 4 × NULL

SELECT count(*) FROM public.public_id_sequences WHERE entity_type='company';
-- ожидание: 0

SELECT count(*) FROM pg_proc
WHERE proname IN ('update_updated_at_column','has_role_v2','next_public_id');
-- ожидание: 3

-- schema hash
SELECT md5(string_agg(
  table_name || ':' || column_name || ':' || data_type,
  ',' ORDER BY table_name, ordinal_position
))
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN (
    'client_legal_details','profiles','public_id_sequences',
    'roles','role_admin_resource_access','role_admin_section_access',
    'admin_section'
  );
-- ожидание: c41160b83c8e15c3d3c41a13028700d5
```

---

## §10. Stop-guards

Execution обязан немедленно остановиться при любом из:

1. Любой из объектов §1 существует в несовместимом виде.
2. `public_id_sequences` содержит `entity_type='company'` с `prefix<>'CMP'` **или** `prefix='CMP'` с `entity_type<>'company'`.
3. Отсутствует helper function из §1.3.
4. Отсутствует SYSTEM tenant `00000000-0000-0000-0000-000000000001`.
5. RLS runtime proof (§8) не совпал с матрицей.
6. Staging rollback (§9) не проходит либо оставляет объекты.
7. Затронута существующая таблица вне scope Phase 1 (`orders_v2`, `crm_tasks`, `client_legal_details`, `admin_section`, `admin_resource`, `app_settings`).
8. Появился файл или изменение вне утверждённого Phase 1 scope (для plan-этапа — вне `.lovable/discovery/companies-1.0/`; для execution — вне одного migration-файла + одного rollback-файла).

---

## §11. Definition of Done

- [ ] Forward migration подготовлена (один файл, атомарная транзакция).
- [ ] Rollback подготовлен (отдельный SQL).
- [ ] Staging preflight §1 — все ожидания совпали.
- [ ] Staging forward execution успешен, verification §7 — все зелёные.
- [ ] Staging RLS runtime proof §8 — вся матрица совпала.
- [ ] Staging rollback §9 успешен, post-rollback §9.6 — 4 × NULL, `schema_hash = c41160b83c8e15c3d3c41a13028700d5`.
- [ ] Повторное staging forward execution (после rollback) успешно — идемпотентность.
- [ ] 4 таблицы пусты.
- [ ] Backfill не выполнен.
- [ ] Application code, edge functions, UI не изменены.
- [ ] Отчёт содержит фактические SQL outputs всех §1, §7, §8, §9.6.
- [ ] Production execution не выполнена без отдельного approval пользователя.

---

Документ готов к consolidated review. Изменения запрещены до отдельного approval Phase 1 execution.
