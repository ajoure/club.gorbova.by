-- Seed kill-switch for section gating
INSERT INTO public.app_settings (key, value)
VALUES ('section_gating_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;