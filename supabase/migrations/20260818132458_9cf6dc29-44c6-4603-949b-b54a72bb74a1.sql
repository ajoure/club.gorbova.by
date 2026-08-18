DO $$
DECLARE r1 jsonb; r2 jsonb;
BEGIN
  r1 := public.admin_create_deal_from_payment(
    '29112f79-34f8-4d09-ae1b-387d74f2f8cb'::uuid,'payments_v2',
    '05cd3754-d589-4d90-97d1-89ba2bee610b'::uuid,'37c0660f-c9bc-4dd0-9913-71b4fab686cb'::uuid,
    '85046734-2282-4ded-b0d3-8c66c8f5bc2b'::uuid,'c5981337-242b-49e8-8c99-64ccf8fac13e'::uuid,
    250.00,'BYN','2026-08-02 13:45:27+00'::timestamptz,'2026-09-01 20:59:59+00'::timestamptz,
    'volodik_84@mail.ru',false,'aug26-recurring-buh-29112f79',
    encode(sha256('aug26-recurring-buh-29112f79'::bytea),'hex'));
  r2 := public.admin_create_deal_from_payment(
    '819eb5b1-87ed-4656-8382-5f7fd5d6ed2c'::uuid,'payments_v2',
    '05cd3754-d589-4d90-97d1-89ba2bee610b'::uuid,'4e8834a5-0f6a-44d6-b05a-8d7ec3b4d6e9'::uuid,
    '85046734-2282-4ded-b0d3-8c66c8f5bc2b'::uuid,'c5981337-242b-49e8-8c99-64ccf8fac13e'::uuid,
    250.00,'BYN','2026-08-03 07:15:16+00'::timestamptz,'2026-09-02 20:59:59+00'::timestamptz,
    'nika.1900735@mail.ru',false,'aug26-recurring-buh-819eb5b1',
    encode(sha256('aug26-recurring-buh-819eb5b1'::bytea),'hex'));
  RAISE NOTICE 'REPLAY1: % REPLAY2: %', r1::text, r2::text;
END $$;