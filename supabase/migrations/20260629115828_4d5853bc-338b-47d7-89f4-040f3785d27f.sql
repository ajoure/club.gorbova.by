
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.kb_questions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.training_lessons FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.training_modules FROM authenticated;

GRANT SELECT ON public.kb_questions TO authenticated;
GRANT SELECT ON public.training_lessons TO authenticated;
GRANT SELECT ON public.training_modules TO authenticated;

GRANT ALL ON public.kb_questions TO service_role;
GRANT ALL ON public.training_lessons TO service_role;
GRANT ALL ON public.training_modules TO service_role;

REVOKE ALL ON public.kb_questions FROM anon;
REVOKE ALL ON public.training_lessons FROM anon;
REVOKE ALL ON public.training_modules FROM anon;
