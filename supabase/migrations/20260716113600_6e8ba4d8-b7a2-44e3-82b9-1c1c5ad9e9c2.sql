CREATE POLICY "Authenticated can view lessons referenced by kb_questions"
  ON public.training_lessons
  FOR SELECT
  TO authenticated
  USING (
    is_active
    AND EXISTS (SELECT 1 FROM public.kb_questions kq WHERE kq.lesson_id = training_lessons.id)
  );