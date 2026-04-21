-- Удалить тестовые вопросы
DELETE FROM public.live_event_questions
WHERE id IN ('ecc1620e-5747-4575-96d2-e72ffa9445cc','295ccce1-dfd6-4df3-8d8d-269dc2688b9b');

-- Удалить временный QA-эфир test-complete-1 (используем slug + id для надежности)
DELETE FROM public.live_event_questions WHERE live_event_id='82662d0c-057d-47f1-8831-88611c5efcde';
DELETE FROM public.live_active_sessions WHERE live_event_id='82662d0c-057d-47f1-8831-88611c5efcde';
DELETE FROM public.live_access_proofs WHERE live_event_id='82662d0c-057d-47f1-8831-88611c5efcde';
DELETE FROM public.live_events WHERE id='82662d0c-057d-47f1-8831-88611c5efcde' AND slug='test-complete-1';