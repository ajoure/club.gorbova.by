import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
const env = process.env;
if (env.PGDATABASE !== 'support_channel_boundary_test' || !['127.0.0.1','localhost'].includes(env.PGHOST) || !env.SUPPORT_BOUNDARY_SQL_FIXTURE) {
  throw new Error('Local synthetic support database and fixture required; production is forbidden');
}
execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-f',env.SUPPORT_BOUNDARY_SQL_FIXTURE],{env,stdio:'pipe'});
const bot='1a560e98-574e-4fd9-82ab-4b7bbdc300b4', actor='00000000-0000-0000-0000-000000000001', client='00000000-0000-0000-0000-000000000002';
const old='00000000-0000-0000-0000-000000000100', fresh='00000000-0000-0000-0000-000000000101';
const auth=`SET test.uid='${actor}'; SET test.access='manage';`;
const insert=id=>`INSERT INTO telegram_messages(id,user_id,telegram_user_id,bot_id,transport,direction,created_at,message_text) VALUES('${id}','${client}',123,'${bot}','bot','incoming',clock_timestamp(),'Synthetic');`;
function run(sql, marker) {
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env}); let output='',error='';
  let signal; const ready=new Promise(resolve=>{signal=resolve;});
  child.stdout.on('data',chunk=>{output+=chunk; if (marker && output.includes(marker)) signal();});
  child.stderr.on('data',chunk=>{error+=chunk;});
  const done=new Promise(resolve=>child.on('close',code=>{signal();resolve({code,output,error});}));
  child.stdin.end(auth+sql); return {ready,done};
}
assert.equal((await run(insert(old)).done).code,0);
const resolve=`SELECT support_bot_set_state_v1('${client}','${bot}','${old}','resolve');`;
const closer=run(`BEGIN;${resolve}SELECT 'CLOSED_LOCK_HELD';SELECT pg_sleep(1);COMMIT;`,'CLOSED_LOCK_HELD');
await closer.ready;
const incoming=run(insert(fresh));
assert.equal((await closer.done).code,0); assert.equal((await incoming.done).code,0);
const readback=await run(`SELECT requires_reply AND NOT is_read FROM telegram_messages WHERE id='${fresh}';`).done;
assert.equal(readback.output.trim(),'t','incoming committed after resolve remains unanswered');
const stale=await run(resolve).done;assert.notEqual(stale.code,0);assert.match(stale.error,/support_new_incoming/);
// Reverse ordering: new incoming owns the lock first; old boundary waits and then rejects.
const latest='00000000-0000-0000-0000-000000000102';
const writer=run(`BEGIN;${insert(latest)}SELECT 'INSERT_LOCK_HELD';SELECT pg_sleep(1);COMMIT;`,'INSERT_LOCK_HELD');
await writer.ready;
const waiting=run(`SELECT support_bot_set_state_v1('${client}','${bot}','${fresh}','resolve');`);
assert.equal((await writer.done).code,0);const rejected=await waiting.done;assert.notEqual(rejected.code,0);assert.match(rejected.error,/support_new_incoming/);
const web='00000000-0000-0000-0000-000000000200', webOld='00000000-0000-0000-0000-000000000201', webNew='00000000-0000-0000-0000-000000000202';
const webInsert=id=>`INSERT INTO ticket_messages(id,ticket_id,author_type,message) VALUES('${id}','${web}','user','Synthetic web incoming');`;
assert.equal((await run(`INSERT INTO support_tickets(id,ticket_number,subject) VALUES('${web}','TEST-WEB','Synthetic');${webInsert(webOld)}SELECT support_web_set_state_v1('${web}','${webOld}','resolve');`).done).code,0);
const webCloser=run(`BEGIN;SELECT support_web_set_state_v1('${web}','${webOld}','close');SELECT 'WEB_CLOSE_HELD';SELECT pg_sleep(1);COMMIT;`,'WEB_CLOSE_HELD');
await webCloser.ready;const webIncoming=run(webInsert(webNew));
assert.equal((await webCloser.done).code,0);assert.equal((await webIncoming.done).code,0);
assert.equal((await run(`SELECT has_unread_admin AND status='open' FROM support_tickets WHERE id='${web}';`).done).output.trim(),'t');
const webLast='00000000-0000-0000-0000-000000000203';
const webWriter=run(`BEGIN;${webInsert(webLast)}SELECT 'WEB_INSERT_HELD';SELECT pg_sleep(1);COMMIT;`,'WEB_INSERT_HELD');
await webWriter.ready;const webWaiting=run(`SELECT support_web_set_state_v1('${web}','${webNew}','resolve');`);
assert.equal((await webWriter.done).code,0);const webRejected=await webWaiting.done;assert.notEqual(webRejected.code,0);assert.match(webRejected.error,/support_new_incoming/);
console.log('PASS real PostgreSQL: bot and web insert-after-resolution remain unanswered; resolution-after-new-incoming rejects stale boundary. No production access.');
