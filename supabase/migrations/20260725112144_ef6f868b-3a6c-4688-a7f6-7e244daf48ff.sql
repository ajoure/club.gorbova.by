-- Purchased add-on modules may be visible immediately while their usable access
-- is delivered either immediately, at a fixed moment, or after an explicit
-- operator action. The commercial snapshot stays on order_group_items; this
-- table is the durable fulfilment state for delayed items.

ALTER TABLE public.offer_addons
  ADD COLUMN access_delivery_mode text NOT NULL DEFAULT 'immediate',
  ADD COLUMN access_opens_at timestamptz,
  ADD COLUMN access_duration_days integer;

ALTER TABLE public.offer_addons
  ADD CONSTRAINT offer_addons_access_delivery_mode_valid
    CHECK (access_delivery_mode IN ('immediate', 'fixed_date', 'manual')),
  ADD CONSTRAINT offer_addons_access_opens_at_valid
    CHECK (
      (access_delivery_mode = 'fixed_date' AND access_opens_at IS NOT NULL)
      OR (access_delivery_mode <> 'fixed_date' AND access_opens_at IS NULL)
    ),
  ADD CONSTRAINT offer_addons_access_duration_days_valid
    CHECK (access_duration_days IS NULL OR access_duration_days > 0);

CREATE INDEX offer_addons_scheduled_open_idx
  ON public.offer_addons(access_opens_at)
  WHERE is_active AND access_delivery_mode = 'fixed_date';

CREATE TABLE public.scheduled_product_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_group_id uuid NOT NULL REFERENCES public.order_groups(id) ON DELETE CASCADE,
  order_group_item_id uuid NOT NULL UNIQUE
    REFERENCES public.order_group_items(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders_v2(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE RESTRICT,
  tariff_id uuid NOT NULL REFERENCES public.tariffs(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL REFERENCES public.tariff_offers(id) ON DELETE RESTRICT,
  access_delivery_mode text NOT NULL
    CHECK (access_delivery_mode IN ('fixed_date', 'manual')),
  opens_at timestamptz,
  access_duration_days integer,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'activating', 'activated', 'cancelled', 'failed')),
  purchase_confirmed_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  activated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  activation_attempts integer NOT NULL DEFAULT 0 CHECK (activation_attempts >= 0),
  last_error text,
  grant_result jsonb,
  access_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_product_access_opens_at_valid CHECK (
    (access_delivery_mode = 'fixed_date' AND opens_at IS NOT NULL)
    OR (access_delivery_mode = 'manual' AND opens_at IS NULL)
  ),
  CONSTRAINT scheduled_product_access_duration_valid CHECK (
    access_duration_days IS NULL OR access_duration_days > 0
  ),
  CONSTRAINT scheduled_product_access_activated_at_valid CHECK (
    status <> 'activated' OR activated_at IS NOT NULL
  )
);

CREATE INDEX scheduled_product_access_due_idx
  ON public.scheduled_product_access(opens_at, id)
  WHERE status = 'scheduled' AND access_delivery_mode = 'fixed_date';
CREATE INDEX scheduled_product_access_user_idx
  ON public.scheduled_product_access(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX scheduled_product_access_profile_idx
  ON public.scheduled_product_access(profile_id, created_at DESC)
  WHERE profile_id IS NOT NULL;
CREATE INDEX scheduled_product_access_group_idx
  ON public.scheduled_product_access(order_group_id, created_at);

ALTER TABLE public.scheduled_product_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduled_product_access_owner_select
  ON public.scheduled_product_access
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.has_role_v2((SELECT auth.uid()), 'manager')
    OR public.has_role_v2((SELECT auth.uid()), 'menedzher')
    OR public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );

CREATE POLICY scheduled_product_access_admin_update
  ON public.scheduled_product_access
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );

REVOKE ALL ON public.scheduled_product_access FROM anon;
GRANT SELECT, UPDATE ON public.scheduled_product_access TO authenticated;

COMMENT ON COLUMN public.offer_addons.access_delivery_mode IS
  'Fulfilment policy snapshotted into a purchased add-on: immediate, fixed_date, or manual.';
COMMENT ON COLUMN public.offer_addons.access_opens_at IS
  'Absolute opening moment for fixed_date add-ons. NULL for immediate/manual.';
COMMENT ON TABLE public.scheduled_product_access IS
  'Paid and owned add-on modules whose active entitlement is intentionally delivered later.';