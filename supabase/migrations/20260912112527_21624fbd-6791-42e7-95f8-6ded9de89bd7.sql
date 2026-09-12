-- Managed registration of the exact earlier 20260912105739 SQL.
-- On fresh databases the earlier migration already installed these objects.
DO $managed_marker$ BEGIN
 IF to_regclass('public.sales_media_observations') IS NULL
 OR to_regprocedure('public.sales_configure_ai(uuid,uuid,jsonb,jsonb)') IS NULL
 OR to_regprocedure('public.sales_defer_context(uuid,uuid,text)') IS NULL
 OR to_regprocedure('public.sales_capture_media_edit()') IS NULL THEN
  RAISE EXCEPTION 'missing_original_sales_ai_migration';
 END IF;
END $managed_marker$;
