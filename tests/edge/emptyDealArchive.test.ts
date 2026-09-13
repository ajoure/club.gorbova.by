import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {describe,it,expect} from 'vitest';
const bootstrap = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE order_status AS ENUM ('pending','paid','partial','refunded','failed','canceled');
CREATE TABLE orders_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_number text,user_id uuid,profile_id uuid,
product_id uuid,tariff_id uuid,offer_id uuid,responsible_user_id uuid,company_id uuid,base_price numeric,final_price numeric,
paid_amount numeric,currency text,status order_status,provider text,provider_payment_id text,payer_type text,reconcile_source text,customer_ip text,customer_email text,customer_phone text,
created_at timestamptz DEFAULT now(),deal_date timestamptz,meta jsonb,pipeline_id uuid,pipeline_stage_id uuid,purchase_snapshot jsonb,is_deleted boolean DEFAULT false);
CREATE TABLE payments_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES orders_v2(id),
provider text,provider_payment_id text,amount numeric,refunded_amount numeric,currency text,status text,is_deleted boolean DEFAULT false,transaction_type text,paid_at timestamptz,meta jsonb);
CREATE TABLE audit_logs(id uuid DEFAULT gen_random_uuid(),actor_type text,action text,entity_type text,entity_id uuid,meta jsonb);
CREATE FUNCTION generate_order_number() RETURNS text LANGUAGE sql AS 'SELECT gen_random_uuid()::text';`;

const batch='00000000-0000-4000-8000-000000000099';
async function fixture() {
  const db=new PGlite(); await db.exec(bootstrap);
  await db.exec(readFileSync('supabase/migrations/20260913115920_crm_empty_deal_archive.sql','utf8'));
  const insert=async(age:string)=> (await db.query<{id:string}>(`INSERT INTO orders_v2(user_id,product_id,tariff_id,final_price,paid_amount,currency,status,created_at,meta)
    VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',250,0,'BYN','pending',now()-$1::interval,'{}') RETURNING id`,[age])).rows[0].id;
  const source=await insert('3 days'),canonical=await insert('2 days');
  const preview=async()=> (await db.query<any>('SELECT * FROM crm_preview_empty_deal_duplicates()')).rows;
  const archive=async(rows:any[])=> (await db.query<{r:any}>('SELECT crm_archive_empty_deal_duplicates($1,$2) r',[batch,JSON.stringify(rows)])).rows[0].r;
  return {db,source,canonical,preview,archive};
}
describe('reversible empty-deal cleanup',()=> {
  it('archives exactly reviewed empty rows, replays safely, and restores a late successful payment',async()=> {
    const {db,source,canonical,preview,archive}=await fixture();
    try {
      const rows=await preview(); expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({source_order_id:source,canonical_order_id:canonical,blocked_reason:null});
      expect(await archive(rows)).toEqual({archived:1,already_applied:false});
      expect(await archive(rows)).toEqual({archived:1,already_applied:true});
      await expect(archive([{...rows[0],canonical_order_id:source}])).rejects.toThrow('archive_batch_conflict');
      expect((await db.query('SELECT count(*)::int n FROM payments_v2')).rows).toEqual([{n:0}]);
      expect((await db.query('SELECT count(*)::int n FROM orders_v2')).rows).toEqual([{n:2}]);
      await db.query(`INSERT INTO payments_v2(order_id,provider,amount,currency,status) VALUES($1,'bepaid',250,'BYN','succeeded')`,[source]);
      expect((await db.query('SELECT is_deleted FROM orders_v2 WHERE id=$1',[source])).rows).toEqual([{is_deleted:false}]);
      expect((await db.query('SELECT restored_at IS NOT NULL restored FROM crm_archived_deal_duplicates WHERE source_order_id=$1',[source])).rows).toEqual([{restored:true}]);
    } finally {await db.close();}
  },20000);
  it('rejects new FK dependencies after preview, without partially archiving anything',async()=> {
    const {db,source,preview,archive}=await fixture();
    try {
      const rows=await preview();
      await db.exec('CREATE TABLE future_order_dependency(order_id uuid REFERENCES orders_v2(id))');
      await db.query('INSERT INTO future_order_dependency VALUES($1)',[source]);
      expect((await preview())[0].blocked_reason).toContain('future_order_dependency');
      await expect(archive(rows)).rejects.toThrow('archive_candidate_changed');
      expect((await db.query('SELECT count(*)::int n FROM crm_archived_deal_duplicates')).rows).toEqual([{n:0}]);
    } finally {await db.close();}
  },20000);
  it('excludes payload links and fresh sessions and supports explicit rollback',async()=> {
    const {db,source,preview,archive}=await fixture();
    try {
      await db.exec('CREATE TABLE provider_events(payload jsonb)');
      await db.query('INSERT INTO provider_events VALUES($1)',[JSON.stringify({nested:{tracking_id:`link:order:${source}`}})]);
      expect((await preview())[0].blocked_reason).toBe('payload_dependency:provider_events');
      await db.exec('DELETE FROM provider_events');
      await db.query(`UPDATE orders_v2 SET meta=jsonb_build_object('checkout_created_at',now()) WHERE id=$1`,[source]);
      expect((await preview())[0].blocked_reason).toBe('recent_checkout');
      await db.query(`UPDATE orders_v2 SET meta='{}'::jsonb WHERE id=$1`,[source]);
      await archive(await preview());
      expect((await db.query('SELECT crm_restore_empty_deal_archive($1) n',[batch])).rows).toEqual([{n:1}]);
      expect((await db.query('SELECT crm_restore_empty_deal_archive($1) n',[batch])).rows).toEqual([{n:0}]);
      await db.exec('SET ROLE authenticated');
      await expect(preview()).rejects.toMatchObject({code:'42501'});
    } finally {await db.close();}
  },20000);
});
