-- Restore privileged client-account actions for RBAC v3 roles.
--
-- The frontend role editor grants none/view/edit/manage per admin section.
-- public.has_permission() already maps most legacy action codes to those
-- section levels, but users.reset_password and users.impersonate were omitted.
-- As a result, a role with full (manage) Contacts access could see the contact
-- card while both the UI and users-admin-actions denied these operations.

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_section text;
  v_level   text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;

  -- Preserve explicit legacy grants.
  IF EXISTS (
    SELECT 1
    FROM public.user_roles_v2 ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _user_id
      AND p.code = _permission_code
  ) THEN
    RETURN true;
  END IF;

  -- Resolve legacy permission checks through the canonical RBAC v3 section.
  CASE _permission_code
    WHEN 'users.view'          THEN v_section := 'contacts';      v_level := 'view';
    WHEN 'users.update'        THEN v_section := 'contacts';      v_level := 'edit';
    WHEN 'users.block'         THEN v_section := 'contacts';      v_level := 'manage';
    WHEN 'users.delete'        THEN v_section := 'contacts';      v_level := 'manage';
    WHEN 'users.reset_password' THEN v_section := 'contacts';     v_level := 'manage';
    WHEN 'users.impersonate'   THEN v_section := 'contacts';      v_level := 'manage';
    WHEN 'deals.view'          THEN v_section := 'deals';         v_level := 'view';
    WHEN 'deals.edit'          THEN v_section := 'deals';         v_level := 'edit';
    WHEN 'deals.manage'        THEN v_section := 'deals';         v_level := 'manage';
    WHEN 'deals.delete'        THEN v_section := 'deals';         v_level := 'manage';
    WHEN 'deals.create'        THEN v_section := 'deals';         v_level := 'edit';
    WHEN 'payments.view'       THEN v_section := 'payments';      v_level := 'view';
    WHEN 'payments.manage'     THEN v_section := 'payments';      v_level := 'manage';
    WHEN 'entitlements.view'   THEN v_section := 'payments';      v_level := 'view';
    WHEN 'entitlements.manage' THEN v_section := 'payments';      v_level := 'manage';
    WHEN 'support.view'        THEN v_section := 'support';       v_level := 'view';
    WHEN 'support.manage'      THEN v_section := 'support';       v_level := 'edit';
    WHEN 'telegram.view'       THEN v_section := 'communication'; v_level := 'view';
    WHEN 'telegram.manage'     THEN v_section := 'communication'; v_level := 'manage';
    WHEN 'roles.view'          THEN v_section := 'roles';         v_level := 'view';
    WHEN 'roles.manage'        THEN v_section := 'roles';         v_level := 'manage';
    WHEN 'admins.manage'       THEN v_section := 'roles';         v_level := 'manage';
    WHEN 'news.view'           THEN v_section := 'editorial';     v_level := 'view';
    WHEN 'news.edit'           THEN v_section := 'editorial';     v_level := 'edit';
    WHEN 'content.edit'        THEN v_section := 'editorial';     v_level := 'edit';
    WHEN 'audit.view'          THEN v_section := 'roles';         v_level := 'view';
    ELSE
      RETURN false;
  END CASE;

  RETURN public.has_admin_section_access(_user_id, v_section, v_level);
END;
$$;

-- CREATE OR REPLACE keeps the existing owner and ACL. Reassert the intended
-- callable roles and remove accidental public/anonymous execution.
REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text)
  TO authenticated, service_role;