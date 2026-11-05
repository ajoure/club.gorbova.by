-- Synthetic, isolated PostgreSQL fixture. Never use a project connection.
DO $fixture$
BEGIN
  IF current_database() <> 'contact_rpc_guard_test' OR current_user <> 'postgres'
     OR to_regclass('public.profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'Fresh synthetic contact_rpc_guard_test database required';
  END IF;
END;
$fixture$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE sandbox_exec_hdjgkjceownmmnrqqtuz NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role, sandbox_exec_hdjgkjceownmmnrqqtuz;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$$;

CREATE TABLE public.fixture_roles(user_id uuid, code text);
CREATE TABLE public.fixture_grants(user_id uuid, section_code text, resource_code text, access_level text);
CREATE FUNCTION public.has_role_v2(_user_id uuid, _role_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.fixture_roles r WHERE r.user_id = _user_id AND r.code = _role_code);
$$;
CREATE FUNCTION public.get_admin_access(_user_id uuid)
RETURNS TABLE(section_code text, resource_code text, access_level text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT g.section_code, g.resource_code, g.access_level FROM public.fixture_grants g WHERE g.user_id = _user_id;
$$;

INSERT INTO public.fixture_roles VALUES
  ('00000000-0000-0000-0000-000000001001', 'user'),
  ('00000000-0000-0000-0000-000000001002', 'staff'),
  ('00000000-0000-0000-0000-000000001003', 'custom_viewer'),
  ('00000000-0000-0000-0000-000000001004', 'custom_editor'),
  ('00000000-0000-0000-0000-000000001005', 'custom_manager'),
  ('00000000-0000-0000-0000-000000001006', 'admin'),
  ('00000000-0000-0000-0000-000000001007', 'super_admin');
INSERT INTO public.fixture_grants VALUES
  ('00000000-0000-0000-0000-000000001002', 'communication', NULL, 'manage'),
  ('00000000-0000-0000-0000-000000001002', 'contacts', 'unrelated_resource', 'manage'),
  ('00000000-0000-0000-0000-000000001003', 'contacts', NULL, 'view'),
  ('00000000-0000-0000-0000-000000001004', 'contacts', NULL, 'edit'),
  ('00000000-0000-0000-0000-000000001005', 'contacts', NULL, 'manage');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, user_id uuid, email text, full_name text, first_name text,
  last_name text, phone text, telegram_username text, telegram_user_id bigint,
  status text DEFAULT 'active', is_archived boolean DEFAULT false,
  created_at timestamptz DEFAULT '2026-01-01 00:00:00+00', duplicate_flag text,
  avatar_url text, last_seen_at timestamptz, loyalty_score integer,
  loyalty_ai_summary text, loyalty_status_reason text, loyalty_proofs jsonb,
  loyalty_analyzed_messages_count integer, loyalty_updated_at timestamptz,
  communication_style jsonb, merged_to_profile_id uuid
);
CREATE TYPE public.order_status AS ENUM ('paid','pending','failed');
CREATE TABLE public.orders_v2(profile_id uuid, status public.order_status, created_at timestamptz);
CREATE TABLE public.companies(id uuid PRIMARY KEY, status text, full_name text, short_name text, public_id text, unp_normalized text);
CREATE TABLE public.company_contacts(profile_id uuid, company_id uuid);

-- Deny ordinary table access. Target function owner postgres bypasses this RLS,
-- so the negative tests exercise the new function guard rather than table RLS.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles, public.orders_v2, public.companies, public.company_contacts TO authenticated;

INSERT INTO public.profiles(id, user_id, email, full_name, phone, created_at) VALUES
  ('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000003001',' Fixture.Duplicate@example.invalid ','Fixture Alpha','+000 123 456 789','2026-01-01 01:00:00+00'),
  ('00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000003002','fixture.duplicate@example.invalid','Fixture Bravo','000123456789','2026-01-01 02:00:00+00'),
  ('00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000003003','archived@example.invalid','Fixture Archived','000000000003','2026-01-01 03:00:00+00'),
  ('00000000-0000-0000-0000-000000002004','00000000-0000-0000-0000-000000003004','merged@example.invalid','Fixture Merged','000000000004','2026-01-01 04:00:00+00'),
  ('00000000-0000-0000-0000-000000002005','00000000-0000-0000-0000-000000003005','banned@example.invalid','Fixture Banned','000000000005','2026-01-01 05:00:00+00'),
  ('00000000-0000-0000-0000-000000002006',NULL,'noaccount@example.invalid','Fixture No Account','000000000006','2026-01-01 06:00:00+00');
UPDATE public.profiles SET status='archived', is_archived=true WHERE id='00000000-0000-0000-0000-000000002003';
UPDATE public.profiles SET merged_to_profile_id='00000000-0000-0000-0000-000000002001' WHERE id='00000000-0000-0000-0000-000000002004';
UPDATE public.profiles SET status='banned' WHERE id='00000000-0000-0000-0000-000000002005';
-- Source loyalty_score is integer; the SQL RPC exposes numeric. Cover
-- non-null, null and negative fixture values so PL/pgSQL preserves coercion.
UPDATE public.profiles SET loyalty_score=5,
  first_name='Fixture First',last_name='Fixture Last',telegram_username='fixture_alpha',telegram_user_id=101,
  duplicate_flag='fixture-duplicate',avatar_url='https://example.invalid/fixture-avatar',
  last_seen_at='2026-01-01 10:00:00+00',loyalty_ai_summary='Synthetic summary',
  loyalty_status_reason='Synthetic reason',loyalty_proofs='[{"fixture":true}]',
  loyalty_analyzed_messages_count=3,loyalty_updated_at='2026-01-01 11:00:00+00',
  communication_style='{"fixture":"plain"}'
WHERE id='00000000-0000-0000-0000-000000002001';
UPDATE public.profiles SET loyalty_score=-2 WHERE id='00000000-0000-0000-0000-000000002003';
INSERT INTO public.orders_v2 VALUES
  ('00000000-0000-0000-0000-000000002001','paid','2026-01-02 00:00:00+00'),
  ('00000000-0000-0000-0000-000000002001','paid','2026-01-03 00:00:00+00'),
  ('00000000-0000-0000-0000-000000002002','paid','2026-01-04 00:00:00+00'),
  ('00000000-0000-0000-0000-000000002003','paid','2026-01-05 00:00:00+00'),
  ('00000000-0000-0000-0000-000000002004','pending','2026-01-06 00:00:00+00');
INSERT INTO public.companies VALUES
  ('00000000-0000-0000-0000-000000004001','active','Fixture Company','FixtureCo','FIX-COMPANY','000000000');
INSERT INTO public.company_contacts VALUES
  ('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000004001'),
  ('00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000004001');

CREATE TABLE public.fixture_safety_marker(marker text PRIMARY KEY);
INSERT INTO public.fixture_safety_marker VALUES ('synthetic-contact-rpc-only');
