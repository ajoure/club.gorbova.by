
CREATE OR REPLACE FUNCTION public.get_admin_payment_links_v1(
  p_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 1000
)
RETURNS SETOF public.payment_links_enriched_v
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- Только admin/super_admin
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.code IN ('admin','super_admin')
    )
  ) THEN
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

REVOKE ALL ON FUNCTION public.get_admin_payment_links_v1(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_payment_links_v1(timestamptz, integer) TO authenticated;
