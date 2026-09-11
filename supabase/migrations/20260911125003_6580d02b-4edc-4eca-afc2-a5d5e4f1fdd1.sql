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

-- The existing permissive staff policies still decide who can see history.
-- This extra restrictive policy hides stale ACTIVE Business projections from the pupil's reads.
DROP POLICY IF EXISTS historical_business_entitlement_window ON public.entitlements;
CREATE POLICY historical_business_entitlement_window ON public.entitlements
AS RESTRICTIVE FOR SELECT TO authenticated USING (
  status <> 'active'
  OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_permission(auth.uid(),'entitlements.view') OR public.has_permission(auth.uid(),'entitlements.manage')
  OR public.has_admin_section_access(auth.uid(),'contacts','view')
  OR public.has_admin_section_access(auth.uid(),'payments','view')
  OR public.has_admin_section_access(auth.uid(),'deals','view')
  OR public.has_admin_section_access(auth.uid(),'companies','view')
  OR public.historical_business_source_is_current(user_id,product_id,meta,product_code)
);

-- Preserve the live function while checking source windows even under SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.user_has_training_lesson_access(_user_id uuid, _lesson_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.training_lessons tl
    JOIN public.training_modules tm ON tm.id = tl.module_id
    WHERE tl.id = _lesson_id
      AND tl.is_active = true
      AND (
        -- админ / super_admin
        public.has_role_v2(_user_id, 'admin')
        OR public.has_role_v2(_user_id, 'super_admin')
        -- прямой entitlement на продукт модуля
        OR (
          tm.product_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.entitlements e
            WHERE e.user_id = _user_id
              AND e.product_id = tm.product_id
              AND e.status = 'active'
              AND (e.expires_at IS NULL OR e.expires_at > now())
              AND public.historical_business_source_is_current(e.user_id,e.product_id,e.meta,e.product_code)
          )
        )
        -- Preserve direct currently valid historical-product sources even without an aggregate cache row.
        OR (tm.product_id = ANY(ARRAY['7101ed3c-7839-4a74-ad95-aa0660369b22','64d9f812-617c-41a8-b3dc-bb113156d6f3','ea98d043-e852-443f-8807-6e77de6a5e1f','99f1f156-f384-417e-bdf8-9203eb3c9d42','d7effaf4-9be0-4ce2-971b-e02fe2a85a9a','abee24cd-5c8b-4111-a6cb-7dee7acf168c','9187db54-8f57-42eb-bbcb-d7103d2459a9','064dd768-de8b-40db-89bc-f8d4a7e442ba','f833c846-a78d-4096-9dac-b8417d588371']::uuid[]) AND (
          EXISTS (SELECT 1 FROM public.entitlement_sources es
            WHERE es.user_id = _user_id AND es.product_id = tm.product_id AND es.status = 'active'
              AND es.starts_at <= now() AND (es.expires_at IS NULL OR es.expires_at > now()))
          OR EXISTS (SELECT 1 FROM public.subscriptions_v2 ds
            WHERE ds.user_id = _user_id AND ds.product_id = tm.product_id
              AND ds.status::text IN ('active','trial','past_due','canceled') AND ds.access_start_at <= now()
              AND (ds.access_end_at IS NULL OR ds.access_end_at > now()))
        ))
        -- entitlement + access_rule training_content на этот module
        OR EXISTS (
          SELECT 1
          FROM public.access_rules ar
          JOIN public.entitlements e
            ON e.user_id = _user_id
           AND e.product_id = ar.product_id
           AND e.status = 'active'
           AND (e.expires_at IS NULL OR e.expires_at > now())
              AND public.historical_business_source_is_current(e.user_id,e.product_id,e.meta,e.product_code)
          WHERE ar.is_active = true
            AND ar.grant_target_type = 'training_content'
            AND (
              -- target_ref = module_id этого урока
              ar.target_ref = tl.module_id::text
              -- либо module_id лежит в allowed_module_ids
              OR (
                ar.conditions ? 'allowed_module_ids'
                AND (ar.conditions->'allowed_module_ids') ? tl.module_id::text
              )
              -- либо full-режим на target_ref = product_id модуля
              OR (
                tm.product_id IS NOT NULL
                AND ar.target_ref = tm.product_id::text
                AND COALESCE(ar.conditions->>'access_mode','full') = 'full'
              )
            )
        )
        -- entitlement + access_rule product_access → доступ к целевому продукту
        OR (
          tm.product_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.access_rules ar
            JOIN public.entitlements e
              ON e.user_id = _user_id
             AND e.product_id = ar.product_id
             AND e.status = 'active'
             AND (e.expires_at IS NULL OR e.expires_at > now())
              AND public.historical_business_source_is_current(e.user_id,e.product_id,e.meta,e.product_code)
            WHERE ar.is_active = true
              AND ar.grant_target_type = 'product_access'
              -- This conditional Business rule requires the materialized, prior-purchase checked target grant.
              AND ar.id <> '1b497fba-031a-4318-8d9f-2530f1bac116'::uuid
              AND ar.target_ref = tm.product_id::text
          )
        )
      )
  );
$function$
;

ALTER POLICY "Users can view lesson blocks with access" ON public.lesson_blocks USING (
(has_role_v2(auth.uid(), 'admin'::text) OR has_role_v2(auth.uid(), 'super_admin'::text) OR has_permission(auth.uid(), 'content.manage'::text) OR (EXISTS ( SELECT 1
   FROM ((training_lessons tl
     JOIN training_modules tm ON ((tm.id = tl.module_id)))
     JOIN subscriptions_v2 s ON ((s.product_id = tm.product_id)))
  WHERE ((tl.id = lesson_blocks.lesson_id) AND (tl.is_active = true) AND (tm.is_active = true) AND (s.user_id = auth.uid()) AND (s.status = ANY (ARRAY['active'::subscription_status, 'trial'::subscription_status])) AND ((s.access_end_at IS NULL) OR (s.access_end_at > now()))))) OR (EXISTS ( SELECT 1
   FROM (((training_lessons tl
     JOIN training_modules tm ON ((tm.id = tl.module_id)))
     JOIN products_v2 p ON ((p.id = tm.product_id)))
     JOIN entitlements e ON ((e.product_code = p.code)))
  WHERE ((tl.id = lesson_blocks.lesson_id) AND (tl.is_active = true) AND (tm.is_active = true) AND (e.user_id = auth.uid()) AND (e.status = 'active'::text) AND ((e.expires_at IS NULL) OR (e.expires_at > now())) AND public.historical_business_source_is_current(e.user_id,e.product_id,e.meta,e.product_code)))) OR (EXISTS ( SELECT 1
   FROM (((training_lessons tl
     JOIN training_modules tm ON ((tm.id = tl.module_id)))
     JOIN module_access ma ON ((ma.module_id = tl.module_id)))
     JOIN subscriptions_v2 s ON ((s.tariff_id = ma.tariff_id)))
  WHERE ((tl.id = lesson_blocks.lesson_id) AND (tl.is_active = true) AND (tm.is_active = true) AND (s.user_id = auth.uid()) AND (s.status = ANY (ARRAY['active'::subscription_status, 'trial'::subscription_status])) AND ((s.access_end_at IS NULL) OR (s.access_end_at > now()))))) OR (EXISTS ( SELECT 1
   FROM (training_lessons tl
     JOIN access_rules ar ON (((ar.is_active = true) AND (ar.grant_target_type = 'training_content'::text) AND ((ar.conditions -> 'allowed_module_ids'::text) ? (tl.module_id)::text))))
  WHERE ((tl.id = lesson_blocks.lesson_id) AND (tl.is_active = true) AND ((EXISTS ( SELECT 1
           FROM subscriptions_v2 s
          WHERE ((s.user_id = auth.uid()) AND (s.product_id = ar.product_id) AND (s.status = ANY (ARRAY['active'::subscription_status, 'trial'::subscription_status])) AND ((s.access_end_at IS NULL) OR (s.access_end_at > now())) AND ((ar.tariff_id IS NULL) OR (s.tariff_id = ar.tariff_id))))) OR (EXISTS ( SELECT 1
           FROM entitlements e
          WHERE ((e.user_id = auth.uid()) AND (e.product_id = ar.product_id) AND (e.status = 'active'::text) AND ((e.expires_at IS NULL) OR (e.expires_at > now())) AND public.historical_business_source_is_current(e.user_id,e.product_id,e.meta,e.product_code)))))))))
OR EXISTS (
  SELECT 1 FROM public.training_lessons tl JOIN public.training_modules tm ON tm.id=tl.module_id
  WHERE tl.id=lesson_blocks.lesson_id AND tl.is_active AND tm.is_active
    AND tm.product_id = ANY(ARRAY['7101ed3c-7839-4a74-ad95-aa0660369b22','64d9f812-617c-41a8-b3dc-bb113156d6f3','ea98d043-e852-443f-8807-6e77de6a5e1f','99f1f156-f384-417e-bdf8-9203eb3c9d42','d7effaf4-9be0-4ce2-971b-e02fe2a85a9a','abee24cd-5c8b-4111-a6cb-7dee7acf168c','9187db54-8f57-42eb-bbcb-d7103d2459a9','064dd768-de8b-40db-89bc-f8d4a7e442ba','f833c846-a78d-4096-9dac-b8417d588371']::uuid[])
    AND (
      EXISTS (SELECT 1 FROM public.entitlement_sources es WHERE es.user_id=auth.uid()
        AND es.product_id=tm.product_id AND es.status='active' AND es.starts_at<=now()
        AND (es.expires_at IS NULL OR es.expires_at>now()))
      OR EXISTS (SELECT 1 FROM public.subscriptions_v2 ds WHERE ds.user_id=auth.uid()
        AND ds.product_id=tm.product_id AND ds.status::text IN ('active','trial','past_due','canceled')
        AND ds.access_start_at<=now() AND (ds.access_end_at IS NULL OR ds.access_end_at>now()))
    )
)

);

-- A permissive KB-reference policy must not bypass this historical-course access check.
CREATE OR REPLACE FUNCTION public.historical_lesson_access_guard(_user_id uuid, _lesson_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE target_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND _user_id IS DISTINCT FROM auth.uid()
  THEN RETURN false; END IF;
  SELECT tm.product_id INTO target_id FROM public.training_lessons tl
    JOIN public.training_modules tm ON tm.id = tl.module_id WHERE tl.id = _lesson_id;
  IF target_id IS NULL OR target_id <> ALL(ARRAY[
    '7101ed3c-7839-4a74-ad95-aa0660369b22','64d9f812-617c-41a8-b3dc-bb113156d6f3',
    'ea98d043-e852-443f-8807-6e77de6a5e1f','99f1f156-f384-417e-bdf8-9203eb3c9d42',
    'd7effaf4-9be0-4ce2-971b-e02fe2a85a9a','abee24cd-5c8b-4111-a6cb-7dee7acf168c',
    '9187db54-8f57-42eb-bbcb-d7103d2459a9','064dd768-de8b-40db-89bc-f8d4a7e442ba',
    'f833c846-a78d-4096-9dac-b8417d588371']::uuid[])
  THEN RETURN true; END IF;
  IF public.has_role_v2(_user_id,'admin') OR public.has_role_v2(_user_id,'super_admin')
    OR public.has_permission(_user_id,'content.manage')
    OR public.has_admin_section_access(_user_id,'communication','view')
    OR public.has_admin_section_access(_user_id,'forms-hub','view')
  THEN RETURN true; END IF;
  RETURN public.user_has_training_lesson_access(_user_id,_lesson_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.historical_lesson_access_guard(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.historical_lesson_access_guard(uuid,uuid) TO authenticated, service_role;
DROP POLICY IF EXISTS historical_lesson_source_window ON public.training_lessons;
CREATE POLICY historical_lesson_source_window ON public.training_lessons
AS RESTRICTIVE FOR SELECT TO authenticated
USING (public.historical_lesson_access_guard(auth.uid(),id));