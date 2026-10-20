import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const old = readFileSync(new URL('supabase/migrations/20260125141326_d06ffc29-75be-4730-8cd7-01c8f69e8c33.sql', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20261020202000_preserve_provider_billing_schedule.sql', root), 'utf8');
export const repair = readFileSync(new URL('scripts/bepaid/correct-completed-provider-schedule.sql', root), 'utf8');
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const end = new Date(Date.now() + 31 * 864e5).toISOString();
export const next = new Date(Date.parse(end) - 864e5).toISOString();

export async function seedFixture(db) {
  await db.exec(`CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,product_id uuid,tariff_id uuid,order_id uuid,
    billing_type text,auto_renew boolean,status text,canceled_at timestamptz,cancel_at timestamptz,auto_renew_disabled_at timestamptz,
    access_start_at timestamptz,access_end_at timestamptz,next_charge_at timestamptz,meta jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE provider_subscriptions(id uuid PRIMARY KEY,provider text,state text,subscription_v2_id uuid,user_id uuid,
      provider_subscription_id text,next_charge_at timestamptz,meta jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE payment_reconcile_queue(id uuid PRIMARY KEY,status text,attempts integer,bepaid_uid text,
      processed_order_id uuid,matched_order_id uuid,amount numeric,currency text,updated_at timestamptz DEFAULT now());
    CREATE TABLE payments_v2(id uuid PRIMARY KEY,provider text,provider_payment_id text,status text,is_deleted boolean,
      amount numeric,refunded_amount numeric,order_id uuid,user_id uuid,profile_id uuid,currency text,meta jsonb);
    CREATE TABLE orders_v2(id uuid PRIMARY KEY,status text,is_deleted boolean,provider_payment_id text,user_id uuid,
      profile_id uuid,product_id uuid,tariff_id uuid,final_price numeric,currency text,meta jsonb);
    CREATE TABLE entitlements(user_id uuid,product_id uuid,status text,expires_at timestamptz);
    CREATE TABLE access_grant_ledger(source_order_id uuid);
    CREATE TABLE audit_logs(action text,actor_type text,actor_user_id uuid,actor_label text,meta jsonb);
    CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at:=clock_timestamp();RETURN NEW;END$$;
    CREATE TRIGGER touch BEFORE UPDATE ON subscriptions_v2 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`);
  await db.exec(old);
  await db.exec(migration);
  const product = '11c9f1b8-0355-4753-bd74-40b42aa53616';
  const receipt = { source_subscription_id:id(2),target_subscription_id:id(1),queue_id:id(4),payment_uid:'fixture-paid-uid',
    operator_user_id:id(10),billing_review_required:true,billing_policy:'preserve_local_auto_renew' };
  await db.query(`INSERT INTO subscriptions_v2(id,user_id,profile_id,product_id,tariff_id,billing_type,auto_renew,status,access_start_at,access_end_at,next_charge_at,meta)
    VALUES($1,$3,$4,$5,$6,'provider_managed',false,'active','2026-10-14T12:00:00Z',$7,$7,'{"bepaid_subscription_id":"fixture-provider"}'),
      ($2,$3,$4,$5,$6,'mit',false,'superseded','2026-09-14T12:00:00Z',$7,$7,'{}')`,[id(1),id(2),id(8),id(9),product,id(7),end]);
  await db.query('UPDATE subscriptions_v2 SET order_id=$1::uuid,meta=meta||jsonb_build_object(\'initial_order_id\',($1::uuid)::text) WHERE id=$2',[id(11),id(1)]);
  await db.query('UPDATE subscriptions_v2 SET order_id=$1 WHERE id=$2',[id(12),id(2)]);
  await db.query("INSERT INTO provider_subscriptions VALUES($1,'bepaid','active',$2,$3,'fixture-provider',$4,$5,now())",[id(3),id(1),id(8),next,{paid_continuation_repair:receipt}]);
  await db.query("INSERT INTO payment_reconcile_queue VALUES($1,'completed',7,'fixture-paid-uid',$2,$2,100,'BYN',now())",[id(4),id(6)]);
  await db.query("INSERT INTO payments_v2 VALUES($1,'bepaid','fixture-paid-uid','succeeded',false,100,0,$2,$3,$4,'BYN','{}')",[id(5),id(6),id(8),id(9)]);
  await db.query("INSERT INTO payments_v2 VALUES($1,'bepaid','fixture-prior-uid','succeeded',false,100,0,$2,$3,$4,'BYN','{}')",[id(13),id(11),id(8),id(9)]);
  await db.query("INSERT INTO orders_v2 VALUES($1,'paid',false,'fixture-paid-uid',$2,$3,$4,$5,100,'BYN','{\"suppress_notifications\":true}')",[id(6),id(8),id(9),product,id(7)]);
  await db.query("INSERT INTO orders_v2 VALUES($1,'paid',false,'fixture-prior-uid',$3,$4,$5,$6,100,'BYN','{}'),($2,'paid',false,'fixture-source-uid',$3,$4,$5,$6,100,'BYN','{}')",[id(11),id(12),id(8),id(9),product,id(7)]);
  await db.query("INSERT INTO entitlements VALUES($1,$2,'active',$3)",[id(8),product,end]);
  await db.query('INSERT INTO access_grant_ledger VALUES($1)',[id(6)]);
  await db.query("INSERT INTO audit_logs VALUES('bepaid.paid_continuation.relinked','user',$1,'payments-reconcile',$2),('bepaid.paid_continuation.billing_synced','user',$1,'payments-reconcile',$3)",
    [id(10),{queue_id:id(4),payment_uid:'fixture-paid-uid',target_subscription_id:id(1),source_subscription_id:id(2)},
      {queue_id:id(4),payment_uid:'fixture-paid-uid',target_subscription_id:id(1),preserved_auto_renew:false,billing_review_required:true}]);
  return db;
}
export const snapshot = async db => (await db.query(`SELECT jsonb_build_object(
  'subscriptions',(SELECT jsonb_agg(s ORDER BY id) FROM subscriptions_v2 s),
  'provider',(SELECT jsonb_agg(p ORDER BY id) FROM provider_subscriptions p),
  'queue',(SELECT jsonb_agg(q ORDER BY id) FROM payment_reconcile_queue q),
  'payments',(SELECT jsonb_agg(p ORDER BY id) FROM payments_v2 p),
  'orders',(SELECT jsonb_agg(o ORDER BY id) FROM orders_v2 o),
  'entitlements',(SELECT jsonb_agg(e) FROM entitlements e),
  'ledger',(SELECT jsonb_agg(l) FROM access_grant_ledger l),
  'audit',(SELECT jsonb_agg(a ORDER BY action) FROM audit_logs a)) value`)).rows[0].value;
export async function input(db) {
  const r = (await db.query(`SELECT t.updated_at target,s.updated_at source,ps.updated_at provider,q.updated_at queue,
    md5((to_jsonb(t)-'next_charge_at'-'updated_at')::text) hash FROM subscriptions_v2 t
    JOIN subscriptions_v2 s ON s.id=$2 JOIN provider_subscriptions ps ON ps.id=$3
    JOIN payment_reconcile_queue q ON q.id=$4 WHERE t.id=$1`,[id(1),id(2),id(3),id(4)])).rows[0];
  const iso = v => new Date(v).toISOString();
  // Preserve PostgreSQL microseconds rather than rounding updated_at in JS.
  const times = (await db.query(`SELECT t.updated_at::text target,s.updated_at::text source,ps.updated_at::text provider,q.updated_at::text queue
    FROM subscriptions_v2 t JOIN subscriptions_v2 s ON s.id=$2 JOIN provider_subscriptions ps ON ps.id=$3
    JOIN payment_reconcile_queue q ON q.id=$4 WHERE t.id=$1`,[id(1),id(2),id(3),id(4)])).rows[0];
  return { target_id:id(1),source_id:id(2),provider_row_id:id(3),queue_id:id(4),payment_uid:'fixture-paid-uid',previous_payment_uid:'fixture-prior-uid',
    target_updated_at:times.target,source_updated_at:times.source,provider_updated_at:times.provider,queue_updated_at:times.queue,
    protected_target_md5:r.hash,before_next_charge_at:end,verified_next_charge_at:next,verified_at:iso(new Date()) };
}
export async function run(db, v, source = repair) {
  const literal = `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  assert.equal(source.split("'__REVIEWED_INPUT_JSON__'::jsonb").length, 2);
  return db.query(source.replace("'__REVIEWED_INPUT_JSON__'::jsonb", literal));
}

