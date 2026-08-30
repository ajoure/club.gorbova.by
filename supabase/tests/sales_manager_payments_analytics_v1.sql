-- Read-only catalog contract for Products 2 payment analytics.
DO $$
DECLARE
  v_security_definer boolean;
  v_config text[];
BEGIN
  SELECT procedure.prosecdef, procedure.proconfig
  INTO v_security_definer, v_config
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'sales_manager_report_v1';

  ASSERT v_security_definer = true,
    'sales_manager_report_v1 must be SECURITY DEFINER';
  ASSERT array_to_string(v_config, ',') IN ('search_path=', 'search_path=""'),
    'sales_manager_report_v1 must use an empty search_path';
  ASSERT has_function_privilege(
    'authenticated',
    'public.sales_manager_report_v1(date,date,uuid,boolean,uuid,uuid)',
    'EXECUTE'
  ), 'authenticated callers need the permission-guarded report RPC';
  ASSERT NOT has_function_privilege(
    'anon',
    'public.sales_manager_report_v1(date,date,uuid,boolean,uuid,uuid)',
    'EXECUTE'
  ), 'anon must not read sales reports';

  RAISE NOTICE 'SALES_MANAGER_PAYMENTS_ANALYTICS_V1_CATALOG_PASS';
END;
$$;
