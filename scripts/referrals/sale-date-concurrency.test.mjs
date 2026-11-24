import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fixtureSql,id } from './sale-date-fixture.mjs';
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'referral_sale_date_test');
function run(sql,onData){let child;const done=new Promise(resolve=>{child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;onData?.(String(b));});child.stderr.on('data',b=>stderr+=b);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(`SET test.jwt='{"role":"service_role"}';\n${sql}`);});return done;}
let r=await run(await fixtureSql());assert.equal(r.code,0,r.stderr);
r=await run(`SELECT set_config('test.uid','${id(1)}',false);SELECT public.referral_admin_credit_historical_order('${id(6)}','${id(8)}','Native fixture historical sale'); UPDATE referral_sale_attributions SET available_at=now()+interval '14 days';
SELECT jsonb_build_object('operation_key','native-retime','items',(SELECT jsonb_agg(jsonb_build_object('id',a.id,'partner_id',a.partner_id,'order_id',a.order_id,'payment_id',a.payment_id,'commission_minor',a.commission_minor,'reversed_minor',a.reversed_minor,'expected_created_at',a.created_at,'expected_available_at',a.available_at,'expected_status',a.status,'sale_paid_at',p.paid_at,'hold_days',14)) FROM referral_sale_attributions a JOIN payments_v2 p ON p.id=a.payment_id),'balances',jsonb_build_object('${id(3)}',referral_private.balance('${id(3)}')));`);
assert.equal(r.code,0,r.stderr);const request=JSON.parse(r.stdout.split('\n').find(line=>line.includes('"operation_key"')));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const repair=`SELECT public.referral_retime_historical_sales(${quote(request.operation_key)},${quote(JSON.stringify(request.items))}::jsonb,${quote(JSON.stringify(request.balances))}::jsonb,false);`;
async function blockedBy(sql,pattern){let ready;const acquired=new Promise(resolve=>ready=resolve);const held=run(`BEGIN;${sql};SELECT 'LOCK_HELD';SELECT pg_sleep(1);COMMIT;`,chunk=>{if(chunk.includes('LOCK_HELD'))ready();});await acquired;const result=await run(repair);assert.notEqual(result.code,0);assert.match(result.stderr,pattern);assert.equal((await run('SELECT count(*) FROM audit_logs')).stdout.trim(),'1');await held;}
await blockedBy(`SELECT pg_advisory_xact_lock(hashtextextended('${id(3)}',0))`,/wallet_busy_retry/);
await blockedBy('SELECT id FROM referral_sale_attributions FOR UPDATE',/could not obtain lock/);
const outcomes=await Promise.all([run(repair),run(repair),run(repair),run("SELECT set_config('test.jwt','{\"role\":\"service_role\"}',false);SELECT referral_mature_due_commissions(10)")]);
assert.ok(outcomes.slice(0,3).some(x=>x.code===0));
const replay=await run(repair);assert.equal(replay.code,0,replay.stderr);assert.equal(JSON.parse(replay.stdout.trim()).already_applied,true);
const state=await run(`SELECT jsonb_build_object('mature_tx',(SELECT count(*) FROM referral_balance_transactions WHERE transaction_type='commission_available'),'entries',(SELECT count(*) FROM referral_balance_entries),'status',(SELECT status FROM referral_sale_attributions),'balance',referral_private.balance('${id(3)}'));`);
assert.equal(state.code,0,state.stderr);const result=JSON.parse(state.stdout.trim());assert.equal(result.mature_tx,1);assert.equal(result.entries,6);assert.equal(result.status,'available');assert.equal(result.balance.available,18000);assert.equal(result.balance.internal,27000);
console.log('PASS: actual PostgreSQL wallet/row-lock collision, overlapping repair/replay/cron, one canonical maturation and no duplicate funds');
