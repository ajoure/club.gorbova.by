UPDATE public.orders_v2
SET payer_type = 'legal_entity',
    meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{__sprint_b_smoke_prev_payer_type}', '"individual"'::jsonb, true)
WHERE id = '84519579-deda-4d2f-bc8a-6f061265bc94'
  AND payer_type = 'individual';