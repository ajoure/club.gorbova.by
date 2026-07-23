CREATE TABLE public.composable_refund_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_group_id uuid NOT NULL REFERENCES public.order_groups(id) ON DELETE CASCADE,
  order_group_item_id uuid NOT NULL REFERENCES public.order_group_items(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.payments_v2(id) ON DELETE RESTRICT,
  primary_order_id uuid NOT NULL REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  access_action text NOT NULL DEFAULT 'keep'
    CHECK (access_action IN ('revoke','reduce','keep','keep_subscription')),
  reduce_days integer,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','provider_confirmed','allocated','failed','cancelled')),
  request_key text NOT NULL UNIQUE,
  provider_refund_id text UNIQUE,
  refund_payment_id uuid REFERENCES public.payments_v2(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX composable_refund_intents_group_idx
  ON public.composable_refund_intents(order_group_id, created_at DESC);
CREATE INDEX composable_refund_intents_item_idx
  ON public.composable_refund_intents(order_group_item_id, created_at DESC);

ALTER TABLE public.composable_refund_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY composable_refund_intents_staff_select
  ON public.composable_refund_intents FOR SELECT TO authenticated
  USING (
    public.has_role_v2((SELECT auth.uid()), 'manager')
    OR public.has_role_v2((SELECT auth.uid()), 'menedzher')
    OR public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );
GRANT SELECT ON public.composable_refund_intents TO authenticated;
REVOKE ALL ON public.composable_refund_intents FROM anon;

CREATE OR REPLACE FUNCTION public.create_composable_refund_intent(
  _primary_order_id uuid,
  _order_group_item_id uuid,
  _amount numeric,
  _reason text,
  _access_action text,
  _reduce_days integer,
  _request_key text,
  _created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_group public.order_groups%ROWTYPE;
  v_item public.order_group_items%ROWTYPE;
  v_allocation public.payment_allocations%ROWTYPE;
  v_intent public.composable_refund_intents%ROWTYPE;
  v_reserved numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(_request_key,''), 91));
  IF _amount <= 0 OR length(trim(coalesce(_reason,''))) = 0 THEN
    RAISE EXCEPTION 'invalid_refund_request';
  END IF;
  IF _access_action NOT IN ('revoke','reduce','keep','keep_subscription') THEN
    RAISE EXCEPTION 'invalid_access_action';
  END IF;
  IF _access_action = 'reduce' AND coalesce(_reduce_days,0) <= 0 THEN
    RAISE EXCEPTION 'reduce_days_required';
  END IF;
  SELECT * INTO v_intent FROM public.composable_refund_intents
  WHERE request_key = _request_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'intent_id', v_intent.id, 'payment_id', v_intent.payment_id,
      'amount', v_intent.amount, 'currency', v_intent.currency,
      'idempotent', true, 'status', v_intent.status,
      'provider_refund_id', v_intent.provider_refund_id
    );
  END IF;

  SELECT * INTO v_group FROM public.order_groups
  WHERE primary_order_id = _primary_order_id FOR UPDATE;
  IF NOT FOUND OR v_group.status NOT IN ('paid','partially_refunded') THEN
    RAISE EXCEPTION 'refundable_order_group_not_found';
  END IF;
  SELECT * INTO v_item FROM public.order_group_items
  WHERE id = _order_group_item_id AND order_group_id = v_group.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_group_item_not_found'; END IF;
  SELECT * INTO v_allocation FROM public.payment_allocations
  WHERE order_group_item_id = v_item.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_allocation_not_found'; END IF;

  SELECT coalesce(sum(amount),0) INTO v_reserved
  FROM public.composable_refund_intents
  WHERE order_group_item_id = v_item.id
    AND status IN ('requested','provider_confirmed');
  IF v_allocation.refunded_amount + v_reserved + _amount > v_allocation.amount THEN
    RAISE EXCEPTION 'refund_exceeds_item_balance';
  END IF;

  INSERT INTO public.composable_refund_intents(
    order_group_id, order_group_item_id, payment_id, primary_order_id,
    amount, currency, reason, access_action, reduce_days, request_key, created_by
  ) VALUES (
    v_group.id, v_item.id, v_allocation.payment_id, _primary_order_id,
    round(_amount,2), v_group.currency, trim(_reason), _access_action,
    _reduce_days, _request_key, _created_by
  )
  ON CONFLICT (request_key) DO UPDATE SET request_key = EXCLUDED.request_key
  RETURNING * INTO v_intent;

  RETURN jsonb_build_object(
    'ok', true, 'intent_id', v_intent.id, 'payment_id', v_intent.payment_id,
    'item_order_id', v_item.order_id, 'amount', v_intent.amount,
    'currency', v_intent.currency
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bind_composable_refund_provider_id(
  _intent_id uuid,
  _provider_refund_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_intent public.composable_refund_intents%ROWTYPE;
BEGIN
  UPDATE public.composable_refund_intents
  SET provider_refund_id = _provider_refund_id,
      status = 'provider_confirmed', updated_at = now()
  WHERE id = _intent_id AND status IN ('requested','provider_confirmed')
  RETURNING * INTO v_intent;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_intent_not_bindable'; END IF;
  RETURN jsonb_build_object('ok', true, 'intent_id', v_intent.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_composable_refund_allocation(
  _provider_refund_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent public.composable_refund_intents%ROWTYPE;
  v_refund public.payments_v2%ROWTYPE;
  v_allocation public.payment_allocations%ROWTYPE;
  v_total_refunded numeric;
  v_total_amount numeric;
  v_item_order_id uuid;
BEGIN
  SELECT * INTO v_intent FROM public.composable_refund_intents
  WHERE provider_refund_id = _provider_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'state', 'no_intent');
  END IF;
  IF v_intent.status = 'allocated' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'already_allocated');
  END IF;

  SELECT * INTO v_refund FROM public.payments_v2
  WHERE provider_payment_id = _provider_refund_id
    AND transaction_type = 'refund'
    AND status::text IN ('succeeded','refunded')
    AND (
      reference_payment_id = v_intent.payment_id
      OR meta->>'parent_payment_id' = v_intent.payment_id::text
    )
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR abs(v_refund.amount) IS DISTINCT FROM v_intent.amount THEN
    RAISE EXCEPTION 'canonical_refund_payment_not_confirmed';
  END IF;

  SELECT * INTO v_allocation FROM public.payment_allocations
  WHERE payment_id = v_intent.payment_id
    AND order_group_item_id = v_intent.order_group_item_id FOR UPDATE;
  IF NOT FOUND OR v_allocation.refunded_amount + v_intent.amount > v_allocation.amount THEN
    RAISE EXCEPTION 'refund_allocation_overflow';
  END IF;

  UPDATE public.payment_allocations
  SET refunded_amount = refunded_amount + v_intent.amount, updated_at = now()
  WHERE id = v_allocation.id;
  UPDATE public.composable_refund_intents
  SET status = 'allocated', refund_payment_id = v_refund.id, updated_at = now()
  WHERE id = v_intent.id;

  SELECT sum(refunded_amount), sum(amount)
  INTO v_total_refunded, v_total_amount
  FROM public.payment_allocations WHERE order_group_id = v_intent.order_group_id;
  UPDATE public.order_groups
  SET status = CASE
      WHEN v_total_refunded >= v_total_amount THEN 'refunded'
      ELSE 'partially_refunded'
    END,
    updated_at = now()
  WHERE id = v_intent.order_group_id;

  SELECT order_id INTO v_item_order_id FROM public.order_group_items
  WHERE id = v_intent.order_group_item_id;
  UPDATE public.orders_v2
  SET status = CASE
      WHEN v_allocation.refunded_amount + v_intent.amount >= v_allocation.amount
        THEN 'refunded'::order_status
      ELSE status
    END,
    meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object(
      'composable_refunded_amount', v_allocation.refunded_amount + v_intent.amount
    )
  WHERE id = v_item_order_id;

  RETURN jsonb_build_object(
    'ok', true, 'state', 'allocated', 'intent_id', v_intent.id,
    'group_status', CASE WHEN v_total_refunded >= v_total_amount
      THEN 'refunded' ELSE 'partially_refunded' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_composable_refund_intent(
  _intent_id uuid,
  _error text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE public.composable_refund_intents
  SET status = 'failed',
      meta = meta || jsonb_build_object('provider_error', _error),
      updated_at = now()
  WHERE id = _intent_id AND status = 'requested'
$$;

REVOKE ALL ON FUNCTION public.create_composable_refund_intent(
  uuid,uuid,numeric,text,text,integer,text,uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bind_composable_refund_provider_id(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_composable_refund_allocation(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_composable_refund_intent(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_composable_refund_intent(
  uuid,uuid,numeric,text,text,integer,text,uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_composable_refund_provider_id(uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_composable_refund_allocation(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_composable_refund_intent(uuid,text)
  TO service_role;
