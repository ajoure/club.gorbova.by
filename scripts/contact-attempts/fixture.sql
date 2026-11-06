CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('fixture.subject',true),'')::uuid $$;
CREATE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('fixture.allowed',true)='yes' $$;
CREATE TABLE profiles(id uuid,user_id uuid);
CREATE TABLE subscriptions_v2(id uuid,profile_id uuid,user_id uuid);
CREATE TABLE provider_subscriptions(id uuid,subscription_v2_id uuid,profile_id uuid,user_id uuid,provider text,provider_subscription_id text);
CREATE TABLE orders_v2(id uuid,profile_id uuid,user_id uuid);
CREATE TABLE payments_v2(id uuid,provider text,provider_payment_id text);
CREATE TABLE payment_reconcile_queue(id uuid,bepaid_uid text,amount numeric,currency text,paid_at timestamptz,created_at timestamptz,provider text,source text,raw_payload jsonb,is_fee boolean,has_conflict boolean,matched_profile_id uuid,matched_order_id uuid,status_normalized text,transaction_type text);
INSERT INTO profiles VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
INSERT INTO subscriptions_v2 SELECT '00000000-0000-0000-0000-000000000003',id,user_id FROM profiles;
INSERT INTO provider_subscriptions SELECT '00000000-0000-0000-0000-000000000004',s.id,s.profile_id,s.user_id,'bepaid','sbs_fixture' FROM subscriptions_v2 s;
INSERT INTO payment_reconcile_queue(id,bepaid_uid,amount,currency,paid_at,created_at,provider,source,raw_payload,status_normalized,transaction_type)
 SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'uid'||i,250,'BYN','2026-11-04T03:01:43Z','2026-11-04T03:01:44Z','bepaid','webhook',jsonb_build_object('id','sbs_fixture','state','failed_attempt','transaction',jsonb_build_object('uid','uid'||i,'status','failed','currency','BYN')),'failed','Оплата' FROM generate_series(10,11) i;
