import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {describe,it,expect} from 'vitest';

const bootstrap=readFileSync('tests/edge/pendingPurchaseMigration.test.ts','utf8').match(/const bootstrap = `([\s\S]*?)`;/)![1];
const migration=readFileSync('supabase/migrations/20261026102500_apply_reviewed_renewal_periods.sql','utf8');
const user='00000000-0000-4000-8000-000000000001';
async function fixture(){
  const db=new PGlite();
  await db.exec(bootstrap+`ALTER TABLE subscriptions_v2 ADD user_id uuid;
    CREATE TABLE entitlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,status text,expires_at timestamptz,meta jsonb);`);
  for(const name of ['20260913112356_crm_pending_purchase_claim.sql','20260913115920_crm_empty_deal_archive.sql',
    '20260913153500_crm_payment_status_compatibility.sql','20261026064402_renewal_checkout_cycle_month.sql',
    '20261026080528_receipt_purchase_settlement.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
  const ids:string[]=[];
  for(let i=0;i<9;i++){
    const id=(await db.query<{id:string}>(`INSERT INTO orders_v2(user_id,base_price,final_price,paid_amount,currency,status,created_at,deal_date,meta)
      VALUES($1,250,250,250,'BYN','paid','2026-09-18T06:00:16Z','2026-09-18T06:00:16Z',
        jsonb_build_object('payment_flow','renewal_one_time','deal_month',$2::text)) RETURNING id`,[user,i<8?'2026-09':'2025-09'])).rows[0].id;
    ids.push(id);
    await db.query(`INSERT INTO payments_v2(order_id,user_id,provider,provider_payment_id,amount,currency,status,paid_at)
      VALUES($1,$2,'bepaid',$3,250,'BYN','succeeded','2026-10-23T10:24:20Z')`,[id,user,'fixture-'+i]);
    if(i<8)await db.query(`INSERT INTO crm_checkout_attempts(order_id,provider,state) VALUES($1,'bepaid','ready')`,[id]);
  }
  await db.query(`INSERT INTO subscriptions_v2(user_id,order_id,status,auto_renew,meta) VALUES($1,$2,'active',false,'{"retained":true}')`,[user,ids[0]]);
  await db.query(`INSERT INTO entitlements(user_id,status,expires_at,meta) VALUES($1,'active','2027-05-20Z','{"retained":true}')`,[user]);
  const plans=(await db.query<any>(`SELECT * FROM crm_preview_renewal_period($1::uuid[]) ORDER BY order_id`,[ids])).rows.filter(p=>p.eligible);
  expect(plans).toHaveLength(8);
  // Run the actual batch SQL against independent fixture fingerprints.
  const sql=migration.replace(/expected_hashes CONSTANT text\[\] := ARRAY\[[\s\S]*?\n  \];/,
    `expected_hashes CONSTANT text[] := ARRAY[${plans.map(p=>`'${p.expected_hash}'`).join(',')}];`);
  return {db,ids,plans,sql};
}
async function snapshot(db:PGlite){return (await db.query<any>(`SELECT jsonb_build_object(
  'orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM orders_v2 o),
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM payments_v2 p),
  'subscriptions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM subscriptions_v2 s),
  'entitlements',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM entitlements e),
  'audit',(SELECT count(*) FROM audit_logs)) state`)).rows[0].state;}

describe('reviewed historical renewal period batch',()=>{
  it('repairs only eight exact rows, preserves money/access and replays without another audit',async()=>{
    const {db,ids,sql}=await fixture();try{
      const before=await snapshot(db);await db.exec(sql);const after=await snapshot(db);
      for(const key of ['payments','subscriptions','entitlements'])expect(after[key]).toEqual(before[key]);
      expect(after.orders.filter((o:any)=>o.meta.deal_month==='2026-10')).toHaveLength(8);
      expect(after.orders.find((o:any)=>o.id===ids[8])).toEqual(before.orders.find((o:any)=>o.id===ids[8]));
      expect(after.audit).toBe(8);await db.exec(sql);expect(await snapshot(db)).toEqual(after);
    }finally{await db.close();}
  },30000);
  it('refuses a stale receipt before any update',async()=>{
    const {db,ids,sql}=await fixture();try{
      await db.query(`UPDATE payments_v2 SET refunded_amount=1 WHERE order_id=$1`,[ids[7]]);
      const before=await snapshot(db);await expect(db.exec(sql)).rejects.toThrow('reviewed_renewal_batch_fingerprint_changed');
      expect(await snapshot(db)).toEqual(before);
    }finally{await db.close();}
  },30000);
  it('rolls back earlier rows on a late trigger failure and resumes one already committed row',async()=>{
    const {db,ids,plans,sql}=await fixture();try{
      const failId=[...ids.slice(0,8)].sort()[6];
      await db.exec(`CREATE FUNCTION fixture_fail_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.id='${failId}'::uuid THEN RAISE EXCEPTION 'fixture_late_failure'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER fixture_failure BEFORE UPDATE ON orders_v2 FOR EACH ROW EXECUTE FUNCTION fixture_fail_update();`);
      const before=await snapshot(db);await expect(db.exec(sql)).rejects.toThrow('fixture_late_failure');
      expect(await snapshot(db)).toEqual(before);await db.exec('DROP TRIGGER fixture_failure ON orders_v2');
      await db.query(`SELECT crm_apply_renewal_period($1,$2)`,[plans[0].order_id,plans[0].expected_hash]);
      await db.exec(sql);expect((await snapshot(db)).audit).toBe(8);
      expect((await snapshot(db)).orders.filter((o:any)=>o.meta.deal_month==='2026-10')).toHaveLength(8);
    }finally{await db.close();}
  },30000);
  it('rolls back if a trigger unexpectedly changes access',async()=>{
    const {db,sql}=await fixture();try{
      await db.exec(`CREATE FUNCTION fixture_access_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE entitlements SET status='unexpected' WHERE user_id=NEW.user_id; RETURN NEW; END; $$;
        CREATE TRIGGER fixture_access_change AFTER UPDATE ON orders_v2 FOR EACH ROW EXECUTE FUNCTION fixture_access_side_effect();`);
      const before=await snapshot(db);
      await expect(db.exec(sql)).rejects.toThrow('reviewed_renewal_batch_unexpected_side_effect');
      expect(await snapshot(db)).toEqual(before);
    }finally{await db.close();}
  },30000);
});
