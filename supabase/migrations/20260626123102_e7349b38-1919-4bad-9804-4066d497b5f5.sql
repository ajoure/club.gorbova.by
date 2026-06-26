
-- TEST-ONLY: Создание временной view-only роли для smoke-теста RBAC v3
DO $$
DECLARE
  v_role_id uuid;
  v_section_comm uuid := '8d187184-80ac-4c81-8f2a-0d34e81b7500';
  v_qa_user uuid := '638a13ec-62a8-47b3-90d9-bc3a4e22c174';
  v_user_role uuid := '159eceef-5cd8-46d5-b238-ddf0c5cf77fa';
BEGIN
  -- Создать роль (idempotent)
  INSERT INTO roles (code, name, description)
  VALUES ('qa_comm_view', 'QA Communication View-only (test-only)', 'TEST-ONLY: communication:view, no manage. Cleanup after smoke.')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_role_id;

  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM roles WHERE code = 'qa_comm_view';
  END IF;

  -- Дать communication:view (без manage)
  INSERT INTO role_admin_section_access (role_id, section_id, access_level)
  VALUES (v_role_id, v_section_comm, 'view')
  ON CONFLICT (role_id, section_id) DO UPDATE SET access_level = 'view';

  -- Удалить базовую "user" роль и назначить qa_comm_view
  DELETE FROM user_roles_v2 WHERE user_id = v_qa_user AND role_id = v_user_role;
  INSERT INTO user_roles_v2 (user_id, role_id)
  VALUES (v_qa_user, v_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END $$;
