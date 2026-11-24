import {PGlite} from '@electric-sql/pglite';
import {fixtureSql} from './sale-date-fixture.mjs';
import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
// Entirely synthetic cohort; production identifiers stay in private artifacts.
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const partners=[uid(101),uid(102),uid(103)];
const before={balances:partners.map((partner_id,i)=>({partner_id,status:'active',balance:{available:i===1?118000:i===2?7800:0,pending:i===0?79162:0}})),sales:[45000,152905,45000,250000,19500].map((commission_minor,i)=>({
 id:uid(200+i),partner_id:partners[i<2?0:i<4?1:2],order_id:uid(300+i),payment_id:uid(400+i),
 order_status:'paid',payment_status:'succeeded',currency:'BYN',amount:i===1?'30581':String(commission_minor/10),paid_amount:i===1?'30581':String(commission_minor/10),
 paid_at:'2026-06-01T09:00:00Z',refunded_amount:'0',is_deleted:false,commission_minor,commission_basis_minor:i===1?3058100:commission_minor*10,
 commission_percent_bps:i===1?500:1000,reversed_minor:0,status:i<2?'pending':'available',
 created_at:i<2?'2026-11-20T12:00:00Z':'2026-06-01T12:00:00Z',available_at:i<2?'2026-12-04T12:00:00Z':'2026-06-15T12:00:00Z'
}))};
let once=await readFile(new URL('../../supabase/migrations/20261124105058_referral_authorized_date_repair_once.sql',import.meta.url),'utf8');
const db=new PGlite();
try{
 await db.exec((await fixtureSql()).replaceAll("current_setting('test.jwt',true)","current_setting('request.jwt.claims',true)"));
 await db.exec("TRUNCATE referral_sale_attributions,referral_balance_entries,referral_balance_transactions,payments_v2,orders_v2,referral_partners CASCADE;SELECT set_config('test.uid','',false);SELECT set_config('request.jwt.claims','{}',false)");
 for(const p of before.balances)await db.query('INSERT INTO referral_partners(id,status) VALUES($1,$2)',[p.partner_id,p.status]);
 for(const s of before.sales){
  await db.query('INSERT INTO orders_v2(id,status,paid_amount,currency) VALUES($1,$2,$3,$4)',[s.order_id,s.order_status,s.paid_amount,s.currency]);
  await db.query('INSERT INTO payments_v2(id,order_id,status,amount,paid_at,refunded_amount,is_deleted) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.payment_id,s.order_id,s.payment_status,s.amount,s.paid_at,s.refunded_amount,s.is_deleted]);
  await db.query('INSERT INTO referral_sale_attributions(id,partner_id,order_id,payment_id,status,commission_minor,commission_basis_minor,commission_percent_bps,reversed_minor,created_at,available_at,metadata,rule_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[s.id,s.partner_id,s.order_id,s.payment_id,s.status,s.commission_minor,s.commission_basis_minor,s.commission_percent_bps,s.reversed_minor,s.created_at,s.available_at,JSON.stringify(s.commission_minor===250000?{}:{administrative_historical:true}),JSON.stringify({hold_days:14,split_60_40_enabled:true,withdrawable_percent_bps:4000})]);
  const tx=(await db.query("INSERT INTO referral_balance_transactions(partner_id,source_id) VALUES($1,$2) RETURNING id",[s.partner_id,s.id])).rows[0].id;
  const cash=Math.round(s.commission_minor*.4),internal=s.commission_minor-cash;
  await db.query('INSERT INTO referral_balance_entries(transaction_id,partner_id,bucket,amount_minor) VALUES($1,$2,$3,$4),($1,$2,$5,$6)',[tx,s.partner_id,s.status==='pending'?'pending':'available',cash,s.status==='pending'?'internal_pending':'internal',internal]);
 }
 const p=before.balances.find(x=>x.balance.available===118000).partner_id;
 const tx=(await db.query("INSERT INTO referral_balance_transactions(partner_id,transaction_type) VALUES($1,'internal_spent') RETURNING id",[p])).rows[0].id;
 await db.query("INSERT INTO referral_balance_entries(transaction_id,partner_id,bucket,amount_minor) VALUES($1,$2,'internal',-164000)",[tx,p]);
 const snap=async()=>JSON.stringify((await db.query('SELECT * FROM referral_sale_attributions ORDER BY id')).rows);
 // Replace only the production fingerprint with the synthetic fixture fingerprint.
 const fingerprintQuery=once.slice(once.indexOf(' SELECT md5'),once.indexOf(' IF fingerprint')).replace(' INTO fingerprint','').replace(/\bop\b/g,"'referral-hold-sale-date-20261124-v1'");
 const fingerprint=Object.values((await db.query(fingerprintQuery)).rows[0])[0];
 once=once.replace(/fingerprint IS DISTINCT FROM '[0-9a-f]{32}'/,`fingerprint IS DISTINCT FROM '${fingerprint}'`);
 const initial=await snap();await db.exec('BEGIN');await db.exec("UPDATE payments_v2 SET refunded_amount=1 WHERE id=(SELECT min(id::text)::uuid FROM payments_v2)");await assert.rejects(()=>db.exec(once),/frozen_financial_snapshot_changed/);await db.exec('ROLLBACK');assert.equal(await snap(),initial);
 await db.exec('BEGIN');await db.exec(once);await db.exec('COMMIT');
 const shid=before.balances.find(x=>x.balance.pending===79162).partner_id;
 const b=(await db.query('SELECT referral_private.balance($1) b',[shid])).rows[0].b;
 assert.deepEqual(b,{available:79162,held:0,internal:118743,internal_held:0,internal_pending:0,paid:0,pending:0});
 assert.equal((await db.query("SELECT count(*)::int n FROM referral_balance_transactions WHERE transaction_type='commission_available'")).rows[0].n,2);
 const after=await snap();await db.exec('BEGIN');await db.exec(once);await db.exec('COMMIT');assert.equal(await snap(),after);
 assert.equal((await db.query("SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb j")).rows[0].j.role,undefined);
 console.log('PASS exact one-shot migration: stale fingerprint abort, 4 repairs/2 maturations, expected balances, replay no-op, service context restored');
}finally{await db.close();}
