UPDATE public.orders_v2
SET payer_type = 'legal_entity',
    meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{__sprint_b_smoke_prev_payer_type}', '"individual"'::jsonb, true)
WHERE id = '479407e8-ba2a-44f1-a6d0-4f09a0f92040'
  AND payer_type = 'individual';