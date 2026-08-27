-- Payment-link RBAC alignment.
--
-- Contract:
--   * every holder of payments:view can list payment links;
--   * every holder of payments:edit can create and safely update/invalidate them;
--   * the canonical manager role receives payments:edit and an explicit links override;
--   * destructive DELETE remains payments:manage only.

WITH manager_role AS (
  SELECT id
  FROM public.roles
  WHERE code = 'menedzher'
), payments_section AS (
  SELECT id
  FROM public.admin_section
  WHERE code = 'payments'
)
INSERT INTO public.role_admin_section_access (
  role_id,
  section_id,
  access_level,
  metadata
)
SELECT
  manager_role.id,
  payments_section.id,
  'edit',
  jsonb_build_object('source', 'payment_links_manager_access')
FROM manager_role
CROSS JOIN payments_section
ON CONFLICT (role_id, section_id) DO UPDATE SET
  access_level = CASE
    WHEN public.role_admin_section_access.access_level = 'manage' THEN 'manage'
    ELSE 'edit'
  END,
  metadata = COALESCE(public.role_admin_section_access.metadata, '{}'::jsonb)
    || jsonb_build_object('source', 'payment_links_manager_access'),
  updated_at = now();

WITH manager_role AS (
  SELECT id
  FROM public.roles
  WHERE code = 'menedzher'
), links_resource AS (
  SELECT resource.id
  FROM public.admin_resource resource
  JOIN public.admin_section section_row ON section_row.id = resource.section_id
  WHERE section_row.code = 'payments'
    AND resource.code = 'links'
)
INSERT INTO public.role_admin_resource_access (
  role_id,
  resource_id,
  access_level,
  metadata
)
SELECT
  manager_role.id,
  links_resource.id,
  'edit',
  jsonb_build_object('source', 'payment_links_manager_access')
FROM manager_role
CROSS JOIN links_resource
ON CONFLICT (role_id, resource_id) DO UPDATE SET
  access_level = CASE
    WHEN public.role_admin_resource_access.access_level = 'manage' THEN 'manage'
    ELSE 'edit'
  END,
  metadata = COALESCE(public.role_admin_resource_access.metadata, '{}'::jsonb)
    || jsonb_build_object('source', 'payment_links_manager_access'),
  updated_at = now();

CREATE OR REPLACE FUNCTION public.get_admin_payment_links_v1(
  p_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 1000
)
RETURNS SETOF public.payment_links_enriched_v
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_admin_section_access(auth.uid(), 'payments', 'view') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.payment_links_enriched_v v
  WHERE p_since IS NULL OR v.updated_at > p_since
  ORDER BY v.created_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_payment_links_v1(timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_payment_links_v1(timestamptz, integer) TO authenticated;

DROP POLICY IF EXISTS "Admins can read payment links" ON public.payment_links;
DROP POLICY IF EXISTS "Admins can insert payment links" ON public.payment_links;
DROP POLICY IF EXISTS "Admins can update payment links" ON public.payment_links;
DROP POLICY IF EXISTS "Admins can delete payment links" ON public.payment_links;
DROP POLICY IF EXISTS "Admins can manage payment links" ON public.payment_links;
DROP POLICY IF EXISTS payment_links_payments_view ON public.payment_links;
DROP POLICY IF EXISTS payment_links_payments_insert ON public.payment_links;
DROP POLICY IF EXISTS payment_links_payments_update ON public.payment_links;
DROP POLICY IF EXISTS payment_links_payments_delete ON public.payment_links;

CREATE POLICY payment_links_payments_view
ON public.payment_links
FOR SELECT
TO authenticated
USING (public.has_admin_section_access(auth.uid(), 'payments', 'view'));

CREATE POLICY payment_links_payments_insert
ON public.payment_links
FOR INSERT
TO authenticated
WITH CHECK (public.has_admin_section_access(auth.uid(), 'payments', 'edit'));

CREATE POLICY payment_links_payments_update
ON public.payment_links
FOR UPDATE
TO authenticated
USING (public.has_admin_section_access(auth.uid(), 'payments', 'edit'))
WITH CHECK (public.has_admin_section_access(auth.uid(), 'payments', 'edit'));

CREATE POLICY payment_links_payments_delete
ON public.payment_links
FOR DELETE
TO authenticated
USING (public.has_admin_section_access(auth.uid(), 'payments', 'manage'));

COMMENT ON FUNCTION public.get_admin_payment_links_v1(timestamptz, integer) IS
  'Lists payment links for holders of payments:view; writes remain guarded by payments:edit.';