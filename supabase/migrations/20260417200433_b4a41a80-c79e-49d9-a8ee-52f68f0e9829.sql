UPDATE tariff_offers
SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
  'crm_routing', jsonb_build_object(
    'enabled', true,
    'pipeline_id', 'e8606cb2-2fe4-443e-919d-069cc3476904',
    'stage_on_pending', '43ded272-6263-4bf4-8bb3-6641f0d0c2f8',
    'stage_on_success', 'bea47a8c-c600-4a4b-8042-c862baffffaf',
    'stage_on_failed',  'e1aef770-ed6d-45f3-8eed-d78743e63798'
  )
),
updated_at = now()
WHERE id = 'f71b5ed3-27dd-419d-b922-ad529192b58a';