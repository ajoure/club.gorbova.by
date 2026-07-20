-- Companies Phase 11C: read-only invariant report for cutover/hardening.

CREATE OR REPLACE FUNCTION public.crm_company_invariants_report()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_duplicate_unp bigint;
  v_broken_merges bigint;
  v_orphan_tasks bigint;
  v_import_errors bigint;
  v_relationships bigint;
  v_result jsonb;
BEGIN
  IF NOT (
    has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin')
    OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')
  ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  SELECT count(*) INTO v_duplicate_unp FROM (
    SELECT country, unp_normalized FROM public.companies
     WHERE status <> 'merged' AND unp_normalized IS NOT NULL
     GROUP BY country, unp_normalized HAVING count(*) > 1
  ) d;
  SELECT count(*) INTO v_broken_merges FROM public.companies c
   WHERE c.status = 'merged'
     AND (c.merged_into_company_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.companies target WHERE target.id = c.merged_into_company_id AND target.status <> 'merged'
     ));
  SELECT count(*) INTO v_orphan_tasks FROM public.crm_tasks t
   WHERE t.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = t.company_id);
  SELECT count(*) INTO v_import_errors FROM public.company_import_ledger l WHERE l.status IN ('error','conflict');
  SELECT count(*) INTO v_relationships FROM public.company_relationships r
   WHERE r.is_current AND (NOT EXISTS (SELECT 1 FROM public.companies a WHERE a.id=r.from_company_id AND a.status <> 'merged') OR NOT EXISTS (SELECT 1 FROM public.companies b WHERE b.id=r.to_company_id AND b.status <> 'merged'));

  SELECT jsonb_build_object(
    'ok', (v_duplicate_unp + v_broken_merges + v_orphan_tasks + v_import_errors + v_relationships) = 0,
    'generated_at', now(),
    'checks', jsonb_build_object(
      'active_duplicate_country_unp', jsonb_build_object('status', CASE WHEN v_duplicate_unp=0 THEN 'ok' ELSE 'fail' END, 'count', v_duplicate_unp),
      'broken_merged_chain', jsonb_build_object('status', CASE WHEN v_broken_merges=0 THEN 'ok' ELSE 'fail' END, 'count', v_broken_merges),
      'orphan_company_tasks', jsonb_build_object('status', CASE WHEN v_orphan_tasks=0 THEN 'ok' ELSE 'fail' END, 'count', v_orphan_tasks),
      'company_import_conflicts_or_errors', jsonb_build_object('status', CASE WHEN v_import_errors=0 THEN 'ok' ELSE 'attention' END, 'count', v_import_errors),
      'inactive_company_relationships', jsonb_build_object('status', CASE WHEN v_relationships=0 THEN 'ok' ELSE 'fail' END, 'count', v_relationships)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_company_invariants_report() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_invariants_report() TO authenticated;
