DO $$
DECLARE r jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.payments_v2 WHERE id='819eb5b1-87ed-4656-8382-5f7fd5d6ed2c' AND order_id IS NULL AND status='succeeded' AND coalesce(is_deleted,false)=false)
     AND NOT EXISTS (SELECT 1 FROM public.admin_deal_reservations WHERE source_row_id='819eb5b1-87ed-4656-8382-5f7fd5d6ed2c')
     AND NOT EXISTS (SELECT 1 FROM public.orders_v2 WHERE user_id='341e6f46-79dd-4920-b500-da78e3574aab' AND product_id='85046734-2282-4ded-b0d3-8c66c8f5bc2b' AND created_at>='2026-08-01' AND created_at<'2026-09-01')
  THEN
    r := public.admin_create_deal_from_payment(
      '819eb5b1-87ed-4656-8382-5f7fd5d6ed2c'::uuid,
      'payments_v2',
      '05cd3754-d589-4d90-97d1-89ba2bee610b'::uuid,
      '4e8834a5-0f6a-44d6-b05a-8d7ec3b4d6e9'::uuid,
      '85046734-2282-4ded-b0d3-8c66c8f5bc2b'::uuid,
      'c5981337-242b-49e8-8c99-64ccf8fac13e'::uuid,
      250.00,
      'BYN',
      '2026-08-03 07:15:16+00'::timestamptz,
      '2026-09-02 20:59:59+00'::timestamptz,
      'nika.1900735@mail.ru',
      false,
      'aug26-recurring-buh-819eb5b1',
      encode(sha256('aug26-recurring-buh-819eb5b1'::bytea),'hex')
    );
    RAISE NOTICE 'RESULT: %', r::text;
  ELSE
    RAISE NOTICE 'RESULT: skipped_precondition';
  END IF;
END $$;