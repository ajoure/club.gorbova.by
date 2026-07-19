-- CRM Companies — Phase 1 ACL hardening
-- Только REVOKE/GRANT. Никакого DDL. Одна транзакция.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- =========================================================================
-- Preflight guards. При несовпадении вся транзакция откатывается.
-- =========================================================================
DO $$
DECLARE
  v_missing text;
  v_policy_count int;
  v_rls_bad text;
BEGIN
  -- 1. Существование 4 таблиц
  SELECT string_agg(t, ', ') INTO v_missing
  FROM (
    SELECT unnest(ARRAY[
      'companies',
      'client_legal_details_company_map',
      'company_contacts',
      'company_sync_queue'
    ]) AS t
  ) x
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=x.t AND c.relkind='r'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ACL hardening aborted: missing tables: %', v_missing;
  END IF;

  -- 2. RLS включён на всех 4 таблицах
  SELECT string_agg(c.relname, ', ') INTO v_rls_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname IN ('companies','client_legal_details_company_map','company_contacts','company_sync_queue')
    AND c.relrowsecurity = false;
  IF v_rls_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ACL hardening aborted: RLS disabled on: %', v_rls_bad;
  END IF;

  -- 3. Ровно 13 policies на 4 таблицах
  SELECT count(*) INTO v_policy_count
  FROM pg_policy pol
  JOIN pg_class c ON c.oid=pol.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname IN ('companies','client_legal_details_company_map','company_contacts','company_sync_queue');
  IF v_policy_count <> 13 THEN
    RAISE EXCEPTION 'ACL hardening aborted: expected 13 policies, found %', v_policy_count;
  END IF;

  -- 4. Существование 3 функций с точными identity args
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='set_companies_public_id'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    RAISE EXCEPTION 'ACL hardening aborted: missing function set_companies_public_id()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='crm_company_get_or_create'
      AND pg_get_function_identity_arguments(p.oid) =
        '_country text, _unp text, _full_name text, _company_kind text, _source text, _source_client_legal_details_id uuid'
  ) THEN
    RAISE EXCEPTION 'ACL hardening aborted: missing/mismatched crm_company_get_or_create signature';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='crm_company_link_contact'
      AND pg_get_function_identity_arguments(p.oid) =
        '_company_id uuid, _profile_id uuid, _relationship_type text, _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid'
  ) THEN
    RAISE EXCEPTION 'ACL hardening aborted: missing/mismatched crm_company_link_contact signature';
  END IF;
END $$;

-- =========================================================================
-- Таблицы: полный REVOKE у клиентских ролей, затем точечный GRANT.
-- =========================================================================
REVOKE ALL ON
  public.companies,
  public.client_legal_details_company_map,
  public.company_contacts,
  public.company_sync_queue
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.companies,
  public.client_legal_details_company_map,
  public.company_contacts
TO authenticated;

GRANT ALL ON
  public.companies,
  public.client_legal_details_company_map,
  public.company_contacts,
  public.company_sync_queue
TO service_role;

-- company_sync_queue: anon и authenticated — НИКАКИХ прав.

-- =========================================================================
-- Функции: приведение EXECUTE-матрицы к утверждённому контракту.
-- =========================================================================

-- Trigger function: EXECUTE не выдаётся никакой внешней роли.
REVOKE ALL ON FUNCTION public.set_companies_public_id()
  FROM PUBLIC, anon, authenticated, service_role;

-- RPC: только authenticated (доступ дополнительно ограничен guard has_role_v2 внутри тел).
REVOKE ALL ON FUNCTION
  public.crm_company_get_or_create(text, text, text, text, text, uuid)
  FROM PUBLIC, anon, service_role;

REVOKE ALL ON FUNCTION
  public.crm_company_link_contact(uuid, uuid, text, boolean, text, uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION
  public.crm_company_get_or_create(text, text, text, text, text, uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.crm_company_link_contact(uuid, uuid, text, boolean, text, uuid)
  TO authenticated;

-- =========================================================================
-- Post-apply invariants. Если что-то расходится с контрактом — откат.
-- =========================================================================
DO $$
DECLARE
  v_bad text;
BEGIN
  -- company_sync_queue не должен быть доступен anon/authenticated ни на одно право
  IF has_table_privilege('anon',          'public.company_sync_queue', 'SELECT')
  OR has_table_privilege('anon',          'public.company_sync_queue', 'INSERT')
  OR has_table_privilege('anon',          'public.company_sync_queue', 'UPDATE')
  OR has_table_privilege('anon',          'public.company_sync_queue', 'DELETE')
  OR has_table_privilege('authenticated', 'public.company_sync_queue', 'SELECT')
  OR has_table_privilege('authenticated', 'public.company_sync_queue', 'INSERT')
  OR has_table_privilege('authenticated', 'public.company_sync_queue', 'UPDATE')
  OR has_table_privilege('authenticated', 'public.company_sync_queue', 'DELETE') THEN
    RAISE EXCEPTION 'ACL hardening invariant failed: anon/authenticated retain access to company_sync_queue';
  END IF;

  -- anon не должен иметь EXECUTE на трёх функциях
  IF has_function_privilege('anon', 'public.crm_company_get_or_create(text,text,text,text,text,uuid)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.set_companies_public_id()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL hardening invariant failed: anon retains EXECUTE on Phase 1 functions';
  END IF;

  -- authenticated не должен иметь EXECUTE на trigger function
  IF has_function_privilege('authenticated', 'public.set_companies_public_id()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL hardening invariant failed: authenticated retains EXECUTE on set_companies_public_id()';
  END IF;

  -- authenticated обязан иметь EXECUTE на двух RPC
  IF NOT has_function_privilege('authenticated', 'public.crm_company_get_or_create(text,text,text,text,text,uuid)', 'EXECUTE')
  OR NOT has_function_privilege('authenticated', 'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL hardening invariant failed: authenticated missing EXECUTE on Phase 1 RPCs';
  END IF;

  -- authenticated должен иметь CRUD на трёх основных таблицах
  FOR v_bad IN
    SELECT t FROM unnest(ARRAY['companies','client_legal_details_company_map','company_contacts']) AS t
    WHERE NOT (
      has_table_privilege('authenticated', 'public.'||t, 'SELECT')
      AND has_table_privilege('authenticated', 'public.'||t, 'INSERT')
      AND has_table_privilege('authenticated', 'public.'||t, 'UPDATE')
      AND has_table_privilege('authenticated', 'public.'||t, 'DELETE')
    )
  LOOP
    RAISE EXCEPTION 'ACL hardening invariant failed: authenticated missing CRUD on %', v_bad;
  END LOOP;
END $$;
