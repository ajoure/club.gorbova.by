
-- 1. Pin search_path on set_site_page_tag_updated_at (hardening, linter 0011)
ALTER FUNCTION public.set_site_page_tag_updated_at()
SET search_path = public, pg_temp;

-- 2. Drop redundant service_role policies (linter: RLS always true)
DROP POLICY IF EXISTS "Service role can insert deploy_logs" ON public.deploy_logs;
DROP POLICY IF EXISTS "Service role can update deploy_logs" ON public.deploy_logs;
DROP POLICY IF EXISTS "Service role can insert system_health_reports" ON public.system_health_reports;
