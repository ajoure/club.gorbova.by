-- =========================================================================
-- B+C: tenants foundation + legal_entities_requisites + individual_requisites
-- Транзакционно. STOP-guards внутри. Старые таблицы НЕ трогаем.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. TENANTS
-- -------------------------------------------------------------------------
CREATE TABLE public.tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  owner_user_id   uuid NOT NULL,
  is_personal     boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tenants_personal_owner_uk
  ON public.tenants (owner_user_id) WHERE is_personal = true;
CREATE INDEX tenants_owner_idx ON public.tenants (owner_user_id);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------------------
-- 2. TENANT_MEMBERSHIPS
-- -------------------------------------------------------------------------
CREATE TABLE public.tenant_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  role        text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','member','viewer')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_memberships_user_idx ON public.tenant_memberships (user_id, is_active);

ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER tenant_memberships_set_updated_at
  BEFORE UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------------------
-- 3. Helper: текущий список tenant_id пользователя (SECURITY DEFINER, без рекурсии RLS)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_tenant_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_memberships
  WHERE user_id = _user_id AND is_active = true
$$;

-- -------------------------------------------------------------------------
-- 4. RLS policies для tenants и tenant_memberships
-- -------------------------------------------------------------------------

-- tenants: SELECT — свой tenant либо admin/super_admin
CREATE POLICY tenants_select_own
  ON public.tenants FOR SELECT
  USING (
    id IN (SELECT public.user_tenant_ids(auth.uid()))
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- tenants: INSERT/UPDATE/DELETE — только admin/super_admin (личные создаются в backfill / триггере регистрации)
CREATE POLICY tenants_admin_write
  ON public.tenants FOR ALL
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- tenant_memberships: SELECT — свои или admin
CREATE POLICY memberships_select_own
  ON public.tenant_memberships FOR SELECT
  USING (
    user_id = auth.uid()
    OR tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY memberships_admin_write
  ON public.tenant_memberships FOR ALL
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- -------------------------------------------------------------------------
-- 5. Backfill: персональный tenant + owner membership на каждого auth.users
-- -------------------------------------------------------------------------
WITH ins_tenants AS (
  INSERT INTO public.tenants (name, owner_user_id, is_personal)
  SELECT
    COALESCE('Личное пространство ' || COALESCE(u.email, u.id::text), 'Личное пространство'),
    u.id,
    true
  FROM auth.users u
  RETURNING id, owner_user_id
)
INSERT INTO public.tenant_memberships (tenant_id, user_id, role, is_active)
SELECT id, owner_user_id, 'owner', true FROM ins_tenants;

-- -------------------------------------------------------------------------
-- 6. legal_entities_requisites (ЮЛ + ИП)
-- -------------------------------------------------------------------------
CREATE TABLE public.legal_entities_requisites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  owner_user_id      uuid NOT NULL,
  owner_profile_id   uuid NOT NULL,
  scope              text NOT NULL CHECK (scope IN ('system_customer','user_requisites')),
  subject_type       text NOT NULL CHECK (subject_type IN ('legal_entity','entrepreneur')),
  is_default         boolean NOT NULL DEFAULT false,
  data               jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_legacy_id   uuid,
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leg_req_tenant_idx ON public.legal_entities_requisites (tenant_id);
CREATE INDEX leg_req_owner_idx  ON public.legal_entities_requisites (owner_user_id);
CREATE INDEX leg_req_scope_idx  ON public.legal_entities_requisites (scope, subject_type);
CREATE UNIQUE INDEX leg_req_default_uk
  ON public.legal_entities_requisites (tenant_id, scope, subject_type)
  WHERE is_default = true;

ALTER TABLE public.legal_entities_requisites ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER leg_req_set_updated_at
  BEFORE UPDATE ON public.legal_entities_requisites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS legal_entities_requisites
CREATE POLICY leg_req_select
  ON public.legal_entities_requisites FOR SELECT
  USING (
    tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY leg_req_insert
  ON public.legal_entities_requisites FOR INSERT
  WITH CHECK (
    owner_user_id = auth.uid()
    AND tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
    AND created_by = auth.uid()
    AND updated_by = auth.uid()
  );

CREATE POLICY leg_req_update
  ON public.legal_entities_requisites FOR UPDATE
  USING (
    owner_user_id = auth.uid()
    AND tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
  )
  WITH CHECK (
    owner_user_id = auth.uid()
    AND tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
    AND updated_by = auth.uid()
  );

CREATE POLICY leg_req_delete
  ON public.legal_entities_requisites FOR DELETE
  USING (
    owner_user_id = auth.uid()
    AND tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
  );

CREATE POLICY leg_req_admin_all
  ON public.legal_entities_requisites FOR ALL
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- -------------------------------------------------------------------------
-- 7. individual_requisites (ФЛ)
-- -------------------------------------------------------------------------
CREATE TABLE public.individual_requisites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  owner_user_id      uuid NOT NULL,
  owner_profile_id   uuid NOT NULL,
  scope              text NOT NULL CHECK (scope IN ('system_customer','user_requisites')),
  is_default         boolean NOT NULL DEFAULT false,
  data               jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_legacy_id   uuid,
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ind_req_tenant_idx ON public.individual_requisites (tenant_id);
CREATE INDEX ind_req_owner_idx  ON public.individual_requisites (owner_user_id);
CREATE INDEX ind_req_scope_idx  ON public.individual_requisites (scope);
CREATE UNIQUE INDEX ind_req_default_uk
  ON public.individual_requisites (tenant_id, scope)
  WHERE is_default = true;

ALTER TABLE public.individual_requisites ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER ind_req_set_updated_at
  BEFORE UPDATE ON public.individual_requisites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY ind_req_select
  ON public.individual_requisites FOR SELECT
  USING (
    tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY ind_req_insert
  ON public.individual_requisites FOR INSERT
  WITH CHECK (
    owner_user_id = auth.uid()
    AND tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
    AND created_by = auth.uid()
    AND updated_by = auth.uid()
  );

CREATE POLICY ind_req_update
  ON public.individual_requisites FOR UPDATE
  USING (
    owner_user_id = auth.uid()
    AND tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
  )
  WITH CHECK (
    owner_user_id = auth.uid()
    AND tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
    AND updated_by = auth.uid()
  );

CREATE POLICY ind_req_delete
  ON public.individual_requisites FOR DELETE
  USING (
    owner_user_id = auth.uid()
    AND tenant_id IN (SELECT public.user_tenant_ids(auth.uid()))
  );

CREATE POLICY ind_req_admin_all
  ON public.individual_requisites FOR ALL
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- -------------------------------------------------------------------------
-- 8. Перенос billing -> новые таблицы (scope='system_customer')
-- -------------------------------------------------------------------------

-- 8.1 ЮЛ + ИП
INSERT INTO public.legal_entities_requisites (
  tenant_id, owner_user_id, owner_profile_id, scope, subject_type,
  is_default, data, source_legacy_id, created_by, updated_by, created_at, updated_at
)
SELECT
  t.id,
  p.user_id,
  cld.profile_id,
  'system_customer',
  cld.client_type,
  cld.is_default,
  to_jsonb(cld) - 'id' - 'profile_id' - 'client_type' - 'is_default'
                - 'created_at' - 'updated_at' - 'purpose',
  cld.id,
  p.user_id,
  p.user_id,
  cld.created_at,
  cld.updated_at
FROM public.client_legal_details cld
JOIN public.profiles p ON p.id = cld.profile_id
JOIN public.tenants  t ON t.owner_user_id = p.user_id AND t.is_personal = true
WHERE cld.purpose = 'billing'
  AND cld.client_type IN ('legal_entity','entrepreneur');

-- 8.2 ФЛ
INSERT INTO public.individual_requisites (
  tenant_id, owner_user_id, owner_profile_id, scope,
  is_default, data, source_legacy_id, created_by, updated_by, created_at, updated_at
)
SELECT
  t.id,
  p.user_id,
  cld.profile_id,
  'system_customer',
  cld.is_default,
  to_jsonb(cld) - 'id' - 'profile_id' - 'client_type' - 'is_default'
                - 'created_at' - 'updated_at' - 'purpose',
  cld.id,
  p.user_id,
  p.user_id,
  cld.created_at,
  cld.updated_at
FROM public.client_legal_details cld
JOIN public.profiles p ON p.id = cld.profile_id
JOIN public.tenants  t ON t.owner_user_id = p.user_id AND t.is_personal = true
WHERE cld.purpose = 'billing'
  AND cld.client_type = 'individual';

-- -------------------------------------------------------------------------
-- 9. STOP-guards — любое несовпадение rollback'ит всю миграцию
-- -------------------------------------------------------------------------
DO $guards$
DECLARE
  v_users        bigint;
  v_tenants      bigint;
  v_memberships  bigint;
  v_le           bigint;
  v_ind          bigint;
  v_billing      bigint;
  v_unresolvable bigint;
  v_le_nulls     bigint;
  v_ind_nulls    bigint;
BEGIN
  SELECT count(*) INTO v_users FROM auth.users;
  SELECT count(*) INTO v_tenants FROM public.tenants WHERE is_personal = true;
  SELECT count(*) INTO v_memberships FROM public.tenant_memberships;
  SELECT count(*) INTO v_le  FROM public.legal_entities_requisites WHERE scope='system_customer';
  SELECT count(*) INTO v_ind FROM public.individual_requisites WHERE scope='system_customer';
  SELECT count(*) INTO v_billing FROM public.client_legal_details WHERE purpose='billing';
  SELECT count(*) INTO v_unresolvable
    FROM public.client_legal_details cld
    LEFT JOIN public.profiles p ON p.id = cld.profile_id
    WHERE cld.purpose='billing' AND p.user_id IS NULL;
  SELECT count(*) INTO v_le_nulls
    FROM public.legal_entities_requisites
    WHERE tenant_id IS NULL OR owner_user_id IS NULL OR owner_profile_id IS NULL;
  SELECT count(*) INTO v_ind_nulls
    FROM public.individual_requisites
    WHERE tenant_id IS NULL OR owner_user_id IS NULL OR owner_profile_id IS NULL;

  IF v_tenants <> v_users THEN
    RAISE EXCEPTION 'STOP-guard 1: tenants(% personal) <> auth.users(%)', v_tenants, v_users;
  END IF;
  IF v_memberships <> v_tenants THEN
    RAISE EXCEPTION 'STOP-guard 2: memberships(%) <> tenants(%)', v_memberships, v_tenants;
  END IF;
  IF (v_le + v_ind) <> v_billing THEN
    RAISE EXCEPTION 'STOP-guard 3: migrated(%+%=%) <> billing(%)', v_le, v_ind, v_le+v_ind, v_billing;
  END IF;
  IF (v_le + v_ind) <> 21 THEN
    RAISE EXCEPTION 'STOP-guard 3b: migrated total(%+%=%) <> 21', v_le, v_ind, v_le+v_ind;
  END IF;
  IF v_le <> 11 THEN
    RAISE EXCEPTION 'STOP-guard 3c: legal_entities_requisites(%) <> 11', v_le;
  END IF;
  IF v_ind <> 10 THEN
    RAISE EXCEPTION 'STOP-guard 3d: individual_requisites(%) <> 10', v_ind;
  END IF;
  IF v_unresolvable > 0 THEN
    RAISE EXCEPTION 'STOP-guard 4: % billing-rows have NULL profiles.user_id', v_unresolvable;
  END IF;
  IF v_le_nulls > 0 OR v_ind_nulls > 0 THEN
    RAISE EXCEPTION 'STOP-guard 5: NULL identity columns: le=%, ind=%', v_le_nulls, v_ind_nulls;
  END IF;

  -- Audit
  INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, meta)
  VALUES (
    NULL, 'system', 'requisites_bc_migration',
    'requisites.migration.bc_executed',
    jsonb_build_object(
      'users', v_users,
      'tenants_personal', v_tenants,
      'memberships', v_memberships,
      'legal_entities_requisites', v_le,
      'individual_requisites', v_ind,
      'billing_source_total', v_billing
    )
  );
END
$guards$;

COMMIT;