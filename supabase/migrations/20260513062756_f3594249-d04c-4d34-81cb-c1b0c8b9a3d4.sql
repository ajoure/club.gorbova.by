UPDATE app_settings SET value = 'false'::jsonb WHERE key = 'documents_canonical_generation_enabled';
UPDATE document_templates SET is_active = false WHERE id = '3a85d410-c17a-462e-929a-bc2bc1e3ff60';