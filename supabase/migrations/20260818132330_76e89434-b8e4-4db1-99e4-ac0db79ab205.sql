DO $$
DECLARE r jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.payments_v2 WHERE id='29112f79-34f8-4d09-ae1b-387d74f2f8cb' AND order_id IS NULL AND status='succeeded' AND coalesce(is_deleted,false)=false)
     AND NOT EXISTS (SELECT 1 FROM public.admin_deal_reservations WHERE source_row_id='29112f79-34f8-4d09-ae1b-387d74f2f8cb')
     AND NOT EXISTS (SELECT 1 FROM public.orders_v2 WHERE user_id='2c8ffa9e-6d40-4dc8-b5aa-30a8fc7afec1' AND product_id='85046734-2282-4ded-b0d3-8c66c8f5bc2b' AND created_at>='2026-08-01' AND created_at<'2026-09-01')
  THEN
    r := public.admin_create_deal_from_payment(
      '29112f79-34f8-4d09-ae1b-387d74f2f8cb'::uuid,
      'payments_v2',
      '05cd3754-d589-4d90-97d1-89ba2bee610b'::uuid,
      '37c0660f-c9bc-4dd0-9913-71b4fab686cb'::uuid,
      '85046734-2282-4ded-b0d3-8c66c8f5bc2b'::uuid,
      'c5981337-242b-49e8-8c99-64ccf8fac13e'::uuid,
      250.00,
      'BYN',
      '2026-08-02 13:45:27+00'::timestamptz,
      '2026-09-01 20:59:59+00'::timestamptz,
      'volodik_84@mail.ru',
      false,
      'aug26-recurring-buh-29112f79',
      encode(sha256('aug26-recurring-buh-29112f79'::bytea),'hex')
    );
    RAISE NOTICE 'RESULT: %', r::text;
  ELSE
    RAISE NOTICE 'RESULT: skipped_precondition';
  END IF;
END $$;