UPDATE public.orders_v2
SET payer_type = 'individual',
    meta = (coalesce(meta,'{}'::jsonb) - '__sprint_b_smoke_prev_payer_type')
WHERE id IN ('479407e8-ba2a-44f1-a6d0-4f09a0f92040','84519579-deda-4d2f-bc8a-6f061265bc94')
  AND meta ? '__sprint_b_smoke_prev_payer_type';