
-- 1) Clear dead template_id in tariff_offers.meta.document_defaults
UPDATE tariff_offers
SET meta = jsonb_set(meta, '{document_defaults,template_id}', 'null'::jsonb, false)
WHERE id = '6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e'
  AND meta #>> '{document_defaults,template_id}' = 'b8aa7b9c-cbad-4109-85fb-980923fc580b';

-- 2) Clear dead template_override in orders_v2.meta.documents
UPDATE orders_v2
SET meta = jsonb_set(meta, '{documents}', (meta->'documents') - 'template_override', false)
WHERE meta #>> '{documents,template_override}' = 'b8aa7b9c-cbad-4109-85fb-980923fc580b';
