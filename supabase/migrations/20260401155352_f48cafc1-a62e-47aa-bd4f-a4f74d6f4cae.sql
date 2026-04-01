
UPDATE subscriptions_v2
SET 
  access_end_at = '2026-05-17T12:00:00.000Z',
  next_charge_at = '2026-05-17T12:00:00.000Z',
  meta = jsonb_set(
    meta,
    '{extended_by_orders}',
    '["1e79586c-ebcf-4306-a3a4-87d8c05c3f3d", "ddfaeb9c-0cdb-4c1b-b6ed-6963911aa3a9"]'::jsonb
  ),
  updated_at = now()
WHERE id = '830998dc-ede6-4542-891f-7913021ab39a';
