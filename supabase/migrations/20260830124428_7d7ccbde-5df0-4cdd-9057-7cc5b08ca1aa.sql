-- Products 2 / sales manager attribution: canonical data and security layer.
--
-- This migration deliberately does not backfill historical deals. Production
-- backfill has its own dry-run/approval gate and must use exact IDs.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Explicit capabilities. New permissions are opt-in for ordinary roles.
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (code, name, category)
VALUES
  ('deals.assign_self', 'Назначить себя менеджером продажи', 'deals'),
  ('deals.reassign', 'Переназначить менеджера продажи', 'deals'),
  ('sales_reports.view_own', 'Просмотр своих показателей продаж', 'sales_reports'),
  ('sales_reports.view_all', 'Просмотр показателей всех сотрудников', 'sales_reports'),
  ('sales_attribution.bulk_edit', 'Пакетное переотнесение продаж', 'sales_attribution')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role_row.id, permission_row.id
FROM public.roles role_row
JOIN public.permissions permission_row
  ON permission_row.code IN (
    'deals.assign_self',
    'deals.reassign',
    'sales_reports.view_own',
    'sales_reports.view_all',
    'sales_attribution.bulk_edit'
  )
WHERE role_row.code IN ('admin', 'super_admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role_row.id, permission_row.id
FROM public.roles role_row
JOIN public.permissions permission_row
  ON permission_row.code IN ('deals.assign_self', 'sales_reports.view_own')
WHERE role_row.code = 'menedzher'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Versioned payment attribution. One open version per payment.
-- ---------------------------------------------------------------------------
CREATE TABLE public.payment_sales_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL
    REFERENCES public.payments_v2(id) ON DELETE CASCADE,
  order_id uuid NOT NULL
    REFERENCES public.orders_v2(id) ON DELETE CASCADE,
  responsible_user_id uuid,
  responsible_name_snapshot text,
  assignment_source text NOT NULL,
  assigned_by uuid,
  assigned_by_name_snapshot text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  reason text,
  batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_sales_attribution_interval_chk
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT payment_sales_attribution_source_chk
    CHECK (assignment_source IN (
      'payment_link',
      'platform_send',
      'manual_reassignment',
      'bulk_reassignment',
      'deal_inheritance',
      'refund_inheritance',
      'import',
      'backfill',
      'unassigned'
    ))
);

CREATE UNIQUE INDEX payment_sales_attribution_one_current_per_payment
  ON public.payment_sales_attribution(payment_id)
  WHERE effective_to IS NULL;

CREATE INDEX payment_sales_attribution_manager_period_idx
  ON public.payment_sales_attribution(responsible_user_id, effective_from DESC)
  WHERE effective_to IS NULL;

CREATE INDEX payment_sales_attribution_order_current_idx
  ON public.payment_sales_attribution(order_id, payment_id)
  WHERE effective_to IS NULL;

CREATE INDEX payment_sales_attribution_batch_idx
  ON public.payment_sales_attribution(batch_id)
  WHERE batch_id IS NOT NULL;

ALTER TABLE public.payment_sales_attribution ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_sales_attribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payment_sales_attribution TO authenticated;
GRANT ALL ON TABLE public.payment_sales_attribution TO service_role;

CREATE POLICY payment_sales_attribution_view_all
ON public.payment_sales_attribution
FOR SELECT
TO authenticated
USING (
  public.has_permission((SELECT auth.uid()), 'sales_reports.view_all')
);

CREATE POLICY payment_sales_attribution_view_own
ON public.payment_sales_attribution
FOR SELECT
TO authenticated
USING (
  responsible_user_id = (SELECT auth.uid())
  AND public.has_permission((SELECT auth.uid()), 'sales_reports.view_own')
);

-- ---------------------------------------------------------------------------
-- 3. Every newly materialized payment inherits a fixed current attribution.
--    Existing active attribution is never overwritten by imports/relinking.
--    Refund records prefer the original payment's attribution.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_sales_attribution_inherit_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
  v_responsible_user_id uuid;
  v_source text;
  v_actor uuid := (SELECT auth.uid());
  v_responsible_name text;
  v_actor_name text;
  v_from_payment_link boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payment_sales_attribution attribution
    WHERE attribution.payment_id = NEW.id
      AND attribution.effective_to IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.reference_payment_id IS NOT NULL THEN
    SELECT
      attribution.order_id,
      attribution.responsible_user_id,
      attribution.responsible_name_snapshot
    INTO v_order_id, v_responsible_user_id, v_responsible_name
    FROM public.payment_sales_attribution attribution
    WHERE attribution.payment_id = NEW.reference_payment_id
      AND attribution.effective_to IS NULL
    ORDER BY attribution.effective_from DESC
    LIMIT 1;

    IF FOUND THEN
      v_source := 'refund_inheritance';
    END IF;
  END IF;

  IF v_order_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT
      deal.id,
      deal.responsible_user_id,
      coalesce(deal.meta->>'payment_link_id', '') <> ''
    INTO v_order_id, v_responsible_user_id, v_from_payment_link
    FROM public.orders_v2 deal
    WHERE deal.id = NEW.order_id
    FOR SHARE;

    IF FOUND THEN
      v_source := CASE
        WHEN v_responsible_user_id IS NULL THEN 'unassigned'
        WHEN v_from_payment_link THEN 'payment_link'
        WHEN NEW.import_ref IS NOT NULL
          OR coalesce(NEW.origin, '') ILIKE '%import%' THEN 'import'
        ELSE 'deal_inheritance'
      END;
    END IF;
  END IF;

  -- An unlinked provider row is intentionally left without attribution until
  -- it is linked to an order or an attributed reference payment.
  IF v_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_responsible_name IS NULL AND v_responsible_user_id IS NOT NULL THEN
    SELECT profile.full_name
    INTO v_responsible_name
    FROM public.profiles profile
    WHERE profile.user_id = v_responsible_user_id
    ORDER BY profile.updated_at DESC
    LIMIT 1;
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT profile.full_name
    INTO v_actor_name
    FROM public.profiles profile
    WHERE profile.user_id = v_actor
    ORDER BY profile.updated_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.payment_sales_attribution (
    payment_id,
    order_id,
    responsible_user_id,
    responsible_name_snapshot,
    assignment_source,
    assigned_by,
    assigned_by_name_snapshot,
    effective_from,
    reason
  )
  VALUES (
    NEW.id,
    v_order_id,
    v_responsible_user_id,
    v_responsible_name,
    v_source,
    v_actor,
    v_actor_name,
    clock_timestamp(),
    CASE
      WHEN v_source = 'refund_inheritance' THEN 'Унаследовано от исходного платежа'
      WHEN v_source = 'payment_link' THEN 'Унаследовано из платёжной ссылки сделки'
      WHEN v_source = 'import' THEN 'Импортированный платёж унаследовал менеджера сделки'
      WHEN v_source = 'deal_inheritance' THEN 'Унаследовано от сделки'
      ELSE 'В сделке не указан менеджер продажи'
    END
  )
  ON CONFLICT (payment_id) WHERE effective_to IS NULL DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_sales_attribution_inherit_v1()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payment_sales_attribution_inherit_v1
  ON public.payments_v2;
CREATE TRIGGER trg_payment_sales_attribution_inherit_v1
AFTER INSERT OR UPDATE OF order_id, reference_payment_id
ON public.payments_v2
FOR EACH ROW
EXECUTE FUNCTION public.payment_sales_attribution_inherit_v1();

-- ---------------------------------------------------------------------------
-- 4. Authenticated clients may not silently rewrite the canonical manager.
--    The RPC below opens the guard only for its own transaction. Trusted
--    service_role/internal writers remain compatible with existing automation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_v2_guard_responsible_change_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF NEW.responsible_user_id IS NOT NULL
     AND NOT public.has_role_v2(NEW.responsible_user_id, 'employee') THEN
    RAISE EXCEPTION 'responsible_user_not_staff' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.responsible_user_id IS NOT NULL
     AND v_jwt_role = 'authenticated' THEN
    IF NEW.responsible_user_id = v_actor THEN
      IF NOT (
        public.has_permission(v_actor, 'deals.assign_self')
        OR public.has_permission(v_actor, 'deals.reassign')
      ) THEN
        RAISE EXCEPTION 'forbidden_assign_self' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT public.has_permission(v_actor, 'deals.reassign') THEN
      RAISE EXCEPTION 'forbidden_assign_other' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.responsible_user_id IS DISTINCT FROM NEW.responsible_user_id
     AND v_jwt_role = 'authenticated'
     AND coalesce(current_setting('app.sales_manager_change', true), '') <> 'allowed' THEN
      RAISE EXCEPTION 'use_set_deal_responsible_v1'
        USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_v2_guard_responsible_change_v1()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_v2_guard_responsible_change_v1
  ON public.orders_v2;
CREATE TRIGGER trg_orders_v2_guard_responsible_change_v1
BEFORE INSERT OR UPDATE OF responsible_user_id
ON public.orders_v2
FOR EACH ROW
EXECUTE FUNCTION public.orders_v2_guard_responsible_change_v1();

-- ---------------------------------------------------------------------------
-- 5. Canonical, audited and transactional reassignment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_deal_responsible_v1(
  p_deal_id uuid,
  p_responsible_user_id uuid,
  p_reason text,
  p_source text DEFAULT 'manual_reassignment',
  p_batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_old_responsible_user_id uuid;
  v_old_name text;
  v_new_name text;
  v_actor_name text;
  v_assignment_source text;
  v_batch_id uuid := coalesce(p_batch_id, gen_random_uuid());
  v_payment record;
  v_has_current boolean;
  v_current_responsible_user_id uuid;
  v_current_effective_from timestamptz;
  v_effective_at timestamptz;
  v_changed_payment_count integer := 0;
BEGIN
  IF p_deal_id IS NULL THEN
    RAISE EXCEPTION 'deal_id_required' USING ERRCODE = '22023';
  END IF;

  IF nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_source, '') NOT IN ('manual_reassignment', 'bulk_reassignment', 'backfill') THEN
    RAISE EXCEPTION 'invalid_assignment_source' USING ERRCODE = '22023';
  END IF;
  v_assignment_source := p_source;

  IF v_jwt_role <> 'service_role' THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_permission(v_actor, 'deals.reassign') THEN
      RAISE EXCEPTION 'forbidden_reassign' USING ERRCODE = '42501';
    END IF;

    IF p_source IN ('bulk_reassignment', 'backfill')
       AND NOT public.has_permission(v_actor, 'sales_attribution.bulk_edit') THEN
      RAISE EXCEPTION 'forbidden_bulk_reassign' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_responsible_user_id IS NOT NULL
     AND NOT public.has_role_v2(p_responsible_user_id, 'employee') THEN
    RAISE EXCEPTION 'responsible_user_not_staff' USING ERRCODE = '22023';
  END IF;

  SELECT deal.responsible_user_id
  INTO v_old_responsible_user_id
  FROM public.orders_v2 deal
  WHERE deal.id = p_deal_id
    AND deal.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'deal_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_old_responsible_user_id IS NOT DISTINCT FROM p_responsible_user_id THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'deal_id', p_deal_id,
      'responsible_user_id', p_responsible_user_id,
      'changed_payment_count', 0,
      'batch_id', v_batch_id
    );
  END IF;

  SELECT profile.full_name
  INTO v_old_name
  FROM public.profiles profile
  WHERE profile.user_id = v_old_responsible_user_id
  ORDER BY profile.updated_at DESC
  LIMIT 1;

  SELECT profile.full_name
  INTO v_new_name
  FROM public.profiles profile
  WHERE profile.user_id = p_responsible_user_id
  ORDER BY profile.updated_at DESC
  LIMIT 1;

  SELECT profile.full_name
  INTO v_actor_name
  FROM public.profiles profile
  WHERE profile.user_id = v_actor
  ORDER BY profile.updated_at DESC
  LIMIT 1;

  PERFORM set_config('app.sales_manager_change', 'allowed', true);
  UPDATE public.orders_v2
  SET responsible_user_id = p_responsible_user_id,
      updated_at = now()
  WHERE id = p_deal_id;

  FOR v_payment IN
    WITH RECURSIVE related_payments AS (
      SELECT payment.id
      FROM public.payments_v2 payment
      WHERE payment.order_id = p_deal_id
        AND payment.is_deleted = false

      UNION

      SELECT refund.id
      FROM public.payments_v2 refund
      JOIN related_payments related
        ON refund.reference_payment_id = related.id
      WHERE refund.is_deleted = false
    )
    SELECT id FROM related_payments
  LOOP
    SELECT attribution.responsible_user_id, attribution.effective_from
    INTO v_current_responsible_user_id, v_current_effective_from
    FROM public.payment_sales_attribution attribution
    WHERE attribution.payment_id = v_payment.id
      AND attribution.effective_to IS NULL
    ORDER BY attribution.effective_from DESC
    LIMIT 1;
    v_has_current := FOUND;

    IF NOT v_has_current
       OR v_current_responsible_user_id IS DISTINCT FROM p_responsible_user_id THEN
      v_effective_at := CASE
        WHEN v_has_current THEN greatest(
          clock_timestamp(),
          v_current_effective_from + interval '1 microsecond'
        )
        ELSE clock_timestamp()
      END;

      UPDATE public.payment_sales_attribution
      SET effective_to = v_effective_at
      WHERE payment_id = v_payment.id
        AND effective_to IS NULL;

      INSERT INTO public.payment_sales_attribution (
        payment_id,
        order_id,
        responsible_user_id,
        responsible_name_snapshot,
        assignment_source,
        assigned_by,
        assigned_by_name_snapshot,
        effective_from,
        reason,
        batch_id
      )
      VALUES (
        v_payment.id,
        p_deal_id,
        p_responsible_user_id,
        v_new_name,
        v_assignment_source,
        v_actor,
        v_actor_name,
        v_effective_at,
        trim(p_reason),
        v_batch_id
      );

      v_changed_payment_count := v_changed_payment_count + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_type,
    actor_label,
    action,
    entity_type,
    entity_id,
    target_user_id,
    meta
  )
  VALUES (
    v_actor,
    CASE WHEN v_jwt_role = 'service_role' THEN 'service' ELSE 'user' END,
    v_actor_name,
    'deal.sales_manager_changed',
    'order_v2',
    p_deal_id::text,
    p_responsible_user_id,
    jsonb_build_object(
      'old_responsible_user_id', v_old_responsible_user_id,
      'old_responsible_name', v_old_name,
      'new_responsible_user_id', p_responsible_user_id,
      'new_responsible_name', v_new_name,
      'changed_payment_count', v_changed_payment_count,
      'reason', trim(p_reason),
      'source', v_assignment_source,
      'batch_id', v_batch_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'deal_id', p_deal_id,
    'old_responsible_user_id', v_old_responsible_user_id,
    'responsible_user_id', p_responsible_user_id,
    'changed_payment_count', v_changed_payment_count,
    'batch_id', v_batch_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_deal_responsible_v1(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_deal_responsible_v1(uuid, uuid, text, text, uuid)
  TO authenticated, service_role;

COMMENT ON TABLE public.payment_sales_attribution IS
  'Versioned manager attribution for payments and refunds; one active version per payment.';
COMMENT ON FUNCTION public.set_deal_responsible_v1(uuid, uuid, text, text, uuid) IS
  'Canonical audited reassignment of a deal and every related payment/refund. Historical backfill requires an external dry-run approval gate.';