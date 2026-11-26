import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import migration from '../../supabase/migrations/20261126133000_contact_payment_reallocation.sql?raw';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const club='11c9f1b8-0355-4753-bd74-40b42aa53616', bbb='85046734-2282-4ded-b0d3-8c66c8f5bc2b';
let db:PGlite;
const preview=async()=>((await db.query<{g:Record<string,unknown>}>('select admin_preview_payment_reallocation($1,$2) g',[id(1),id(3)])).rows[0].g);
const commit=(hash:string,request=id(30),reason='Customer requested correction')=>db.query<{r:Record<string,unknown>}>(
  'select admin_commit_payment_reallocation($1,$2,$3,$4,$5) r',[request,id(1),id(3),hash,reason]);
const money=async()=> (await db.query('select * from payments_v2 order by id')).rows;
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function public.has_role_v2(uuid,text) returns boolean language sql stable as $$select $1='${id(99)}'::uuid$$;
    create table profiles(id uuid primary key,user_id uuid,is_archived boolean default false);
    create table products_v2(id uuid primary key,telegram_club_id uuid);
    create table tariffs(id uuid primary key,product_id uuid,is_active boolean);
    create table payments_v2(id uuid primary key,order_id uuid,profile_id uuid,user_id uuid,status text,is_deleted boolean default false,currency text,amount numeric,refunded_amount numeric default 0,paid_at timestamptz);
    create table orders_v2(id uuid primary key,profile_id uuid,user_id uuid,product_id uuid,tariff_id uuid,offer_id uuid,status text,is_deleted boolean default false,currency text,final_price numeric,paid_amount numeric,purchase_snapshot jsonb default '{}',meta jsonb default '{}',pipeline_id uuid,pipeline_stage_id uuid);
    create table crm_pipeline_automation_rules(pipeline_id uuid,stage_id uuid,status text,trigger_type text,trigger_field text);
    create table subscriptions_v2(id uuid primary key,user_id uuid,product_id uuid,tariff_id uuid,status text,auto_renew boolean,access_end_at timestamptz,next_charge_at timestamptz,meta jsonb default '{}');
    create table provider_subscriptions(id uuid primary key,user_id uuid,subscription_v2_id uuid,state text,last_charge_at timestamptz,next_charge_at timestamptz,order_id uuid);
    create table entitlements(id uuid primary key,user_id uuid,product_id uuid,order_id uuid,status text,expires_at timestamptz,meta jsonb default '{}');
    create table access_grant_ledger(id uuid primary key,user_id uuid,source_order_id uuid,reason_code text,status text,result jsonb,created_at timestamptz);
    create table entitlement_sources(id uuid,user_id uuid,product_id uuid,order_id uuid,meta jsonb default '{}');
    create table tariff_offers(id uuid primary key,tariff_id uuid,is_active boolean,offer_type text,payment_method text,amount numeric);
    create table order_groups(id uuid primary key,primary_order_id uuid,profile_id uuid,user_id uuid,status text,total_amount numeric,currency text,quote_snapshot jsonb,meta jsonb default '{}');
    create table order_group_items(id uuid primary key,order_group_id uuid,order_id uuid,role text,product_id uuid,tariff_id uuid,offer_id uuid,quantity integer,final_amount numeric,item_snapshot jsonb);
    create table payment_allocations(id uuid primary key,payment_id uuid,order_group_id uuid,order_group_item_id uuid,amount numeric,refunded_amount numeric);
    create table telegram_access_grants(id uuid primary key,user_id uuid,club_id uuid,source text,source_id uuid,status text,start_at timestamptz,end_at timestamptz,meta jsonb default '{}');
    create table telegram_access(id uuid primary key,user_id uuid,club_id uuid,active_until timestamptz);
    create table payment_refund_requests(id uuid,payment_id uuid);
    create table referral_sale_attributions(id uuid,order_id uuid);
    create table referral_customer_credit_entries(id uuid,source_order_id uuid,source_payment_id uuid);
    create table audit_logs(action text,actor_type text,actor_user_id uuid,target_user_id uuid,entity_type text,entity_id text,meta jsonb);
  `);
  await db.exec(migration);
});
beforeEach(async()=>{
  await db.exec(`RESET ROLE;drop trigger if exists synthetic_failure on audit_logs;
    truncate access_grant_ledger,payment_reallocations,profiles,products_v2,tariffs,payments_v2,orders_v2,subscriptions_v2,provider_subscriptions,entitlements,entitlement_sources,tariff_offers,order_groups,order_group_items,payment_allocations,telegram_access_grants,telegram_access,payment_refund_requests,referral_sale_attributions,referral_customer_credit_entries,audit_logs cascade;
    select set_config('test.actor','${id(99)}',false);
    insert into profiles values('${id(1)}','${id(2)}',false);
    insert into products_v2 values('${club}','${id(20)}'),('${bbb}','${id(21)}');
    insert into tariffs values('${id(11)}','${bbb}',true);
    insert into orders_v2(id,profile_id,user_id,product_id,tariff_id,offer_id,status,currency,final_price,paid_amount) values
      ('${id(4)}','${id(1)}','${id(2)}','${club}','${id(6)}','${id(7)}','paid','BYN',250,250),
      ('${id(5)}','${id(1)}','${id(2)}','${club}','${id(6)}','${id(7)}','paid','BYN',250,250);
    insert into payments_v2(id,order_id,profile_id,user_id,status,currency,amount,paid_at) values
      ('${id(3)}','${id(4)}','${id(1)}','${id(2)}','succeeded','BYN',250,now()),
      ('${id(8)}','${id(5)}','${id(1)}','${id(2)}','succeeded','BYN',250,now()-interval '15 days');
    insert into subscriptions_v2 values
      ('${id(9)}','${id(2)}','${club}','${id(6)}','active',false,'2030-01-10 12:00Z','2030-01-10 12:00Z','{"extended_by_orders":["${id(5)}","${id(4)}"]}'),
      ('${id(10)}','${id(2)}','${bbb}','${id(11)}','active',true,now()+interval '1 hour',now()+interval '1 hour','{}');
    insert into tariff_offers values('${id(12)}','${id(11)}',true,'pay_now','full_payment',250);
    insert into entitlements(id,user_id,product_id,order_id,status,expires_at) values('${id(13)}','${id(2)}','${club}','${id(4)}','active','2030-01-10 12:00Z'),('${id(14)}','${id(2)}','${bbb}','${id(15)}','active',now()+interval '1 hour');
    insert into entitlements(id,user_id,product_id,status,expires_at,meta)
      select ('00000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,'${id(2)}',
        ('00000000-0000-4000-8000-'||lpad((200+n)::text,12,'0'))::uuid,'active','2030-01-10 12:00Z',
        jsonb_build_object('source_order_id','${id(4)}') from generate_series(1,10) n;
    insert into access_grant_ledger select ('00000000-0000-4000-8000-'||lpad((300+n)::text,12,'0'))::uuid,
      '${id(2)}','${id(4)}','rule_engine_bonus','extended',jsonb_build_object(
        'target_product_id',('00000000-0000-4000-8000-'||lpad((200+n)::text,12,'0')),
        'previous_expires_at','2029-12-10T12:00:00Z','new_expires_at','2030-01-10T12:00:00Z'),now()-interval '1 minute'
        from generate_series(1,10) n;
    insert into order_groups values('${id(16)}','${id(4)}','${id(1)}','${id(2)}','paid',250,'BYN','{}','{}');
    insert into order_group_items values('${id(17)}','${id(16)}','${id(4)}','primary','${club}','${id(6)}','${id(7)}',1,250,'{}');
    insert into payment_allocations values('${id(18)}','${id(3)}','${id(16)}','${id(17)}',250,0);
    insert into telegram_access_grants values
      ('${id(22)}','${id(2)}','${id(20)}','grant-access-for-order','${id(4)}','active',now(),'2030-01-10 12:00Z','{}'),
      ('${id(23)}','${id(2)}','${id(20)}','grant-access-for-order','${id(5)}','active',now(),'2029-12-10 12:00Z','{}'),
      ('${id(24)}','${id(2)}','${id(21)}','grant-access-for-order','${id(15)}','active',now(),now()+interval '1 hour','{}');
    insert into telegram_access values('${id(25)}','${id(2)}','${id(20)}','2030-01-10 12:00Z'),('${id(26)}','${id(2)}','${id(21)}',now()+interval '1 hour');
  `);
});
afterAll(async()=>db.close());
describe('atomic mistaken payment correction',()=>{
  it('preview writes nothing; corrects one item preserving receipts, allocation and legitimate Club',async()=>{
    const before=await money(),g=await preview();
    expect((await db.query('select * from payment_reallocations')).rows).toEqual([]);
    expect(await money()).toEqual(before);
    const result=(await commit(String(g.before_hash))).rows[0].r;
    expect(result.applied).toBe(true);expect(await money()).toEqual(before);
    expect((await db.query<{product_id:string}>('select product_id from orders_v2 where id=$1',[id(4)])).rows[0].product_id).toBe(bbb);
    expect((await db.query('select * from payment_allocations')).rows).toHaveLength(1);
    expect((await db.query<{access_end_at:string}>('select access_end_at::text from subscriptions_v2 where id=$1',[id(9)])).rows[0].access_end_at).toContain('2029-12-10');
    expect((await db.query<{order_id:string}>('select order_id from entitlements where id=$1',[id(13)])).rows[0].order_id).toBe(id(5));
    expect((await db.query('select * from provider_subscriptions')).rows).toEqual([]);
    expect((await db.query("select * from entitlements where meta ? 'payment_reallocation_reversed_ledger_id' and expires_at='2029-12-10T12:00:00Z'")).rows).toHaveLength(10);
  });
  it('two submitted requests for the same receipt cannot credit twice',async()=>{
    const g=await preview();
    const results=await Promise.all([commit(String(g.before_hash)),commit(String(g.before_hash))]);
    expect(results.map(r=>r.rows[0].r.replayed)).toEqual([false,true]);
    expect((await db.query('select * from payment_reallocations')).rows).toHaveLength(1);
    await expect(commit(String(g.before_hash),id(31))).rejects.toThrow('reallocation_already_applied');
  });
  it('stale financial/provider graph refuses without changes',async()=>{
    const g=await preview(),before=await money();
    await db.exec(`insert into provider_subscriptions(id,user_id,subscription_v2_id,state) values('${id(40)}','${id(2)}','${id(10)}','active')`);
    await expect(commit(String(g.before_hash))).rejects.toThrow('reallocation_preview_changed');
    expect(await money()).toEqual(before);
    expect((await db.query<{product_id:string}>('select product_id from orders_v2 where id=$1',[id(4)])).rows[0].product_id).toBe(club);
  });
  it('failure at final audit rolls the entire graph back',async()=>{
    const g=await preview(),before=await money();
    await db.exec(`create or replace function synthetic_failure() returns trigger language plpgsql as $$begin raise exception 'injected_failure';end$$;
      create trigger synthetic_failure before insert on audit_logs for each row execute function synthetic_failure();`);
    await expect(commit(String(g.before_hash))).rejects.toThrow('injected_failure');
    expect(await money()).toEqual(before);
    expect((await db.query('select * from payment_reallocations')).rows).toEqual([]);
    expect((await db.query<{product_id:string}>('select product_id from orders_v2 where id=$1',[id(4)])).rows[0].product_id).toBe(club);
    expect((await db.query<{club_id:string}>('select club_id from telegram_access_grants where id=$1',[id(22)])).rows[0].club_id).toBe(id(20));
  });
  it('refuses absent legitimate Club payment or refund dependencies',async()=>{
    await db.exec(`update payments_v2 set status='failed' where id='${id(8)}'`);
    await expect(preview()).rejects.toThrow('reallocation_legitimate_club_payment_required');
    await db.exec(`update payments_v2 set status='succeeded' where id='${id(8)}';insert into payment_refund_requests values('${id(41)}','${id(3)}')`);
    await expect(preview()).rejects.toThrow('reallocation_financial_dependencies');
  });
  it('refuses an unprovable or subsequently modified bonus before state',async()=>{
    await db.exec(`update access_grant_ledger set result=result-'previous_expires_at' where id='${id(301)}'`);
    await expect(preview()).rejects.toThrow('reallocation_bonus_before_state_unproven');
  });
  it('restores each bonus from its ledger rather than using the Club date',async()=>{
    await db.exec(`update access_grant_ledger set result=jsonb_set(result,'{previous_expires_at}','"2029-12-15T12:00:00Z"') where id='${id(301)}'`);
    const g=await preview();await commit(String(g.before_hash));
    expect((await db.query<{expires_at:string}>(`select expires_at::text from entitlements where id='${id(101)}'`)).rows[0].expires_at).toContain('2029-12-15');
  });
  it('pending mandates with a schedule block even without active subscriptions',async()=>{
    await db.exec(`insert into provider_subscriptions(id,user_id,subscription_v2_id,state,next_charge_at) values('${id(40)}','${id(2)}','${id(9)}','pending',now())`);
    await expect(preview()).rejects.toThrow('reallocation_pending_provider_not_proven_idle');
  });
  it('non-admin cannot preview, inspect or commit another customer payment',async()=>{
    await db.exec(`select set_config('test.actor','${id(98)}',false)`);
    await expect(preview()).rejects.toThrow('reallocation_admin_required');
    await expect(commit('unknown')).rejects.toThrow('reallocation_admin_required');
    await expect(db.query('select admin_get_payment_reallocation($1,$2)',[id(1),id(3)])).rejects.toThrow('reallocation_admin_required');
  });
  it('authenticated callers cannot bypass RPCs with direct table writes or private graph execution',async()=>{
    await db.exec('SET ROLE authenticated');
    await expect(db.query('select payment_reallocation_graph($1,$2)',[id(1),id(3)])).rejects.toThrow(/permission denied/);
    await expect(db.query('delete from payment_reallocations')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });
});
