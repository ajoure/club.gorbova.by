-- One reviewed batch from the 2026-10-26 audit. No customer IDs or credentials.
-- Only these complete row fingerprints are authorized; changed rows fail closed.
-- Runs through Lovable managed migrations, with existing service-only CAS RPCs.
SET lock_timeout = '3s';
SET statement_timeout = '15s';
DO $repair$
DECLARE
  expected_hashes CONSTANT text[] := ARRAY[
    '68823b5a14ac25647392d4400a06af57',
    'e0aa48518cd4fde4c7d03d56e2dcf997',
    '77eb5d62163faa9b318832584e7ed271',
    '18d90a296b03285e4b7a1936af454640',
    'cffbedbd14606ee91b21b7586a7cd17a',
    '76c0c2dd10acc2d8acf2263f1d0c6c4f',
    '6f2a607329eec9a5f01b8b0555f307f5',
    'a09ac951fce3102d8be81fc5d14aa520'
  ];
  candidate_ids uuid[];
  target_ids uuid[];
  target_users uuid[];
  plans jsonb;
  item jsonb;
  result jsonb;
  before_state jsonb;
  after_state jsonb;
  applied_count integer := 0;
  already_count integer := 0;
  verified_count integer;
BEGIN
  -- The cutoff bounds discovery, not entitlement dates. Preview owns eligibility.
  SELECT array_agg(DISTINCT o.id ORDER BY o.id) INTO candidate_ids
  FROM public.orders_v2 o JOIN public.payments_v2 p ON p.order_id=o.id
  WHERE NOT coalesce(o.is_deleted,false) AND o.status::text='paid'
    AND o.meta->>'payment_flow'='renewal_one_time'
    AND o.meta->>'deal_month'=to_char(o.created_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')
    AND o.meta->>'deal_month' IS DISTINCT FROM to_char(p.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')
    AND o.created_at>='2026-01-01T00:00:00Z'::timestamptz
    AND p.paid_at<='2026-10-26T10:00:00Z'::timestamptz
    AND p.provider='bepaid' AND p.amount>0 AND p.status::text='succeeded'
    AND NOT coalesce(p.is_deleted,false);
  IF coalesce(cardinality(candidate_ids),0)>20 THEN
    RAISE EXCEPTION 'reviewed_renewal_batch_discovery_limit';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.order_id),'[]'::jsonb) INTO plans
  FROM public.crm_preview_renewal_period(coalesce(candidate_ids,ARRAY[]::uuid[])) p
  WHERE p.eligible AND p.expected_hash=ANY(expected_hashes);

  -- A committed prior application is a no-op, including a safe partial resume.
  SELECT plans||coalesce(jsonb_agg(jsonb_build_object(
    'order_id',o.id,'expected_hash',o.meta#>>'{renewal_period_repair,expected_hash}',
    'already_applied',true) ORDER BY o.id),'[]'::jsonb) INTO plans
  FROM public.orders_v2 o JOIN public.payments_v2 p
    ON p.id::text=o.meta#>>'{renewal_period_repair,payment_id}' AND p.order_id=o.id
  WHERE o.meta#>>'{renewal_period_repair,expected_hash}'=ANY(expected_hashes)
    AND o.deal_date=p.paid_at
    AND o.meta->>'deal_month'=to_char(p.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM');

  IF jsonb_array_length(plans)<>8
    OR (SELECT count(DISTINCT x->>'expected_hash') FROM jsonb_array_elements(plans) x)<>8
    OR (SELECT count(DISTINCT x->>'order_id') FROM jsonb_array_elements(plans) x)<>8 THEN
    RAISE EXCEPTION 'reviewed_renewal_batch_fingerprint_changed';
  END IF;
  SELECT array_agg((x->>'order_id')::uuid ORDER BY (x->>'order_id')::uuid)
    INTO target_ids FROM jsonb_array_elements(plans) x;
  PERFORM 1 FROM public.orders_v2 WHERE id=ANY(target_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.payments_v2 WHERE order_id=ANY(target_ids) ORDER BY id FOR UPDATE;
  SELECT array_agg(DISTINCT user_id) INTO target_users
    FROM public.orders_v2 WHERE id=ANY(target_ids);

  -- Detect any unintended financial/access mutation, including trigger effects.
  SELECT jsonb_build_object(
    'orders',(SELECT jsonb_agg((to_jsonb(o)-'deal_date'-'updated_at'-'meta')||
      jsonb_build_object('meta',coalesce(o.meta,'{}'::jsonb)-'deal_month'-'renewal_period_repair') ORDER BY o.id)
      FROM public.orders_v2 o WHERE o.id=ANY(target_ids)),
    'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.payments_v2 p WHERE p.order_id=ANY(target_ids)),
    'subscriptions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.subscriptions_v2 s WHERE s.user_id=ANY(target_users)),
    'entitlements',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.entitlements e WHERE e.user_id=ANY(target_users))
  ) INTO before_state;

  FOR item IN SELECT x FROM jsonb_array_elements(plans) x ORDER BY x->>'order_id' LOOP
    SELECT public.crm_apply_renewal_period((item->>'order_id')::uuid,item->>'expected_hash') INTO result;
    IF result->>'updated'='true' THEN applied_count:=applied_count+1;
    ELSIF result->>'already_applied'='true' THEN already_count:=already_count+1;
    ELSE RAISE EXCEPTION 'reviewed_renewal_batch_invalid_result'; END IF;
  END LOOP;

  SELECT count(*) INTO verified_count FROM public.orders_v2 o
  JOIN public.payments_v2 p ON p.id::text=o.meta#>>'{renewal_period_repair,payment_id}' AND p.order_id=o.id
  WHERE o.id=ANY(target_ids)
    AND o.meta#>>'{renewal_period_repair,expected_hash}'=ANY(expected_hashes)
    AND o.deal_date=p.paid_at
    AND o.meta->>'deal_month'=to_char(p.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM');
  IF verified_count<>8 OR applied_count+already_count<>8 THEN
    RAISE EXCEPTION 'reviewed_renewal_batch_readback_failed';
  END IF;

  SELECT jsonb_build_object(
    'orders',(SELECT jsonb_agg((to_jsonb(o)-'deal_date'-'updated_at'-'meta')||
      jsonb_build_object('meta',coalesce(o.meta,'{}'::jsonb)-'deal_month'-'renewal_period_repair') ORDER BY o.id)
      FROM public.orders_v2 o WHERE o.id=ANY(target_ids)),
    'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.payments_v2 p WHERE p.order_id=ANY(target_ids)),
    'subscriptions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.subscriptions_v2 s WHERE s.user_id=ANY(target_users)),
    'entitlements',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.entitlements e WHERE e.user_id=ANY(target_users))
  ) INTO after_state;
  IF after_state IS DISTINCT FROM before_state THEN
    RAISE EXCEPTION 'reviewed_renewal_batch_unexpected_side_effect';
  END IF;
  RAISE NOTICE 'reviewed_renewal_batch: updated=%, already_applied=%, verified=%',applied_count,already_count,verified_count;
END;
$repair$;
RESET lock_timeout;
RESET statement_timeout;
