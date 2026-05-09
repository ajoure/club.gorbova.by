-- C5-G QA cleanup: удалить транзиентную тест-функцию и тестовые документы/счётчики
DROP FUNCTION IF EXISTS public._c5g_qa_runner();

-- Чистка тестовых документов и счётчиков (immutability trigger разрешает DELETE, блокирует только UPDATE document_number)
DELETE FROM public.ai_generated_documents WHERE idempotency_key LIKE 'c5g_qa_%';
DELETE FROM public.document_number_counters
  WHERE document_date IN (DATE '2026-05-09', DATE '2026-05-10', DATE '2026-05-11');

-- Audit финального QA-прогона
INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, meta)
VALUES (
  NULL, 'system', 'c5g_qa_finalize', 'document_numbering.qa_completed',
  jsonb_build_object(
    'sprint', 'sprint11_c5g',
    'tests_passed', jsonb_build_array(
      'sequential:0905/1,0905/2,1005/1',
      'idempotency:counter_unchanged',
      'concurrency:10/10_distinct_no_gaps',
      'immutability:document_number_is_immutable',
      'audit:assigned_records_present'
    ),
    'fix_applied', 'allocate_document_number variable_conflict use_column'
  )
);