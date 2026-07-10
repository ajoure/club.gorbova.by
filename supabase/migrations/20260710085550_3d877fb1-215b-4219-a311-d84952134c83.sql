CREATE OR REPLACE FUNCTION public.rr_get_or_create_pending_order(
  _offer_id uuid,
  _user_id uuid,
  _email_norm text,
  _phone_norm text,
  _product_id uuid,
  _tariff_id uuid,
  _amount numeric,
  _currency text,
  _customer_email text,
  _customer_phone text,
  _customer_ip text,
  _meta jsonb
)
RETURNS TABLE(order_id uuid, was_reused boolean, order_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.orders_v2%ROWTYPE;
  v_lock_key bigint;
  v_order_number text;
BEGIN
  v_lock_key := hashtextextended(
    coalesce(_offer_id::text,'') || '|' ||
    coalesce(_user_id::text,'') || '|' ||
    coalesce(_email_norm,'') || '|' ||
    coalesce(_phone_norm,''),
    42
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Reuse либо готовый (created + payment_url), либо ещё инициализирующийся
  -- (pending, <120 сек), чтобы параллельные запросы не создавали дубликаты.
  SELECT * INTO v_row
    FROM public.orders_v2 o
   WHERE o.offer_id = _offer_id
     AND o.status = 'pending'::order_status
     AND o.provider = 'rr'
     AND (o.meta->>'flow') = 'rr_installment'
     AND o.created_at >= now() - interval '30 minutes'
     AND (o.user_id IS NOT DISTINCT FROM _user_id)
     AND (
       _email_norm IS NULL OR lower(trim(coalesce(o.customer_email,''))) = _email_norm
     )
     AND (
       _phone_norm IS NULL OR regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') = _phone_norm
     )
     AND (
       (o.meta->'rr'->>'initiation_status') = 'created'
       AND coalesce(o.meta->'rr'->>'payment_url','') <> ''
     OR
       (o.meta->'rr'->>'initiation_status') = 'pending'
       AND o.created_at >= now() - interval '120 seconds'
     )
   ORDER BY
     -- prefer already-created (has payment_url) over in-flight pending
     CASE WHEN (o.meta->'rr'->>'initiation_status') = 'created' THEN 0 ELSE 1 END,
     o.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    order_id := v_row.id;
    was_reused := true;
    order_number := v_row.order_number;
    RETURN NEXT;
    RETURN;
  END IF;

  v_order_number := public.generate_order_number();
  INSERT INTO public.orders_v2(
    order_number, product_id, tariff_id, offer_id,
    base_price, final_price, currency,
    status, provider, customer_email, customer_phone, customer_ip,
    user_id, meta
  ) VALUES (
    v_order_number, _product_id, _tariff_id, _offer_id,
    _amount, _amount, _currency,
    'pending'::order_status,
    'rr', _customer_email, _customer_phone, _customer_ip,
    _user_id, _meta
  )
  RETURNING * INTO v_row;

  order_id := v_row.id;
  was_reused := false;
  order_number := v_row.order_number;
  RETURN NEXT;
END;
$function$;