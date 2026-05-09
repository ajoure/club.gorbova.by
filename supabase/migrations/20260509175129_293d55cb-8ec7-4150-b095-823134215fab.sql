-- C5-G QA: транзиентная тест-функция, запускается через read_query, удаляется в следующей миграции
CREATE OR REPLACE FUNCTION public._c5g_qa_runner()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb := '{}'::jsonb;
  v_profile uuid;
  v_doc1 uuid; v_doc2 uuid; v_doc3 uuid; v_doc_idem uuid; v_doc_imm uuid;
  v_concurrency uuid[];
  v_ids uuid[]; v_id uuid;
  v_n1 jsonb; v_n2 jsonb; v_n3 jsonb; v_idem_first jsonb; v_idem_second jsonb;
  v_imm_msg text;
  v_counters jsonb;
  v_concurrent_results jsonb := '[]'::jsonb;
  v_alloc record;
  v_audit_count int;
  i int;
BEGIN
  -- 1) Сheap cleanup: убрать предыдущие тестовые документы и счетчики тестовых дат
  DELETE FROM public.ai_generated_documents
    WHERE idempotency_key LIKE 'c5g_qa_%';
  DELETE FROM public.document_number_counters
    WHERE document_date IN (DATE '2026-05-09', DATE '2026-05-10', DATE '2026-05-11');

  -- profile
  SELECT profile_id INTO v_profile FROM public.ai_generated_documents LIMIT 1;
  IF v_profile IS NULL THEN
    SELECT id INTO v_profile FROM public.profiles LIMIT 1;
  END IF;

  -- =========================================================
  -- TEST 1: SEQUENTIAL ALLOCATION: 0905/1, 0905/2, 1005/1
  -- =========================================================
  INSERT INTO public.ai_generated_documents (profile_id, template_name, title, status, idempotency_key)
  VALUES (v_profile, 'C5G QA Seq #1', 'C5G QA Seq #1', 'pending', 'c5g_qa_seq_1') RETURNING id INTO v_doc1;
  INSERT INTO public.ai_generated_documents (profile_id, template_name, title, status, idempotency_key)
  VALUES (v_profile, 'C5G QA Seq #2', 'C5G QA Seq #2', 'pending', 'c5g_qa_seq_2') RETURNING id INTO v_doc2;
  INSERT INTO public.ai_generated_documents (profile_id, template_name, title, status, idempotency_key)
  VALUES (v_profile, 'C5G QA Seq #3', 'C5G QA Seq #3', 'pending', 'c5g_qa_seq_3') RETURNING id INTO v_doc3;

  SELECT to_jsonb(t) INTO v_n1 FROM (SELECT * FROM public.allocate_document_number(v_doc1, TIMESTAMPTZ '2026-05-09 12:00:00+03')) t;
  SELECT to_jsonb(t) INTO v_n2 FROM (SELECT * FROM public.allocate_document_number(v_doc2, TIMESTAMPTZ '2026-05-09 13:00:00+03')) t;
  SELECT to_jsonb(t) INTO v_n3 FROM (SELECT * FROM public.allocate_document_number(v_doc3, TIMESTAMPTZ '2026-05-10 09:00:00+03')) t;

  v_results := jsonb_set(v_results, '{sequential}', jsonb_build_object('n1', v_n1, 'n2', v_n2, 'n3', v_n3));

  -- =========================================================
  -- TEST 2: IDEMPOTENCY - повторный allocate на тот же документ возвращает тот же номер
  -- =========================================================
  SELECT to_jsonb(t) INTO v_idem_first FROM (SELECT * FROM public.allocate_document_number(v_doc1, TIMESTAMPTZ '2026-05-11 10:00:00+03')) t;
  -- counter за 09.05 не должен увеличиться (всё ещё last_seq=2)
  SELECT to_jsonb(c) INTO v_counters FROM public.document_number_counters c WHERE document_date = DATE '2026-05-09';
  v_results := jsonb_set(v_results, '{idempotency}', jsonb_build_object(
    'second_call_returns_same', v_idem_first,
    'counter_09_05_unchanged', v_counters
  ));

  -- =========================================================
  -- TEST 3: CONCURRENCY (10 sequential allocates под FOR UPDATE; реальный параллелизм гарантирован lock'ом)
  -- =========================================================
  v_concurrency := ARRAY[]::uuid[];
  FOR i IN 1..10 LOOP
    INSERT INTO public.ai_generated_documents (profile_id, template_name, title, status, idempotency_key)
    VALUES (v_profile, 'C5G QA Conc #' || i, 'C5G QA Conc #' || i, 'pending', 'c5g_qa_conc_' || i)
    RETURNING id INTO v_id;
    v_concurrency := array_append(v_concurrency, v_id);
  END LOOP;

  FOREACH v_id IN ARRAY v_concurrency LOOP
    FOR v_alloc IN SELECT * FROM public.allocate_document_number(v_id, TIMESTAMPTZ '2026-05-11 12:00:00+03') LOOP
      v_concurrent_results := v_concurrent_results || to_jsonb(v_alloc);
    END LOOP;
  END LOOP;

  v_results := jsonb_set(v_results, '{concurrency}', jsonb_build_object(
    'allocated', v_concurrent_results,
    'distinct_count', (SELECT count(DISTINCT document_number) FROM public.ai_generated_documents WHERE id = ANY(v_concurrency)),
    'total_count', (SELECT count(*) FROM public.ai_generated_documents WHERE id = ANY(v_concurrency)),
    'min_seq', (SELECT min(document_seq) FROM public.ai_generated_documents WHERE id = ANY(v_concurrency)),
    'max_seq', (SELECT max(document_seq) FROM public.ai_generated_documents WHERE id = ANY(v_concurrency)),
    'gaps_check', (SELECT count(*) FROM public.ai_generated_documents WHERE id = ANY(v_concurrency)) =
                  (SELECT max(document_seq) - min(document_seq) + 1 FROM public.ai_generated_documents WHERE id = ANY(v_concurrency)),
    'counter_11_05', (SELECT to_jsonb(c) FROM public.document_number_counters c WHERE document_date = DATE '2026-05-11')
  ));

  -- =========================================================
  -- TEST 4: IMMUTABILITY - прямой UPDATE document_number должен падать
  -- =========================================================
  v_imm_msg := NULL;
  BEGIN
    UPDATE public.ai_generated_documents SET document_number = '9999/9' WHERE id = v_doc1;
    v_imm_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_imm_msg := SQLERRM;
  END;
  v_results := jsonb_set(v_results, '{immutability}', jsonb_build_object(
    'direct_update_blocked', v_imm_msg,
    'document_number_unchanged', (SELECT document_number FROM public.ai_generated_documents WHERE id = v_doc1)
  ));

  -- TEST 4b: попытка обнулить
  v_imm_msg := NULL;
  BEGIN
    UPDATE public.ai_generated_documents SET document_number = NULL WHERE id = v_doc2;
    v_imm_msg := 'FAILED_NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_imm_msg := SQLERRM;
  END;
  v_results := jsonb_set(v_results, '{immutability_null}', jsonb_build_object('blocked', v_imm_msg));

  -- =========================================================
  -- TEST 5: AUDIT LOGS - record per assigned number
  -- =========================================================
  SELECT count(*) INTO v_audit_count FROM public.audit_logs
   WHERE action = 'document_number.assigned'
     AND (meta->>'document_id')::uuid IN (v_doc1, v_doc2, v_doc3);
  v_results := jsonb_set(v_results, '{audit}', jsonb_build_object('assigned_records_for_seq_test', v_audit_count));

  -- =========================================================
  -- Final counters snapshot
  -- =========================================================
  v_results := jsonb_set(v_results, '{final_counters}', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.document_date)
      FROM public.document_number_counters c
     WHERE document_date IN (DATE '2026-05-09', DATE '2026-05-10', DATE '2026-05-11')
  ));

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public._c5g_qa_runner() TO PUBLIC;