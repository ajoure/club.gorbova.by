import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Never connect this test to a hosted database or production.
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'site_questionnaire_test');
assert.equal(process.env.SITE_QUESTIONNAIRE_SQL_FIXTURE_PATH,'/tmp/site-questionnaire-fixture.sql');
const run=sql=>new Promise(resolve=>{
  const process=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';process.stdout.on('data',b=>stdout+=b);process.stderr.on('data',b=>stderr+=b);
  process.on('close',code=>resolve({code,stdout,stderr}));process.stdin.end(sql);
});
const setup=await run(await readFile(process.env.SITE_QUESTIONNAIRE_SQL_FIXTURE_PATH,'utf8'));
assert.equal(setup.code,0,setup.stderr);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fields=[
  {label:'Email',type:'email',mapping:'email',value:'buyer@example.invalid'},
  {label:'ФИО',type:'text',mapping:'full_name',value:'Test Buyer'},
  {label:'Телефон',type:'phone',mapping:'phone',value:'+375 29 111 22 33'},
  {label:'Комментарий',type:'textarea',mapping:'none',value:'My complete answer'},
];
const submit=key=>`SELECT submit_site_questionnaire('${id(3)}','${id(8)}','${id(1)}','${id(key)}','${JSON.stringify(fields)}'::jsonb,'reels','v2026-04-10')`;
const [one,two]=await Promise.all([
  run(`BEGIN; ${submit(10)}; SELECT pg_sleep(0.4); COMMIT;`),
  run(`BEGIN; ${submit(10)}; COMMIT;`),
]);
for(const result of [one,two])assert.equal(result.code,0,result.stderr);
const states=[one,two].map(r=>JSON.parse(r.stdout.split('\n').find(line=>line.startsWith('{'))));
assert.equal(states[0].submission_id,states[1].submission_id);
assert.equal(states.filter(s=>s.replayed===false).length,1);
const inspect=()=>run(`SELECT jsonb_build_object('submissions',(SELECT count(*) FROM site_form_submissions),
  'orders',(SELECT count(*) FROM orders_v2),'events',(SELECT count(*) FROM domain_events),
  'consents',(SELECT count(*) FROM consent_logs),'access',(SELECT count(*) FROM commercial_access));`);
let state=await inspect();assert.equal(state.code,0,state.stderr);
assert.deepEqual(JSON.parse(state.stdout.trim()),{submissions:1,orders:1,events:1,consents:1,access:0});
const competing=await Promise.all([run(submit(11)),run(submit(12))]);
for(const result of competing)assert.equal(result.code,0,result.stderr);
state=await inspect();assert.equal(state.code,0,state.stderr);
assert.deepEqual(JSON.parse(state.stdout.trim()),{submissions:3,orders:1,events:3,consents:3,access:0});
console.log('PASS: concurrent retries create one complete submission; distinct submissions reuse one draft deal');
