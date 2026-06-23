CREATE OR REPLACE FUNCTION public.get_kb_questions_public()
RETURNS TABLE (
  id uuid,
  episode_number integer,
  question_number integer,
  title text,
  full_question text,
  tags text[],
  answer_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.id,
    q.episode_number,
    q.question_number,
    q.title,
    q.full_question,
    q.tags,
    q.answer_date
  FROM public.kb_questions q
  WHERE q.title IS NOT NULL OR q.full_question IS NOT NULL
  ORDER BY q.answer_date DESC NULLS LAST,
           q.episode_number DESC NULLS LAST,
           q.question_number ASC NULLS LAST
  LIMIT 700
$$;

REVOKE ALL ON FUNCTION public.get_kb_questions_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kb_questions_public() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_kb_questions_public() IS
'Публичный безопасный эндпоинт для поиска по базе вопросов на лендингах. Возвращает только нечувствительные поля (без lesson_id, kinescope_url, timecode_seconds). Sprint INV-LANDING-DB-PUBLIC.';