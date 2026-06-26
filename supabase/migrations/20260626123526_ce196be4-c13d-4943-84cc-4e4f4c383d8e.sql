
-- CLEANUP: remove TEST-ONLY qa_comm_view role and restore baseline
DO $$
DECLARE
  v_role_id uuid;
  v_qa_user uuid := '638a13ec-62a8-47b3-90d9-bc3a4e22c174';
  v_user_role uuid := '159eceef-5cd8-46d5-b238-ddf0c5cf77fa';
BEGIN
  SELECT id INTO v_role_id FROM roles WHERE code = 'qa_comm_view';
  IF v_role_id IS NOT NULL THEN
    DELETE FROM role_admin_section_access WHERE role_id = v_role_id;
    DELETE FROM role_admin_resource_access WHERE role_id = v_role_id;
    DELETE FROM user_roles_v2 WHERE role_id = v_role_id;
    DELETE FROM roles WHERE id = v_role_id;
  END IF;

  -- restore base 'user' role for qa.user
  INSERT INTO user_roles_v2 (user_id, role_id)
  VALUES (v_qa_user, v_user_role)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END $$;
