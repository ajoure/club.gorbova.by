import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe,it,expect } from 'vitest';
import { bootstrap,ids,args,call,accessCall } from './historical-manual-fixture.mjs';
const migration=readFileSync('supabase/migrations/20261126143000_historical_manual_installments.sql','utf8');
async function fixture(run:(db:PGlite)=>Promise<void>){const db=new PGlite();try{await db.exec(bootstrap);await db.exec(migration);await run(db);}finally{await db.close();}}
const invoke=async(db:PGlite,a=args())=>(await db.query<{result:any}>(call,a)).rows[0].result;
async function confirm(db:PGlite){const preview=await invoke(db);return invoke(db,args(true,preview.fingerprint));}

describe('historical manual two-part agreements',()=>{
  it('preview writes nothing; confirmation preserves receipt and corrects only the original debt, repeat has one audit',()=>fixture(async db=>{
    const before=(await db.query('SELECT to_jsonb(p) p FROM payments_v2 p')).rows;
    const preview=await invoke(db);expect(preview).toMatchObject({confirmed:false,total_byn:500,paid_byn:250,remaining_byn:250});
    expect((await db.query('SELECT count(*)::int n FROM historical_manual_installments')).rows).toEqual([{n:0}]);
    expect((await db.query('SELECT count(*)::int n FROM audit_logs')).rows).toEqual([{n:0}]);
    const first=await invoke(db,args(true,preview.fingerprint));const second=await invoke(db,args(true,preview.fingerprint));
    expect(first.agreement_id).toBe(second.agreement_id);expect(second.reused).toBe(true);
    expect((await db.query('SELECT to_jsonb(p) p FROM payments_v2 p')).rows).toEqual(before);
    expect((await db.query('SELECT count(*)::int n FROM audit_logs')).rows).toEqual([{n:1}]);
    expect((await db.query('SELECT count(*)::int n FROM orders_v2')).rows).toEqual([{n:1}]);
    expect((await db.query('SELECT count(*)::int n FROM provider_subscriptions')).rows).toEqual([{n:0}]);
    await expect(db.exec('UPDATE historical_manual_installments SET total_byn=600')).rejects.toThrow('historical_manual_agreement_immutable');
    await expect(db.exec('DELETE FROM historical_manual_installments')).rejects.toThrow('historical_manual_agreement_immutable');
  }),20000);
  it('owner-confirmed full agreement 2650 keeps actual1325 receipt and existing access byte-identical',()=>fixture(async db=>{
    await db.exec(`UPDATE orders_v2 SET status='paid',paid_amount=1325,final_price=1325,base_price=1325;
      UPDATE payments_v2 SET amount=1325;
      INSERT INTO subscriptions_v2(order_id,user_id,product_id,tariff_id,status,auto_renew,access_start_at,access_end_at)
      VALUES('${ids.order}','${ids.user}','${ids.product}','${ids.tariff}','active',false,now()-interval '100 days',now()+interval '100 days');`);
    const before=(await db.query('SELECT to_jsonb(s) s FROM subscriptions_v2 s')).rows;
    const a=args();a[4]=2650;a[5]=0;const preview=await invoke(db,a);a[8]=true;a[9]=preview.fingerprint;expect(preview.due_basis).toBe('recovery_now');await invoke(db,a);
    expect((await db.query('SELECT status,final_price::int total,paid_amount::int paid FROM orders_v2')).rows).toEqual([{status:'partial',total:2650,paid:1325}]);
    expect((await db.query('SELECT to_jsonb(s) s FROM subscriptions_v2 s')).rows).toEqual(before);
    const access=(await db.query<{result:any}>(accessCall,[ids.actor,ids.order,ids.profile])).rows[0].result;
    expect(access).toMatchObject({state:'complete',existing:true});
    expect((await db.query('SELECT count(*)::int n FROM historical_manual_access_dispatch')).rows).toEqual([{n:0}]);
  }),20000);
  for(const [name,sql,error] of [
    ['refund',"UPDATE payments_v2 SET refunded_amount=1",'historical_manual_payment_requires_review'],
    ['in-flight payment',"UPDATE payments_v2 SET status='processing'",'historical_manual_payment_requires_review'],
    ['foreign currency',"UPDATE payments_v2 SET currency='EUR'",'historical_manual_first_receipt_missing'],
    ['missing verified money',"UPDATE payments_v2 SET status='failed'",'historical_manual_first_receipt_missing'],
    ['provider present',`INSERT INTO provider_subscriptions(order_id,state) VALUES('${ids.order}','active')`,'historical_manual_provider_present'],
  ]) it(`fails closed on ${name}`,()=>fixture(async db=>{await db.exec(sql);await expect(invoke(db)).rejects.toThrow(error);
    expect((await db.query('SELECT count(*)::int n FROM historical_manual_installments')).rows).toEqual([{n:0}]);}),20000);
  it('rejects cross-contact, nonstaff, stale preview and changed confirmed terms',()=>fixture(async db=>{
    const foreign=args();foreign[1]=ids.actor;await expect(invoke(db,foreign)).rejects.toThrow('historical_manual_identity_mismatch');
    const unauthorized=args();unauthorized[0]=ids.user;await expect(invoke(db,unauthorized)).rejects.toThrow('historical_manual_forbidden');
    const p=await invoke(db);await db.exec("UPDATE payments_v2 SET updated_at=now()+interval '1second'");
    await expect(invoke(db,args(true,p.fingerprint))).rejects.toThrow('historical_manual_quote_changed');
    await confirm(db);const changed=args(true,p.fingerprint);changed[5]=22;
    await expect(invoke(db,changed)).rejects.toThrow('historical_manual_agreement_conflict');
    await db.exec('SET ROLE authenticated');await expect(invoke(db)).rejects.toThrow('permission denied');
  }),20000);
  it('dispatches partial access once and holds an unknown result without issuing another grant',()=>fixture(async db=>{
    await confirm(db);
    const invokeAccess=async()=>(await db.query<{result:any}>(accessCall,[ids.actor,ids.order,ids.profile])).rows[0].result;
    expect(await invokeAccess()).toMatchObject({state:'claimed',access_days:180});
    expect(await invokeAccess()).toMatchObject({state:'unknown'});
    expect((await db.query('SELECT count(*)::int n FROM historical_manual_access_dispatch')).rows).toEqual([{n:1}]);
  }),20000);
  it('never restores expired historical access from the first receipt',()=>fixture(async db=>{
    await db.exec("UPDATE payments_v2 SET paid_at=now()-interval '181 days'");await confirm(db);
    await expect(db.query(accessCall,[ids.actor,ids.order,ids.profile])).rejects.toThrow('historical_manual_access_expired');
  }),20000);
  it('creates one remaining-only link, rejects a larger balance or recurring mandate, and reuses the exact request',()=>fixture(async db=>{
    await confirm(db);
    const sub=(await db.query<{id:string}>(`INSERT INTO subscriptions_v2(order_id,user_id,product_id,tariff_id,status,auto_renew)
      VALUES($1,$2,$3,$4,'active',false) RETURNING id`,[ids.order,ids.user,ids.product,ids.tariff])).rows[0];
    const o=(await db.query<{updated_at:string}>('SELECT updated_at FROM orders_v2')).rows[0];
    const s=(await db.query<{updated_at:string}>('SELECT updated_at FROM subscriptions_v2')).rows[0];
    const payments=(await db.query('SELECT id,updated_at FROM payments_v2')).rows;
    const quote={contract_version:1,agreement_model:'historical_manual_installment',original_order_id:ids.order,subscription_v2_id:sub.id,
      total_minor:50000,paid_minor:25000,remaining_minor:25000,schedule_minor:[25000],interval_days:21,payment_type:'one_time',
      fingerprint:'checked',preserves_purchase:true,changes_access:false};
    const link=async(q=quote)=> (await db.query<{r:any}>(`SELECT create_existing_installment_payment_link_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) r`,
      [ids.actor,ids.order,sub.id,o.updated_at,s.updated_at,JSON.stringify(payments),'[]',JSON.stringify(q),'a'.repeat(48),ids.request,'Owner confirmed remaining250',false])).rows[0].r;
    await expect(link({...quote,schedule_minor:[50000]})).rejects.toThrow('repayment_invalid_quote');
    await expect(link({...quote,payment_type:'subscription',schedule_minor:[12500,12500]})).rejects.toThrow('historical_manual_single_repayment_only');
    const first=await link();const second=await link();expect(first.payment_link_id).toBe(second.payment_link_id);expect(second.reused).toBe(true);
    expect((await db.query('SELECT amount::int amount,payment_type FROM payment_links')).rows).toEqual([{amount:25000,payment_type:'one_time'}]);
    expect((await db.query('SELECT count(*)::int n FROM orders_v2')).rows).toEqual([{n:1}]);
    expect((await db.query('SELECT count(*)::int n FROM payments_v2')).rows).toEqual([{n:1}]);
    await db.query(`UPDATE payment_links SET meta=jsonb_set(meta,'{repayment,checkout_state}','"ready"') WHERE id=$1`,[first.payment_link_id]);
    const settle=async(amount=25000)=>(await db.query<{r:any}>(`SELECT record_historical_manual_repayment_v1($1,'synthetic-final-uid',$2,'BYN',now()) r`,
      [first.payment_link_id,amount])).rows[0].r;
    await expect(settle(50000)).rejects.toThrow('historical_manual_link_mismatch');
    const paid=await settle(),replay=await settle();expect(paid.payment_id).toBe(replay.payment_id);expect(replay.reused).toBe(true);
    expect((await db.query('SELECT count(*)::int n FROM payments_v2')).rows).toEqual([{n:2}]);
    expect((await db.query('SELECT status,paid_amount::int paid,final_price::int total FROM orders_v2')).rows).toEqual([{status:'paid',paid:500,total:500}]);
    expect((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='installment.historical_manual_repayment_recorded'")).rows).toEqual([{n:1}]);
    expect((await db.query('SELECT count(*)::int n FROM provider_subscriptions')).rows).toEqual([{n:0}]);
  }),20000);
});
