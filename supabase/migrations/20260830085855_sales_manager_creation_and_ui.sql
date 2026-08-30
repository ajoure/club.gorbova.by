-- Products 2 / sales manager attribution: creation paths and CRM UI support.
-- Historical rows are intentionally not changed here.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The canonical reassignment RPC is also called by trusted payment writers.
-- Preserve that distinction in the audit trail instead of mislabelling a
-- service-role operation as an end-user action.
ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_type_check;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_type_check
  CHECK (actor_type IN ('user', 'system', 'service'));

-- Public links must keep the selected manager until checkout materializes a deal.
ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid;

CREATE INDEX IF NOT EXISTS payment_links_responsible_created_idx
  ON public.payment_links(responsible_user_id, created_at DESC)
  WHERE responsible_user_id IS NOT NULL;

CREATE OR REPLACE VIEW public.payment_links_enriched_v AS
SELECT pl.id,
    pl.url_token,
    pl.product_id,
    pl.tariff_id,
    pl.offer_id,
    pl.amount,
    pl.currency,
    pl.payment_type,
    pl.description,
    pl.user_id,
    pl.status,
    pl.max_uses,
    pl.current_uses,
    pl.expires_at,
    pl.created_by,
    pl.created_at,
    pl.updated_at,
    p.name AS product_name,
    t.name AS tariff_name,
    tof.button_label AS offer_title,
    rec.full_name AS recipient_name,
    rec.email AS recipient_email,
    cre.full_name AS creator_name,
    cre.email AS creator_email,
    (pl.expires_at IS NOT NULL AND pl.expires_at < now()) AS is_expired,
    (pl.max_uses IS NOT NULL AND pl.current_uses >= pl.max_uses) AS is_exhausted,
    (pl.status <> 'active'::text
      OR (pl.expires_at IS NOT NULL AND pl.expires_at < now())
      OR (pl.max_uses IS NOT NULL AND pl.current_uses >= pl.max_uses)) AS is_invalid,
    COALESCE(ord.related_orders_count, 0) AS related_orders_count,
    COALESCE(ord.paid_orders_count, 0) AS paid_orders_count,
    ord.last_order_id,
    pl.public_url,
    pl.provider,
    pl.provider_mode,
    pl.account_code,
    pl.profile_code,
    pl.business_stream,
    pl.responsible_user_id,
    mgr.full_name AS responsible_name,
    mgr.email AS responsible_email
FROM public.payment_links pl
  LEFT JOIN public.products_v2 p ON p.id = pl.product_id
  LEFT JOIN public.tariffs t ON t.id = pl.tariff_id
  LEFT JOIN public.tariff_offers tof ON tof.id = pl.offer_id
  LEFT JOIN public.profiles rec ON rec.user_id = pl.user_id
  LEFT JOIN public.profiles cre ON cre.user_id = pl.created_by
  LEFT JOIN public.profiles mgr ON mgr.user_id = pl.responsible_user_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS related_orders_count,
           count(*) FILTER (WHERE o.status = 'paid'::public.order_status)::integer AS paid_orders_count,
           (array_agg(o.id ORDER BY o.created_at DESC))[1] AS last_order_id
    FROM public.orders_v2 o
    WHERE (o.meta ->> 'payment_link_id') = pl.id::text
  ) ord ON true;

CREATE OR REPLACE FUNCTION public.payment_links_guard_responsible_v1()
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
  IF v_jwt_role = 'authenticated'
     AND (TG_OP = 'INSERT' OR OLD.responsible_user_id IS DISTINCT FROM NEW.responsible_user_id)
     AND NEW.responsible_user_id IS NOT NULL THEN
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
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_links_guard_responsible_v1()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payment_links_guard_responsible_v1
  ON public.payment_links;
CREATE TRIGGER trg_payment_links_guard_responsible_v1
BEFORE INSERT OR UPDATE OF responsible_user_id
ON public.payment_links
FOR EACH ROW
EXECUTE FUNCTION public.payment_links_guard_responsible_v1();

-- Backward-compatible v2 entry point for manual deal creation. The existing
-- admin_create_deal remains callable by legacy clients; the UI uses this RPC.
CREATE OR REPLACE FUNCTION public.admin_create_deal_v2(
  p_profile_id uuid,
  p_title text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_tariff_id uuid DEFAULT NULL,
  p_pipeline_id uuid DEFAULT NULL,
  p_pipeline_stage_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT 0,
  p_currency text DEFAULT 'BYN',
  p_notes text DEFAULT NULL,
  p_responsible_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_responsible_user_id uuid := coalesce(p_responsible_user_id, (SELECT auth.uid()));
  v_order_id uuid;
  v_responsible_name text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_responsible_user_id IS NULL
     OR NOT public.has_role_v2(v_responsible_user_id, 'employee') THEN
    RAISE EXCEPTION 'responsible_user_not_staff' USING ERRCODE = '22023';
  END IF;

  IF v_responsible_user_id = v_actor THEN
    IF NOT (
      public.has_permission(v_actor, 'deals.assign_self')
      OR public.has_permission(v_actor, 'deals.reassign')
    ) THEN
      RAISE EXCEPTION 'forbidden_assign_self' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.has_permission(v_actor, 'deals.reassign') THEN
    RAISE EXCEPTION 'forbidden_assign_other' USING ERRCODE = '42501';
  END IF;

  v_order_id := public.admin_create_deal(
    p_profile_id,
    p_title,
    p_product_id,
    p_tariff_id,
    p_pipeline_id,
    p_pipeline_stage_id,
    p_amount,
    p_currency,
    p_notes
  );

  PERFORM set_config('app.sales_manager_change', 'allowed', true);
  UPDATE public.orders_v2
  SET responsible_user_id = v_responsible_user_id,
      updated_at = now()
  WHERE id = v_order_id;

  SELECT profile.full_name
  INTO v_responsible_name
  FROM public.profiles profile
  WHERE profile.user_id = v_responsible_user_id
  ORDER BY profile.created_at
  LIMIT 1;

  INSERT INTO public.audit_logs(action, actor_type, actor_user_id, entity_type, entity_id, meta)
  VALUES (
    'deal_sales_manager_assigned_on_create',
    'user',
    v_actor,
    'deal',
    v_order_id::text,
    jsonb_build_object(
      'order_id', v_order_id,
      'responsible_user_id', v_responsible_user_id,
      'responsible_name_snapshot', v_responsible_name,
      'source', 'admin_manual'
    )
  );

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_deal_v2(
  uuid, text, uuid, uuid, uuid, uuid, numeric, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_deal_v2(
  uuid, text, uuid, uuid, uuid, uuid, numeric, text, text, uuid
) TO authenticated, service_role;

-- Canonical batch wrapper. Each row still goes through the audited v1
-- operation, while the wrapper provides one transaction and one batch id.
CREATE OR REPLACE FUNCTION public.set_deals_responsible_bulk_v1(
  p_deal_ids uuid[],
  p_responsible_user_id uuid,
  p_reason text,
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
  v_batch_id uuid := coalesce(p_batch_id, gen_random_uuid());
  v_deal_id uuid;
  v_result jsonb;
  v_requested integer;
  v_changed integer := 0;
  v_changed_payments integer := 0;
BEGIN
  SELECT count(*)
  INTO v_requested
  FROM (SELECT DISTINCT unnest(coalesce(p_deal_ids, '{}'::uuid[])) AS id) ids;

  IF v_requested = 0 THEN
    RAISE EXCEPTION 'empty_selection' USING ERRCODE = '22023';
  END IF;
  IF v_requested > 500 THEN
    RAISE EXCEPTION 'selection_too_large' USING ERRCODE = '22023';
  END IF;
  IF nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  IF v_jwt_role <> 'service_role' THEN
    IF v_actor IS NULL
       OR NOT public.has_permission(v_actor, 'deals.reassign')
       OR NOT public.has_permission(v_actor, 'sales_attribution.bulk_edit') THEN
      RAISE EXCEPTION 'forbidden_bulk_reassign' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_deal_id IN
    SELECT ids.id
    FROM (
      SELECT DISTINCT unnest(p_deal_ids) AS id
    ) ids
    ORDER BY ids.id
  LOOP
    v_result := public.set_deal_responsible_v1(
      v_deal_id,
      p_responsible_user_id,
      p_reason,
      'bulk_reassignment',
      v_batch_id
    );
    IF coalesce((v_result->>'changed')::boolean, false) THEN
      v_changed := v_changed + 1;
      v_changed_payments := v_changed_payments
        + coalesce((v_result->>'changed_payment_count')::integer, 0);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'requested', v_requested,
    'changed', v_changed,
    'changed_payment_count', v_changed_payments,
    'responsible_user_id', p_responsible_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_deals_responsible_bulk_v1(
  uuid[], uuid, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_deals_responsible_bulk_v1(
  uuid[], uuid, text, uuid
) TO authenticated, service_role;
