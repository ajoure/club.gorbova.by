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
  const timeout=setTimeout(()=>child.kill('SIGTERM'),20_000);
  let signal; const ready=new Promise(resolve=>{signal=resolve;});
  child.stdout.on('data',chunk=>{output+=chunk; if (marker && output.includes(marker)) signal();});
  child.stderr.on('data',chunk=>{error+=chunk;});
  const done=new Promise(resolve=>child.on('close',code=>{clearTimeout(timeout);signal();resolve({code,output,error});}));
  if(keepOpen) child.stdin.write(auth+sql+"\n"); else child.stdin.end(auth+sql); return {ready,done,finish:(tail)=>child.stdin.end(tail)};
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

// The repaired existing assignment writer: real concurrent transactions, only
// the loopback synthetic database allowed above. No production connection.
let sequence=400;
const uuid=()=>`00000000-0000-0000-0000-${String(++sequence).padStart(12,'0')}`;
async function assignmentSnapshot() {
  const result=await run(`SELECT (r->>'latest_incoming_id')||'|'||(r->>'assignment_id')||'|'||(r->>'assignment_version') FROM support_bot_dialogs_v1('${bot}','${client}') r;`).done;
  assert.equal(result.code,0,result.error);
  const [incoming,id,version]=result.output.trim().split('|');assert.ok(version);
  return {incoming,id,version};
}
async function resetAssignment() {
  const result=await run(`DELETE FROM support_bot_send_claims;DELETE FROM contact_center_message_assignments;DELETE FROM audit_logs WHERE action='support_bot_assignment_cas';UPDATE profiles SET telegram_user_id=123 WHERE user_id='${client}';UPDATE telegram_bots SET status='active',support_enabled=true WHERE id='${bot}';SELECT support_bot_assign_v1('${client}','${bot}',(SELECT id FROM telegram_messages WHERE user_id='${client}' AND bot_id='${bot}' AND direction='incoming' AND transport='bot' AND business_account_id IS NULL AND business_connection_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1),'${client}');`).done;
  assert.equal(result.code,0,result.error);return assignmentSnapshot();
}
const assignCas=(s,request)=>`SELECT support_bot_assign_v1('${client}','${bot}','${s.incoming}','${actor}','${s.id}','${s.version}',123,'${request}');`;
// A completed direct edit must invalidate the snapshot even when its writer
// omits updated_at. No timestamp rounding or legacy writer can hide the edit.
let snapshot=await resetAssignment();
const edit=run(`BEGIN;UPDATE contact_center_message_assignments SET note='Concurrent edit' WHERE id='${snapshot.id}';SELECT 'EDIT_HELD';SELECT pg_sleep(1);COMMIT;`,'EDIT_HELD');
await edit.ready;let casResult=run(assignCas(snapshot,uuid()));
assert.equal((await edit.done).code,0);let outcome=await casResult.done;assert.notEqual(outcome.code,0);assert.match(outcome.error,/support_assignment_stale_refresh_required/);
// Binding update commits first; stale recipient must fail after the wait.
snapshot=await resetAssignment();
const binding=run(`BEGIN;UPDATE profiles SET telegram_user_id=456 WHERE user_id='${client}';SELECT 'CAS_BINDING_HELD';SELECT pg_sleep(1);COMMIT;`,'CAS_BINDING_HELD');
await binding.ready;casResult=run(assignCas(snapshot,uuid()));
assert.equal((await binding.done).code,0);outcome=await casResult.done;assert.notEqual(outcome.code,0);assert.match(outcome.error,/support_recipient_not_verified/);
// CAS first protects the binding; a later incoming waits and stays unanswered.
snapshot=await resetAssignment();
const request=uuid(),incomingId=uuid();
const firstCas=run(`BEGIN;${assignCas(snapshot,request)}SELECT 'CAS_LOCKS_HELD';SELECT pg_sleep(1);COMMIT;`,'CAS_LOCKS_HELD');
await firstCas.ready;
const profileWriter=run(`UPDATE profiles SET telegram_user_id=456 WHERE user_id='${client}';`), newIncoming=run(insert(incomingId));
const profileOutcome=await profileWriter.done;assert.notEqual(profileOutcome.code,0);assert.match(profileOutcome.error,/support_binding_busy_retry/);
assert.equal((await firstCas.done).code,0);assert.equal((await newIncoming.done).code,0);
assert.equal((await run(`SELECT requires_reply AND NOT is_read FROM telegram_messages WHERE id='${incomingId}';`).done).output.trim(),'t');
// Incoming first rejects the old observed incoming, without changing ownership.
snapshot=await resetAssignment();
const incomingFirst=run(`BEGIN;${insert(uuid())}SELECT 'CAS_INCOMING_HELD';SELECT pg_sleep(1);COMMIT;`,'CAS_INCOMING_HELD');
await incomingFirst.ready;casResult=run(assignCas(snapshot,uuid()));
assert.equal((await incomingFirst.done).code,0);outcome=await casResult.done;assert.notEqual(outcome.code,0);assert.match(outcome.error,/support_new_incoming_refresh_required/);
// Two operators with different requests cannot both replace the same snapshot.
snapshot=await resetAssignment();
const winner=run(`BEGIN;${assignCas(snapshot,uuid())}SELECT 'CAS_WINNER_HELD';SELECT pg_sleep(1);COMMIT;`,'CAS_WINNER_HELD');
await winner.ready;const loser=run(assignCas(snapshot,uuid()));
assert.equal((await winner.done).code,0);outcome=await loser.done;assert.notEqual(outcome.code,0);assert.match(outcome.error,/support_assignment_stale_refresh_required/);
assert.equal((await run("SELECT count(*) FROM audit_logs WHERE action='support_bot_assignment_cas';").done).output.trim(),'1');
// Concurrent replay uses one request and emits one receipt/assignment only.
snapshot=await resetAssignment();const replayRequest=uuid();
const replayWinner=run(`BEGIN;${assignCas(snapshot,replayRequest)}SELECT 'CAS_REPLAY_HELD';SELECT pg_sleep(1);COMMIT;`,'CAS_REPLAY_HELD');
await replayWinner.ready;const replay=run(assignCas(snapshot,replayRequest));
assert.equal((await replayWinner.done).code,0);const replayOutcome=await replay.done;assert.equal(replayOutcome.code,0,replayOutcome.error);assert.match(replayOutcome.output,/"created": false/);
assert.equal((await run("SELECT count(*) FROM audit_logs WHERE action='support_bot_assignment_cas';").done).output.trim(),'1');
assert.equal((await run('SELECT count(*) FROM contact_center_message_assignments;').done).output.trim(),'2');
// Direct legacy writers can hold rows before the advisory lock. Either the
// trigger rejects them before CAS reaches the row, or NOWAIT rejects CAS.
// The scheduler may choose either winner; neither ordering may deadlock.
for (const operation of ['UPDATE','DELETE']) {
  snapshot=await resetAssignment();
  const direct=run(`BEGIN;SELECT id FROM contact_center_message_assignments WHERE id='${snapshot.id}' FOR UPDATE;SELECT 'CAS_DIRECT_ROW_HELD';`,'CAS_DIRECT_ROW_HELD',true);
  await direct.ready;
  const casLocks=run(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('support-binding:${client}',0));SELECT pg_advisory_xact_lock(hashtextextended('support-bot:${client}:${bot}',0));SELECT 'CAS_ADVISORY_HELD';${assignCas(snapshot,uuid())}COMMIT;`,'CAS_ADVISORY_HELD');
  await casLocks.ready;
  direct.finish(operation==='UPDATE' ? `UPDATE contact_center_message_assignments SET note='Direct writer' WHERE id='${snapshot.id}';COMMIT;` : `DELETE FROM contact_center_message_assignments WHERE id='${snapshot.id}';COMMIT;`);
  const directOutcome=await direct.done;
  if (directOutcome.code!==0) assert.match(directOutcome.error,/support_assignment_busy_retry/);
  const casOutcome=await casLocks.done;
  if (casOutcome.code===0) {
    assert.notEqual(directOutcome.code,0,'CAS may succeed only after the competing writer rolls back');
    assert.equal((await run("SELECT count(*) FROM audit_logs WHERE action='support_bot_assignment_cas';").done).output.trim(),'1');
  } else {
    assert.match(casOutcome.error,/support_assignment_busy_retry/);
    assert.equal((await run("SELECT count(*) FROM audit_logs WHERE action='support_bot_assignment_cas';").done).output.trim(),'0');
  }
}
// A bot deactivated while the call waits cannot pass stale allowlist checks.
snapshot=await resetAssignment();
const disable=run(`BEGIN;UPDATE telegram_bots SET support_enabled=false WHERE id='${bot}';SELECT 'CAS_CONFIG_HELD';SELECT pg_sleep(1);COMMIT;`,'CAS_CONFIG_HELD');
await disable.ready;casResult=run(assignCas(snapshot,uuid()));
assert.equal((await disable.done).code,0);outcome=await casResult.done;assert.notEqual(outcome.code,0);assert.match(outcome.error,/support_channel_not_allowed|invalid_support_assignment|support_assignment_busy_retry/);
console.log('PASS real PostgreSQL assignment CAS: competing owners, replay, incoming/binding/config changes, legacy direct writers and row/advisory lock order.');
