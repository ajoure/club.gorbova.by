-- Smoke: enable canonical generation flag and activate template
UPDATE app_settings SET value = 'true'::jsonb WHERE key = 'documents_canonical_generation_enabled';
UPDATE document_templates SET is_active = true, current_version_id = 'c183b7b8-d23f-44b8-8da4-f8a648c9bdf1' WHERE id = '3a85d410-c17a-462e-929a-bc2bc1e3ff60';