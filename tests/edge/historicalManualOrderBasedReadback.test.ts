import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {describe,it,expect} from 'vitest';
import {bootstrap,ids,args,call,accessCall} from './historical-manual-fixture.mjs';

async function fixture(run:(db:PGlite)=>Promise<void>){
  const db=new PGlite();
  try{
    await db.exec(bootstrap);
    await db.exec(readFileSync('supabase/migrations/20261126143000_historical_manual_installments.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/20261127183000_historical_manual_order_based_readback.sql','utf8'));
    const preview=(await db.query<{result:any}>(call,args())).rows[0].result;
    await db.query(call,args(true,preview.fingerprint));
    await db.exec("UPDATE products_v2 SET entitlement_mode='order_based_only'");
    const first=(await db.query<{result:any}>(accessCall,[ids.actor,ids.order,ids.profile])).rows[0].result;
    expect(first.state).toBe('claimed');
    await db.query(`INSERT INTO entitlements(order_id,user_id,product_id,status,expires_at)
      VALUES($1,$2,$3,'active',$4::timestamptz+interval '180 days')`,[ids.order,ids.user,ids.product,first.start_at]);
    await run(db);
  }finally{await db.close();}
}
const access=async(db:PGlite)=>(await db.query<{result:any}>(accessCall,[ids.actor,ids.order,ids.profile])).rows[0].result;
const counts=async(db:PGlite)=>(await db.query(`SELECT
  (SELECT count(*)::int FROM historical_manual_access_dispatch) dispatch,
  (SELECT count(*)::int FROM audit_logs) audit,
  (SELECT count(*)::int FROM subscriptions_v2) subscriptions,
  (SELECT count(*)::int FROM entitlements) entitlements,
  (SELECT count(*)::int FROM payments_v2) payments`)).rows;

describe('historical order-based access readback',()=>{
  it('recognizes the exact paid entitlement without a subscription or another dispatch',()=>fixture(async db=>{
    const before=await counts(db);
    expect(await access(db)).toMatchObject({state:'complete',existing:false,entitlement_only:true});
    expect(await access(db)).toMatchObject({state:'complete',entitlement_only:true});
    expect(await counts(db)).toEqual(before);
    expect(before[0]).toMatchObject({dispatch:1,subscriptions:0,entitlements:1,payments:1});
  }),20000);
  for(const [name,sql] of [
    ['missing right','DELETE FROM entitlements'],
    ['revoked right',"UPDATE entitlements SET status='revoked'"],
    ['shortened right',"UPDATE entitlements SET expires_at=now()"],
    ['foreign user',`UPDATE entitlements SET user_id='${ids.actor}'`],
    ['foreign product',`UPDATE entitlements SET product_id='${ids.actor}'`],
    ['foreign order',`UPDATE entitlements SET order_id='${ids.actor}'`],
    ['refunded first payment','UPDATE payments_v2 SET refunded_amount=1'],
    ['unexpected subscription',`INSERT INTO subscriptions_v2(order_id) VALUES('${ids.order}')`],
    ['other access model',"UPDATE products_v2 SET entitlement_mode='subscription'"],
  ])it(`holds ${name} without dispatching again`,()=>fixture(async db=>{
    await db.exec(sql);const before=await counts(db);
    expect(await access(db)).toMatchObject({state:'unknown'});
    expect(await counts(db)).toEqual(before);
  }),20000);
  it('retains the staff and contact identity guards',()=>fixture(async db=>{
    await expect(db.query(accessCall,[ids.user,ids.order,ids.profile])).rejects.toThrow('historical_manual_forbidden');
    await expect(db.query(accessCall,[ids.actor,ids.order,ids.actor])).rejects.toThrow('historical_manual_identity_mismatch');
    await db.exec('SET ROLE authenticated');
    await expect(db.query(accessCall,[ids.actor,ids.order,ids.profile])).rejects.toThrow('permission denied');
  }),20000);
});
