
-- Cross-product training_content rule:
-- product «Gorbova Club - идеология» (3ea08f79) → root «База знаний» (8b1fb03e),
-- partial scope: allow only module «Видеоответы» (f5dc3e63).
-- Idempotent: skip if equivalent rule already exists.
INSERT INTO public.access_rules (
  grant_target_type, product_id, tariff_id, target_ref, target_label,
  is_active, conditions
)
SELECT
  'training_content',
  '3ea08f79-afe8-4361-81fe-4c0f318f9a2b',
  NULL,
  '8b1fb03e-8743-4654-a07f-b6c03ca7517b',
  'База знаний',
  true,
  jsonb_build_object(
    'access_mode', 'partial',
    'allowed_lesson_ids', '[]'::jsonb,
    'allowed_module_ids', jsonb_build_array('f5dc3e63-4cfd-40ba-9ce6-cee3b8790630'),
    'auto_include_new_modules', false
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.access_rules
  WHERE grant_target_type = 'training_content'
    AND product_id = '3ea08f79-afe8-4361-81fe-4c0f318f9a2b'
    AND target_ref = '8b1fb03e-8743-4654-a07f-b6c03ca7517b'
    AND conditions->'allowed_module_ids' ? 'f5dc3e63-4cfd-40ba-9ce6-cee3b8790630'
);
