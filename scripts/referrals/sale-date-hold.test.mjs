import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fixtureSql,id } from './sale-date-fixture.mjs';
import { writeFile } from 'node:fs/promises';
const sql=await fixtureSql();
if(process.env.REFERRAL_DATE_SQL_FIXTURE)await writeFile(process.env.REFERRAL_DATE_SQL_FIXTURE,sql);
async function fixture(){const db=new PGlite();try{await db.exec(sql);return db;}catch(error){await db.close();throw error;}}
async function credit(db,sale=null,available=null){return (await db.query('SELECT public.referral_admin_credit_historical_order_at($1,$2,$3,$4,$5) result',[id(6),id(8),'Synthetic historical sale',sale,available])).rows[0].result;}
async function request(db){const sales=(await db.query('SELECT a.*,p.paid_at FROM referral_sale_attributions a JOIN payments_v2 p ON p.id=a.payment_id WHERE a.partner_id=$1 ORDER BY a.id',[id(3)])).rows;const balance=(await db.query('SELECT referral_private.balance($1) b',[id(3)])).rows[0].b;return {p_operation_key:'fixture-date-repair',p_expected_balances:{[id(3)]:balance},p_items:sales.map(sale=>({id:sale.id,partner_id:sale.partner_id,order_id:sale.order_id,payment_id:sale.payment_id,commission_minor:Number(sale.commission_minor),reversed_minor:Number(sale.reversed_minor),expected_created_at:sale.created_at,expected_available_at:sale.available_at,expected_status:sale.status,sale_paid_at:sale.paid_at.toISOString(),hold_days:14,allow_unmarked:false}))};}
async function repair(db,r,dry=true){return (await db.query('SELECT public.referral_retime_historical_sales($1,$2,$3,$4) result',[r.p_operation_key,JSON.stringify(r.p_items),JSON.stringify(r.p_expected_balances),dry])).rows[0].result;}
async function historical(db){await credit(db);await db.exec("UPDATE referral_sale_attributions SET available_at=now()+interval '14 days'");return request(db);}
async function snapshot(db){const out={};for(const t of ['referral_sale_attributions','referral_balance_transactions','referral_balance_entries','audit_logs','fixture_events'])out[t]=(await db.query(`SELECT * FROM ${t} ORDER BY 1`)).rows;return out;}

test('ordinary and historical credit share sale-payment time; explicit timestamps are audited, cash split and replay unchanged',async()=>{const db=await fixture();try{
 await credit(db);let sale=(await db.query('SELECT * FROM referral_sale_attributions')).rows[0];assert.equal(sale.available_at.toISOString(),'2026-06-15T09:00:00.000Z');assert.equal(sale.commission_minor,45000);assert.equal(sale.metadata.administrative_historical,true);assert.equal(sale.rule_snapshot.hold_days,14);
 assert.deepEqual((await db.query('SELECT referral_private.balance($1) b',[id(3)])).rows[0].b,{pending:18000,available:0,held:0,paid:0,internal_pending:27000,internal:0,internal_held:0});
 await db.query('SELECT referral_process_order($1)',[id(8)]);assert.equal((await db.query('SELECT count(*) n FROM referral_sale_attributions')).rows[0].n,1);
 await db.exec('TRUNCATE referral_balance_entries,referral_balance_transactions,referral_sale_attributions');
 await credit(db,'2026-05-01T12:00:00Z','2026-05-20T18:00:00Z');sale=(await db.query('SELECT * FROM referral_sale_attributions')).rows[0];assert.equal(sale.available_at.toISOString(),'2026-05-20T18:00:00.000Z');assert.equal(new Date(sale.metadata.sale_at_override).toISOString(),'2026-05-01T12:00:00.000Z');
}finally{await db.close()}});

test('missing payment date requires explicit sale date; invalid/future overrides and unauthorized caller leave no money',async()=>{const db=await fixture();try{
 await db.exec('UPDATE payments_v2 SET paid_at=NULL');assert.equal((await db.query('SELECT referral_process_order($1) result',[id(8)])).rows[0].result,null);await assert.rejects(()=>credit(db),/sale_date_required/);assert.equal((await db.query('SELECT count(*) n FROM referral_sale_attributions')).rows[0].n,0);
 await assert.rejects(()=>credit(db,'2099-01-01'),/sale_date_in_future/);await assert.rejects(()=>credit(db,'2026-05-01','2026-04-01'),/availability_before_sale/);
 await db.exec("SELECT set_config('test.uid','',false)");await assert.rejects(()=>credit(db,'2026-05-01'),/forbidden/);
 await db.exec("SELECT set_config('test.uid','00000000-0000-4000-8000-000000000001',false)");await credit(db,'2026-05-01');
}finally{await db.close()}});

test('dry-run is zero-write; atomic repair preserves creation time and old dates, uses canonical maturation once and never emits another event',async()=>{const db=await fixture();try{
 const r=await historical(db),before=await snapshot(db);const preview=await repair(db,r);assert.equal(preview.date_changes,1);assert.equal(preview.expected_matured,1);assert.deepEqual(await snapshot(db),before);
 const result=await repair(db,r,false);assert.equal(result.changed,1);assert.equal(result.matured,1);const sale=(await db.query('SELECT * FROM referral_sale_attributions')).rows[0];assert.equal(sale.status,'available');assert.equal(sale.created_at.toISOString(),r.p_items[0].expected_created_at.toISOString());assert.equal(new Date(sale.metadata.old_dates.available_at).toISOString(),r.p_items[0].expected_available_at.toISOString());assert.equal(sale.metadata.old_dates.operation_key,r.p_operation_key);
 assert.equal(result.balances_after[id(3)].available,18000);assert.equal(result.balances_after[id(3)].internal,27000);assert.equal(result.balances_after[id(3)].pending,0);assert.equal((await db.query('SELECT count(*) n FROM fixture_events')).rows[0].n,1);
 const after=await snapshot(db);assert.equal((await repair(db,r,false)).already_applied,true);assert.deepEqual(await snapshot(db),after);
}finally{await db.close()}});

for(const [name,mutate,pattern]of [
 ['stale money',r=>r.p_items[0].commission_minor++,/sale_snapshot_changed/],
 ['stale balance',r=>r.p_expected_balances[id(3)].available++,/balance_snapshot_changed/],
 ['duplicate',r=>r.p_items.push(r.p_items[0]),/duplicate_or_missing_sale/],
 ['wrong sale date',r=>r.p_items[0].sale_paid_at='2026-05-01',/payment_snapshot_changed/],
])test(`${name} aborts with all dates and ledger unchanged`,async()=>{const db=await fixture();try{const r=await historical(db),before=await snapshot(db);mutate(r);await assert.rejects(()=>repair(db,r,false),pattern);assert.deepEqual(await snapshot(db),before);}finally{await db.close()}});

test('available historical row changes only date/metadata and no wallet entries',async()=>{const db=await fixture();try{await credit(db);await db.query('SELECT referral_mature_due_commissions(1)');await db.exec("UPDATE referral_sale_attributions SET available_at=now()-interval '1 day'");const r=await request(db),before=(await snapshot(db));const result=await repair(db,r,false);assert.equal(result.matured,0);const after=await snapshot(db);for(const t of ['referral_balance_entries','referral_balance_transactions','fixture_events'])assert.deepEqual(after[t],before[t]);}finally{await db.close()}});

test('unmarked row is not silently treated as historical; explicit frozen opt-in is required',async()=>{const db=await fixture();try{const r=await historical(db);await db.exec("UPDATE referral_sale_attributions SET metadata='{}'");await assert.rejects(()=>repair(db,r,false),/historical_sale_required/);r.p_items[0].allow_unmarked=true;assert.equal((await repair(db,r,false)).changed,1);}finally{await db.close()}});

test('unexpected new ledger entry rolls dates, audit and canonical maturation back together',async()=>{const db=await fixture();try{const r=await historical(db);await db.exec(`CREATE FUNCTION fixture_extra_entry() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.bucket='available' THEN INSERT INTO referral_balance_entries(transaction_id,partner_id,bucket,amount_minor) VALUES(NEW.transaction_id,NEW.partner_id,'internal',1); END IF;RETURN NEW; END $$;CREATE TRIGGER fixture_extra AFTER INSERT ON referral_balance_entries FOR EACH ROW EXECUTE FUNCTION fixture_extra_entry();`);const before=await snapshot(db);await assert.rejects(()=>repair(db,r,false),/unexpected_maturation_entries/);assert.deepEqual(await snapshot(db),before);}finally{await db.close()}});

test('repair endpoint is unavailable to ordinary authenticated and anonymous roles',async()=>{const db=await fixture();try{for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);await assert.rejects(()=>db.query("SELECT referral_retime_historical_sales('x','[]','{}',true)"),/permission denied/);await db.exec('RESET ROLE');}}finally{await db.close()}});


test('two pending commissions mature atomically with exact rounding; excluded available sale stays byte-for-byte unchanged',async()=>{const db=await fixture();try{
 await credit(db);await db.exec(`INSERT INTO orders_v2(id,profile_id,product_id,paid_amount) VALUES('${id(18)}','${id(7)}','${id(5)}',30581);INSERT INTO payments_v2(id,order_id,amount,paid_at) VALUES('${id(19)}','${id(18)}',30581,'2026-06-02');UPDATE products_v2 SET referral_settings_mode='custom',referral_commission_percent_bps=500;`);
 await db.query('SELECT referral_admin_credit_historical_order_at($1,$2,$3,NULL,NULL)',[id(6),id(18),'Second synthetic sale']);
 await db.exec(`UPDATE referral_sale_attributions SET available_at=now()+interval '14 days';INSERT INTO referral_sale_attributions(id,partner_id,order_id,status,commission_minor,reversed_minor,created_at,available_at,metadata) VALUES('${id(30)}','${id(31)}','${id(32)}','available',19500,0,'2026-06-01','2026-06-18','{"administrative_historical":true}');`);
 const excluded=(await db.query('SELECT * FROM referral_sale_attributions WHERE id=$1',[id(30)])).rows[0];const r=await request(db);assert.equal(r.p_items.length,2);const stale=structuredClone(r);stale.p_items[1].commission_minor++;const before=await snapshot(db);await assert.rejects(()=>repair(db,stale,false),/sale_snapshot_changed/);assert.deepEqual(await snapshot(db),before);
 const result=await repair(db,r,false);assert.equal(result.changed,2);assert.equal(result.matured,2);assert.equal(result.balances_after[id(3)].available,79162);assert.equal(result.balances_after[id(3)].internal,118743);assert.equal(result.balances_after[id(3)].pending,0);assert.deepEqual((await db.query('SELECT * FROM referral_sale_attributions WHERE id=$1',[id(30)])).rows[0],excluded);
}finally{await db.close()}});

test('refund anomaly rolls back every date; native maturation authorization is preserved without service context',async()=>{const db=await fixture();try{const r=await historical(db);await db.exec('UPDATE payments_v2 SET refunded_amount=4500');let before=await snapshot(db);await assert.rejects(()=>repair(db,r,false),/maturation_preflight_changed/);assert.deepEqual(await snapshot(db),before);await db.exec("UPDATE payments_v2 SET refunded_amount=0;SELECT set_config('test.uid','',false);SELECT set_config('test.jwt','{}',false)");before=await snapshot(db);await assert.rejects(()=>repair(db,r,false),/forbidden/);assert.deepEqual(await snapshot(db),before);}finally{await db.close()}});
