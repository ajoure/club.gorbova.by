-- B.1. Functions: fix search_path
ALTER FUNCTION public.trg_site_form_submissions_public_id() SET search_path = public;
ALTER FUNCTION public.validate_training_content_rule() SET search_path = public;

-- B.2. Public buckets: drop broad public SELECT (kills .list(), keeps direct public URL)
DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view signatures" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view training content" ON storage.objects;
DROP POLICY IF EXISTS "Public read webinar-prestart" ON storage.objects;
DROP POLICY IF EXISTS "Public can view training assets" ON storage.objects;