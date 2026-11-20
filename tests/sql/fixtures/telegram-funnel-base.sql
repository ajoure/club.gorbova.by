-- Synthetic local-only fixture. No application/runtime data.
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT CASE WHEN $1='00000000-0000-4000-8000-000000000001'::uuid THEN true ELSE NULL::boolean END $$;
 CREATE FUNCTION public.has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
 CREATE TABLE public.telegram_bots(id uuid PRIMARY KEY,status text);INSERT INTO telegram_bots VALUES('00000000-0000-4000-8000-000000000003','active');
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),telegram_user_id bigint,telegram_link_bot_id uuid,is_archived boolean DEFAULT false);
 INSERT INTO profiles VALUES('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002',100,'00000000-0000-4000-8000-000000000003',false);
 CREATE TABLE public.telegram_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,bot_id uuid,telegram_user_id bigint,transport text);
 GRANT USAGE ON SCHEMA auth TO authenticated,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;
ALTER TABLE profiles ADD full_name text,ADD country text,ADD city text,ADD source text,ADD status text DEFAULT 'active',ADD marketing_consent boolean,ADD was_club_member boolean,ADD merged_to_profile_id uuid;
CREATE TABLE orders_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),profile_id uuid,user_id uuid,product_id uuid,tariff_id uuid,flow_id uuid,status text,is_deleted boolean DEFAULT false,is_trial boolean DEFAULT false,meta jsonb DEFAULT '{}',purchase_snapshot jsonb DEFAULT '{}',final_price numeric,currency text,reconcile_source text,deal_date timestamptz);
CREATE TABLE payments_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,is_deleted boolean DEFAULT false,status text,transaction_type text,currency text,amount numeric,refunded_amount numeric DEFAULT 0);
CREATE TABLE entitlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),profile_id uuid,user_id uuid,product_id uuid,order_id uuid,status text,expires_at timestamptz,meta jsonb DEFAULT '{}');
CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),profile_id uuid,user_id uuid,product_id uuid,tariff_id uuid,flow_id uuid,order_id uuid,status text,access_start_at timestamptz,access_end_at timestamptz,is_trial boolean DEFAULT false,meta jsonb DEFAULT '{}');
CREATE TABLE flows(id uuid PRIMARY KEY,start_date timestamptz);

CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,action text,entity_type text,entity_id text,meta jsonb);

ALTER TABLE profiles ADD telegram_link_status text DEFAULT 'active';
ALTER TABLE profiles ADD CONSTRAINT profiles_telegram_user_id_key UNIQUE(telegram_user_id);
ALTER TABLE telegram_messages ADD direction text DEFAULT 'incoming',ADD status text DEFAULT 'received';
