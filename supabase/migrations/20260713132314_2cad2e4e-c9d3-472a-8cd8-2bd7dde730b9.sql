CREATE OR REPLACE FUNCTION public._payment_delete_checksum(
  p_payment_ids uuid[], p_order_id uuid, p_version integer
) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_agg text;
BEGIN
  SELECT string_agg(
    p.id::text
    || ':' || p.is_deleted::text
    || ':' || coalesce(p.amount::text,'')
    || ':' || coalesce(upper(p.currency),'')
    || ':' || coalesce(p.status::text,'')
    || ':' || coalesce(lower(trim(p.provider)),'')
    || ':' || coalesce(p.transaction_type,'')
    || ':' || coalesce(p.reference_payment_id::text,'')
    || ':' || coalesce(p.order_id::text,'')
    || ':' || coalesce(p.profile_id::text,'')
    || ':' || coalesce(p.refunded_amount::text,''),
    '|' ORDER BY p.id
  )
  INTO v_agg
  FROM public.payments_v2 p
  WHERE p.id = ANY(p_payment_ids);
  RETURN md5(coalesce(v_agg,'') || '||' || coalesce(p_order_id::text,'') || '||v' || p_version::text);
END $$;

CREATE OR REPLACE FUNCTION public._payment_delete_graph_checksum(
  p_order_ids uuid[], p_selected_payment_ids uuid[]
) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_pay text; v_ord text; v_led text; v_sel text;
BEGIN
  SELECT string_agg(
    p.id::text
    || ':' || p.is_deleted::text
    || ':' || coalesce(p.amount::text,'')
    || ':' || coalesce(upper(p.currency),'')
    || ':' || coalesce(p.status::text,'')
    || ':' || coalesce(lower(trim(p.provider)),'')
    || ':' || coalesce(p.transaction_type,'')
    || ':' || coalesce(p.reference_payment_id::text,'')
    || ':' || coalesce(p.order_id::text,'')
    || ':' || coalesce(p.profile_id::text,'')
    || ':' || coalesce(p.refunded_amount::text,''),
    '|' ORDER BY p.id
  ) INTO v_pay
  FROM public.payments_v2 p
  WHERE p.order_id = ANY(p_order_ids) AND p.is_deleted = false;

  SELECT string_agg(
    o.id::text
    || ':' || coalesce(o.status::text,'')
    || ':' || coalesce(o.paid_amount::text,'')
    || ':' || coalesce(o.final_price::text,'')
    || ':' || coalesce(upper(o.currency),'')
    || ':' || o.is_deleted::text,
    '|' ORDER BY o.id
  ) INTO v_ord
  FROM public.orders_v2 o WHERE o.id = ANY(p_order_ids);

  SELECT string_agg(l.id::text || ':' || coalesce(l.status,'') || ':' || coalesce(l.action_type,''),
                    '|' ORDER BY l.id)
  INTO v_led
  FROM public.access_grant_ledger l WHERE l.order_id = ANY(p_order_ids);

  SELECT string_agg(x::text, ',' ORDER BY x) INTO v_sel
  FROM unnest(p_selected_payment_ids) x;

  RETURN md5(
    'PAY:' || coalesce(v_pay,'')
    || '||ORD:' || coalesce(v_ord,'')
    || '||LED:' || coalesce(v_led,'')
    || '||SEL:' || coalesce(v_sel,'')
  );
END $$;