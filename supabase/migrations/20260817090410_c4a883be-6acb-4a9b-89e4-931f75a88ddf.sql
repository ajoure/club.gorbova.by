-- The CRM automation worker invokes crm_task_create with the service-role JWT.
-- PostgREST exposes that role in request.jwt.claims, while the legacy
-- request.jwt.claim.role setting may be absent.  Read both representations so
-- that only an actual service-role JWT bypasses the employee-role check.
CREATE OR REPLACE FUNCTION public._crm_tasks_assert_staff()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := (select auth.uid());
  _role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF _role = 'service_role' THEN
    RETURN;
  END IF;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role_v2(_uid, 'employee')
    OR public.has_role_v2(_uid, 'admin')
    OR public.has_role_v2(_uid, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'forbidden_not_staff' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_tasks_assert_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_tasks_assert_staff() TO authenticated, service_role;

-- Keep the current Deals/edit authorization contract while accepting the
-- canonical PostgREST JWT-claims representation used by service-role workers.
-- This supersedes the immediately preceding worker fix without changing the
-- permissions of staff who have section access rather than a global role.
CREATE OR REPLACE FUNCTION public._crm_tasks_assert_staff()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_jwt_role = 'service_role' THEN
    RETURN;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role_v2(v_user_id, 'employee')
    OR public.has_admin_section_access(v_user_id, 'deals', 'edit')
  ) THEN
    RAISE EXCEPTION 'forbidden_not_staff' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_tasks_assert_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_tasks_assert_staff() TO authenticated, service_role;