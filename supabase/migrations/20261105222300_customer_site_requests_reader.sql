-- A read projection of existing authenticated website requests. No business DML.
-- One atomic managed migration; the surrounding transaction also covers the ACL.
DO $migration$
BEGIN
  EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.get_my_site_requests()
RETURNS TABLE (
  id uuid,
  kind text,
  source_id uuid,
  submitted_at timestamptz,
  product_name text,
  tariff_name text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $reader$
DECLARE
  v_actor uuid := auth.uid();
  v_profile uuid;
  v_profile_count bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*), (pg_catalog.array_agg(p.id ORDER BY p.id))[1]
    INTO v_profile_count, v_profile
  FROM public.profiles AS p
  WHERE p.user_id = v_actor
    AND p.status = 'active'
    AND p.is_archived IS NOT TRUE
    AND p.merged_to_profile_id IS NULL;

  IF v_profile_count <> 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH verified AS MATERIALIZED (
    SELECT o.id AS order_id, o.product_id, o.tariff_id, o.meta AS order_meta,
           submission.id AS submission_id, submission.created_at,
           product.name AS product_title, tariff.name AS tariff_title
    FROM public.orders_v2 AS o
    JOIN public.site_form_submissions AS submission
      ON submission.order_id = o.id
     AND submission.profile_id = v_profile
     AND submission.source = 'site_form_auth'
     AND submission.status = 'processed'
     AND pg_catalog.jsonb_typeof(submission.metadata) = 'object'
     AND submission.metadata -> 'auth_mode' = 'true'::jsonb
     AND submission.metadata ->> 'user_id' = v_actor::text
     AND submission.metadata ->> 'product_id' = o.product_id::text
     AND submission.metadata ->> 'tariff_id' = o.tariff_id::text
    JOIN public.site_pages AS page
      ON page.id = submission.page_id
     AND page.workspace_id = submission.workspace_id
    JOIN public.products_v2 AS product
      ON product.id = o.product_id
     AND product.status IS DISTINCT FROM 'deleted'
    JOIN public.tariffs AS tariff
      ON tariff.id = o.tariff_id AND tariff.product_id = product.id
    WHERE o.profile_id = v_profile
      AND (o.user_id IS NULL OR o.user_id = v_actor)
      AND o.is_deleted IS NOT TRUE
      AND o.deleted_at IS NULL
      AND o.reconcile_source = 'site_form'
      AND pg_catalog.jsonb_typeof(o.meta) = 'object'
      AND o.meta ->> 'source' = 'site_form'
      AND o.meta ->> 'page_id' = submission.page_id::text
      AND o.meta ->> 'workspace_id' = submission.workspace_id::text
  ), first_per_order AS (
    SELECT DISTINCT ON (request.order_id)
           request.order_id, request.submission_id, request.created_at,
           request.product_title, request.tariff_title
    FROM verified AS request
    -- Origin validation is independent of repeat submissions. A later valid
    -- request cannot legitimise a foreign, malformed or legacy origin.
    WHERE EXISTS (
      SELECT 1 FROM verified AS origin
      WHERE origin.order_id = request.order_id
        AND origin.submission_id::text = request.order_meta ->> 'submission_id'
    )
    -- A course row alone is not trusted: legacy public INSERT accepts its
    -- metadata. Require the order's link, both owners, and the backlink.
    AND NOT EXISTS (
      SELECT 1 FROM public.course_preregistrations AS course
      WHERE course.id::text = request.order_meta ->> 'preregistration_id'
        AND course.user_id = v_actor
        AND pg_catalog.jsonb_typeof(course.meta) = 'object'
        AND course.meta ->> 'order_id' = request.order_id::text
        AND course.meta ->> 'product_id' = request.product_id::text
        AND course.meta ->> 'tariff_id' = request.tariff_id::text
    )
    ORDER BY request.order_id, request.created_at, request.submission_id
  )
  SELECT first.order_id, 'site_request'::text, first.submission_id,
         first.created_at, first.product_title, first.tariff_title, 'received'::text
  FROM first_per_order AS first
  -- No silent LIMIT: return the complete verified own history.
  ORDER BY first.created_at DESC, first.order_id DESC;
END;
$reader$;
  $ddl$;
  REVOKE ALL ON FUNCTION public.get_my_site_requests() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_my_site_requests() TO authenticated;
  COMMENT ON FUNCTION public.get_my_site_requests() IS
    'Own authenticated website request history only; no registration, payment or access mutation.';
END;
$migration$;
