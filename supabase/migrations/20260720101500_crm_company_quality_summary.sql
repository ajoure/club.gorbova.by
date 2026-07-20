-- Companies Phase 7D: read-only data-quality summary for CRM staff.
-- Queue internals stay service-role-only; this RPC exposes counts only.

CREATE OR REPLACE FUNCTION public.crm_company_quality_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin')
       OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  RETURN jsonb_build_object(
    'without_contacts', (
      SELECT count(*) FROM public.companies c
       WHERE c.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id = c.id)
    ),
    'without_unp', (
      SELECT count(*) FROM public.companies c
       WHERE c.status = 'active' AND NULLIF(btrim(c.unp_normalized), '') IS NULL
    ),
    'without_billing_map', (
      SELECT count(*) FROM public.companies c
       WHERE c.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM public.client_legal_details_company_map m WHERE m.company_id = c.id)
    ),
    'ownership_conflicts', (
      SELECT count(DISTINCT source_entity_id) FROM public.crm_activity_log
       WHERE source_entity_type = 'company' AND activity_type = 'company.field.override_conflict'
    ),
    'broken_merged_chain', (
      SELECT count(*) FROM public.companies c
       WHERE c.status = 'merged'
         AND (c.merged_into_company_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.companies target WHERE target.id = c.merged_into_company_id
         ))
    ),
    'failed_sync', (
      SELECT count(*) FROM public.company_sync_queue q
       WHERE q.status IN ('failed', 'dead_letter')
    ),
    'duplicate_candidates', (
      SELECT count(*) FROM (
        SELECT c.country, c.unp_normalized
          FROM public.companies c
         WHERE c.status <> 'merged' AND c.unp_normalized IS NOT NULL
         GROUP BY c.country, c.unp_normalized
        HAVING count(*) > 1
      ) duplicates
    ),
    'orphan_order_links', (
      SELECT count(*) FROM public.company_order_links l
       WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = l.company_id)
    ),
    'generated_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.crm_company_quality_summary() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_quality_summary() TO authenticated;
