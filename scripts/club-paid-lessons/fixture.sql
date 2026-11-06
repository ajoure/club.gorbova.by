-- Synthetic, disposable PostgreSQL database only. Never run against production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE sandbox_exec_hdjgkjceownmmnrqqtuz NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION public.has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,user_id uuid);
CREATE TABLE public.tariffs(id uuid PRIMARY KEY);
CREATE TABLE public.training_modules(id uuid PRIMARY KEY,parent_module_id uuid,product_id uuid,is_active boolean NOT NULL);
CREATE TABLE public.training_lessons(id uuid PRIMARY KEY,module_id uuid,content_month text,is_active boolean NOT NULL,released boolean DEFAULT true);
CREATE TABLE public.subscriptions_v2(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,product_id uuid,tariff_id uuid,status text,access_start_at timestamptz,access_end_at timestamptz);
CREATE TABLE public.payments_v2(id uuid PRIMARY KEY,profile_id uuid,status text,currency text,amount numeric,refunded_amount numeric,is_deleted boolean,transaction_type text DEFAULT 'payment');
CREATE TABLE public.access_rules(id uuid PRIMARY KEY,product_id uuid,tariff_id uuid,grant_target_type text,target_ref text,is_active boolean,conditions jsonb);
CREATE TABLE public.orders_v2(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,tariff_id uuid,status text,meta jsonb);
CREATE FUNCTION public.training_release_guard(l uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT is_active AND released FROM public.training_lessons WHERE id=l),false);
$$;
CREATE FUNCTION private.cb2_module_in_scope(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION private.cb2_user_allowed(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION private.training_lesson_access_before_cb2(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT $2='00000000-0000-0000-0000-000000000099'::uuid;
$$;
CREATE FUNCTION public.historical_lesson_access_guard(u uuid,l uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT public.user_has_training_lesson_access(u,l);
$$;
