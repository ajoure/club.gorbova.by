-- Canonical RBAC v3 alignment for every visible admin menu item/tab.
-- Code remains the source of truth; this migration makes managed data access
-- match the same none/view/edit/manage levels.

-- ---------------------------------------------------------------------
-- 1. Complete the resource catalog used by query/path tabs.
-- ---------------------------------------------------------------------
WITH section_row AS (
  SELECT id FROM public.admin_section WHERE code = 'communication'
), resource_row(code, label, route, sort_order) AS (VALUES
  ('inbox', 'Входящие', '/admin/communication', 0),
  ('broadcasts', 'Рассылки', '/admin/communication?tab=broadcasts', 1),
  ('settings', 'Настройки', '/admin/communication?tab=settings', 2)
)
INSERT INTO public.admin_resource(section_id, code, label, route, sort_order, is_active)
SELECT section_row.id, resource_row.code, resource_row.label, resource_row.route, resource_row.sort_order, true
FROM section_row CROSS JOIN resource_row
ON CONFLICT (section_id, code) DO UPDATE SET
  label = EXCLUDED.label,
  route = EXCLUDED.route,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

UPDATE public.admin_resource resource
SET is_active = false, updated_at = now()
FROM public.admin_section section_row
WHERE resource.section_id = section_row.id
  AND section_row.code = 'communication'
  AND resource.code IN ('email', 'support', 'instagram');

WITH section_row AS (
  SELECT id FROM public.admin_section WHERE code = 'payments'
), resource_row(code, label, route, sort_order) AS (VALUES
  ('invoices', 'Счета', '/admin/payments/invoices', 4)
)
INSERT INTO public.admin_resource(section_id, code, label, route, sort_order, is_active)
SELECT section_row.id, resource_row.code, resource_row.label, resource_row.route, resource_row.sort_order, true
FROM section_row CROSS JOIN resource_row
ON CONFLICT (section_id, code) DO UPDATE SET
  label = EXCLUDED.label,
  route = EXCLUDED.route,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

WITH section_row AS (
  SELECT id FROM public.admin_section WHERE code = 'forms-hub'
), resource_row(code, label, route, sort_order) AS (VALUES
  ('all', 'Все', '/admin/forms', 0),
  ('site', 'Анкеты сайта', '/admin/forms?tab=site', 1),
  ('preorders', 'Предзаписи', '/admin/forms?tab=preorders', 2),
  ('training', 'Обучение', '/admin/forms?tab=training', 3),
  ('by-product', 'По продуктам', '/admin/forms?tab=by-product', 4),
  ('export', 'Экспорт', '/admin/forms?tab=export', 5)
)
INSERT INTO public.admin_resource(section_id, code, label, route, sort_order, is_active)
SELECT section_row.id, resource_row.code, resource_row.label, resource_row.route, resource_row.sort_order, true
FROM section_row CROSS JOIN resource_row
ON CONFLICT (section_id, code) DO UPDATE SET
  label = EXCLUDED.label,
  route = EXCLUDED.route,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

UPDATE public.admin_section
SET route_prefix = '/admin/club-members', updated_at = now()
WHERE code = 'club-members';

-- ---------------------------------------------------------------------
-- 2. Resolve every legacy page/button permission through section grants.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
  v_action text;
  v_section text;
  v_level text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles_v2 ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _user_id AND p.code = _permission_code
  ) THEN
    RETURN true;
  END IF;

  v_category := split_part(_permission_code, '.', 1);
  v_action := (string_to_array(_permission_code, '.'))[
    array_length(string_to_array(_permission_code, '.'), 1)
  ];

  v_section := CASE v_category
    WHEN 'users' THEN 'contacts'
    WHEN 'contacts' THEN 'contacts'
    WHEN 'companies' THEN 'companies'
    WHEN 'deals' THEN 'deals'
    WHEN 'tasks' THEN 'deals'
    WHEN 'payments' THEN 'payments'
    WHEN 'subscriptions' THEN 'payments'
    WHEN 'entitlements' THEN 'payments'
    WHEN 'forms' THEN 'forms-hub'
    WHEN 'referrals' THEN 'referrals'
    WHEN 'support' THEN 'support'
    WHEN 'telegram' THEN 'communication'
    WHEN 'communication' THEN 'communication'
    WHEN 'integrations' THEN 'integrations'
    WHEN 'news' THEN 'editorial'
    WHEN 'editorial' THEN 'editorial'
    WHEN 'content' THEN 'editorial'
    WHEN 'roles' THEN 'roles'
    WHEN 'admins' THEN 'roles'
    WHEN 'audit' THEN 'roles'
    WHEN 'products' THEN 'products'
    WHEN 'executors' THEN 'documents'
    WHEN 'documents' THEN 'documents'
    WHEN 'training' THEN 'training'
    WHEN 'consents' THEN 'consents'
    WHEN 'sites' THEN 'sites'
    WHEN 'marketing' THEN 'marketing'
    WHEN 'ai' THEN 'ai'
    WHEN 'sections' THEN 'sections'
    WHEN 'legislation' THEN 'legislation'
    WHEN 'live-events' THEN 'live-events'
    WHEN 'calls' THEN 'calls'
    ELSE NULL
  END;

  -- Club administration is an independent section. Keep generic Telegram
  -- communication permissions intact, but route the legacy club action codes
  -- through the explicit club-members grant used by the page and Edge Function.
  IF _permission_code LIKE 'telegram.clubs.%' THEN
    v_section := 'club-members';
  END IF;

  v_level := CASE
    WHEN _permission_code = 'support.manage' THEN 'edit'
    WHEN v_action IN ('view', 'read') THEN 'view'
    WHEN v_action IN ('create', 'edit', 'update') THEN 'edit'
    WHEN v_action IN ('manage', 'delete', 'block', 'reset_password', 'impersonate', 'publish') THEN 'manage'
    ELSE NULL
  END;

  IF v_section IS NULL OR v_level IS NULL THEN RETURN false; END IF;
  RETURN public.has_admin_section_access(_user_id, v_section, v_level);
END;
$$;

REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_admin_resource_access(
  _user_id uuid,
  _section_code text,
  _resource_code text,
  _min_level text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(max(CASE access.access_level
    WHEN 'manage' THEN 3
    WHEN 'edit' THEN 2
    WHEN 'view' THEN 1
    ELSE 0
  END), 0) >= CASE lower(coalesce(_min_level, 'view'))
    WHEN 'manage' THEN 3
    WHEN 'edit' THEN 2
    WHEN 'view' THEN 1
    WHEN 'none' THEN 0
    ELSE 999
  END
  FROM public.get_admin_access(_user_id) access
  WHERE access.section_code = _section_code
    AND access.resource_code = _resource_code
$$;

REVOKE ALL ON FUNCTION public.has_admin_resource_access(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_resource_access(uuid, text, text, text)
  TO authenticated, service_role;

-- Task RPCs used a hard-coded employee role even though the page is owned by
-- the Deals section. Existing mutation RPCs keep calling this edit-level gate.
CREATE OR REPLACE FUNCTION public._crm_tasks_assert_staff()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF v_jwt_role = 'service_role' THEN RETURN; END IF;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role_v2(v_user_id, 'employee')
    OR public.has_admin_section_access(v_user_id, 'deals', 'edit')
  ) THEN
    RAISE EXCEPTION 'forbidden_not_staff' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_tasks_assert_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_tasks_assert_staff() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_task_list(_filters jsonb DEFAULT '{}'::jsonb)
RETURNS SETOF public.crm_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  _assignee uuid; _statuses text[]; _type_ids uuid[]; _deal_id uuid;
  _contact_id uuid; _company_id uuid; _due_from timestamptz; _due_to timestamptz;
  _bucket text; _search text; _limit int; _offset int;
BEGIN
  IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT (
       public.has_role_v2(v_user_id, 'employee')
       OR public.has_admin_section_access(v_user_id, 'deals', 'view')
     ) THEN
    RAISE EXCEPTION 'forbidden_not_staff' USING ERRCODE = '42501';
  END IF;
  _assignee := nullif(_filters->>'assignee_user_id','')::uuid;
  _statuses := CASE WHEN jsonb_typeof(_filters->'status')='array'
                    THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'status')) ELSE NULL END;
  _type_ids := CASE WHEN jsonb_typeof(_filters->'task_type_id')='array'
                   THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'task_type_id'))::uuid) ELSE NULL END;
  _deal_id := nullif(_filters->>'deal_id','')::uuid;
  _contact_id := nullif(_filters->>'contact_id','')::uuid;
  _company_id := nullif(_filters->>'company_id','')::uuid;
  _due_from := nullif(_filters->>'due_from','')::timestamptz;
  _due_to := nullif(_filters->>'due_to','')::timestamptz;
  _bucket := nullif(_filters->>'bucket','');
  _search := nullif(trim(_filters->>'search'),'');
  _limit := least(greatest(coalesce(nullif(_filters->>'limit','')::int,200),1),500);
  _offset := greatest(coalesce(nullif(_filters->>'offset','')::int,0),0);
  RETURN QUERY SELECT task.* FROM public.crm_tasks task
   WHERE (_assignee IS NULL OR task.assignee_user_id=_assignee)
     AND (_statuses IS NULL OR task.status=ANY(_statuses))
     AND (_type_ids IS NULL OR task.task_type_id=ANY(_type_ids))
     AND (_deal_id IS NULL OR task.deal_id=_deal_id)
     AND (_contact_id IS NULL OR task.contact_id=_contact_id)
     AND (_company_id IS NULL OR task.company_id=_company_id)
     AND (_due_from IS NULL OR task.due_at>=_due_from)
     AND (_due_to IS NULL OR task.due_at<=_due_to)
     AND (_bucket IS NULL
       OR (_bucket='overdue' AND task.status IN ('open','in_progress') AND task.due_at IS NOT NULL AND task.due_at<now())
       OR (_bucket='today' AND task.status IN ('open','in_progress') AND task.due_at::date=(now() AT TIME ZONE 'Europe/Minsk')::date)
       OR (_bucket='tomorrow' AND task.status IN ('open','in_progress') AND task.due_at::date=((now() AT TIME ZONE 'Europe/Minsk')::date+1))
       OR (_bucket='week' AND task.status IN ('open','in_progress') AND task.due_at>=now() AND task.due_at<now()+interval '7 days')
       OR (_bucket='later' AND task.status IN ('open','in_progress') AND task.due_at>=now()+interval '7 days')
       OR (_bucket='no_due' AND task.status IN ('open','in_progress') AND task.due_at IS NULL)
       OR (_bucket='closed' AND task.status IN ('done','canceled')))
     AND (_search IS NULL OR task.title ILIKE '%'||_search||'%'
          OR coalesce(task.description,'') ILIKE '%'||_search||'%'
          OR coalesce(task.public_id,'') ILIKE '%'||_search||'%')
   ORDER BY CASE WHEN task.status IN ('open','in_progress') THEN 0 ELSE 1 END,
            task.due_at NULLS LAST, task.created_at DESC
   LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_task_list(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_task_list(jsonb) TO authenticated, service_role;

-- Core CRM/payment tables used as joins on multiple admin pages. A viewer of
-- the owning section must see the complete historical rows; write policies
-- remain level-specific.
DROP POLICY IF EXISTS companies_rbac_section_view ON public.companies;
CREATE POLICY companies_rbac_section_view ON public.companies
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'companies', 'view'));

DROP POLICY IF EXISTS companies_rbac_section_insert ON public.companies;
CREATE POLICY companies_rbac_section_insert ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'companies', 'edit'));

DROP POLICY IF EXISTS companies_rbac_section_update ON public.companies;
CREATE POLICY companies_rbac_section_update ON public.companies
  FOR UPDATE TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'companies', 'edit'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'companies', 'edit'));

DROP POLICY IF EXISTS companies_rbac_section_delete ON public.companies;
CREATE POLICY companies_rbac_section_delete ON public.companies
  FOR DELETE TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'companies', 'manage'));

DROP POLICY IF EXISTS subscriptions_v2_rbac_history_view ON public.subscriptions_v2;
CREATE POLICY subscriptions_v2_rbac_history_view ON public.subscriptions_v2
  FOR SELECT TO authenticated
  USING (
    public.has_admin_section_access(auth.uid(), 'payments', 'view')
    OR public.has_admin_section_access(auth.uid(), 'deals', 'view')
    OR public.has_admin_section_access(auth.uid(), 'contacts', 'view')
    OR public.has_admin_section_access(auth.uid(), 'companies', 'view')
  );

DROP POLICY IF EXISTS subscriptions_v2_rbac_edit ON public.subscriptions_v2;
CREATE POLICY subscriptions_v2_rbac_edit ON public.subscriptions_v2
  FOR UPDATE TO authenticated
  USING (
    public.has_admin_section_access(auth.uid(), 'payments', 'edit')
    OR public.has_admin_section_access(auth.uid(), 'deals', 'edit')
  )
  WITH CHECK (
    public.has_admin_section_access(auth.uid(), 'payments', 'edit')
    OR public.has_admin_section_access(auth.uid(), 'deals', 'edit')
  );

DROP POLICY IF EXISTS entitlements_rbac_history_view ON public.entitlements;
CREATE POLICY entitlements_rbac_history_view ON public.entitlements
  FOR SELECT TO authenticated
  USING (
    public.has_admin_section_access(auth.uid(), 'payments', 'view')
    OR public.has_admin_section_access(auth.uid(), 'deals', 'view')
    OR public.has_admin_section_access(auth.uid(), 'contacts', 'view')
    OR public.has_admin_section_access(auth.uid(), 'companies', 'view')
  );

DROP POLICY IF EXISTS entitlements_rbac_edit_grant ON public.entitlements;
CREATE POLICY entitlements_rbac_edit_grant ON public.entitlements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'payments', 'edit'));

DROP POLICY IF EXISTS provider_subscriptions_rbac_view ON public.provider_subscriptions;
CREATE POLICY provider_subscriptions_rbac_view ON public.provider_subscriptions
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'payments', 'view'));

DROP POLICY IF EXISTS provider_subscriptions_rbac_edit ON public.provider_subscriptions;
CREATE POLICY provider_subscriptions_rbac_edit ON public.provider_subscriptions
  FOR UPDATE TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'payments', 'edit'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'payments', 'edit'));

DROP POLICY IF EXISTS products_v2_rbac_history_view ON public.products_v2;
CREATE POLICY products_v2_rbac_history_view ON public.products_v2
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'products', 'view'));

DROP POLICY IF EXISTS products_v2_rbac_insert ON public.products_v2;
CREATE POLICY products_v2_rbac_insert ON public.products_v2
  FOR INSERT TO authenticated
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'products', 'edit'));

DROP POLICY IF EXISTS products_v2_rbac_update ON public.products_v2;
CREATE POLICY products_v2_rbac_update ON public.products_v2
  FOR UPDATE TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'products', 'edit'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'products', 'edit'));

DROP POLICY IF EXISTS products_v2_rbac_delete ON public.products_v2;
CREATE POLICY products_v2_rbac_delete ON public.products_v2
  FOR DELETE TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'products', 'manage'));

DROP POLICY IF EXISTS crm_task_types_deals_view ON public.crm_task_types;
CREATE POLICY crm_task_types_deals_view ON public.crm_task_types
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'deals', 'view'));

DROP POLICY IF EXISTS crm_task_types_deals_edit ON public.crm_task_types;
CREATE POLICY crm_task_types_deals_edit ON public.crm_task_types
  FOR ALL TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'deals', 'edit'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'deals', 'edit'));

-- Club members used to share the Telegram integrations route and policies,
-- so an independent club-members grant could never load its own tables.
DROP POLICY IF EXISTS "RBAC v3: view telegram bots" ON public.telegram_bots;
CREATE POLICY "RBAC v3: view telegram bots" ON public.telegram_bots
  FOR SELECT TO authenticated
  USING (
    public.has_admin_resource_access(auth.uid(), 'integrations', 'telegram', 'view')
    OR public.has_admin_section_access(auth.uid(), 'club-members', 'view')
  );

DROP POLICY IF EXISTS "RBAC v3: manage telegram bots" ON public.telegram_bots;
CREATE POLICY "RBAC v3: manage telegram bots" ON public.telegram_bots
  FOR ALL TO authenticated
  USING (
    public.has_admin_resource_access(auth.uid(), 'integrations', 'telegram', 'edit')
    OR public.has_admin_section_access(auth.uid(), 'club-members', 'edit')
  )
  WITH CHECK (
    public.has_admin_resource_access(auth.uid(), 'integrations', 'telegram', 'edit')
    OR public.has_admin_section_access(auth.uid(), 'club-members', 'edit')
  );

DROP POLICY IF EXISTS "RBAC v3: view telegram clubs" ON public.telegram_clubs;
CREATE POLICY "RBAC v3: view telegram clubs" ON public.telegram_clubs
  FOR SELECT TO authenticated
  USING (
    public.has_admin_resource_access(auth.uid(), 'integrations', 'telegram', 'view')
    OR public.has_admin_section_access(auth.uid(), 'club-members', 'view')
  );

DROP POLICY IF EXISTS "RBAC v3: manage telegram clubs" ON public.telegram_clubs;
CREATE POLICY "RBAC v3: manage telegram clubs" ON public.telegram_clubs
  FOR ALL TO authenticated
  USING (
    public.has_admin_resource_access(auth.uid(), 'integrations', 'telegram', 'edit')
    OR public.has_admin_section_access(auth.uid(), 'club-members', 'edit')
  )
  WITH CHECK (
    public.has_admin_resource_access(auth.uid(), 'integrations', 'telegram', 'edit')
    OR public.has_admin_section_access(auth.uid(), 'club-members', 'edit')
  );

DROP POLICY IF EXISTS "RBAC v3: view club members" ON public.telegram_club_members;
CREATE POLICY "RBAC v3: view club members" ON public.telegram_club_members
  FOR SELECT TO authenticated
  USING (
    public.has_admin_resource_access(auth.uid(), 'integrations', 'telegram', 'view')
    OR public.has_admin_section_access(auth.uid(), 'club-members', 'view')
  );

DROP POLICY IF EXISTS "RBAC v3: manage club members" ON public.telegram_club_members;
CREATE POLICY "RBAC v3: manage club members" ON public.telegram_club_members
  FOR ALL TO authenticated
  USING (
    public.has_admin_resource_access(auth.uid(), 'integrations', 'telegram', 'edit')
    OR public.has_admin_section_access(auth.uid(), 'club-members', 'edit')
  )
  WITH CHECK (
    public.has_admin_resource_access(auth.uid(), 'integrations', 'telegram', 'edit')
    OR public.has_admin_section_access(auth.uid(), 'club-members', 'edit')
  );

DROP POLICY IF EXISTS telegram_access_club_members_rbac_view ON public.telegram_access;
CREATE POLICY telegram_access_club_members_rbac_view ON public.telegram_access
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'club-members', 'view'));

DROP POLICY IF EXISTS telegram_manual_access_club_members_rbac_view ON public.telegram_manual_access;
CREATE POLICY telegram_manual_access_club_members_rbac_view ON public.telegram_manual_access
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'club-members', 'view'));

DROP POLICY IF EXISTS telegram_access_grants_club_members_rbac_view ON public.telegram_access_grants;
CREATE POLICY telegram_access_grants_club_members_rbac_view ON public.telegram_access_grants
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'club-members', 'view'));

-- The enriched member RPCs are SECURITY DEFINER and therefore must perform
-- the same explicit section check. Patch only the known legacy role guard and
-- fail the migration if the deployed definition drifted from the repository.
DO $club_rpc_guards$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_patched text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_club_members_enriched(uuid,text)'::regprocedure,
    'public.search_club_members_enriched(uuid,text,text)'::regprocedure,
    'public.get_club_member_summary(uuid)'::regprocedure
  ]
  LOOP
    v_definition := pg_get_functiondef(v_signature);
    v_patched := regexp_replace(
      v_definition,
      $guard_pattern$IF[[:space:]]+v_user_id[[:space:]]+IS[[:space:]]+NULL[[:space:]]+OR[[:space:]]*\([[:space:]]*NOT[[:space:]]+public\.has_role\(v_user_id,[[:space:]]*'admin'::app_role\)[[:space:]]+AND[[:space:]]+NOT[[:space:]]+public\.has_role\(v_user_id,[[:space:]]*'superadmin'::app_role\)[[:space:]]*\)[[:space:]]+THEN$guard_pattern$,
      $guard_replacement$IF v_user_id IS NULL OR NOT public.has_admin_section_access(v_user_id, 'club-members', 'view') THEN$guard_replacement$
    );
    IF v_patched = v_definition THEN
      RAISE EXCEPTION 'club_members_rpc_guard_not_found: %', v_signature::text;
    END IF;
    EXECUTE v_patched;
  END LOOP;
END;
$club_rpc_guards$;

-- Keep the existing business-statistics implementation intact behind an
-- access-checked wrapper instead of duplicating its accounting query. The
-- catalog guard makes a managed retry safe after the implementation rename.
DO $club_stats_wrapper$
BEGIN
  IF to_regprocedure('public.get_club_business_stats_rbac_impl(uuid,integer)') IS NULL THEN
    IF to_regprocedure('public.get_club_business_stats(uuid,integer)') IS NULL THEN
      RAISE EXCEPTION 'get_club_business_stats_missing';
    END IF;
    ALTER FUNCTION public.get_club_business_stats(uuid, integer)
      RENAME TO get_club_business_stats_rbac_impl;
  END IF;
END;
$club_stats_wrapper$;

REVOKE ALL ON FUNCTION public.get_club_business_stats_rbac_impl(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_business_stats_rbac_impl(uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_club_business_stats(
  p_club_id uuid,
  p_period_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_admin_section_access(auth.uid(), 'club-members', 'view') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.get_club_business_stats_rbac_impl(p_club_id, p_period_days);
END;
$$;

REVOKE ALL ON FUNCTION public.get_club_business_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_club_business_stats(uuid, integer)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Referral page: view sees the complete ledger/history; edit can use
--    existing administrative workflows; money/settings remain manage-only.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(public.has_admin_section_access(p_user_id, 'referrals', 'edit'), false)
$$;

REVOKE ALL ON FUNCTION public.referral_is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_is_admin(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS referral_settings_admin_select ON public.referral_program_settings;
CREATE POLICY referral_settings_admin_select ON public.referral_program_settings
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'));

DROP POLICY IF EXISTS referral_settings_admin_update ON public.referral_program_settings;
CREATE POLICY referral_settings_admin_update ON public.referral_program_settings
  FOR UPDATE TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'manage'))
  WITH CHECK (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'manage'));

DROP POLICY IF EXISTS referral_partners_rbac_view ON public.referral_partners;
CREATE POLICY referral_partners_rbac_view ON public.referral_partners
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'));

DROP POLICY IF EXISTS referral_relationships_rbac_view ON public.referral_relationships;
CREATE POLICY referral_relationships_rbac_view ON public.referral_relationships
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'));

DROP POLICY IF EXISTS referral_sales_rbac_view ON public.referral_sale_attributions;
CREATE POLICY referral_sales_rbac_view ON public.referral_sale_attributions
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'));

DROP POLICY IF EXISTS referral_transactions_rbac_view ON public.referral_balance_transactions;
CREATE POLICY referral_transactions_rbac_view ON public.referral_balance_transactions
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'));

DROP POLICY IF EXISTS referral_entries_rbac_view ON public.referral_balance_entries;
CREATE POLICY referral_entries_rbac_view ON public.referral_balance_entries
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'));

DROP POLICY IF EXISTS referral_payouts_rbac_view ON public.referral_payout_requests;
CREATE POLICY referral_payouts_rbac_view ON public.referral_payout_requests
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'));

DROP POLICY IF EXISTS products_referrals_rbac_view ON public.products_v2;
CREATE POLICY products_referrals_rbac_view ON public.products_v2
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'));

DROP POLICY IF EXISTS profiles_referrals_rbac_view ON public.profiles;
CREATE POLICY profiles_referrals_rbac_view ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'));

CREATE OR REPLACE FUNCTION public.referral_admin_get_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'partners_count', (SELECT count(*) FROM public.referral_partners),
    'relationships_count', (SELECT count(*) FROM public.referral_relationships WHERE status = 'active'),
    'sales_count', (SELECT count(*) FROM public.referral_sale_attributions),
    'pending_minor', coalesce((SELECT sum(amount_minor) FROM public.referral_balance_entries WHERE bucket IN ('pending', 'internal_pending')), 0),
    'available_minor', coalesce((SELECT sum(amount_minor) FROM public.referral_balance_entries WHERE bucket = 'available'), 0),
    'internal_minor', coalesce((SELECT sum(amount_minor) FROM public.referral_balance_entries WHERE bucket = 'internal'), 0),
    'held_minor', coalesce((SELECT sum(amount_minor) FROM public.referral_balance_entries WHERE bucket = 'held'), 0),
    'paid_minor', coalesce((SELECT sum(amount_minor) FROM public.referral_balance_entries WHERE bucket = 'paid'), 0)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.referral_admin_get_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_get_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.referral_admin_list_historical_orders(p_relationship_id uuid)
RETURNS TABLE(
  order_id uuid,
  order_number text,
  created_at timestamptz,
  product_name text,
  paid_minor bigint,
  payments_count integer,
  commissionable boolean,
  sale_id uuid,
  sale_status text,
  sale_commission_minor bigint,
  sale_reversed_minor bigint,
  credit_action text,
  can_reverse boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_admin_section_access(auth.uid(), 'referrals', 'view') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.created_at,
    coalesce(pr.name, 'Продукт без названия'),
    coalesce(payment_totals.paid_minor, 0)::bigint,
    coalesce(payment_totals.payments_count, 0)::integer,
    coalesce(payment_totals.paid_minor, 0) > 0
      AND pr.id IS NOT NULL
      AND coalesce(pr.referral_settings_mode, 'inherit') <> 'disabled',
    rsa.id,
    rsa.status,
    rsa.commission_minor,
    rsa.reversed_minor,
    CASE
      WHEN rsa.id IS NULL
        AND coalesce(payment_totals.paid_minor, 0) > 0
        AND pr.id IS NOT NULL
        AND coalesce(pr.referral_settings_mode, 'inherit') <> 'disabled' THEN 'credit'
      WHEN rsa.reversed_minor >= rsa.commission_minor
        AND coalesce(rsa.metadata->>'admin_can_restore', 'false') = 'true' THEN 'restore'
      WHEN rsa.id IS NOT NULL THEN 'credited'
      ELSE 'ineligible'
    END,
    rsa.id IS NOT NULL
      AND rsa.reversed_minor < rsa.commission_minor
      AND rsa.status IN ('pending', 'shadow')
  FROM public.referral_relationships rr
  JOIN public.orders_v2 o ON o.profile_id = rr.referred_profile_id
  LEFT JOIN public.products_v2 pr ON pr.id = o.product_id
  LEFT JOIN public.referral_sale_attributions rsa ON rsa.order_id = o.id
  CROSS JOIN LATERAL (
    SELECT
      coalesce(sum(round(p.amount * 100)::bigint), 0) AS paid_minor,
      count(*)::integer AS payments_count
    FROM public.payments_v2 p
    WHERE p.order_id = o.id
      AND p.status::text = 'succeeded'
      AND NOT coalesce(p.is_recurring, false)
      AND NOT coalesce(p.is_deleted, false)
  ) payment_totals
  WHERE rr.id = p_relationship_id
    AND rr.status = 'active'
    AND o.status::text = 'paid'
    AND NOT coalesce(o.is_deleted, false)
    AND o.currency = 'BYN'
    AND coalesce(o.meta->>'split_from_order_id', '') = ''
    AND coalesce(o.meta->>'is_test', 'false') <> 'true'
    AND coalesce(o.meta->>'sandbox', 'false') <> 'true'
    AND NOT EXISTS (
      SELECT 1 FROM public.payments_v2 recurring_payment
      WHERE recurring_payment.order_id = o.id
        AND recurring_payment.status::text = 'succeeded'
        AND coalesce(recurring_payment.is_recurring, false)
    )
  ORDER BY o.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.referral_admin_list_historical_orders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_list_historical_orders(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.referral_admin_decide_payout(
  p_request_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_payment_reference text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req public.referral_payout_requests%rowtype;
  v_tx uuid;
  v_type text;
BEGIN
  IF NOT public.has_admin_section_access(auth.uid(), 'referrals', 'manage') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_decision NOT IN ('paid', 'rejected') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  SELECT * INTO v_req FROM public.referral_payout_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_req.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'request_already_decided'; END IF;
  IF p_decision = 'paid' AND nullif(trim(coalesce(p_payment_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'payment_reference_required';
  END IF;
  v_type := CASE WHEN p_decision = 'paid' THEN 'payout_paid' ELSE 'payout_release' END;
  INSERT INTO public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
  VALUES (v_req.partner_id, v_type, 'referral:payout:' || p_decision || ':' || v_req.id, 'payout_request', v_req.id,
    CASE WHEN p_decision = 'paid' THEN 'Выплата подтверждена администратором' ELSE 'Резерв выплаты возвращён' END)
  RETURNING id INTO v_tx;
  IF p_decision = 'paid' THEN
    INSERT INTO public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
    VALUES (v_tx, v_req.partner_id, 'held', -v_req.amount_minor), (v_tx, v_req.partner_id, 'paid', v_req.amount_minor);
  ELSE
    INSERT INTO public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
    VALUES (v_tx, v_req.partner_id, 'held', -v_req.amount_minor), (v_tx, v_req.partner_id, 'available', v_req.amount_minor);
  END IF;
  UPDATE public.referral_payout_requests
  SET status = p_decision,
      decision_reason = nullif(trim(p_reason), ''),
      payment_reference = nullif(trim(p_payment_reference), ''),
      decided_at = now(),
      paid_at = CASE WHEN p_decision = 'paid' THEN now() ELSE NULL END,
      decided_by = auth.uid(),
      updated_at = now()
  WHERE id = v_req.id;
  INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  VALUES (auth.uid(), 'user', 'referral_payout_' || p_decision, 'referral_payout_request', v_req.id,
    jsonb_build_object('amount_minor', v_req.amount_minor, 'reason', p_reason, 'payment_reference', p_payment_reference));
  PERFORM public.referral_emit_event('referral.payout.' || p_decision, v_req.id, jsonb_build_object('amount_minor', v_req.amount_minor));
END;
$$;

REVOKE ALL ON FUNCTION public.referral_admin_decide_payout(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_decide_payout(uuid, text, text, text) TO authenticated, service_role;
