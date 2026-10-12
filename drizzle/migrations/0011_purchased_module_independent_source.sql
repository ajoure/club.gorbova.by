-- Historical purchases stay permanent facts; Business secondary access is finite.
-- No entitlement, subscription, order, payment or Auth row is mutated here.
CREATE OR REPLACE FUNCTION public.historical_business_source_is_current(
  _user_id uuid, _product_id uuid, _meta jsonb, _product_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  target_id uuid := coalesce(_product_id, (SELECT id FROM public.products_v2 WHERE code = _product_code));
  business_id constant uuid := '7c748940-dcad-4c7c-a92e-76a2344622d3';
  club_id constant uuid := '11c9f1b8-0355-4753-bd74-40b42aa53616';
  scoped boolean;
BEGIN
  -- Public RPC access may reveal only the caller's own access state, or staff-authorized state.
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM _user_id
    AND NOT coalesce(public.has_role_v2(auth.uid(), 'admin'),false) AND NOT coalesce(public.has_role_v2(auth.uid(), 'super_admin'),false)
    AND NOT coalesce(public.has_permission(auth.uid(), 'entitlements.view'),false)
    AND NOT coalesce(public.has_permission(auth.uid(), 'entitlements.manage'),false)
    AND NOT coalesce(public.has_admin_section_access(auth.uid(), 'contacts', 'view'),false)
    AND NOT coalesce(public.has_admin_section_access(auth.uid(), 'payments', 'view'),false)
    AND NOT coalesce(public.has_admin_section_access(auth.uid(), 'deals', 'view'),false)
    AND NOT coalesce(public.has_admin_section_access(auth.uid(), 'companies', 'view'),false)
  THEN RETURN false; END IF;

  IF target_id IS NULL OR target_id <> ALL(ARRAY[
    '7101ed3c-7839-4a74-ad95-aa0660369b22','64d9f812-617c-41a8-b3dc-bb113156d6f3',
    'ea98d043-e852-443f-8807-6e77de6a5e1f','99f1f156-f384-417e-bdf8-9203eb3c9d42',
    'd7effaf4-9be0-4ce2-971b-e02fe2a85a9a','abee24cd-5c8b-4111-a6cb-7dee7acf168c',
    '9187db54-8f57-42eb-bbcb-d7103d2459a9','064dd768-de8b-40db-89bc-f8d4a7e442ba',
    'f833c846-a78d-4096-9dac-b8417d588371']::uuid[])
  THEN RETURN true; END IF;

  scoped := coalesce(_meta->>'business_tariff_id' = business_id::text, false)
    OR coalesce(_meta->>'source_rule_id' = '1b497fba-031a-4318-8d9f-2530f1bac116', false)
    OR EXISTS (SELECT 1 FROM public.subscriptions_v2 s WHERE s.user_id = _user_id
      AND s.id::text = _meta->>'business_subscription_id' AND s.product_id = club_id AND s.tariff_id = business_id)
    OR EXISTS (SELECT 1 FROM public.entitlement_sources s WHERE s.user_id = _user_id
      AND s.id::text = _meta->>'source_entitlement_source_id' AND s.product_id = club_id AND s.tariff_id = business_id);
  IF NOT scoped THEN RETURN true; END IF;

  -- Fulfillment may retain an old Business marker when merging a paid purchase.
  -- Trust only the exact paid order bound to a currently valid primary entitlement,
  -- never an unrelated historical purchase or a zero-price Business projection.
  IF EXISTS (
    SELECT 1 FROM public.entitlements e
    JOIN public.orders_v2 o ON o.id = e.order_id
    WHERE e.user_id = _user_id AND e.product_id = target_id
      AND e.status = 'active' AND (e.expires_at IS NULL OR e.expires_at > now())
      AND e.meta->>'granted_by' = 'primary_order_fulfillment'
      AND o.user_id = e.user_id AND o.product_id = e.product_id
      AND o.status::text = 'paid' AND NOT o.is_deleted
      AND o.final_price > 0 AND o.paid_amount > 0
      -- Refund decisions for this item do not affect unrelated paid modules.
      -- Explicit keep decisions retain access; revoke/reduce still fail closed.
      AND NOT EXISTS (SELECT 1 FROM public.order_group_items i
        WHERE i.order_id = o.id AND (
          EXISTS (SELECT 1 FROM public.payment_refund_requests r
            WHERE r.order_group_item_id = i.id AND r.state <> 'failed'
              AND r.access_action NOT IN ('keep','keep_subscription'))
          OR EXISTS (SELECT 1 FROM public.composable_refund_intents ci
            WHERE ci.order_group_item_id = i.id AND ci.status NOT IN ('failed','cancelled')
              AND ci.access_action NOT IN ('keep','keep_subscription'))))
      AND (
        (o.meta->>'group_primary_order_id' IS NULL
          AND coalesce(o.meta->>'group_child_order','false') <> 'true'
          AND NOT EXISTS (SELECT 1 FROM public.payments_v2 p
            WHERE p.order_id = o.id AND (p.status::text = 'refunded'
              OR (p.amount > 0 AND p.refunded_amount >= p.amount))))
        OR EXISTS (SELECT 1 FROM public.orders_v2 par
          WHERE par.id::text = o.meta->>'group_primary_order_id'
            AND par.user_id = o.user_id AND NOT par.is_deleted
            AND par.status::text IN ('paid','partial_refund')
            AND EXISTS (SELECT 1 FROM public.payments_v2 p
              WHERE p.order_id = par.id AND p.id::text = o.meta->>'group_payment_id'
                AND p.status::text IN ('succeeded','partially_refunded')
                AND p.amount > coalesce(p.refunded_amount,0))
            AND NOT EXISTS (SELECT 1 FROM public.payments_v2 p
              WHERE p.order_id = par.id AND (p.status::text = 'refunded'
                OR (p.amount > 0 AND p.refunded_amount >= p.amount))))
      )
  ) THEN RETURN true; END IF;

  -- A separate currently valid purchase/manual source for the target remains independent.
  IF EXISTS (SELECT 1 FROM public.entitlement_sources s
    WHERE s.user_id = _user_id AND s.product_id = target_id AND s.status = 'active'
      AND s.starts_at <= now() AND (s.expires_at IS NULL OR s.expires_at > now()))
    OR EXISTS (SELECT 1 FROM public.subscriptions_v2 s
    WHERE s.user_id = _user_id AND s.product_id = target_id
      AND s.status::text IN ('active','trial','past_due','canceled')
      AND s.access_start_at <= now() AND (s.access_end_at IS NULL OR s.access_end_at > now()))
  THEN RETURN true; END IF;

  -- Any current Business window preserves access when one of several sources ends.
  -- Cancellation of rebilling alone is deliberately not an access revocation.
  RETURN EXISTS (SELECT 1 FROM public.subscriptions_v2 s
    WHERE s.user_id = _user_id AND s.product_id = club_id AND s.tariff_id = business_id
      AND s.status::text IN ('active','past_due','canceled') AND NOT s.is_trial
      AND s.access_start_at <= now() AND s.access_end_at > now())
    OR EXISTS (SELECT 1 FROM public.entitlement_sources s
    WHERE s.user_id = _user_id AND s.product_id = club_id AND s.tariff_id = business_id
      AND s.status = 'active' AND s.starts_at <= now() AND s.expires_at > now());
END;
$fn$;
REVOKE ALL ON FUNCTION public.historical_business_source_is_current(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.historical_business_source_is_current(uuid,uuid,jsonb,text) TO authenticated, service_role;

