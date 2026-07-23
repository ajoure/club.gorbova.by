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

REVOKE ALL ON FUNCTION public.materialize_composable_order_group(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_composable_order_group(uuid, jsonb, text, text) TO service_role;
