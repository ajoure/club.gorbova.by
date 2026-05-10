-- Read-only admin RPCs for /admin/tenants
CREATE OR REPLACE FUNCTION public.admin_tenants_overview()
RETURNS TABLE(
  tenant_id uuid,
  name text,
  owner_user_id uuid,
  owner_email text,
  owner_full_name text,
  is_personal boolean,
  memberships_count bigint,
  legal_requisites_count bigint,
  individual_requisites_count bigint,
  system_customer_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id AS tenant_id,
    t.name,
    t.owner_user_id,
    u.email::text AS owner_email,
    p.full_name AS owner_full_name,
    t.is_personal,
    (SELECT count(*) FROM tenant_memberships m WHERE m.tenant_id = t.id AND m.is_active) AS memberships_count,
    (SELECT count(*) FROM legal_entities_requisites r WHERE r.tenant_id = t.id) AS legal_requisites_count,
    (SELECT count(*) FROM individual_requisites r WHERE r.tenant_id = t.id) AS individual_requisites_count,
    (
      (SELECT count(*) FROM legal_entities_requisites r WHERE r.tenant_id = t.id AND r.scope = 'system_customer') +
      (SELECT count(*) FROM individual_requisites r WHERE r.tenant_id = t.id AND r.scope = 'system_customer')
    ) AS system_customer_count,
    t.created_at,
    t.updated_at
  FROM tenants t
  LEFT JOIN auth.users u ON u.id = t.owner_user_id
  LEFT JOIN profiles p ON p.user_id = t.owner_user_id
  WHERE has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin')
  ORDER BY t.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_tenants_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_tenants_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_tenants_stats()
RETURNS TABLE(
  tenants_total bigint,
  memberships_total bigint,
  tenants_with_requisites bigint,
  tenants_without_requisites bigint,
  legal_system_customer bigint,
  individual_system_customer bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM tenants),
    (SELECT count(*) FROM tenant_memberships WHERE is_active),
    (SELECT count(DISTINCT t.id) FROM tenants t
       WHERE EXISTS (SELECT 1 FROM legal_entities_requisites r WHERE r.tenant_id = t.id)
          OR EXISTS (SELECT 1 FROM individual_requisites r WHERE r.tenant_id = t.id)),
    (SELECT count(*) FROM tenants t
       WHERE NOT EXISTS (SELECT 1 FROM legal_entities_requisites r WHERE r.tenant_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM individual_requisites r WHERE r.tenant_id = t.id)),
    (SELECT count(*) FROM legal_entities_requisites WHERE scope = 'system_customer'),
    (SELECT count(*) FROM individual_requisites WHERE scope = 'system_customer')
  WHERE has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin');
$$;

REVOKE ALL ON FUNCTION public.admin_tenants_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_tenants_stats() TO authenticated;