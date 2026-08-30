-- Read-only catalog contract for the Products 2 attribution data layer.
-- Run after migrations; no production rows are created or changed.
DO $$
DECLARE
  v_rls_enabled boolean;
  v_function_security_definer boolean;
  v_function_search_path text[];
BEGIN
  SELECT class.relrowsecurity
  INTO v_rls_enabled
  FROM pg_class class
  JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public'
    AND class.relname = 'payment_sales_attribution';

  ASSERT v_rls_enabled = true,
    'payment_sales_attribution must have RLS enabled';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'payment_sales_attribution_one_current_per_payment'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%effective_to IS NULL%'
  ), 'one-current-attribution partial unique index is missing';

  ASSERT NOT has_table_privilege('anon', 'public.payment_sales_attribution', 'SELECT'),
    'anon must not read payment attribution';
  ASSERT has_table_privilege('authenticated', 'public.payment_sales_attribution', 'SELECT'),
    'authenticated must reach RLS-protected attribution reads';
  ASSERT NOT has_table_privilege('authenticated', 'public.payment_sales_attribution', 'INSERT'),
    'authenticated must not insert attribution directly';
  ASSERT NOT has_table_privilege('authenticated', 'public.payment_sales_attribution', 'UPDATE'),
    'authenticated must not update attribution directly';
  ASSERT NOT has_table_privilege('authenticated', 'public.payment_sales_attribution', 'DELETE'),
    'authenticated must not delete attribution directly';

  SELECT procedure.prosecdef, procedure.proconfig
  INTO v_function_security_definer, v_function_search_path
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'set_deal_responsible_v1'
    AND pg_get_function_identity_arguments(procedure.oid) =
      'p_deal_id uuid, p_responsible_user_id uuid, p_reason text, p_source text, p_batch_id uuid';

  ASSERT v_function_security_definer = true,
    'set_deal_responsible_v1 must be SECURITY DEFINER';
  ASSERT array_to_string(v_function_search_path, ',') IN ('search_path=', 'search_path=""'),
    'set_deal_responsible_v1 must use an empty search_path';

  ASSERT NOT has_function_privilege(
    'anon',
    'public.set_deal_responsible_v1(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ), 'anon must not execute set_deal_responsible_v1';
  ASSERT has_function_privilege(
    'authenticated',
    'public.set_deal_responsible_v1(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ), 'authenticated callers need the RPC, which performs its own RBAC checks';

  ASSERT (
    SELECT count(*) = 5
    FROM public.permissions
    WHERE code IN (
      'deals.assign_self',
      'deals.reassign',
      'sales_reports.view_own',
      'sales_reports.view_all',
      'sales_attribution.bulk_edit'
    )
  ), 'sales attribution permissions are incomplete';

  RAISE NOTICE 'SALES_MANAGER_ATTRIBUTION_V1_CATALOG_PASS';
END;
$$;
