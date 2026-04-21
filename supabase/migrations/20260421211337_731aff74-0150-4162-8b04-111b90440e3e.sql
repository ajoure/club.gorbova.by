-- Перенос ранее хардкоднутого layout="vertical-grid" в Consultation.tsx
-- в каноническое место хранения: products_v2.landing_config.tariffs_layout
UPDATE products_v2
SET landing_config = COALESCE(landing_config, '{}'::jsonb) || jsonb_build_object('tariffs_layout', 'vertical-grid')
WHERE id = '9d0d6de8-4b0e-477f-b6c4-ab7def8268f6';