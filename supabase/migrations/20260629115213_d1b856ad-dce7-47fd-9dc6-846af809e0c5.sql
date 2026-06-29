-- PATCH-KNOWLEDGE-CONTENT-EMPTY-FOR-TRIAL
-- Restore missing Data API GRANTs on kb_questions and embedded join tables.
-- RLS policies remain unchanged (they already encode the correct business rule).

GRANT SELECT ON public.kb_questions TO authenticated;
GRANT ALL    ON public.kb_questions TO service_role;

GRANT SELECT ON public.training_lessons TO authenticated;
GRANT ALL    ON public.training_lessons TO service_role;

GRANT SELECT ON public.training_modules TO authenticated;
GRANT ALL    ON public.training_modules TO service_role;