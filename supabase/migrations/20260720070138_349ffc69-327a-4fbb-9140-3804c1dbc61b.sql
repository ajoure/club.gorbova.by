
CREATE OR REPLACE FUNCTION public.crm_phase4d_rehearsal_replay(_run_tag text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_actor uuid; v_profile_id uuid;
  v_fixture_cld uuid; v_fixture_cld2 uuid; v_fixture_cld3 uuid;
  v_job1 uuid; v_job1_dup uuid; v_job2 uuid; v_job3 uuid;
  v_result jsonb := jsonb_build_object('run_tag', _run_tag, 't', jsonb_build_object());
  v_before_counts jsonb; v_after_counts jsonb; v_health jsonb;
  v_fake_company uuid; v_writer_ret jsonb;
  v_err_state text; v_err_msg text;
  v_admin_claims text; v_svc_claims text := '{"role":"service_role"}';
  v_claimed jsonb; v_outcomes jsonb := '[]'::jsonb;
  v_row jsonb; v_status text; v_error text;
  v_before_c int; v_before_m int; v_before_ct int;
  v_delta_c int; v_delta_m int; v_delta_ct int;
  v_job1_second uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role only'; END IF;
  SELECT p.id, COALESCE(p.user_id, p.id) INTO v_profile_id, v_actor
  FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = COALESCE(p.user_id,p.id)
  WHERE ur.role IN ('admin','superadmin') ORDER BY p.created_at LIMIT 1;
  v_admin_claims := json_build_object('role','authenticated','sub',v_actor::text)::text;

  SELECT jsonb_build_object(
    'companies',(SELECT count(*) FROM public.companies),
    'maps',(SELECT count(*) FROM public.client_legal_details_company_map),
    'billing_contacts',(SELECT count(*) FROM public.company_contacts WHERE relationship_type='billing_contact' AND is_billing_contact),
    'seq_company',(SELECT last_value FROM public.public_id_sequences WHERE entity_type='company'),
    'queue_total',(SELECT count(*) FROM public.company_sync_queue)
  ) INTO v_before_counts;
  v_result := jsonb_set(v_result,'{baseline_before}',v_before_counts);

  INSERT INTO public.client_legal_details (id,profile_id,client_type,purpose,status,is_default,leg_org_form,leg_name,leg_unp,leg_address,created_at,updated_at)
    VALUES (gen_random_uuid(),v_profile_id,'legal_entity','billing','active',false,'ООО','PHASE4D_1_'||_run_tag,'9'||to_char(floor(random()*1000000000)::int,'FM000000000'),'t1',now(),now())
    RETURNING id INTO v_fixture_cld;
  INSERT INTO public.client_legal_details (id,profile_id,client_type,purpose,status,is_default,leg_org_form,leg_name,leg_unp,leg_address,created_at,updated_at)
    VALUES (gen_random_uuid(),v_profile_id,'legal_entity','billing','active',false,'ООО','PHASE4D_2_'||_run_tag,'9'||to_char(floor(random()*1000000000)::int,'FM000000000'),'t2',now(),now())
    RETURNING id INTO v_fixture_cld2;
  INSERT INTO public.client_legal_details (id,profile_id,client_type,purpose,status,is_default,leg_org_form,leg_name,leg_unp,leg_address,created_at,updated_at)
    VALUES (gen_random_uuid(),v_profile_id,'legal_entity','billing','active',false,'ООО','PHASE4D_3_'||_run_tag,'9'||to_char(floor(random()*1000000000)::int,'FM000000000'),'t3',now(),now())
    RETURNING id INTO v_fixture_cld3;
  SELECT id INTO v_fake_company FROM public.companies ORDER BY created_at LIMIT 1;
  INSERT INTO public.client_legal_details_company_map (id,client_legal_details_id,company_id,created_by,created_at)
    VALUES (gen_random_uuid(),v_fixture_cld3,v_fake_company,v_actor,now());

  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  v_job1 := public.crm_company_sync_enqueue(v_fixture_cld,'legal_details_upsert',NULL);
  v_job1_dup := public.crm_company_sync_enqueue(v_fixture_cld,'legal_details_upsert',NULL);
  v_result := jsonb_set(v_result,'{t,T1_enqueue_job_id}',to_jsonb(v_job1));
  v_result := jsonb_set(v_result,'{t,T2_dedup_pass}',to_jsonb(v_job1=v_job1_dup));
  v_job2 := public.crm_company_sync_enqueue(v_fixture_cld2,'manual_replay',NULL);
  v_result := jsonb_set(v_result,'{t,T5_manual_replay_job_id}',to_jsonb(v_job2));
  v_job3 := public.crm_company_sync_enqueue(v_fixture_cld3,'legal_details_upsert',NULL);
  v_result := jsonb_set(v_result,'{t,T12_mismatch_job_id}',to_jsonb(v_job3));
  PERFORM set_config('request.jwt.claims', v_svc_claims, true);

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_claimed
    FROM public.crm_company_sync_worker_claim(10,60) x;
  v_result := jsonb_set(v_result,'{claimed_count}',to_jsonb(jsonb_array_length(v_claimed)));

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_claimed) LOOP
    v_error := NULL; v_writer_ret := NULL;
    BEGIN
      v_writer_ret := public.crm_company_backfill_billing_cld((v_row->>'entity_id')::uuid);
      IF v_writer_ret IS NULL
         OR v_writer_ret->>'writer' IS DISTINCT FROM 'crm_company_backfill_billing_cld'
         OR coalesce(v_writer_ret->>'company_id','') = '' THEN
        v_status := 'dead_letter'; v_error := left(coalesce(v_writer_ret::text,'nil'),300);
      ELSE v_status := 'done'; END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err_state=RETURNED_SQLSTATE, v_err_msg=MESSAGE_TEXT;
      IF v_err_state IN ('42501','23503','22023','23505','P0001') OR v_err_msg ILIKE '%mismatch%' THEN
        v_status := 'dead_letter';
      ELSE v_status := 'retry'; END IF;
      v_error := left(v_err_msg,300);
    END;
    PERFORM public.crm_company_sync_worker_complete((v_row->>'id')::uuid, v_status, v_error);
    v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
      'job_id',v_row->>'id','entity_id',v_row->>'entity_id',
      'reason',v_row->>'run_reason','status',v_status,'error',v_error));
  END LOOP;
  v_result := jsonb_set(v_result,'{worker_outcomes}',v_outcomes);

  SELECT count(*) INTO v_before_c FROM public.companies;
  SELECT count(*) INTO v_before_m FROM public.client_legal_details_company_map;
  SELECT count(*) INTO v_before_ct FROM public.company_contacts WHERE relationship_type='billing_contact' AND is_billing_contact;
  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  v_job1_second := public.crm_company_sync_enqueue(v_fixture_cld,'legal_details_upsert',NULL);
  PERFORM set_config('request.jwt.claims', v_svc_claims, true);
  v_result := jsonb_set(v_result,'{t,T3_new_job_after_done}',to_jsonb(v_job1_second<>v_job1));
  v_writer_ret := public.crm_company_backfill_billing_cld(v_fixture_cld);
  v_result := jsonb_set(v_result,'{t,T3_writer_second_pass}',v_writer_ret);
  UPDATE public.company_sync_queue SET status='done',updated_at=now() WHERE id=v_job1_second;
  SELECT (SELECT count(*) FROM public.companies)-v_before_c,
         (SELECT count(*) FROM public.client_legal_details_company_map)-v_before_m,
         (SELECT count(*) FROM public.company_contacts WHERE relationship_type='billing_contact' AND is_billing_contact)-v_before_ct
    INTO v_delta_c,v_delta_m,v_delta_ct;
  v_result := jsonb_set(v_result,'{t,T3_zero_delta}',
    jsonb_build_object('companies',v_delta_c,'maps',v_delta_m,'contacts',v_delta_ct));

  v_health := public.crm_company_sync_health();
  v_result := jsonb_set(v_result,'{healthcheck}',v_health);

  SELECT jsonb_build_object(
    'companies',(SELECT count(*) FROM public.companies),
    'maps',(SELECT count(*) FROM public.client_legal_details_company_map),
    'billing_contacts',(SELECT count(*) FROM public.company_contacts WHERE relationship_type='billing_contact' AND is_billing_contact),
    'seq_company',(SELECT last_value FROM public.public_id_sequences WHERE entity_type='company'),
    'queue_total',(SELECT count(*) FROM public.company_sync_queue),
    'queue_done',(SELECT count(*) FROM public.company_sync_queue WHERE status='done'),
    'queue_dead',(SELECT count(*) FROM public.company_sync_queue WHERE status='dead_letter')
  ) INTO v_after_counts;
  v_result := jsonb_set(v_result,'{after_within_txn}',v_after_counts);

  RAISE EXCEPTION 'PHASE4D_REHEARSAL_FORCED_ROLLBACK::%', v_result::text;
END $fn$;
