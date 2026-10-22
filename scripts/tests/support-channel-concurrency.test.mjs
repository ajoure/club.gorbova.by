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
function run(sql, marker, keepOpen=false) {
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env}); let output='',error='';
  let signal; const ready=new Promise(resolve=>{signal=resolve;});
  child.stdout.on('data',chunk=>{output+=chunk; if (marker && output.includes(marker)) signal();});
  child.stderr.on('data',chunk=>{error+=chunk;});
  const done=new Promise(resolve=>child.on('close',code=>{signal();resolve({code,output,error});}));
  if(keepOpen) child.stdin.write(auth+sql); else child.stdin.end(auth+sql); return {ready,done,finish:(tail)=>child.stdin.end(tail)};
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
// CAS vs profile binding: a completed rebind must be seen before authorization.
const nonce='00000000-0000-0000-0000-000000000300';
const begin=(request=nonce)=>`SELECT support_bot_begin_send_v1('${actor}','${client}','${bot}','${latest}','${request}',null);`;
const rebind=run(`BEGIN;UPDATE profiles SET telegram_user_id=456 WHERE user_id='${client}';SELECT 'BINDING_HELD';SELECT pg_sleep(1);COMMIT;`,'BINDING_HELD');
await rebind.ready;const sendAfterBinding=run(begin());
assert.equal((await rebind.done).code,0);const bindingRejected=await sendAfterBinding.done;assert.notEqual(bindingRejected.code,0);assert.match(bindingRejected.error,/support_recipient_not_verified/);
assert.equal((await run(`UPDATE profiles SET telegram_user_id=123 WHERE user_id='${client}';`).done).code,0);
// Send claim owns binding/dialog locks first. Profile writer fails rather than
// waiting with row locks; assignment writer waits then sees the committed lease.
const claimWriter=run(`BEGIN;${begin()}SELECT 'SEND_CLAIM_HELD';SELECT pg_sleep(1);COMMIT;`,'SEND_CLAIM_HELD');
await claimWriter.ready;
const profileDuringSend=run(`UPDATE profiles SET telegram_user_id=456 WHERE user_id='${client}';`);
const assignmentDuringSend=run(`SELECT support_bot_assign_v1('${client}','${bot}','${latest}','${actor}');`);
const profileRejected=await profileDuringSend.done;assert.notEqual(profileRejected.code,0);assert.match(profileRejected.error,/support_binding_busy_retry|support_send_in_progress_retry/);
assert.equal((await claimWriter.done).code,0);const assignmentRejected=await assignmentDuringSend.done;assert.notEqual(assignmentRejected.code,0);assert.match(assignmentRejected.error,/support_send_in_progress_retry/);
assert.equal((await run(`SELECT support_bot_finish_send_v1('${nonce}','sent',700);`).done).code,0);
// Existing assignment wins before CAS: authorization must reject another owner.
const assigned=run(`BEGIN;SELECT support_bot_assign_v1('${client}','${bot}','${latest}','${client}');SELECT 'ASSIGNMENT_HELD';SELECT pg_sleep(1);COMMIT;`,'ASSIGNMENT_HELD');
await assigned.ready;const sendAfterAssignment=run(begin('00000000-0000-0000-0000-000000000301'));
assert.equal((await assigned.done).code,0);const ownerRejected=await sendAfterAssignment.done;assert.notEqual(ownerRejected.code,0);assert.match(ownerRejected.error,/support_assigned_to_another_employee/);
console.log('PASS real PostgreSQL: binding/assignment before CAS reject stale authorization; CAS first excludes profile/assignment changes without row/advisory deadlock.');

// A legacy direct writer holds the row first; resolve holds advisory first.
// The BEFORE trigger must fail fast instead of waiting in the opposite order.
for (const operation of ['UPDATE','DELETE']) {
  const clean=await run(`DELETE FROM contact_center_message_assignments;SELECT support_bot_assign_v1('${client}','${bot}','${latest}','${actor}');`).done;
  assert.equal(clean.code,0,clean.error);
  const direct=run(`BEGIN;SELECT id FROM contact_center_message_assignments WHERE resolved_at IS NULL FOR UPDATE;SELECT 'DIRECT_ROW_HELD';`,'DIRECT_ROW_HELD',true);
  await direct.ready;
  const resolving=run(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('support-bot:${client}:${bot}',0));SELECT 'RESOLVE_ADVISORY_HELD';SELECT support_bot_set_state_v1('${client}','${bot}','${latest}','resolve');COMMIT;`,'RESOLVE_ADVISORY_HELD');
  await resolving.ready;
  direct.finish(operation==='UPDATE' ? "UPDATE contact_center_message_assignments SET note='Synthetic concurrent change';COMMIT;" : 'DELETE FROM contact_center_message_assignments;COMMIT;');
  const directResult=await direct.done;assert.notEqual(directResult.code,0);assert.match(directResult.error,/support_assignment_busy_retry/);
  const resolvedResult=await resolving.done;assert.equal(resolvedResult.code,0,resolvedResult.error);
}
console.log('PASS real PostgreSQL: direct assignment UPDATE/DELETE vs resolve fail fast, without deadlock.');
