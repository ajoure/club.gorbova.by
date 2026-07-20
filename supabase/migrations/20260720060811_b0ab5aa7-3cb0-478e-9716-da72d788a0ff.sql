
CREATE OR REPLACE FUNCTION public.crm_company_backfill_execute_phase3c()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_baseline jsonb;
  v_after_wave jsonb;
  v_after_second jsonb;
  v_cld record;
  v_res jsonb;
  v_results jsonb := '[]'::jsonb;
  v_second_results jsonb := '[]'::jsonb;
  v_soft_company uuid;
  v_soft_contacts int;
  v_activity_baseline int;
  v_activity_after int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: crm_company_backfill_execute_phase3c is service_role only'
      USING ERRCODE='42501';
  END IF;

  -- ============ INNER PREFLIGHT (repeat) ============
  SELECT jsonb_build_object(
    'companies', (SELECT count(*) FROM public.companies),
    'maps', (SELECT count(*) FROM public.client_legal_details_company_map),
    'billing_contacts', (SELECT count(*) FROM public.company_contacts
                          WHERE relationship_type='billing_contact' AND is_billing_contact=true),
    'seq_company', (SELECT last_value FROM public.public_id_sequences WHERE entity_type='company'),
    'activity_log', (SELECT count(*) FROM public.crm_activity_log)
  ) INTO v_baseline;

  IF (v_baseline->>'companies')::int <> 0
     OR (v_baseline->>'maps')::int <> 0
     OR (v_baseline->>'billing_contacts')::int <> 0
     OR (v_baseline->>'seq_company')::int <> 0 THEN
    RAISE EXCEPTION 'preflight baseline non-zero: %', v_baseline USING ERRCODE='55000';
  END IF;

  v_activity_baseline := (v_baseline->>'activity_log')::int;

  -- ============ WAVE 1: 16 unique UNP (earliest CLD per UNP) ============
  FOR v_cld IN
    WITH elig AS (
      SELECT id, profile_id, coalesce(leg_unp, ent_unp) AS unp, created_at
      FROM public.client_legal_details
      WHERE purpose='billing'
        AND client_type IN ('legal_entity','entrepreneur')
        AND coalesce(length(coalesce(leg_unp, ent_unp)),0) > 0
        AND coalesce(length(trim(coalesce(leg_name, ent_name))),0) > 0
    ),
    ranked AS (
      SELECT id, unp, created_at,
             row_number() OVER (PARTITION BY unp ORDER BY created_at, id) AS rn
      FROM elig
    )
    SELECT id, unp FROM ranked WHERE rn=1 ORDER BY unp, id
  LOOP
    v_res := public.crm_company_backfill_billing_cld(v_cld.id);
    v_results := v_results || jsonb_build_array(v_res);
  END LOOP;

  -- ============ WAVE 2: remaining duplicates (UNP 193405000 second CLD) ============
  FOR v_cld IN
    WITH elig AS (
      SELECT id, profile_id, coalesce(leg_unp, ent_unp) AS unp, created_at
      FROM public.client_legal_details
      WHERE purpose='billing'
        AND client_type IN ('legal_entity','entrepreneur')
        AND coalesce(length(coalesce(leg_unp, ent_unp)),0) > 0
        AND coalesce(length(trim(coalesce(leg_name, ent_name))),0) > 0
    ),
    ranked AS (
      SELECT id, unp, created_at,
             row_number() OVER (PARTITION BY unp ORDER BY created_at, id) AS rn
      FROM elig
    )
    SELECT id, unp FROM ranked WHERE rn>1 ORDER BY unp, id
  LOOP
    v_res := public.crm_company_backfill_billing_cld(v_cld.id);
    v_results := v_results || jsonb_build_array(v_res);
  END LOOP;

  -- ============ IN-TX VERIFY EXPECTED COUNTS ============
  SELECT jsonb_build_object(
    'companies', (SELECT count(*) FROM public.companies),
    'maps', (SELECT count(*) FROM public.client_legal_details_company_map),
    'billing_contacts', (SELECT count(*) FROM public.company_contacts
                          WHERE relationship_type='billing_contact' AND is_billing_contact=true),
    'seq_company', (SELECT last_value FROM public.public_id_sequences WHERE entity_type='company')
  ) INTO v_after_wave;

  IF (v_after_wave->>'companies')::int <> 16
     OR (v_after_wave->>'maps')::int <> 17
     OR (v_after_wave->>'billing_contacts')::int <> 17
     OR (v_after_wave->>'seq_company')::int <> 16 THEN
    RAISE EXCEPTION 'in-tx counts mismatch: %', v_after_wave USING ERRCODE='55000';
  END IF;

  -- soft-flag: UNP 193405000 => 1 company + 2 billing contacts
  SELECT c.id INTO v_soft_company FROM public.companies c WHERE c.unp_normalized='193405000';
  IF v_soft_company IS NULL THEN
    RAISE EXCEPTION 'soft flag: company for UNP 193405000 missing' USING ERRCODE='55000';
  END IF;
  SELECT count(*) INTO v_soft_contacts FROM public.company_contacts
    WHERE company_id=v_soft_company AND relationship_type='billing_contact' AND is_billing_contact=true;
  IF v_soft_contacts <> 2 THEN
    RAISE EXCEPTION 'soft flag: expected 2 billing contacts, got %', v_soft_contacts USING ERRCODE='55000';
  END IF;

  -- verify all map company_id equal to their canonical company (no cross-links)
  IF EXISTS (
    SELECT 1 FROM public.client_legal_details_company_map m
    JOIN public.client_legal_details cld ON cld.id=m.client_legal_details_id
    JOIN public.companies c ON c.id=m.company_id
    WHERE c.unp_normalized IS DISTINCT FROM coalesce(cld.leg_unp, cld.ent_unp)
  ) THEN
    RAISE EXCEPTION 'map integrity: unp_normalized mismatch' USING ERRCODE='55000';
  END IF;

  -- ============ SECOND FULL PASS: expect zero deltas ============
  FOR v_cld IN
    WITH elig AS (
      SELECT id, coalesce(leg_unp, ent_unp) AS unp, created_at
      FROM public.client_legal_details
      WHERE purpose='billing'
        AND client_type IN ('legal_entity','entrepreneur')
        AND coalesce(length(coalesce(leg_unp, ent_unp)),0) > 0
        AND coalesce(length(trim(coalesce(leg_name, ent_name))),0) > 0
    )
    SELECT id FROM elig ORDER BY unp, id
  LOOP
    v_res := public.crm_company_backfill_billing_cld(v_cld.id);
    v_second_results := v_second_results || jsonb_build_array(v_res);
  END LOOP;

  SELECT jsonb_build_object(
    'companies', (SELECT count(*) FROM public.companies),
    'maps', (SELECT count(*) FROM public.client_legal_details_company_map),
    'billing_contacts', (SELECT count(*) FROM public.company_contacts
                          WHERE relationship_type='billing_contact' AND is_billing_contact=true),
    'seq_company', (SELECT last_value FROM public.public_id_sequences WHERE entity_type='company'),
    'activity_log', (SELECT count(*) FROM public.crm_activity_log)
  ) INTO v_after_second;

  IF (v_after_second->>'companies')::int <> 16
     OR (v_after_second->>'maps')::int <> 17
     OR (v_after_second->>'billing_contacts')::int <> 17
     OR (v_after_second->>'seq_company')::int <> 16 THEN
    RAISE EXCEPTION 'second-pass delta detected: %', v_after_second USING ERRCODE='55000';
  END IF;

  v_activity_after := (v_after_second->>'activity_log')::int;

  -- Any second-pass entry with contact_created=true or map_created=true is a bug
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_second_results) el
    WHERE (el->>'map_created')::boolean OR (el->>'contact_created')::boolean
  ) THEN
    RAISE EXCEPTION 'second-pass idempotency violation' USING ERRCODE='55000';
  END IF;

  RETURN jsonb_build_object(
    'phase', '3C',
    'baseline', v_baseline,
    'after_waves', v_after_wave,
    'after_second_pass', v_after_second,
    'first_pass_count', jsonb_array_length(v_results),
    'second_pass_count', jsonb_array_length(v_second_results),
    'soft_flag', jsonb_build_object(
       'unp', '193405000',
       'company_id', v_soft_company,
       'billing_contacts', v_soft_contacts
    ),
    'activity_baseline', v_activity_baseline,
    'activity_after', v_activity_after,
    'first_pass', v_results,
    'second_pass', v_second_results
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.crm_company_backfill_execute_phase3c() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_backfill_execute_phase3c() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_backfill_execute_phase3c() TO service_role;
