-- Restore executable role and permission helpers for signed-in application users.
--
-- The helpers are SECURITY DEFINER and are used in RLS policies.  They must be
-- callable by `authenticated`; granting them to `PUBLIC` would also expose the
-- RPCs to anonymous callers and masks an authorization failure as a database
-- error.  `service_role` needs the same explicit grant for backend flows that
-- perform role checks.
DO $$
BEGIN
  IF to_regprocedure('public.has_permission(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing required function public.has_permission(uuid,text)';
  END IF;

  IF to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'Missing required function public.has_role(uuid,public.app_role)';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated, service_role;
