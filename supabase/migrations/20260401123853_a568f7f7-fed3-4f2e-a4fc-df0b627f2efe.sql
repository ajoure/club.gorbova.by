
-- 1. Drop unique CONSTRAINT (not index) first
ALTER TABLE site_domain_bindings DROP CONSTRAINT IF EXISTS site_domain_bindings_domain_key;
DROP INDEX IF EXISTS idx_site_domain_bindings_domain;

-- 2. Normalize domains: strip protocol, path, query, fragment, port, trailing dot
UPDATE site_domain_bindings
SET domain = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(trim(domain)),
          '^https?://', ''
        ),
        '/.*$', ''
      ),
      ':[\d]+$', ''
    ),
    '\.+$', ''
  ),
  '\?.*$', ''
);

-- 3. Delete duplicates after normalization (keep oldest)
DELETE FROM site_domain_bindings a
USING site_domain_bindings b
WHERE a.domain = b.domain
  AND a.site_page_id = b.site_page_id
  AND a.id <> b.id
  AND a.created_at > b.created_at;

-- 4. Add is_home column
ALTER TABLE site_domain_bindings ADD COLUMN is_home BOOLEAN NOT NULL DEFAULT false;

-- 5. Backfill: single-binding domains → is_home = true
UPDATE site_domain_bindings SET is_home = true
WHERE id IN (
  SELECT min(id::text)::uuid FROM site_domain_bindings
  GROUP BY domain HAVING count(*) = 1
);

-- 6. New constraints
CREATE UNIQUE INDEX idx_site_domain_binding_unique ON site_domain_bindings(domain, site_page_id);
CREATE UNIQUE INDEX idx_site_domain_one_home ON site_domain_bindings(domain) WHERE is_home = true;
CREATE INDEX idx_site_domain_bindings_domain ON site_domain_bindings(domain);

-- 7. Atomic home page switch RPC with RBAC
CREATE OR REPLACE FUNCTION set_site_home_page(p_domain TEXT, p_page_id UUID)
RETURNS void LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  UPDATE site_domain_bindings SET is_home = false WHERE domain = p_domain AND is_home = true;
  UPDATE site_domain_bindings SET is_home = true WHERE domain = p_domain AND site_page_id = p_page_id;
END;
$$;
