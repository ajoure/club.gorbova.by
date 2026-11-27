export const ids={actor:'00000000-0000-4000-8000-000000000001',user:'00000000-0000-4000-8000-000000000002',
  profile:'00000000-0000-4000-8000-000000000003',order:'00000000-0000-4000-8000-000000000004',
  payment:'00000000-0000-4000-8000-000000000005',product:'00000000-0000-4000-8000-000000000006',
  tariff:'00000000-0000-4000-8000-000000000007',request:'00000000-0000-4000-8000-000000000008'};
export const bootstrap=`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(current_setting('request.jwt.claim.role',true),'service_role') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${ids.actor}'::uuid $$;
CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid);
CREATE TABLE products_v2(id uuid PRIMARY KEY,entitlement_mode text);
CREATE TABLE orders_v2(id uuid PRIMARY KEY,profile_id uuid,user_id uuid,product_id uuid,tariff_id uuid,currency text,status text,is_deleted boolean DEFAULT false,
  paid_amount numeric,final_price numeric,base_price numeric,payment_plan_id uuid,meta jsonb DEFAULT '{}',purchase_snapshot jsonb DEFAULT '{}',
  responsible_user_id uuid,updated_at timestamptz DEFAULT now());
CREATE TABLE payments_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES orders_v2(id),profile_id uuid,user_id uuid,amount numeric,currency text,
 status text,is_deleted boolean DEFAULT false,refunded_amount numeric DEFAULT 0,transaction_type text DEFAULT 'payment',paid_at timestamptz,
 origin text,is_recurring boolean,meta jsonb DEFAULT '{}',provider text,provider_payment_id text,updated_at timestamptz DEFAULT now());
CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,user_id uuid,product_id uuid,tariff_id uuid,status text,auto_renew boolean,
  meta jsonb DEFAULT '{}',access_start_at timestamptz,access_end_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE provider_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,subscription_v2_id uuid,state text,updated_at timestamptz DEFAULT now());
CREATE TABLE entitlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,user_id uuid,product_id uuid,status text,expires_at timestamptz);
CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid,access_days integer);
CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_type text,actor_user_id uuid,action text,target_user_id uuid,
 entity_type text,entity_id text,meta jsonb);
CREATE TABLE payment_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,product_id uuid,tariff_id uuid,amount numeric,currency text,payment_type text,
 provider text,provider_mode text,status text,url_token text,public_url text,max_uses integer,expires_at timestamptz,created_by uuid,responsible_user_id uuid,
 description text,current_uses integer DEFAULT 0,meta jsonb,created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX payment_uid ON payments_v2(provider,provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE FUNCTION recalc_order_totals(uuid,text,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE paid numeric;
BEGIN SELECT sum(amount) INTO paid FROM payments_v2 WHERE order_id=$1 AND status='succeeded' AND NOT is_deleted;
UPDATE orders_v2 SET paid_amount=paid,status=CASE WHEN paid>=final_price THEN 'paid' ELSE 'partial' END WHERE id=$1;
RETURN '{"ok":true}'::jsonb; END $$;
INSERT INTO profiles VALUES('${ids.profile}','${ids.user}');
INSERT INTO products_v2 VALUES('${ids.product}','subscription');
INSERT INTO tariffs VALUES('${ids.tariff}','${ids.product}',180);
INSERT INTO orders_v2(id,profile_id,user_id,product_id,tariff_id,currency,status,paid_amount,final_price,base_price)
VALUES('${ids.order}','${ids.profile}','${ids.user}','${ids.product}','${ids.tariff}','BYN','partial',250,500,500);
INSERT INTO payments_v2(id,order_id,profile_id,user_id,amount,currency,status,paid_at,provider,provider_payment_id)
VALUES('${ids.payment}','${ids.order}','${ids.profile}','${ids.user}',250,'BYN','succeeded',now()-interval '2 days','bank',NULL);
`;
export const args=(confirm=false,fingerprint=null)=>[ids.actor,ids.profile,ids.order,ids.payment,500,21,
  'Owner confirmed historical two-part bank agreement',ids.request,confirm,fingerprint];
export const call=`SELECT admin_historical_manual_installment_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`;
export const accessCall=`SELECT admin_claim_historical_manual_access_v1($1,$2,$3) AS result`;
