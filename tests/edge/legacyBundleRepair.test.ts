import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {describe,it,expect} from 'vitest';

const sql=readFileSync('supabase/migrations/20261026111500_repair_reviewed_legacy_bundle.sql','utf8');
const catalog=JSON.parse(sql.match(/catalog CONSTANT jsonb := '([\s\S]*?)'::jsonb;/)![1]);
const bootstrap=readFileSync('tests/edge/pendingPurchaseMigration.test.ts','utf8').match(/const bootstrap = `([\s\S]*?)`;/)![1];
const read=(name:string)=>readFileSync('supabase/migrations/'+name,'utf8');
function table(source:string,name:string){return source.match(new RegExp('CREATE TABLE (?:IF NOT EXISTS )?public\\.'+name+' \\([\\s\\S]*?\\n\\);'))![0];}
function procedure(source:string,name:string){
  const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
  const tail=source.slice(start),body=tail.match(/AS\s+(\$\w*\$)[\s\S]*?\1;/i)!;
  return tail.slice(0,body.index!+body[0].length);
}
const user='00000000-0000-4000-8000-000000000001',profile='00000000-0000-4000-8000-000000000002';
async function fixture(){
  const db=new PGlite();
  // The production fingerprint snapshot explicitly reported TimeZone=UTC.
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(bootstrap+`
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());
    CREATE TABLE products_v2(id uuid PRIMARY KEY,code text NOT NULL UNIQUE);
    CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid REFERENCES products_v2(id),meta jsonb DEFAULT '{}',sort_order int,display_order int);
    CREATE TABLE tariff_offers(id uuid PRIMARY KEY,tariff_id uuid REFERENCES tariffs(id),amount numeric,created_at timestamptz);
    CREATE TABLE offer_addons(parent_offer_id uuid,addon_product_id uuid,addon_tariff_id uuid,addon_offer_id uuid,pricing_mode text,discount_percent numeric,created_at timestamptz);
    ALTER TABLE orders_v2 ADD updated_at timestamptz DEFAULT now();
    ALTER TABLE subscriptions_v2 ADD user_id uuid,ADD product_id uuid,ADD tariff_id uuid,
      ADD access_start_at timestamptz,ADD access_end_at timestamptz,ADD created_at timestamptz DEFAULT now();
    CREATE TABLE entitlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,profile_id uuid,product_id uuid,
      product_code text NOT NULL,order_id uuid UNIQUE,status text,expires_at timestamptz,meta jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(user_id,product_code));
    CREATE TABLE payment_refund_requests(id uuid DEFAULT gen_random_uuid(),order_id uuid,payment_id uuid,state text);
  `);
  const groups=read('20260723181041_178e769e-6c42-4bdb-a41a-cfa4c0280bac.sql');
  for(const name of ['order_groups','order_group_items','payment_allocations'])await db.exec(table(groups,name));
  await db.exec(table(read('20260725090541_cb_composable_scheduled_module_access.sql'),'scheduled_product_access'));
  await db.exec(table(read('20260712093753_274ad033-cb45-4254-ab50-87c440e04c75.sql'),'entitlement_sources'));
  for(const [name,file]of [
    ['materialize_composable_order_group','20260917064341_9eea2f80-8f8d-4cc4-8f4c-40c9ce10f761.sql'],
    ['settle_composable_order_group','20260723181041_178e769e-6c42-4bdb-a41a-cfa4c0280bac.sql'],
    ['tariff_access_rank','20260810170000_club_bonus_independent_sources.sql'],
    ['recalculate_entitlement_aggregate','20261002113949_referral_product_redemption.sql']])await db.exec(procedure(read(file),name));
  await db.query('INSERT INTO auth.users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)',[profile,user]);
  for(const [i,item]of catalog.entries()){
    await db.query('INSERT INTO products_v2(id,code) VALUES($1,$2)',[item.product_id,'fixture-product-'+i]);
    await db.query('INSERT INTO tariffs(id,product_id,sort_order) VALUES($1,$2,1)',[item.tariff_id,item.product_id]);
    await db.query(`INSERT INTO tariff_offers(id,tariff_id,amount,created_at) VALUES($1,$2,$3,'2026-07-13Z')`,[item.offer_id,item.tariff_id,item.list_amount]);
    if(i)await db.query(`INSERT INTO offer_addons VALUES($1,$2,$3,$4,'percent_discount',50,'2026-07-23Z')`,
      [catalog[0].offer_id,item.product_id,item.tariff_id,item.offer_id]);
  }
  const parent=(await db.query<{id:string}>(`INSERT INTO orders_v2(order_number,user_id,profile_id,product_id,tariff_id,
    base_price,final_price,paid_amount,currency,status,deal_date,meta) VALUES('FIXTURE-LEGACY',$1,$2,$3,$4,
    3400,3400,3400,'BYN','paid','2026-07-24T12:49Z','{"deal_only":true,"retained":"original"}') RETURNING id`,
    [user,profile,catalog[0].product_id,catalog[0].tariff_id])).rows[0].id;
  const payment=(await db.query<{id:string}>(`INSERT INTO payments_v2(order_id,user_id,profile_id,provider,provider_payment_id,
    amount,currency,status,paid_at,origin) VALUES($1,$2,$3,'rr','fixture-receipt',3400,'BYN','succeeded','2026-07-24T12:49Z','manual_admin') RETURNING id`,
    [parent,user,profile])).rows[0].id;
  const entitlement=(await db.query<{id:string}>(`INSERT INTO entitlements(user_id,profile_id,product_id,product_code,order_id,status,expires_at,meta)
    VALUES($1,$2,$3,'fixture-product-0',$4,'active','2027-05-20T12:49Z','{"retained":"course"}') RETURNING id`,
    [user,profile,catalog[0].product_id,parent])).rows[0].id;
  await db.query(`INSERT INTO entitlements(user_id,profile_id,product_code,status,expires_at,meta)
    VALUES($1,$2,'unrelated-club','active','2026-11-18T12:00Z','{"retained":"club"}')`,[user,profile]);
  await db.query(`INSERT INTO subscriptions_v2(user_id,status,auto_renew,meta) VALUES($1,'active',true,'{"retained":"billing"}')`,[user]);
  const hashes=(await db.query<any>(`SELECT md5(o.id::text) selector_hash,md5(p.id::text) payment_selector_hash,md5(to_jsonb(o)::text) approved_order_hash,
    md5(to_jsonb(p)::text) approved_payment_hash,
    md5(jsonb_build_array(e.user_id,e.product_id,e.order_id,e.status,e.expires_at)::text) approved_access_hash
    FROM orders_v2 o JOIN payments_v2 p ON p.order_id=o.id JOIN entitlements e ON e.order_id=o.id WHERE o.id=$1`,[parent])).rows[0];
  let script=sql;
  for(const [key,value]of Object.entries(hashes))script=script.replace(new RegExp(key+" CONSTANT text := '[a-f0-9]{32}'"),key+" CONSTANT text := '"+value+"'");
  for(const [key,value]of Object.entries(hashes))expect(script).toContain(key+" CONSTANT text := '"+value+"'");
  return {db,parent,payment,entitlement,script};
}
async function snapshot(db:PGlite){
  const names=['orders_v2','payments_v2','order_groups','order_group_items','payment_allocations','entitlements','entitlement_sources','subscriptions_v2','scheduled_product_access','audit_logs'];
  const out:any={};for(const name of names)out[name]=(await db.query<any>(`SELECT to_jsonb(t) r FROM ${name} t ORDER BY id`)).rows.map(x=>x.r);
  return out;
}
describe('reviewed historical bundle reconstruction',()=>{
  it('keeps one receipt and the original offer/window, creates four priced lines and only two ready accesses',async()=>{
    const {db,parent,script}=await fixture();try{
      const before=await snapshot(db);await db.exec(script).catch((e:any)=>{throw new Error(e.message+' '+e.where);});const after=await snapshot(db);
      expect(after.payments_v2).toEqual(before.payments_v2);expect(after.subscriptions_v2).toEqual(before.subscriptions_v2);
      expect(after.orders_v2).toHaveLength(4);expect(after.order_groups).toHaveLength(1);
      expect(after.order_group_items.map((x:any)=>Number(x.final_amount)).sort((a:number,b:number)=>b-a)).toEqual([2650,250,250,250]);
      expect(after.payment_allocations.reduce((s:number,x:any)=>s+Number(x.amount),0)).toBe(3400);
      const primary=after.orders_v2.find((o:any)=>o.id===parent);
      expect(primary.offer_id).toBeNull();expect(Number(primary.final_price)).toBe(3400);expect(Number(primary.paid_amount)).toBe(3400);
      expect(primary.meta.retained).toBe('original');
      for(const old of before.entitlements)expect(after.entitlements.find((e:any)=>e.id===old.id)).toEqual(old);
      expect(after.entitlement_sources).toHaveLength(2);expect(after.entitlements).toHaveLength(4);
      for(const source of after.entitlement_sources){expect(new Date(source.starts_at).toISOString()).toBe('2026-07-24T12:49:00.000Z');expect(new Date(source.expires_at).toISOString()).toBe('2027-05-20T12:49:00.000Z');}
      expect(after.entitlements.some((e:any)=>e.product_id===catalog[3].product_id)).toBe(false);
      expect(after.scheduled_product_access).toHaveLength(1);expect(after.scheduled_product_access[0]).toMatchObject({status:'scheduled',access_delivery_mode:'manual',opens_at:null,access_duration_days:null});
      await db.exec(script);expect(await snapshot(db)).toEqual(after);
    }finally{await db.close();}
  },30000);
  it('refuses a changed receipt and preserves all existing rows',async()=>{
    const {db,payment,script}=await fixture();try{
      await db.query(`UPDATE payments_v2 SET refunded_amount=1 WHERE id=$1`,[payment]);const before=await snapshot(db);
      await expect(db.exec(script)).rejects.toThrow();expect(await snapshot(db)).toEqual(before);
    }finally{await db.close();}
  },30000);
  it('does not overwrite a legacy revoked aggregate found through its unique product code',async()=>{
    const {db,script}=await fixture();try{
      await db.query(`INSERT INTO entitlements(user_id,product_code,status,expires_at,meta) VALUES($1,'fixture-product-1','revoked','2027-12-01Z','{"manual":"hold"}')`,[user]);
      const before=await snapshot(db);await expect(db.exec(script)).rejects.toThrow('legacy_bundle_existing_or_concurrent_access');
      expect(await snapshot(db)).toEqual(before);
    }finally{await db.close();}
  },30000);
  it('rolls the whole bundle back if a downstream trigger changes a ready access window',async()=>{
    const {db,script}=await fixture();try{
      await db.exec(`CREATE FUNCTION fixture_bad_window() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.product_id='${catalog[2].product_id}'::uuid THEN NEW.expires_at='2026-10-27Z'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER fixture_window_change BEFORE UPDATE ON entitlements FOR EACH ROW EXECUTE FUNCTION fixture_bad_window();`);
      const before=await snapshot(db);await expect(db.exec(script)).rejects.toThrow('legacy_bundle_readback_failed');
      expect(await snapshot(db)).toEqual(before);
    }finally{await db.close();}
  },30000);
});
