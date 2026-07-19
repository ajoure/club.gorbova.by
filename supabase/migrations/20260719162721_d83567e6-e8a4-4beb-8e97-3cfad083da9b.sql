
-- CRM Companies — Phase 1 forward migration.
-- Источник: .lovable/discovery/companies-1.0/companies_phase1_runnable_plan.md §3–§6.
-- Применяется однократно. Rollback хранится в .lovable/rollback/companies-phase1/phase1_rollback.sql (НЕ применяется).

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================
-- 3.0 HARD STOP guards
-- ============================================================
DO $$
DECLARE
  v_roles text[] := ARRAY['admin','admin_gost','editor','menedzher','super_admin','support','user'];
  v_missing_role text;
  v_tenant_row record;
BEGIN
  IF to_regclass('public.companies') IS NOT NULL
     OR to_regclass('public.client_legal_details_company_map') IS NOT NULL
     OR to_regclass('public.company_contacts') IS NOT NULL
     OR to_regclass('public.company_sync_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: one of target tables already exists';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname IN (
               'crm_company_get_or_create','crm_company_link_contact','set_companies_public_id'
             )) THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: target function already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='next_public_id'
      AND pg_get_function_identity_arguments(p.oid)='p_entity_type text'
  ) THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: helper next_public_id(p_entity_type text) missing or drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='update_updated_at_column'
      AND pg_get_function_identity_arguments(p.oid)=''
  ) THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: helper public.update_updated_at_column() missing or drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='has_role_v2'
      AND pg_get_function_identity_arguments(p.oid)='_user_id uuid, _role_code text'
  ) THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: helper has_role_v2(_user_id uuid, _role_code text) missing or drifted';
  END IF;

  IF EXISTS (SELECT 1 FROM public.public_id_sequences
             WHERE prefix='CMP' AND entity_type<>'company') THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: prefix CMP already reserved by another entity_type';
  END IF;
  IF EXISTS (SELECT 1 FROM public.public_id_sequences
             WHERE entity_type='company' AND prefix<>'CMP') THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: entity_type=company already exists with prefix<>CMP';
  END IF;
  IF EXISTS (SELECT 1 FROM public.public_id_sequences
             WHERE entity_type='company' OR prefix='CMP') THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: namespace company/CMP already registered';
  END IF;

  SELECT r INTO v_missing_role
  FROM unnest(v_roles) AS r
  WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE code=r)
  LIMIT 1;
  IF v_missing_role IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: canonical role missing: %', v_missing_role;
  END IF;

  SELECT id, name, is_personal INTO v_tenant_row
  FROM public.tenants WHERE id='00000000-0000-0000-0000-000000000001';
  IF v_tenant_row.id IS NULL THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: SYSTEM tenant 00000000-0000-0000-0000-000000000001 missing';
  END IF;
  IF v_tenant_row.name <> 'system' OR v_tenant_row.is_personal <> false THEN
    RAISE EXCEPTION 'Phase 1 assertion failed: SYSTEM tenant contract mismatch (expected name=system, is_personal=false)';
  END IF;
END $$;

-- ============================================================
-- 3.1 Namespace
-- ============================================================
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('company', 'CMP', 0);

-- ============================================================
-- 3.2 companies
-- ============================================================
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

-- ============================================================
-- 3.3 client_legal_details_company_map (ДО company_contacts)
-- ============================================================
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

-- ============================================================
-- 3.4 company_contacts
-- ============================================================
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

-- ============================================================
-- 3.5 company_sync_queue (service_role only)
-- ============================================================
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

GRANT ALL ON public.company_sync_queue TO service_role;
ALTER TABLE public.company_sync_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_sync_queue service only"
  ON public.company_sync_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 4. Trigger function + triggers
-- ============================================================
CREATE FUNCTION public.set_companies_public_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.public_id IS NOT NULL THEN
    RAISE EXCEPTION
      'companies.public_id must not be provided explicitly; use next_public_id(''company'')';
  END IF;
  NEW.public_id := public.next_public_id('company');
  RETURN NEW;
END;
$fn$;

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

-- ============================================================
-- 6. RPC-скелеты
-- ============================================================
CREATE FUNCTION public.crm_company_get_or_create(
  _country text,
  _unp text,
  _full_name text,
  _company_kind text,
  _source text,
  _source_client_legal_details_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT id INTO v_id
  FROM public.companies
  WHERE country = _country AND unp_normalized = _unp AND status <> 'merged'
  LIMIT 1;
  RETURN v_id;
END;
$fn$;

CREATE FUNCTION public.crm_company_link_contact(
  _company_id uuid,
  _profile_id uuid,
  _relationship_type text,
  _is_billing_contact boolean,
  _source text,
  _source_client_legal_details_map_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $fn$
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) TO authenticated;
