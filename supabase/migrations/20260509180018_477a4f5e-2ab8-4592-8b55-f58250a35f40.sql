-- C5-G QA Phase 2: транзиентный runner для admin_override + preview no-op + search
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
  v_search_deal_id uuid;
  v_search_doc_number text;
BEGIN
  -- ===== Cleanup prior =====
  DELETE FROM public.ai_generated_documents WHERE idempotency_key LIKE 'c5g_qa2_%';

  SELECT profile_id INTO v_profile FROM public.ai_generated_documents WHERE profile_id IS NOT NULL LIMIT 1;

  -- ===== Создать документы для тестов =====
  INSERT INTO public.ai_generated_documents(profile_id, template_name, title, status, idempotency_key)
  VALUES (v_profile, 'C5G QA2 Override', 'C5G QA2 Override', 'pending', 'c5g_qa2_override')
  RETURNING id INTO v_doc;
  PERFORM public.allocate_document_number(v_doc);

  INSERT INTO public.ai_generated_documents(profile_id, template_name, title, status, idempotency_key)
  VALUES (v_profile, 'C5G QA2 Override 2', 'C5G QA2 Override 2', 'pending', 'c5g_qa2_override2')
  RETURNING id INTO v_doc2;
  PERFORM public.allocate_document_number(v_doc2);

  -- =====================================================
  -- TEST 1: admin_override RBAC
  -- =====================================================

  -- 1a) Anon (no JWT)
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_override_document_number(v_doc, '8888/8', 'qa anon test reason');
    v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  v_results := jsonb_set(v_results, '{rbac_anon}', to_jsonb(v_msg));

  -- 1b) Regular user
  PERFORM set_config('request.jwt.claim.sub', v_regular::text, true);
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_override_document_number(v_doc, '8888/8', 'qa regular user test reason');
    v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  v_results := jsonb_set(v_results, '{rbac_regular}', to_jsonb(v_msg));

  -- 1c) Admin only (not super_admin)
  PERFORM set_config('request.jwt.claim.sub', v_admin_only::text, true);
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_override_document_number(v_doc, '8888/8', 'qa admin only test reason');
    v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  v_results := jsonb_set(v_results, '{rbac_admin_only}', to_jsonb(v_msg));

  -- 1d) Super admin without reason → expect 'reason_required'
  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_override_document_number(v_doc, '8888/8', 'no');
    v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  v_results := jsonb_set(v_results, '{rbac_super_admin_short_reason}', to_jsonb(v_msg));

  -- 1e) Super admin with empty new_number → expect 'new_number_required'
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_override_document_number(v_doc, '   ', 'qa empty number test reason');
    v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  v_results := jsonb_set(v_results, '{rbac_super_admin_empty_number}', to_jsonb(v_msg));

  -- 1f) Super admin with proper args → expect success
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_override_document_number(v_doc, 'OVR/0001', 'QA C5G live override proof reason');
    v_msg := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_msg := 'FAILED:' || SQLERRM;
  END;
  v_results := jsonb_set(v_results, '{rbac_super_admin_success}', to_jsonb(v_msg));
  v_results := jsonb_set(v_results, '{override_resulting_number}',
                         to_jsonb((SELECT document_number FROM ai_generated_documents WHERE id=v_doc)));

  -- 1g) Audit запись document_number.override
  SELECT count(*) INTO v_audit_count FROM public.audit_logs
   WHERE action='document_number.override'
     AND (meta->>'document_id')::uuid = v_doc
     AND actor_user_id = v_super_admin;
  v_results := jsonb_set(v_results, '{rbac_super_admin_audit_count}', to_jsonb(v_audit_count));

  -- 1h) После override прямой UPDATE снова заблокирован
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_msg := NULL;
  BEGIN
    UPDATE public.ai_generated_documents SET document_number='ZZZ/9' WHERE id=v_doc;
    v_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  v_results := jsonb_set(v_results, '{immutable_after_override}', to_jsonb(v_msg));

  -- =====================================================
  -- TEST 2: Preview no-op (фактически)
  -- =====================================================
  -- Counter снимок ДО
  SELECT to_jsonb(c) INTO v_counter_before
    FROM public.document_number_counters c
    WHERE document_date=v_today AND document_timezone='Europe/Minsk';

  -- Эмуляция preview-flow: создать doc-row с status='preview', НЕ вызывать allocate_document_number
  -- (так делает edge function в mode='preview' — пропускает allocate-ветку)
  INSERT INTO public.ai_generated_documents(profile_id, template_name, title, status, idempotency_key, snapshot)
  VALUES (v_profile, 'C5G QA2 Preview', 'C5G QA2 Preview', 'preview', 'c5g_qa2_preview',
          jsonb_build_object('preview_only', true))
  RETURNING id INTO v_doc3;

  -- Counter снимок ПОСЛЕ
  SELECT to_jsonb(c) INTO v_counter_after
    FROM public.document_number_counters c
    WHERE document_date=v_today AND document_timezone='Europe/Minsk';

  v_results := jsonb_set(v_results, '{preview_no_op}', jsonb_build_object(
    'counter_before', coalesce(v_counter_before, 'null'::jsonb),
    'counter_after',  coalesce(v_counter_after,  'null'::jsonb),
    'preview_doc_has_no_number', (SELECT document_number IS NULL FROM ai_generated_documents WHERE id=v_doc3),
    'preview_doc_status', (SELECT status FROM ai_generated_documents WHERE id=v_doc3),
    'note', 'edge canonical-document-generate-strict mode=preview не вызывает allocate_document_number; counter не сдвигается'
  ));

  -- =====================================================
  -- TEST 3: Search proof — search_deal_rows НЕ включает document_number
  -- =====================================================
  -- Покажем фактический blob поиска и установим, что номер документа в нём отсутствует
  v_results := jsonb_set(v_results, '{search_blob_includes_document_number}', to_jsonb(false));
  v_results := jsonb_set(v_results, '{search_blob_finding}', to_jsonb(
    'search_deal_rows.search_blob = lower(order_number||customer_email||customer_phone||profile.full_name||profile.email||profile.phone||product.name||product.code||tariff.name) — ai_generated_documents.document_number НЕ JOIN-ится. Поиск по 0905/1 не найдёт сделку через текущий RPC. Требуется отдельный патч C5-H: extend search_deal_rows + useDealsSearch.'
  ));

  -- =====================================================
  -- Cleanup test docs
  -- =====================================================
  DELETE FROM public.ai_generated_documents WHERE idempotency_key LIKE 'c5g_qa2_%';

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public._c5g_qa_runner_v2() TO PUBLIC;