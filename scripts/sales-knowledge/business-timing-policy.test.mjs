import test from 'node:test';
import assert from 'node:assert/strict';
import {planReplyTime,planReengagement} from './business-timing-policy.mjs';
test('first contact waits until 08:00 Minsk, active customer replies may continue after 23:00',()=>{
 const x={now:'2026-09-12T20:30:00Z',lastInbound:'2026-09-12T20:30:00Z',eventState:'clear',random:0};
 assert.equal(planReplyTime(x).dueAt,'2026-09-13T05:01:00.000Z');
 assert.equal(planReplyTime({...x,continuation:true}).dueAt,'2026-09-12T20:31:00.000Z');
});
test('any active or uncertain event blocks even a night continuation; completion restarts random delay',()=>{
 const x={now:'2026-09-12T18:00:00Z',lastInbound:'2026-09-12T17:00:00Z',continuation:true,random:.5};
 assert.equal(planReplyTime({...x,eventState:'active'}).reason,'event_running');
 assert.equal(planReplyTime(x).reason,'event_state_unknown');
 assert.equal(planReplyTime({...x,eventState:'clear'}).dueAt,'2026-09-12T18:02:00.000Z');
});
test('seller reply never renews Telegram 24h window; near-deadline sends are blocked',()=>{
 assert.equal(planReplyTime({now:'2026-09-13T08:00:00Z',lastInbound:'2026-09-12T08:00:00Z',eventState:'clear'}).reason,'telegram_window_expired');
 const x={now:'2026-09-12T20:30:00Z',lastInbound:'2026-09-12T02:00:00Z',eventState:'clear'};
 assert.equal(planReplyTime(x).reason,'no_send_window');
});
test('one reengagement before deadline, within 08-23 Minsk; morning inbound uses evening if next opening is too late',()=>{
 const x={now:'2026-09-12T06:00:00Z',lastInbound:'2026-09-12T05:00:00Z',lastSeller:'2026-09-12T05:02:00Z',eventState:'clear',random:.5};
 const r=planReengagement(x);assert.equal(r.dueAt,'2026-09-12T19:59:00.000Z');assert.equal(r.maxAttempts,1);
 assert.equal(planReengagement({...x,alreadyAttempted:true}).action,'none');
 assert.equal(planReengagement({...x,humanHold:true}).action,'none');
});
test('no reminder immediately after a late seller answer; no reminder if window cannot fit',()=>{
 const x={now:'2026-09-12T19:50:00Z',lastInbound:'2026-09-12T01:00:00Z',lastSeller:'2026-09-12T19:45:00Z',eventState:'clear'};
 assert.equal(planReengagement(x).action,'none');
});
