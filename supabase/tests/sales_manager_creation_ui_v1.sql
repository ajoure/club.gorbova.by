-- Read-only catalog contract for Products 2 creation and UI support.
DO $$
DECLARE
  v_security_definer boolean;
  v_config text[];
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_links'
      AND column_name = 'responsible_user_id'
      AND data_type = 'uuid'
  ), 'payment_links.responsible_user_id is missing';

  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_links_enriched_v'
      AND column_name = 'responsible_name'
  ), 'payment links view must expose the manager name';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'payment_links_enriched_v'
      AND relation.reloptions @> ARRAY['security_invoker=true']
  ), 'payment links view must use invoker rights';

  ASSERT NOT has_table_privilege(
    'anon',
    'public.payment_links_enriched_v',
    'SELECT'
  ), 'anon must not read payment links directly';
  ASSERT NOT has_table_privilege(
    'authenticated',
    'public.payment_links_enriched_v',
    'SELECT'
  ), 'authenticated users must use the guarded payment-links RPC';
  ASSERT has_table_privilege(
    'service_role',
    'public.payment_links_enriched_v',
    'SELECT'
  ), 'service_role must retain read-only diagnostics access';
  ASSERT NOT has_table_privilege(
    'service_role',
    'public.payment_links_enriched_v',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ), 'service_role must not retain meaningless write-like view privileges';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'audit_logs'
      AND constraint_row.conname = 'audit_logs_actor_type_check'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%service%'
  ), 'audit_logs must accept trusted service-role attribution changes';

  SELECT procedure.prosecdef, procedure.proconfig
  INTO v_security_definer, v_config
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'admin_create_deal_v2';

  ASSERT v_security_definer = true, 'admin_create_deal_v2 must be SECURITY DEFINER';
  ASSERT array_to_string(v_config, ',') IN ('search_path=', 'search_path=""'),
    'admin_create_deal_v2 must use an empty search_path';

  ASSERT has_function_privilege(
    'authenticated',
    'public.admin_create_deal_v2(uuid,text,uuid,uuid,uuid,uuid,numeric,text,text,uuid)',
    'EXECUTE'
  ), 'authenticated staff need the guarded creation RPC';
  ASSERT NOT has_function_privilege(
    'anon',
    'public.admin_create_deal_v2(uuid,text,uuid,uuid,uuid,uuid,numeric,text,text,uuid)',
    'EXECUTE'
  ), 'anon must not create admin deals';

  ASSERT has_function_privilege(
    'authenticated',
    'public.set_deals_responsible_bulk_v1(uuid[],uuid,text,uuid)',
    'EXECUTE'
  ), 'authenticated callers need the guarded bulk RPC';
  ASSERT NOT has_function_privilege(
    'anon',
    'public.set_deals_responsible_bulk_v1(uuid[],uuid,text,uuid)',
    'EXECUTE'
  ), 'anon must not reassign deals';

  RAISE NOTICE 'SALES_MANAGER_CREATION_UI_V1_CATALOG_PASS';
END;
$$;
