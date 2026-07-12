-- Sprint C2 / Stage E.1 v3 — atomic CRM routing persist on INSERT.
-- Extend rr_get_or_create_pending_order with three optional trailing params:
--   _crm_routing_snapshot jsonb, _pipeline_id uuid, _pipeline_stage_id uuid.
-- On new order INSERT: write pipeline_id + pipeline_stage_id columns AND embed
-- crm_routing_snapshot into meta atomically (single transactional INSERT).
-- On was_reused=true: params are IGNORED (existing snapshot/stage untouched).

DROP FUNCTION IF EXISTS public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb
);

CREATE OR REPLACE FUNCTION public.rr_get_or_create_pending_order(
  _offer_id uuid, _user_id uuid, _email_norm text, _phone_norm text,
  _product_id uuid, _tariff_id uuid, _amount numeric, _currency text,
  _customer_email text, _customer_phone text, _customer_ip text, _meta jsonb,
  _crm_routing_snapshot jsonb DEFAULT NULL,
  _pipeline_id uuid DEFAULT NULL,
  _pipeline_stage_id uuid DEFAULT NULL
) RETURNS TABLE(order_id uuid, was_reused boolean, order_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.orders_v2%ROWTYPE;
  v_lock_key bigint;
  v_order_number text;
  v_meta jsonb := COALESCE(_meta, '{}'::jsonb);
BEGIN
  v_lock_key := hashtextextended(
    coalesce(_offer_id::text,'')||'|'||coalesce(_user_id::text,'')||'|'||
    coalesce(_email_norm,'')||'|'||coalesce(_phone_norm,''), 42);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_row FROM public.orders_v2 o
   WHERE o.offer_id = _offer_id AND o.provider = 'rr'
     AND (o.meta->>'flow') = 'rr_installment'
     AND (o.user_id IS NOT DISTINCT FROM _user_id)
     AND (_email_norm IS NULL OR lower(trim(coalesce(o.customer_email,''))) = _email_norm)
     AND (_phone_norm IS NULL OR regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') = _phone_norm)
     AND (
       (o.status = 'pending'::order_status
        AND (o.meta->'rr'->>'upstream_call_state') = 'started'
        AND coalesce(o.meta->'rr'->>'initiation_status','pending') NOT IN ('created','failed'))
       OR (o.status = 'pending'::order_status AND (o.meta->'rr'->>'local_persist_failed') = 'true')
       OR (o.status = 'pending'::order_status AND (o.meta->'rr'->>'upstream_outcome') = 'unknown'
           AND coalesce(o.meta->'rr'->>'reconciliation_status','pending') IN ('pending','operator_required'))
       OR (o.status = 'pending'::order_status AND (o.meta->'rr'->>'reconciliation_status') = 'resolved'
           AND coalesce(o.meta->'rr'->>'operator_resolution','') IN ('keep_blocked','confirm_created'))
       OR (o.status = 'pending'::order_status AND o.created_at >= now() - interval '30 minutes'
           AND (((o.meta->'rr'->>'initiation_status') = 'created' AND coalesce(o.meta->'rr'->>'payment_url','') <> '')
             OR ((o.meta->'rr'->>'initiation_status') = 'pending'
                 AND o.created_at >= now() - interval '120 seconds'
                 AND (o.meta->'rr'->>'local_persist_failed') IS DISTINCT FROM 'true'
                 AND (o.meta->'rr'->>'upstream_outcome') IS DISTINCT FROM 'unknown'
                 AND (o.meta->'rr'->>'upstream_call_state') IS DISTINCT FROM 'started')))
     )
   ORDER BY
     CASE
       WHEN (o.meta->'rr'->>'upstream_call_state') = 'started'
            AND coalesce(o.meta->'rr'->>'initiation_status','pending') NOT IN ('created','failed') THEN 0
       WHEN (o.meta->'rr'->>'local_persist_failed') = 'true' THEN 1
       WHEN (o.meta->'rr'->>'upstream_outcome') = 'unknown' THEN 2
       WHEN (o.meta->'rr'->>'reconciliation_status') = 'resolved' THEN 3
       WHEN (o.meta->'rr'->>'initiation_status') = 'created' THEN 4
       ELSE 5
     END, o.created_at DESC LIMIT 1;

  IF FOUND THEN
    -- REUSE: ignore all three CRM params completely. Existing snapshot & pipeline untouched.
    order_id := v_row.id; was_reused := true; order_number := v_row.order_number;
    RETURN NEXT; RETURN;
  END IF;

  -- Явно фиксируем pre-call состояние.
  v_meta := jsonb_set(
    v_meta, '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object('upstream_call_state','not_started'),
    true
  );

  -- Sprint C2 / Stage E.1 v3 — atomic CRM snapshot embed on INSERT.
  -- If caller passed _crm_routing_snapshot explicitly, it wins over any value in _meta.
  IF _crm_routing_snapshot IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{crm_routing_snapshot}', _crm_routing_snapshot, true);
  END IF;

  v_order_number := public.generate_order_number();
  INSERT INTO public.orders_v2(order_number, product_id, tariff_id, offer_id,
    base_price, final_price, currency, status, provider,
    customer_email, customer_phone, customer_ip, user_id, meta,
    pipeline_id, pipeline_stage_id)
  VALUES (v_order_number, _product_id, _tariff_id, _offer_id, _amount, _amount, _currency,
    'pending'::order_status, 'rr', _customer_email, _customer_phone, _customer_ip, _user_id, v_meta,
    _pipeline_id, _pipeline_stage_id)
  RETURNING * INTO v_row;
  order_id := v_row.id; was_reused := false; order_number := v_row.order_number;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb, jsonb, uuid, uuid
) TO service_role;
