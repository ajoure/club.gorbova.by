GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_lessons TO authenticated;
GRANT ALL ON public.training_lessons TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_modules TO authenticated;
GRANT ALL ON public.training_modules TO service_role;