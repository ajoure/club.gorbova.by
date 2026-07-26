-- Composable checkout foundation.
-- Products remain independently sellable. Eligibility and pricing are configured
-- per parent tariff offer, while completed purchases keep an immutable item snapshot.

CREATE TABLE public.offer_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_offer_id uuid NOT NULL REFERENCES public.tariff_offers(id) ON DELETE CASCADE,
  addon_product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE RESTRICT,
  addon_tariff_id uuid NOT NULL REFERENCES public.tariffs(id) ON DELETE RESTRICT,
  addon_offer_id uuid NOT NULL REFERENCES public.tariff_offers(id) ON DELETE RESTRICT,
  pricing_mode text NOT NULL DEFAULT 'offer_price'
    CHECK (pricing_mode IN ('offer_price', 'fixed_price', 'percent_discount', 'free')),
  fixed_amount numeric(12,2),
  discount_percent numeric(5,2),
  is_required boolean NOT NULL DEFAULT false,
  is_default_selected boolean NOT NULL DEFAULT false,
  allow_repurchase_after_expiry boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  visible_from timestamptz,
  visible_to timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_addons_unique_offer UNIQUE (parent_offer_id, addon_offer_id),
  CONSTRAINT offer_addons_fixed_amount_valid CHECK (
    (pricing_mode = 'fixed_price' AND fixed_amount IS NOT NULL AND fixed_amount >= 0)
    OR (pricing_mode <> 'fixed_price' AND fixed_amount IS NULL)
  ),
  CONSTRAINT offer_addons_discount_valid CHECK (
    (pricing_mode = 'percent_discount' AND discount_percent BETWEEN 0 AND 100)
    OR (pricing_mode <> 'percent_discount' AND discount_percent IS NULL)
  )
);

CREATE INDEX offer_addons_parent_active_idx
  ON public.offer_addons(parent_offer_id, sort_order)
  WHERE is_active;
CREATE INDEX offer_addons_product_idx ON public.offer_addons(addon_product_id);
CREATE INDEX offer_addons_tariff_idx ON public.offer_addons(addon_tariff_id);
CREATE INDEX offer_addons_offer_idx ON public.offer_addons(addon_offer_id);

CREATE TABLE public.order_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_number text NOT NULL UNIQUE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  primary_order_id uuid REFERENCES public.orders_v2(id) ON DELETE SET NULL,
  payer_type text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'failed')),
  currency text NOT NULL,
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  adjustment_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  adjustment_reason text,
  payment_method text,
  source text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  quote_snapshot jsonb NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_groups_profile_created_idx
  ON public.order_groups(profile_id, created_at DESC);
CREATE INDEX order_groups_user_created_idx ON public.order_groups(user_id, created_at DESC);
CREATE INDEX order_groups_primary_order_idx ON public.order_groups(primary_order_id)
  WHERE primary_order_id IS NOT NULL;
CREATE INDEX order_groups_created_by_idx ON public.order_groups(created_by)
  WHERE created_by IS NOT NULL;

CREATE TABLE public.order_group_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_group_id uuid NOT NULL REFERENCES public.order_groups(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders_v2(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('primary', 'addon')),
  product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE RESTRICT,
  tariff_id uuid NOT NULL REFERENCES public.tariffs(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL REFERENCES public.tariff_offers(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity = 1),
  list_amount numeric(12,2) NOT NULL CHECK (list_amount >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  final_amount numeric(12,2) NOT NULL CHECK (final_amount >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  item_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_group_items_one_offer UNIQUE (order_group_id, offer_id)
);

CREATE INDEX order_group_items_group_idx ON public.order_group_items(order_group_id, sort_order);
CREATE INDEX order_group_items_order_idx ON public.order_group_items(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX order_group_items_product_idx ON public.order_group_items(product_id);
CREATE INDEX order_group_items_tariff_idx ON public.order_group_items(tariff_id);
CREATE INDEX order_group_items_offer_idx ON public.order_group_items(offer_id);

CREATE TABLE public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments_v2(id) ON DELETE CASCADE,
  order_group_id uuid NOT NULL REFERENCES public.order_groups(id) ON DELETE CASCADE,
  order_group_item_id uuid NOT NULL REFERENCES public.order_group_items(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  refunded_amount numeric(12,2) NOT NULL DEFAULT 0
    CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_allocations_unique_item UNIQUE (payment_id, order_group_item_id)
);

CREATE INDEX payment_allocations_group_idx ON public.payment_allocations(order_group_id);
CREATE INDEX payment_allocations_payment_idx ON public.payment_allocations(payment_id);
CREATE INDEX payment_allocations_item_idx ON public.payment_allocations(order_group_item_id);

ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS order_group_id uuid REFERENCES public.order_groups(id) ON DELETE SET NULL;
CREATE INDEX payment_links_order_group_idx ON public.payment_links(order_group_id)
  WHERE order_group_id IS NOT NULL;

ALTER TABLE public.offer_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_group_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY offer_addons_staff_select ON public.offer_addons
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2((SELECT auth.uid()), 'manager')
    OR public.has_role_v2((SELECT auth.uid()), 'menedzher')
    OR public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );
CREATE POLICY offer_addons_admin_insert ON public.offer_addons
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );
CREATE POLICY offer_addons_admin_update ON public.offer_addons
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );
CREATE POLICY offer_addons_admin_delete ON public.offer_addons
  FOR DELETE TO authenticated
  USING (
    public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );

CREATE POLICY order_groups_owner_select ON public.order_groups
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.has_role_v2((SELECT auth.uid()), 'manager')
    OR public.has_role_v2((SELECT auth.uid()), 'menedzher')
    OR public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );
CREATE POLICY order_group_items_owner_select ON public.order_group_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.order_groups g
      WHERE g.id = order_group_id
        AND (
          g.user_id = (SELECT auth.uid())
          OR public.has_role_v2((SELECT auth.uid()), 'manager')
          OR public.has_role_v2((SELECT auth.uid()), 'menedzher')
          OR public.has_role_v2((SELECT auth.uid()), 'admin')
          OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
        )
    )
  );
CREATE POLICY payment_allocations_staff_select ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2((SELECT auth.uid()), 'manager')
    OR public.has_role_v2((SELECT auth.uid()), 'menedzher')
    OR public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );

REVOKE ALL ON public.offer_addons, public.order_groups, public.order_group_items, public.payment_allocations
  FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_addons TO authenticated;
GRANT SELECT ON public.order_groups, public.order_group_items, public.payment_allocations TO authenticated;

COMMENT ON TABLE public.offer_addons IS
  'Add-on products allowed for a specific primary tariff offer. Public reads go through a server-side quote.';
COMMENT ON TABLE public.order_groups IS
  'One commercial deal/payment containing a primary product and independently fulfilled add-on products.';
COMMENT ON TABLE public.order_group_items IS
  'Immutable purchase lines; each line may materialize as its own orders_v2 row for access fulfillment.';
COMMENT ON TABLE public.payment_allocations IS
  'Allocation of one provider payment across independently refundable purchase lines.';

CREATE OR REPLACE FUNCTION public.materialize_composable_order_group(
  _primary_order_id uuid,
  _quote jsonb,
  _source text,
  _idempotency_key text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_primary public.orders_v2%ROWTYPE;
  v_group_id uuid;
  v_item jsonb;
  v_index integer := 0;
  v_order_id uuid;
  v_order_number text;
  v_role text;
BEGIN
  SELECT * INTO v_primary FROM public.orders_v2 WHERE id = _primary_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'primary_order_not_found'; END IF;
  IF jsonb_typeof(_quote->'items') <> 'array' OR jsonb_array_length(_quote->'items') < 1 THEN
    RAISE EXCEPTION 'quote_items_required';
  END IF;
  IF ((_quote->'items'->0->>'product_id')::uuid IS DISTINCT FROM v_primary.product_id)
     OR ((_quote->'items'->0->>'tariff_id')::uuid IS DISTINCT FROM v_primary.tariff_id)
     OR ((_quote->'items'->0->>'offer_id')::uuid IS DISTINCT FROM v_primary.offer_id) THEN
    RAISE EXCEPTION 'primary_quote_order_mismatch';
  END IF;

  INSERT INTO public.order_groups (
    group_number, profile_id, user_id, primary_order_id, payer_type, status,
    currency, subtotal, adjustment_amount, total_amount, adjustment_reason,
    payment_method, source, idempotency_key, quote_snapshot, meta
  ) VALUES (
    'GRP-' || v_primary.order_number, v_primary.profile_id, v_primary.user_id,
    v_primary.id, v_primary.payer_type,
    CASE WHEN v_primary.status::text = 'paid' THEN 'paid' ELSE 'pending' END,
    COALESCE(_quote->>'currency', v_primary.currency),
    (_quote->>'subtotal')::numeric,
    COALESCE((_quote->>'adjustment_amount')::numeric, 0),
    (_quote->>'total')::numeric,
    NULLIF(_quote->>'adjustment_reason', ''),
    v_primary.meta->>'payment_method', _source, _idempotency_key, _quote,
    jsonb_build_object('single_crm_deal', true, 'separate_entitlements', true)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_group_id;
  IF v_group_id IS NULL THEN
    SELECT id INTO v_group_id
    FROM public.order_groups
    WHERE idempotency_key = _idempotency_key;
    RETURN v_group_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_quote->'items')
  LOOP
    v_role := COALESCE(v_item->>'role', CASE WHEN v_index = 0 THEN 'primary' ELSE 'addon' END);
    IF v_role = 'primary' THEN
      v_order_id := v_primary.id;
    ELSE
      v_order_number := v_primary.order_number || '-A' || v_index::text;
      INSERT INTO public.orders_v2 (
        order_number, product_id, tariff_id, offer_id, profile_id, user_id,
        customer_email, customer_phone, payer_type, status, reconcile_source,
        base_price, final_price, paid_amount, currency, purchase_snapshot, meta
      ) VALUES (
        v_order_number, (v_item->>'product_id')::uuid, (v_item->>'tariff_id')::uuid,
        (v_item->>'offer_id')::uuid, v_primary.profile_id, v_primary.user_id,
        v_primary.customer_email, v_primary.customer_phone, v_primary.payer_type,
        v_primary.status, 'composable_checkout',
        (v_item->>'list_amount')::numeric, (v_item->>'final_amount')::numeric,
        CASE WHEN v_primary.status::text = 'paid' THEN (v_item->>'final_amount')::numeric ELSE 0 END,
        COALESCE(_quote->>'currency', v_primary.currency), v_item,
        jsonb_build_object(
          'order_group_id', v_group_id,
          'group_primary_order_id', v_primary.id,
          'group_child_order', true,
          'exclude_separate_crm_deal', true
        )
      ) RETURNING id INTO v_order_id;
    END IF;

    INSERT INTO public.order_group_items (
      order_group_id, order_id, role, product_id, tariff_id, offer_id,
      list_amount, discount_amount, final_amount, sort_order, item_snapshot
    ) VALUES (
      v_group_id, v_order_id, v_role, (v_item->>'product_id')::uuid,
      (v_item->>'tariff_id')::uuid, (v_item->>'offer_id')::uuid,
      (v_item->>'list_amount')::numeric, COALESCE((v_item->>'discount_amount')::numeric, 0),
      (v_item->>'final_amount')::numeric, v_index, v_item
    );
    v_index := v_index + 1;
  END LOOP;

  UPDATE public.orders_v2
  SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'order_group_id', v_group_id,
    'composable_checkout', _quote,
    'single_crm_deal', true
  )
  WHERE id = v_primary.id;
  RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_composable_order_group(uuid, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_composable_order_group(uuid, jsonb, text, text) TO service_role;
-- Different module sets for the same RR offer/contact must never reuse one
-- another's pending application.
DROP FUNCTION IF EXISTS public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb,
  jsonb, uuid, uuid
);

CREATE OR REPLACE FUNCTION public.rr_get_or_create_pending_order(
  _offer_id uuid, _user_id uuid, _email_norm text, _phone_norm text,
  _product_id uuid, _tariff_id uuid, _amount numeric, _currency text,
  _customer_email text, _customer_phone text, _customer_ip text, _meta jsonb,
  _crm_routing_snapshot jsonb DEFAULT NULL,
  _pipeline_id uuid DEFAULT NULL,
  _pipeline_stage_id uuid DEFAULT NULL,
  _checkout_fingerprint text DEFAULT ''
) RETURNS TABLE(order_id uuid, was_reused boolean, order_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.orders_v2%ROWTYPE;
  v_lock_key bigint;
  v_order_number text;
  v_meta jsonb := COALESCE(_meta, '{}'::jsonb);
  v_fingerprint text := COALESCE(_checkout_fingerprint, '');
BEGIN
  v_lock_key := hashtextextended(
    coalesce(_offer_id::text,'')||'|'||coalesce(_user_id::text,'')||'|'||
    coalesce(_email_norm,'')||'|'||coalesce(_phone_norm,'')||'|'||v_fingerprint, 42);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_row FROM public.orders_v2 o
   WHERE o.offer_id = _offer_id AND o.provider = 'rr'
     AND (o.meta->>'flow') = 'rr_installment'
     AND coalesce(o.meta->>'checkout_fingerprint', '') = v_fingerprint
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
    order_id := v_row.id; was_reused := true; order_number := v_row.order_number;
    RETURN NEXT; RETURN;
  END IF;

  v_meta := jsonb_set(
    v_meta, '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object('upstream_call_state','not_started'),
    true
  );
  v_meta := jsonb_set(v_meta, '{checkout_fingerprint}', to_jsonb(v_fingerprint), true);
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
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb,
  jsonb, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb,
  jsonb, uuid, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_composable_order_group(
  _primary_order_id uuid,
  _payment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group public.order_groups%ROWTYPE;
  v_payment public.payments_v2%ROWTYPE;
  v_item record;
  v_subtotal numeric;
  v_allocated numeric := 0;
  v_amount numeric;
  v_count integer;
  v_index integer := 0;
BEGIN
  SELECT * INTO v_group FROM public.order_groups
  WHERE primary_order_id = _primary_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'state', 'not_grouped');
  END IF;

  SELECT * INTO v_payment FROM public.payments_v2
  WHERE id = _payment_id AND order_id = _primary_order_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status::text <> 'succeeded' THEN
    RAISE EXCEPTION 'succeeded_primary_payment_required';
  END IF;
  IF upper(v_payment.currency) IS DISTINCT FROM upper(v_group.currency) THEN
    RAISE EXCEPTION 'group_payment_currency_mismatch';
  END IF;
  IF v_payment.amount IS DISTINCT FROM v_group.total_amount THEN
    RAISE EXCEPTION 'group_payment_amount_mismatch';
  END IF;

  SELECT count(*), sum(final_amount) INTO v_count, v_subtotal
  FROM public.order_group_items WHERE order_group_id = v_group.id;

  FOR v_item IN
    SELECT * FROM public.order_group_items
    WHERE order_group_id = v_group.id ORDER BY sort_order, id
  LOOP
    v_index := v_index + 1;
    v_amount := CASE
      WHEN v_index = v_count THEN v_payment.amount - v_allocated
      WHEN coalesce(v_subtotal, 0) = 0 THEN 0
      ELSE round(v_payment.amount * v_item.final_amount / v_subtotal, 2)
    END;
    v_allocated := v_allocated + v_amount;

    INSERT INTO public.payment_allocations(
      payment_id, order_group_id, order_group_item_id, amount
    ) VALUES (_payment_id, v_group.id, v_item.id, v_amount)
    ON CONFLICT (payment_id, order_group_item_id)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();

    UPDATE public.orders_v2
    SET status = 'paid'::order_status,
        paid_amount = v_amount,
        deal_date = COALESCE(deal_date, v_payment.paid_at, now()),
        meta = COALESCE(meta, '{}'::jsonb) ||
          jsonb_build_object('group_payment_id', _payment_id)
    WHERE id = v_item.order_id AND v_item.role = 'addon';
  END LOOP;

  UPDATE public.order_groups
  SET status = 'paid', paid_at = COALESCE(v_payment.paid_at, now()), updated_at = now()
  WHERE id = v_group.id;
  RETURN jsonb_build_object('ok', true, 'state', 'settled', 'group_id', v_group.id);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_composable_order_group(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_composable_order_group(uuid, uuid)
  TO service_role;
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
-- Supabase projects may define default function privileges that explicitly
-- grant EXECUTE to API roles. Revoking only from PUBLIC does not remove those
-- role-specific grants.
REVOKE ALL ON FUNCTION public.materialize_composable_order_group(uuid, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_composable_order_group(uuid, jsonb, text, text)
  TO service_role;
ALTER TABLE public.order_groups
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;