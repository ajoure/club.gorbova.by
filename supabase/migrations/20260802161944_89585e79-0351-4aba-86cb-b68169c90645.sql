DO $$
DECLARE
  v_n1 int;
  v_n2 int;
  v_a  int;
  v_ids uuid[] := ARRAY[
    '01d295ff-eeec-4559-87d2-edb0748cf538','19d9196c-80d0-43ba-9a37-140eb21a661f',
    '1c53bd85-5248-4951-b5f4-3027380a11fa','3bb3bd40-04bb-48e9-9796-514cae79399f',
    '67c4cbd6-b752-4c5b-a636-9585bb83b4cc','6e6340f7-deaf-4eec-9db5-584f40dd0edc',
    '99548b24-87cc-4b67-9597-3b07cdc71f41','9b03eb99-358e-4ba8-810c-9b2a18a66225',
    'b56006c5-0a8e-40fc-acd3-c138713ceb13','b8219853-1519-42a5-b700-da1e58d2242b',
    'd08a43e3-8526-466f-90ed-8da8ff1e0c2c','d27b54eb-8096-484b-872b-36a8c7c086f9',
    'd3099bd2-89c7-47be-977b-3e0e770b628b','d6807c3b-a5a4-4568-98ca-2155f1b12746',
    'dd7089fc-0dda-47e9-b89d-06d3f0bc7249','efba8a3d-7e8d-4af3-a068-e092e6c7bfeb',
    'ff0b8f3c-bc32-4218-9016-79eb9649a91f'
  ]::uuid[];
BEGIN
  -- N1
  WITH upd AS (
    UPDATE public.subscriptions_v2 s
       SET auto_renew = false,
           auto_renew_disabled_by = 'system',
           auto_renew_disabled_at = now(),
           meta = coalesce(s.meta,'{}'::jsonb) || jsonb_build_object(
             'autorenew_noise_reconciled', jsonb_build_object(
               'batch','audit-2026-08-02:pd-noise',
               'reason','past_due without card/token/live provider link/next_charge; auto_renew not actionable',
               'at', now(),
               'before', jsonb_build_object('auto_renew', true, 'auto_renew_disabled_by', s.auto_renew_disabled_by, 'auto_renew_disabled_at', s.auto_renew_disabled_at)
             ))
     WHERE s.id = ANY(v_ids)
       AND s.status = 'past_due'
       AND s.auto_renew = true
       AND s.payment_method_id IS NULL
       AND s.payment_token IS NULL
       AND s.next_charge_at IS NULL
       AND (s.access_end_at IS NULL OR s.access_end_at <= now())
       AND s.charge_attempts = 0
       AND NOT (coalesce(s.meta,'{}'::jsonb) ? 'last_charge_attempt_at')
       AND NOT EXISTS (SELECT 1 FROM public.provider_subscriptions ps
                        WHERE ps.subscription_v2_id = s.id AND ps.state IN ('active','pending'))
       AND NOT EXISTS (SELECT 1 FROM public.payments_v2 pv
                        WHERE pv.order_id = s.order_id AND pv.status = 'succeeded'
                          AND pv.created_at > now() - interval '60 days')
     RETURNING s.id, s.user_id
  ), aud AS (
    INSERT INTO public.audit_logs (actor_type, actor_label, action, entity_type, entity_id, target_user_id, meta)
    SELECT 'system','residual-audit-2026-08-02','subscription.autorenew_noise_reconciled','subscription', upd.id::text, upd.user_id,
           jsonb_build_object(
             'key', 'audit-2026-08-02:pd-noise:'||upd.id::text,
             'part','N1',
             'before', jsonb_build_object('auto_renew', true, 'next_charge_at', null),
             'after',  jsonb_build_object('auto_renew', false, 'next_charge_at', null),
             'rollback', 'UPDATE public.subscriptions_v2 SET auto_renew=true, auto_renew_disabled_by=NULL, auto_renew_disabled_at=NULL, meta = meta - ''autorenew_noise_reconciled'' WHERE id='''||upd.id::text||'''::uuid;'
           )
    FROM upd RETURNING 1
  )
  SELECT (SELECT count(*) FROM upd), (SELECT count(*) FROM aud) INTO v_n1, v_a;

  IF v_n1 <> 17 OR v_a <> 17 THEN
    RAISE EXCEPTION 'N1 mismatch: updated=% audited=% (expected 17/17)', v_n1, v_a;
  END IF;

  -- N2
  WITH upd2 AS (
    UPDATE public.subscriptions_v2 s
       SET next_charge_at = NULL,
           meta = coalesce(s.meta,'{}'::jsonb) || jsonb_build_object(
             'autorenew_noise_reconciled', jsonb_build_object(
               'batch','audit-2026-08-02:pd-noise',
               'reason','stale next_charge_at on past_due without auto_renew/card/live link',
               'at', now(),
               'before', jsonb_build_object('next_charge_at', s.next_charge_at)
             ))
     WHERE s.id = 'ce57fef3-5e1c-4acc-b815-c0593f14bd50'::uuid
       AND s.status = 'past_due'
       AND s.auto_renew = false
       AND s.payment_method_id IS NULL
       AND s.payment_token IS NULL
       AND s.next_charge_at = '2026-06-27 14:40:10+00'::timestamptz
       AND s.charge_attempts = 0
       AND NOT (coalesce(s.meta,'{}'::jsonb) ? 'last_charge_attempt_at')
       AND NOT EXISTS (SELECT 1 FROM public.provider_subscriptions ps
                        WHERE ps.subscription_v2_id = s.id AND ps.state IN ('active','pending'))
       AND NOT EXISTS (SELECT 1 FROM public.payments_v2 pv
                        WHERE pv.order_id = s.order_id AND pv.status = 'succeeded'
                          AND pv.created_at > now() - interval '60 days')
     RETURNING s.id, s.user_id
  ), aud2 AS (
    INSERT INTO public.audit_logs (actor_type, actor_label, action, entity_type, entity_id, target_user_id, meta)
    SELECT 'system','residual-audit-2026-08-02','subscription.autorenew_noise_reconciled','subscription', upd2.id::text, upd2.user_id,
           jsonb_build_object(
             'key','audit-2026-08-02:pd-noise:'||upd2.id::text,
             'part','N2',
             'before', jsonb_build_object('next_charge_at','2026-06-27T14:40:10+00:00'),
             'after',  jsonb_build_object('next_charge_at', null),
             'rollback','UPDATE public.subscriptions_v2 SET next_charge_at=''2026-06-27 14:40:10+00''::timestamptz, meta = meta - ''autorenew_noise_reconciled'' WHERE id=''ce57fef3-5e1c-4acc-b815-c0593f14bd50''::uuid;'
           )
    FROM upd2 RETURNING 1
  )
  SELECT (SELECT count(*) FROM upd2), (SELECT count(*) FROM aud2) INTO v_n2, v_a;

  IF v_n2 <> 1 OR v_a <> 1 THEN
    RAISE EXCEPTION 'N2 mismatch: updated=% audited=% (expected 1/1)', v_n2, v_a;
  END IF;

  -- invariants
  IF (SELECT count(*) FROM public.subscriptions_v2 WHERE status='past_due') <> 68 THEN
    RAISE EXCEPTION 'past_due total changed';
  END IF;
  IF (SELECT count(*) FROM public.subscriptions_v2 WHERE status='past_due' AND (auto_renew OR next_charge_at IS NOT NULL)) <> 1 THEN
    RAISE EXCEPTION 'chargeable predicate <> 1';
  END IF;

  RAISE NOTICE 'N1=% N2=% OK', v_n1, v_n2;
END $$;