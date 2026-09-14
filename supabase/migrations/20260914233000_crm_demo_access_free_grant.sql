-- Historic trial_no_card orders use status=paid solely to represent an opened
-- access period. They are not financial settlements. Mark the reviewed cohort
-- explicitly so every CRM surface shows "Бесплатно" and contact cards omit it
-- from the money-only deal list. The exact count is a deliberate drift gate.
DO $$
DECLARE
  candidate_count integer;
  updated_count integer;
BEGIN
  SELECT count(*) INTO candidate_count
  FROM public.orders_v2 o
  WHERE NOT coalesce(o.is_deleted, false)
    AND o.pipeline_stage_id = '40325a3a-dd31-414d-a381-df6cedec67c8'::uuid
    AND o.status = 'paid'
    AND coalesce(o.paid_amount, 0) = 0
    AND coalesce(o.final_price, 0) = 0
    AND o.provider IS NULL
    AND o.provider_payment_id IS NULL
    AND o.bepaid_subscription_id IS NULL
    AND o.reconcile_source IS NULL
    AND coalesce(o.meta->>'source', '') = 'trial_no_card'
    AND coalesce(o.meta->>'auto_charge_after_trial', 'false') <> 'true'
    AND coalesce(o.meta->>'requires_card_tokenization', 'false') <> 'true'
    AND NOT (coalesce(o.meta, '{}'::jsonb) ? 'financial_kind')
    AND NOT EXISTS (SELECT 1 FROM public.payments_v2 p WHERE p.order_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM public.subscriptions_v2 s WHERE s.order_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM public.provider_subscriptions ps WHERE ps.order_id = o.id);

  IF candidate_count <> 20 THEN
    RAISE EXCEPTION 'crm_demo_free_grant_count_drift:%', candidate_count;
  END IF;

  UPDATE public.orders_v2 o
  SET meta = coalesce(o.meta, '{}'::jsonb) || jsonb_build_object(
    'financial_kind', 'free_grant',
    'financial_kind_reason', 'trial_no_card_no_payment'
  )
  WHERE NOT coalesce(o.is_deleted, false)
    AND o.pipeline_stage_id = '40325a3a-dd31-414d-a381-df6cedec67c8'::uuid
    AND o.status = 'paid'
    AND coalesce(o.paid_amount, 0) = 0
    AND coalesce(o.final_price, 0) = 0
    AND o.provider IS NULL
    AND o.provider_payment_id IS NULL
    AND o.bepaid_subscription_id IS NULL
    AND o.reconcile_source IS NULL
    AND coalesce(o.meta->>'source', '') = 'trial_no_card'
    AND coalesce(o.meta->>'auto_charge_after_trial', 'false') <> 'true'
    AND coalesce(o.meta->>'requires_card_tokenization', 'false') <> 'true'
    AND NOT (coalesce(o.meta, '{}'::jsonb) ? 'financial_kind')
    AND NOT EXISTS (SELECT 1 FROM public.payments_v2 p WHERE p.order_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM public.subscriptions_v2 s WHERE s.order_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM public.provider_subscriptions ps WHERE ps.order_id = o.id);
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count <> 20 THEN
    RAISE EXCEPTION 'crm_demo_free_grant_update_drift:%', updated_count;
  END IF;

  INSERT INTO public.audit_logs(actor_type, action, entity_type, entity_id, meta)
  SELECT 'system', 'crm.deal.free_grant_classified', 'orders_v2', o.id,
    jsonb_build_object('source', 'trial_no_card', 'financial_kind', 'free_grant')
  FROM public.orders_v2 o
  WHERE NOT coalesce(o.is_deleted, false)
    AND o.pipeline_stage_id = '40325a3a-dd31-414d-a381-df6cedec67c8'::uuid
    AND o.meta->>'financial_kind_reason' = 'trial_no_card_no_payment';
END;
$$;
