-- Create deterministic SQL function for selecting demo profiles
-- This ensures consistent selection across all cleanup operations

CREATE OR REPLACE FUNCTION get_demo_profile_ids()
RETURNS TABLE(profile_id uuid, auth_user_id uuid, email text)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, user_id, email 
  FROM profiles
  WHERE email LIKE 'user+%@example.com'
     OR (full_name = 'Пользователь Демо' AND email LIKE '%@example.com');
$$;

-- Grant execute to service role only
REVOKE ALL ON FUNCTION get_demo_profile_ids FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_demo_profile_ids TO service_role;