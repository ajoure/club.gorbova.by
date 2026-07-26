
CREATE OR REPLACE FUNCTION public.crm_phase4d_rehearsal_replay(_run_tag text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_actor          uuid;
  v_profile_id     uuid;
  v_fixture_cld    uuid;
  v_fixture_cld2   uuid;
  v_fixture_cld3   uuid;
  v_job1           uuid;
  v_job1_dup       uuid;
  v_job2           uuid;
  v_job3           uuid;
  v_result         jsonb := jsonb_build_object('run_tag', _run_tag, 't', jsonb_build_object());
  v_before_counts  jsonb;
  v_after_counts   jsonb;
  v_health         jsonb;
  v_fake_company   uuid;
  v_writer_ret     jsonb;
  v_err_state      text;
  v_err_msg        text;

  FUNCTION_new_cld TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'phase4d_rehearsal: service_role only, got %', auth.role();
  END IF;

  SELECT p.id, COALESCE(p.user_id, p.id)
    INTO v_profile_id, v_actor
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = COALESCE(p.user_id, p.id)
  WHERE ur.role IN ('admin','superadmin')
  ORDER BY p.created_at ASC
  LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'phase4d_rehearsal: no admin profile available for fixture actor';
  END IF;

  SELECT jsonb_build_object(
    'companies',(SELECT count(*) FROM public.companies),
    'maps',(SELECT count(*) FROM public.client_legal_details_company_map),
    'billing_contacts',(SELECT count(*) FROM public.company_contacts WHERE relationship_type='billing_contact' AND is_billing_contact=true),
    'seq_company',(SELECT last_value FROM public.public_id_sequences WHERE entity_type='company'),
    'queue_total',(SELECT count(*) FROM public.company_sync_queue)
  ) INTO v_before_counts;
  v_result := jsonb_set(v_result, '{baseline_before}', v_before_counts);

  -- Fixture #1
  INSERT INTO public.client_legal_details (
    id, profile_id, client_type, purpose, status, is_default,
    leg_org_form, leg_name, leg_unp, leg_address,
    created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_profile_id, 'legal_entity', 'billing', 'draft', false,
    'ООО', 'PHASE4D_TEST_ORG_1_'||_run_tag,
    '9'||to_char(floor(random()*1000000000)::int,'FM000000000'),
    'г. Тест, тестовая 1', now(), now()
  ) RETURNING id INTO v_fixture_cld;

  v_job1 := public.crm_company_sync_enqueue(v_fixture_cld, 'legal_details_upsert', NULL);
  v_result := jsonb_set(v_result, '{t,T1_enqueue_job_id}', to_jsonb(v_job1));

  v_job1_dup := public.crm_company_sync_enqueue(v_fixture_cld, 'legal_details_upsert', NULL);
  v_result := jsonb_set(v_result, '{t,T2_dedup_pass}', to_jsonb(v_job1 = v_job1_dup));
  v_result := jsonb_set(v_result, '{t,T4_http_auth_negatives}', to_jsonb('tested_via_http'::text));

  -- Fixture #2 manual_replay
  INSERT INTO public.client_legal_details (
    id, profile_id, client_type, purpose, status, is_default,
    leg_org_form, leg_name, leg_unp, leg_address,
    created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_profile_id, 'legal_entity', 'billing', 'draft', false,
    'ООО', 'PHASE4D_TEST_ORG_2_'||_run_tag,
    '9'||to_char(floor(random()*1000000000)::int,'FM000000000'),
    'г. Тест, тестовая 2', now(), now()
  ) RETURNING id INTO v_fixture_cld2;
  v_job2 := public.crm_company_sync_enqueue(v_fixture_cld2, 'manual_replay', NULL);
  v_result := jsonb_set(v_result, '{t,T5_manual_replay_job_id}', to_jsonb(v_job2));

  -- Fixture #3 mismatch guard
  INSERT INTO public.client_legal_details (
    id, profile_id, client_type, purpose, status, is_default,
    leg_org_form, leg_name, leg_unp, leg_address,
    created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_profile_id, 'legal_entity', 'billing', 'draft', false,
    'ООО', 'PHASE4D_TEST_ORG_3_'||_run_tag,
    '9'||to_char(floor(random()*1000000000)::int,'FM000000000'),
    'г. Тест, тестовая 3', now(), now()
  ) RETURNING id INTO v_fixture_cld3;

  SELECT id INTO v_fake_company FROM public.companies ORDER BY created_at ASC LIMIT 1;
  INSERT INTO public.client_legal_details_company_map (
    id, client_legal_details_id, company_id, created_by, created_at
  ) VALUES (
    gen_random_uuid(), v_fixture_cld3, v_fake_company, v_actor, now()
  );

  v_job3 := public.crm_company_sync_enqueue(v_fixture_cld3, 'legal_details_upsert', NULL);
  v_result := jsonb_set(v_result, '{t,T12_mismatch_job_id}', to_jsonb(v_job3));

  -- Worker loop
  DECLARE
    r jsonb;
    v_outcomes jsonb := '[]'::jsonb;
    v_status text;
    v_error text;
  BEGIN
    LOOP
      SELECT to_jsonb(x) INTO r FROM public.crm_company_sync_worker_claim(10, 60) x LIMIT 1;
      EXIT WHEN r IS NULL;

      IF (r->>'run_reason') NOT IN ('legal_details_upsert','manual_replay') THEN
        v_status := 'done'; v_error := 'skipped: unsupported reason';
      ELSE
        BEGIN
          v_writer_ret := public.crm_company_backfill_billing_cld((r->>'entity_id')::uuid);
          IF v_writer_ret IS NOT NULL AND v_writer_ret->>'status' <> 'ok' THEN
            v_status := 'dead_letter'; v_error := left(v_writer_ret::text,300);
          ELSE
            v_status := 'done'; v_error := NULL;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
          IF v_err_state IN ('42501','23503','22023','P0001')
             OR v_err_msg ILIKE '%company_id mismatch%' THEN
            v_status := 'dead_letter';
          ELSE
            v_status := 'retry';
          END IF;
          v_error := left(coalesce(v_err_msg,'unknown'),300);
        END;
      END IF;

      PERFORM public.crm_company_sync_worker_complete((r->>'id')::uuid, v_status, v_error);
      v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
        'job_id', r->>'id', 'entity_id', r->>'entity_id',
        'reason', r->>'run_reason', 'status', v_status, 'error', v_error
      ));
    END LOOP;
    v_result := jsonb_set(v_result, '{worker_outcomes}', v_outcomes);
  END;

  -- T3
  DECLARE
    v_job1_second uuid;
    v_delta_c int; v_delta_m int; v_delta_ct int;
    v_before_c int; v_before_m int; v_before_ct int;
  BEGIN
    SELECT count(*) INTO v_before_c FROM public.companies;
    SELECT count(*) INTO v_before_m FROM public.client_legal_details_company_map;
    SELECT count(*) INTO v_before_ct FROM public.company_contacts WHERE relationship_type='billing_contact' AND is_billing_contact=true;

    v_job1_second := public.crm_company_sync_enqueue(v_fixture_cld, 'legal_details_upsert', NULL);
    v_result := jsonb_set(v_result, '{t,T3_new_job_after_done}', to_jsonb(v_job1_second <> v_job1));

    v_writer_ret := public.crm_company_backfill_billing_cld(v_fixture_cld);
    PERFORM public.crm_company_sync_worker_complete(v_job1_second, 'done', NULL);

    SELECT (SELECT count(*) FROM public.companies) - v_before_c,
           (SELECT count(*) FROM public.client_legal_details_company_map) - v_before_m,
           (SELECT count(*) FROM public.company_contacts WHERE relationship_type='billing_contact' AND is_billing_contact=true) - v_before_ct
      INTO v_delta_c, v_delta_m, v_delta_ct;
    v_result := jsonb_set(v_result, '{t,T3_zero_delta}',
      jsonb_build_object('companies',v_delta_c,'maps',v_delta_m,'contacts',v_delta_ct));
  END;

  v_health := public.crm_company_sync_health();
  v_result := jsonb_set(v_result, '{healthcheck}', v_health);

  SELECT jsonb_build_object(
    'companies',(SELECT count(*) FROM public.companies),
    'maps',(SELECT count(*) FROM public.client_legal_details_company_map),
    'billing_contacts',(SELECT count(*) FROM public.company_contacts WHERE relationship_type='billing_contact' AND is_billing_contact=true),
    'seq_company',(SELECT last_value FROM public.public_id_sequences WHERE entity_type='company'),
    'queue_total',(SELECT count(*) FROM public.company_sync_queue),
    'queue_done',(SELECT count(*) FROM public.company_sync_queue WHERE status='done'),
    'queue_dead',(SELECT count(*) FROM public.company_sync_queue WHERE status='dead_letter')
  ) INTO v_after_counts;
  v_result := jsonb_set(v_result, '{after_within_txn}', v_after_counts);

  RAISE EXCEPTION 'PHASE4D_REHEARSAL_FORCED_ROLLBACK::%', v_result::text;
END
$fn$;
