import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// This can only connect to the disposable CI database, never production.
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'referral_redemption_test');
const run=sql=>new Promise(resolve=>{const p=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('close',code=>resolve({code,stdout,stderr}));p.stdin.end(sql);});
const actor='00000000-0000-4000-8000-000000000001',partner='00000000-0000-4000-8000-000000000003';
const setup=await run(await readFile(process.env.REFERRAL_SQL_FIXTURE_PATH,'utf8'));assert.equal(setup.code,0,setup.stderr);
const asAdmin=sql=>`BEGIN; SELECT set_config('test.uid','${actor}',true); ${sql}; COMMIT;`;
const request={reason:'Concurrent fixture exchange',cash_minor:118000,consent_reference:'Fixture consent',allow_subsidy:true,items:[{product_id:'00000000-0000-4000-8000-000000000005',tariff_id:'00000000-0000-4000-8000-000000000006',offer_id:'00000000-0000-4000-8000-000000000007',period_unit:'months',period_count:12,start_mode:'now'}]};
async function quote(){const r=await run(asAdmin(`SELECT public.referral_admin_quote_redemption('${partner}','${JSON.stringify(request)}'::jsonb)`));assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout.split('\n').find(line=>line.startsWith('{'))).quote_id;}
const first=await quote(),other=await quote();
const commit=id=>run(asAdmin(`SELECT public.referral_admin_commit_redemption('${id}')`));
const [one,replay,competing]=await Promise.all([commit(first),commit(first),commit(other)]);
const successful=[one,replay,competing].filter(r=>r.code===0);
// Either distinct quote can win; only the winner can be replayed successfully.
assert.ok(successful.length===1||successful.length===2);
const result=await run(`SELECT jsonb_build_object('orders',(SELECT count(*) FROM orders_v2),'redemptions',(SELECT count(*) FROM referral_redemptions),'spends',(SELECT count(*) FROM referral_balance_transactions WHERE transaction_type='bonus_spend'),'balance',referral_private.balance('${partner}'));`);
assert.equal(result.code,0,result.stderr);const state=JSON.parse(result.stdout.trim());assert.equal(state.orders,1);assert.equal(state.redemptions,1);assert.equal(state.spends,1);assert.equal(state.balance.internal,0);assert.equal(state.balance.available,0);
// Ordinary checkout reservation and redemption also share the same lock.
const winner=(await run('SELECT id FROM referral_redemptions')).stdout.trim();
const undone=await run(asAdmin(`SELECT public.referral_admin_reverse_redemption('${winner}','Fixture rollback',true)`));assert.equal(undone.code,0,undone.stderr);
const redemption=await quote();
const reserve=()=>run(`BEGIN; SELECT set_config('test.jwt','{"role":"service_role"}',true); SELECT public.referral_reserve_partner_bonus('00000000-0000-4000-8000-000000000002',10000,25000,'concurrent-checkout','00000000-0000-4000-8000-000000000005'); COMMIT;`);
await Promise.all([commit(redemption),reserve(),reserve()]);
const checked=await run(`SELECT jsonb_build_object('balance',referral_private.balance('${partner}'),'reservations',(SELECT count(*) FROM referral_bonus_reservations WHERE checkout_key='concurrent-checkout'));`);
assert.equal(checked.code,0,checked.stderr);const final=JSON.parse(checked.stdout.trim());assert.ok(final.balance.internal>=0);assert.ok(final.balance.available>=0);assert.ok(final.reservations<=1);
console.log('PASS: real concurrent commits/replay/reservation cannot duplicate spend or overdraw wallets');
