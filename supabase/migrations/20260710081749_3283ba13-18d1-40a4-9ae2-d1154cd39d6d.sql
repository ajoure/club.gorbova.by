
CREATE TABLE IF NOT EXISTS public.rr_public_rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.rr_public_rate_limits FROM PUBLIC;
REVOKE ALL ON public.rr_public_rate_limits FROM anon;
REVOKE ALL ON public.rr_public_rate_limits FROM authenticated;
GRANT ALL ON public.rr_public_rate_limits TO service_role;
ALTER TABLE public.rr_public_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rr_public_rate_limits_updated
  ON public.rr_public_rate_limits (updated_at);

CREATE OR REPLACE FUNCTION public.rr_public_rate_limit_hit(
  _key text,
  _window_seconds integer,
  _max integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.rr_public_rate_limits%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  DELETE FROM public.rr_public_rate_limits
   WHERE ctid IN (
     SELECT ctid FROM public.rr_public_rate_limits
      WHERE updated_at < v_now - interval '1 day'
      LIMIT 100
   );

  INSERT INTO public.rr_public_rate_limits (bucket_key, window_started_at, count, updated_at)
  VALUES (_key, v_now, 1, v_now)
  ON CONFLICT (bucket_key) DO UPDATE
    SET count = CASE
                  WHEN public.rr_public_rate_limits.window_started_at
                       < EXCLUDED.window_started_at - make_interval(secs => _window_seconds)
                  THEN 1
                  ELSE public.rr_public_rate_limits.count + 1
                END,
        window_started_at = CASE
                  WHEN public.rr_public_rate_limits.window_started_at
                       < EXCLUDED.window_started_at - make_interval(secs => _window_seconds)
                  THEN EXCLUDED.window_started_at
                  ELSE public.rr_public_rate_limits.window_started_at
                END,
        updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_row;

  RETURN v_row.count <= _max;
END;
$$;

REVOKE ALL ON FUNCTION public.rr_public_rate_limit_hit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_public_rate_limit_hit(text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.rr_public_rate_limit_hit(text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rr_public_rate_limit_hit(text, integer, integer) TO service_role;

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
) RETURNS TABLE(order_id uuid, was_reused boolean, order_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  SELECT * INTO v_row
    FROM public.orders_v2 o
   WHERE o.offer_id = _offer_id
     AND o.status = 'pending'::order_status
     AND o.provider = 'rr'
     AND (o.meta->>'flow') = 'rr_installment'
     AND (o.meta->'rr'->>'initiation_status') = 'created'
     AND coalesce(o.meta->'rr'->>'payment_url','') <> ''
     AND o.created_at >= now() - interval '30 minutes'
     AND (o.user_id IS NOT DISTINCT FROM _user_id)
     AND (
       _email_norm IS NULL OR lower(trim(coalesce(o.customer_email,''))) = _email_norm
     )
     AND (
       _phone_norm IS NULL OR regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') = _phone_norm
     )
   ORDER BY o.created_at DESC
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
    'pending'::order_status, 'rr', _customer_email, _customer_phone, _customer_ip,
    _user_id, _meta
  )
  RETURNING * INTO v_row;

  order_id := v_row.id;
  was_reused := false;
  order_number := v_row.order_number;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb
) FROM anon;
REVOKE ALL ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb
) TO service_role;
