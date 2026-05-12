UPDATE public.app_settings SET value = 'false'::jsonb, updated_at = now()
WHERE key = 'documents_canonical_generation_enabled';