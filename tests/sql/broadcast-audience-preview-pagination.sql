-- Run only in a disposable PostgreSQL database, before the migration under test.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION public.has_permission(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.profiles (id uuid, user_id uuid, full_name text, email text, telegram_username text, is_archived boolean, status text);
CREATE TABLE public.preview_test_contacts (profile_id uuid, user_id uuid, full_name text, email text, telegram_username text, has_telegram boolean, has_account boolean, is_archived boolean);
CREATE TABLE public.preview_test_tg (user_id uuid, has_telegram boolean);
CREATE FUNCTION public.resolve_broadcast_audience_contacts(jsonb) RETURNS SETOF public.preview_test_contacts LANGUAGE sql AS $$ SELECT * FROM public.preview_test_contacts $$;
CREATE FUNCTION public.resolve_broadcast_audience_user_ids(jsonb) RETURNS SETOF public.preview_test_tg LANGUAGE sql AS $$ SELECT * FROM public.preview_test_tg $$;
INSERT INTO public.preview_test_contacts
SELECT md5('profile-' || i)::uuid, CASE WHEN i = 1 THEN NULL ELSE md5('user-' || i)::uuid END,
  CASE WHEN i > 45 THEN NULL ELSE 'Same name' END, 'test-' || i || '@example.invalid', NULL,
  i > 1, i > 1, i = 1 FROM generate_series(1, 55) i;
INSERT INTO public.preview_test_tg SELECT md5('user-' || i)::uuid, true FROM generate_series(2, 59) i;
INSERT INTO public.profiles SELECT md5('profile-' || i)::uuid, md5('user-' || i)::uuid,
  NULL, NULL, 'test_' || i, false, 'active' FROM generate_series(56, 59) i;
