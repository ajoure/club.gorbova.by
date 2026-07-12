
-- Sprint C2 / Этап C: runtime bridge между paid RR-заказом и entitlement_sources.
-- Идемпотентно вставляет source (source_type='order', source_ref=order_id) и
-- вызывает recalculate_entitlement_aggregate. Никаких UPDATE существующих источников.
CREATE OR REPLACE FUNCTION public.rr_upsert_entitlement_source_from_order(
  _order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order      public.orders_v2%ROWTYPE;
  v_days       integer;
  v_starts_at  timestamptz;
  v_expires_at timestamptz;
  v_inserted   boolean := false;
  v_src_id     uuid;
  v_recalc     jsonb;
BEGIN
  IF _order_id IS NULL THEN
    RAISE EXCEPTION 'rr_upsert_entitlement_source_from_order: order_id required';
  END IF;

  SELECT * INTO v_order FROM public.orders_v2 WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','order_not_found','order_id',_order_id);
  END IF;

  IF v_order.status <> 'paid'::order_status THEN
    RETURN jsonb_build_object('status','order_not_paid','order_id',_order_id,
                              'order_status', v_order.status::text);
  END IF;

  IF v_order.user_id IS NULL OR v_order.product_id IS NULL OR v_order.tariff_id IS NULL THEN
    RETURN jsonb_build_object('status','missing_owner_or_product',
                              'user_id', v_order.user_id,
                              'product_id', v_order.product_id,
                              'tariff_id', v_order.tariff_id);
  END IF;

  SELECT t.access_days INTO v_days FROM public.tariffs t WHERE t.id = v_order.tariff_id;
  IF v_days IS NULL OR v_days <= 0 THEN
    RETURN jsonb_build_object('status','tariff_access_days_missing','tariff_id',v_order.tariff_id);
  END IF;

  -- paid_at: приоритет meta.paid_at → updated_at (момент перевода в paid) → created_at.
  v_starts_at := COALESCE(
    NULLIF(v_order.meta->>'paid_at','')::timestamptz,
    v_order.updated_at,
    v_order.created_at
  );
  v_expires_at := v_starts_at + make_interval(days => v_days);

  INSERT INTO public.entitlement_sources
    (source_type, source_ref, user_id, profile_id, product_id, tariff_id, order_id,
     starts_at, expires_at, status, meta)
  VALUES
    ('order', _order_id::text, v_order.user_id, v_order.profile_id,
     v_order.product_id, v_order.tariff_id, _order_id,
     v_starts_at, v_expires_at, 'active',
     jsonb_build_object(
       'origin', 'rr_upsert_entitlement_source_from_order',
       'created_from_order_at', now(),
       'tariff_access_days', v_days
     ))
  ON CONFLICT (source_type, source_ref) DO NOTHING
  RETURNING id INTO v_src_id;

  v_inserted := v_src_id IS NOT NULL;
  IF NOT v_inserted THEN
    SELECT id INTO v_src_id FROM public.entitlement_sources
      WHERE source_type='order' AND source_ref = _order_id::text;
  END IF;

  v_recalc := public.recalculate_entitlement_aggregate(v_order.user_id, v_order.product_id);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted THEN 'inserted' ELSE 'exists' END,
    'source_id', v_src_id,
    'order_id', _order_id,
    'user_id', v_order.user_id,
    'product_id', v_order.product_id,
    'tariff_id', v_order.tariff_id,
    'starts_at', v_starts_at,
    'expires_at', v_expires_at,
    'recalc', v_recalc
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rr_upsert_entitlement_source_from_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_upsert_entitlement_source_from_order(uuid) TO service_role;
