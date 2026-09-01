-- Products 2 / payments: least-privilege directory for the manager filter.
--
-- The payments page is gated by entitlements.view, while direct SELECT from
-- user_roles_v2 requires users.view. Keep those capabilities separate and
-- expose only the stable user ID plus a non-sensitive display label.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_payment_manager_options_v1()
RETURNS TABLE (
  user_id uuid,
  label text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_is_service_role boolean :=
    coalesce((SELECT auth.role()), '') = 'service_role';
BEGIN
  IF v_actor IS NULL AND NOT v_is_service_role THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_service_role
     AND NOT public.has_permission(v_actor, 'entitlements.view') THEN
    RAISE EXCEPTION 'forbidden_payments_view' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    user_role.user_id,
    coalesce(
      max(nullif(btrim(profile.full_name), '')),
      'Менеджер ' || left(user_role.user_id::text, 8)
    ) AS label
  FROM public.user_roles_v2 user_role
  JOIN public.roles role_row
    ON role_row.id = user_role.role_id
  LEFT JOIN public.profiles profile
    ON profile.user_id = user_role.user_id
  WHERE role_row.code <> 'user'
  GROUP BY user_role.user_id
  ORDER BY 2, 1;
END;
$$;

COMMENT ON FUNCTION public.get_payment_manager_options_v1() IS
  'Minimal staff directory for authenticated users allowed to view payments.';

REVOKE ALL ON FUNCTION public.get_payment_manager_options_v1()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_manager_options_v1()
  TO authenticated, service_role;