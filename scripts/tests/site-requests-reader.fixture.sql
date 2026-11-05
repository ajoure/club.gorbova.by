-- Synthetic isolated PostgreSQL fixture. Never use against an application DB.
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, user_id uuid, status text, is_archived boolean,
  merged_to_profile_id uuid, email text DEFAULT 'DO_NOT_RETURN_CONTACT'
);
CREATE TABLE public.products_v2 (id uuid PRIMARY KEY, name text, status text, is_active boolean DEFAULT true);
CREATE TABLE public.tariffs (id uuid PRIMARY KEY, product_id uuid, name text, is_active boolean DEFAULT true);
CREATE TABLE public.site_pages (id uuid PRIMARY KEY, workspace_id uuid);
CREATE TABLE public.orders_v2 (
  id uuid PRIMARY KEY, profile_id uuid, user_id uuid, product_id uuid,
  tariff_id uuid, status text, is_deleted boolean, deleted_at timestamptz,
  reconcile_source text, meta jsonb, final_price numeric DEFAULT 0
);
CREATE TABLE public.site_form_submissions (
  id uuid PRIMARY KEY, profile_id uuid, order_id uuid, page_id uuid,
  workspace_id uuid, source text, status text, metadata jsonb,
  created_at timestamptz, form_data jsonb DEFAULT '{"private":"DO_NOT_RETURN_ANSWERS"}'
);
CREATE TABLE public.course_preregistrations (id uuid PRIMARY KEY, user_id uuid, meta jsonb);
CREATE TABLE public.payments_v2 (id uuid PRIMARY KEY, payload text);
CREATE TABLE public.entitlements (id uuid PRIMARY KEY, payload text);
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY, payload text);
CREATE TABLE public.domain_events (id uuid PRIMARY KEY, payload text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY, payload text);

INSERT INTO profiles(id,user_id,status,is_archived) VALUES
 ('10000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000001','active',false),
 ('10000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000002','active',false);
INSERT INTO products_v2(id,name,status) VALUES
 ('10000000-0000-0000-0000-000000000301','Synthetic long course title with a genuine historical website request','active'),
 ('10000000-0000-0000-0000-000000000302','Different product','active');
INSERT INTO tariffs(id,product_id,name) VALUES
 ('10000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000301','Synthetic standard'),
 ('10000000-0000-0000-0000-000000000402','10000000-0000-0000-0000-000000000302','Different tariff');
-- The all-zero workspace is a valid stored identity, not an absent UUID.
INSERT INTO site_pages VALUES
 ('10000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000000'),
 ('10000000-0000-0000-0000-000000000502','10000000-0000-0000-0000-000000000010');
INSERT INTO orders_v2(id,profile_id,user_id,product_id,tariff_id,status,is_deleted,reconcile_source,meta) VALUES
 ('10000000-0000-0000-0000-000000000601','10000000-0000-0000-0000-000000000101',NULL,
  '10000000-0000-0000-0000-000000000301','10000000-0000-0000-0000-000000000401','draft',false,'site_form',
  '{"source":"site_form","submission_id":"10000000-0000-0000-0000-000000000701","page_id":"10000000-0000-0000-0000-000000000501","workspace_id":"00000000-0000-0000-0000-000000000000","private":"DO_NOT_RETURN_CRM_META"}');
INSERT INTO site_form_submissions(id,profile_id,order_id,page_id,workspace_id,source,status,metadata,created_at) VALUES
 ('10000000-0000-0000-0000-000000000701','10000000-0000-0000-0000-000000000101',
  '10000000-0000-0000-0000-000000000601','10000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000000','site_form_auth','processed',
  '{"auth_mode":true,"user_id":"10000000-0000-0000-0000-000000000001","product_id":"10000000-0000-0000-0000-000000000301","tariff_id":"10000000-0000-0000-0000-000000000401"}',
  '2026-02-03T08:10:00Z');
-- An unrelated older course preregistration must remain unchanged.
INSERT INTO course_preregistrations VALUES
 ('10000000-0000-0000-0000-000000000800','10000000-0000-0000-0000-000000000001',
  '{"product_id":"10000000-0000-0000-0000-000000000302","legacy_code":"unrelated_course"}');

-- RLS mirrors the relevant production read boundary, including the legacy
-- permissive preregistration INSERT. It deliberately gives no own form SELECT.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_preregistrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON profiles FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY own_order ON orders_v2 FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY own_course ON course_preregistrations FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY legacy_course_insert ON course_preregistrations FOR INSERT TO authenticated WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated,anon;
