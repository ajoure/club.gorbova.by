CREATE OR REPLACE FUNCTION public.admin_create_deal_from_payment(
  p_payment_id       uuid,
  p_raw_source       text,
  p_actor_user_id    uuid,
  p_profile_id       uuid,
  p_product_id       uuid,
  p_tariff_id        uuid,
  p_offer_id         uuid,
  p_final_amount     numeric,
  p_final_currency   text,
  p_access_start     timestamptz,
  p_access_end       timestamptz,
  p_customer_email   text,
  p_grant_access     boolean,
  p_idempotency_key  text,
  p_request_hash     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer_tariff_id uuid;
  v_result jsonb;
  v_order_id uuid;
BEGIN
  IF p_offer_id IS NOT NULL THEN
    SELECT tariff_id INTO v_offer_tariff_id
      FROM public.tariff_offers
     WHERE id = p_offer_id
       AND coalesce(is_active, false) = true;

    IF NOT FOUND OR v_offer_tariff_id IS DISTINCT FROM p_tariff_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'offer_invalid');
    END IF;
  END IF;

  v_result := public.admin_create_deal_from_payment(
    p_payment_id,
    p_raw_source,
    p_actor_user_id,
    p_profile_id,
    p_product_id,
    p_tariff_id,
    p_final_amount,
    p_final_currency,
    p_access_start,
    p_access_end,
    p_customer_email,
    p_grant_access,
    p_idempotency_key,
    p_request_hash
  );

  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  v_order_id := nullif(v_result->>'order_id', '')::uuid;
  IF p_offer_id IS NOT NULL AND v_order_id IS NOT NULL THEN
    UPDATE public.orders_v2
       SET offer_id = p_offer_id,
           meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
             'offer_id', p_offer_id,
             'offer_snapshot_source', 'admin_payment_reconciliation'
           )
     WHERE id = v_order_id;
  END IF;

  RETURN v_result || jsonb_build_object('offer_id', p_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_deal_from_payment(
  uuid, text, uuid, uuid, uuid, uuid, uuid, numeric, text,
  timestamptz, timestamptz, text, boolean, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_create_deal_from_payment(
  uuid, text, uuid, uuid, uuid, uuid, uuid, numeric, text,
  timestamptz, timestamptz, text, boolean, text, text
) TO service_role;