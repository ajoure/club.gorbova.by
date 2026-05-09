-- Фикс типа: явно кастуем строку к text перед to_jsonb
CREATE OR REPLACE FUNCTION public._c5g_qa_runner_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_results jsonb := '{}'::jsonb;
  v_profile uuid;
  v_doc uuid; v_doc2 uuid; v_doc3 uuid;
  v_super_admin uuid := '05cd3754-d589-4d90-97d1-89ba2bee610b';
  v_admin_only uuid := '7a0083ac-d2b0-4fc3-9940-6822922365c6';
  v_regular   uuid := '0012a7a4-1420-486c-b95e-e6ba5907ef93';
  v_msg text;
  v_counter_before jsonb;
  v_counter_after jsonb;
  v_audit_count int;
  v_today date := (now() AT TIME ZONE 'Europe/Minsk')::date;
BEGIN
  DELETE FROM public.ai_generated_documents WHERE idempotency_key LIKE 'c5g_qa2_%';
  SELECT profile_id INTO v_profile FROM public.ai_generated_documents WHERE profile_id IS NOT NULL LIMIT 1;

  INSERT INTO public.ai_generated_documents(profile_id, template_name, title, status, idempotency_key)
  VALUES (v_profile, 'C5G QA2 Override', 'C5G QA2 Override', 'pending', 'c5g_qa2_override') RETURNING id INTO v_doc;
  PERFORM public.allocate_document_number(v_doc);

  -- 1a anon
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_msg := NULL;
  BEGIN PERFORM public.admin_override_document_number(v_doc, '8888/8', 'qa anon test reason'); v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  v_results := jsonb_set(v_results, '{rbac_anon}', to_jsonb(v_msg::text));

  -- 1b regular
  PERFORM set_config('request.jwt.claim.sub', v_regular::text, true);
  v_msg := NULL;
  BEGIN PERFORM public.admin_override_document_number(v_doc, '8888/8', 'qa regular user test reason'); v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  v_results := jsonb_set(v_results, '{rbac_regular}', to_jsonb(v_msg::text));

  -- 1c admin only
  PERFORM set_config('request.jwt.claim.sub', v_admin_only::text, true);
  v_msg := NULL;
  BEGIN PERFORM public.admin_override_document_number(v_doc, '8888/8', 'qa admin only test reason'); v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  v_results := jsonb_set(v_results, '{rbac_admin_only}', to_jsonb(v_msg::text));

  -- 1d super short reason
  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  v_msg := NULL;
  BEGIN PERFORM public.admin_override_document_number(v_doc, '8888/8', 'no'); v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  v_results := jsonb_set(v_results, '{rbac_super_admin_short_reason}', to_jsonb(v_msg::text));

  -- 1e super empty number
  v_msg := NULL;
  BEGIN PERFORM public.admin_override_document_number(v_doc, '   ', 'qa empty number test reason'); v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  v_results := jsonb_set(v_results, '{rbac_super_admin_empty_number}', to_jsonb(v_msg::text));

  -- 1f success
  v_msg := NULL;
  BEGIN PERFORM public.admin_override_document_number(v_doc, 'OVR/0001', 'QA C5G live override proof reason'); v_msg := 'OK';
  EXCEPTION WHEN OTHERS THEN v_msg := 'FAILED:' || SQLERRM; END;
  v_results := jsonb_set(v_results, '{rbac_super_admin_success}', to_jsonb(v_msg::text));
  v_results := jsonb_set(v_results, '{override_resulting_number}',
    to_jsonb((SELECT document_number FROM ai_generated_documents WHERE id=v_doc)::text));

  -- 1g audit
  SELECT count(*) INTO v_audit_count FROM public.audit_logs
   WHERE action='document_number.override' AND (meta->>'document_id')::uuid = v_doc AND actor_user_id = v_super_admin;
  v_results := jsonb_set(v_results, '{rbac_super_admin_audit_count}', to_jsonb(v_audit_count));

  -- 1h immutability after override
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_msg := NULL;
  BEGIN UPDATE public.ai_generated_documents SET document_number='ZZZ/9' WHERE id=v_doc; v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  v_results := jsonb_set(v_results, '{immutable_after_override}', to_jsonb(v_msg::text));

  -- TEST 2: preview no-op
  SELECT to_jsonb(c) INTO v_counter_before FROM public.document_number_counters c
    WHERE document_date=v_today AND document_timezone='Europe/Minsk';
  INSERT INTO public.ai_generated_documents(profile_id, template_name, title, status, idempotency_key, snapshot)
  VALUES (v_profile, 'C5G QA2 Preview', 'C5G QA2 Preview', 'preview', 'c5g_qa2_preview',
          jsonb_build_object('preview_only', true)) RETURNING id INTO v_doc3;
  SELECT to_jsonb(c) INTO v_counter_after FROM public.document_number_counters c
    WHERE document_date=v_today AND document_timezone='Europe/Minsk';
  v_results := jsonb_set(v_results, '{preview_no_op}', jsonb_build_object(
    'counter_before', coalesce(v_counter_before, 'null'::jsonb),
    'counter_after',  coalesce(v_counter_after,  'null'::jsonb),
    'preview_doc_has_no_number', (SELECT document_number IS NULL FROM ai_generated_documents WHERE id=v_doc3),
    'preview_doc_status', (SELECT status FROM ai_generated_documents WHERE id=v_doc3),
    'note', 'edge canonical-document-generate-strict mode=preview не вызывает allocate_document_number; counter не сдвигается'
  ));

  -- TEST 3: search blob coverage
  v_results := jsonb_set(v_results, '{search_proof}', jsonb_build_object(
    'search_blob_includes_document_number', false,
    'finding', 'search_deal_rows.search_blob = lower(order_number||customer_email||customer_phone||profile.full_name||profile.email||profile.phone||product.name||product.code||tariff.name) — ai_generated_documents.document_number НЕ JOIN. Поиск по 0905/1 через текущий RPC не найдёт сделку. Требует C5-H: extend search_deal_rows + useDealsSearch.'
  ));

  DELETE FROM public.ai_generated_documents WHERE idempotency_key LIKE 'c5g_qa2_%';
  RETURN v_results;
END;
$$;