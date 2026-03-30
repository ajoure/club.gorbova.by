-- v22.7 smoke fixture: create test subscription for admin-actions smoke
INSERT INTO subscriptions_v2 (
  id, user_id, product_id, status, auto_renew, billing_type,
  access_end_at, created_at, updated_at, meta
) VALUES (
  'a7b8c9d0-1234-5678-9abc-def012345678',
  '2ef54ad1-198e-4e3d-a686-0de9f6037332',
  '11c9f1b8-0355-4753-bd74-40b42aa53616',
  'active',
  false,
  'mit',
  '2026-03-30T23:59:59Z',
  now(),
  now(),
  '{"smoke_fixture": "v22.7", "purpose": "admin-actions-runtime-smoke"}'::jsonb
);