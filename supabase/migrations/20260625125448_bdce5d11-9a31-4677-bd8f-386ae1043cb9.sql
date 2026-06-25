INSERT INTO public.app_settings (key, value)
VALUES ('qa_test_helper_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value='true'::jsonb, updated_at=now();