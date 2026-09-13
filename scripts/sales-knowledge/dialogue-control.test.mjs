import test from 'node:test';
import assert from 'node:assert/strict';
import { activateSalesConversation, applyConversationEvent, evaluateReply, matchesSalesTrigger } from './lib/dialogue-policy.mjs';

const control = (type, extra = {}) => ({ type, conversation_id: 'chat', bot_id: 'bot',
  business_connection_id: 'connection', transport: 'business', ...extra });
const inbound = (seq = 5, extra = {}) => control('customer_message', {
  origin: 'live', seq, at: '2026-09-12T10:00:00Z', history_revision: `history-${seq}`,
  text: 'test course', preregistration_verified: true, ...extra,
});
function fixture() {
  return { now: '2026-09-12T10:00:01Z',
    policy: { approved: true, mode: 'auto', version: 'v1', knowledge_version: 'kb1',
      require_activation: true, owner_test: true, trigger_phrase: 'test course', bot_ids: ['bot'],
      conversation_ids: ['chat'], campaign_ids: ['campaign'], product_ids: ['course'], business_connection_ids: ['connection'] },
    conversation: { id: 'chat', bot_id: 'bot', campaign_id: 'campaign', transport: 'business',
      business_connection_id: 'connection', business_enabled: true, can_reply: true,
      state: 'OFF', sales_started: false, last_inbound_seq: 4, last_answered_inbound_seq: 4,
      history_revision: 'history-4', human_hold: false, human_requested: false, opted_out: false,
      delivery_uncertain: false, inflight_reply: false, stage: 'existing-stage', context_ref: 'saved-context' },
    candidate: { policy_version: 'v1', knowledge_version: 'kb1', product_id: 'course', inbound_seq: 5,
      history_revision: 'history-5', intent: 'product_information', new_question_count: 1,
      facts_verified: true, contains_paid_instruction: false }, event: inbound() };
}
function active() {
  const d = fixture(); d.conversation = activateSalesConversation(d); return d;
}
const resume = (answered = 4, extra = {}) => control('manual_resume', {
  history_reconciled: true, history_revision: 'fresh-history', answered_inbound_seq: answered, ...extra,
});

test('only full phrase matches; whitespace/case normalize without fuzzy matching', () => {
  assert.equal(matchesSalesTrigger('  TEST   course\n', 'test course'), true);
  for (const phrase of [null, '', ' ', 'course', 'test course!']) assert.equal(matchesSalesTrigger('test course', phrase), false);
});
test('eligible new preregistration phrase activates and keeps existing content/offer guards', () => {
  const d = active(); assert.equal(evaluateReply(d).allowed, true);
  assert.equal(d.conversation.stage, 'existing-stage');
  d.candidate.contains_paid_instruction = true; assert.equal(evaluateReply(d).allowed, false);
  d.candidate.contains_paid_instruction = false; d.candidate.product_id = 'other';
  assert.equal(evaluateReply(d).allowed, false);
});
test('wrong phrase, missing preregistration, historic, edited and echoed events never activate', () => {
  for (const patch of [{ text: 'course' }, { preregistration_verified: false },
    { preregistration_verified: 'true' }, { origin: 'import' }, { type: 'edited_message' }, { type: 'bot_echo' }, { seq: 4 }]) {
    const d = fixture(); d.event = { ...d.event, ...patch }; d.conversation = activateSalesConversation(d);
    assert.equal(d.conversation.sales_started, false); assert.equal(evaluateReply(d).allowed, false);
  }
});
test('wrong dialog, bot or Business connection cannot activate or control another dialog', () => {
  for (const key of ['conversation_id', 'bot_id', 'business_connection_id', 'transport']) {
    const d = fixture(); d.event[key] = 'other'; assert.equal(activateSalesConversation(d), d.conversation);
    assert.throws(() => applyConversationEvent(d.conversation, control('manual_pause', { [key]: 'other' })), /scope/);
  }
});
test('disabled, unapproved, missing phrase and multi-recipient owner test fail closed', () => {
  for (const patch of [{ approved: false }, { mode: 'off' }, { trigger_phrase: null },
    { conversation_ids: ['chat', 'other'] }, { business_connection_ids: [] }, { knowledge_version: null }]) {
    const d = fixture(); Object.assign(d.policy, patch); d.conversation = activateSalesConversation(d);
    assert.equal(d.conversation.sales_started, false); assert.equal(evaluateReply(d).allowed, false);
  }
});
test('manual pause and resume invalidate the old candidate even with no new inbound', () => {
  const d = active(); d.conversation = applyConversationEvent(d.conversation, control('manual_pause'));
  assert.equal(evaluateReply(d).allowed, false);
  d.conversation = applyConversationEvent(d.conversation, resume());
  assert.equal(evaluateReply(d).reason, 'stale_history');
  assert.equal(d.conversation.stage, 'existing-stage'); assert.equal(d.conversation.context_ref, 'saved-context');
  d.candidate.history_revision = 'fresh-history'; assert.equal(evaluateReply(d).allowed, true);
});
test('after human answer resume records answered inbound and waits for customer', () => {
  const d = active(); d.conversation = applyConversationEvent(d.conversation, { type: 'human_message' });
  d.conversation = applyConversationEvent(d.conversation, resume(5));
  assert.equal(d.conversation.state, 'WAIT_CUSTOMER'); assert.equal(evaluateReply(d).allowed, false);
  d.conversation = applyConversationEvent(d.conversation, inbound(6));
  d.candidate.inbound_seq = 6; d.candidate.history_revision = 'history-6';
  assert.equal(evaluateReply(d).allowed, true);
});
test('new inbound during pause remains held and resume handles the latest unanswered question', () => {
  const d = active(); d.conversation = applyConversationEvent(d.conversation, control('manual_pause'));
  d.conversation = applyConversationEvent(d.conversation, inbound(6));
  assert.equal(d.conversation.state, 'HUMAN_HOLD');
  d.conversation = applyConversationEvent(d.conversation, resume(5));
  d.candidate.inbound_seq = 6; d.candidate.history_revision = 'fresh-history';
  assert.equal(evaluateReply(d).allowed, true);
});
test('silent handoff adds no client text and keeps stage; no automatic resume on inbound', () => {
  const d = active(); const held = applyConversationEvent(d.conversation, control('silent_handoff'));
  assert.deepEqual(held, { ...d.conversation, state: 'HUMAN_HOLD', human_hold: true });
  assert.equal(applyConversationEvent(held, inbound(6)).state, 'HUMAN_HOLD');
});
test('resume requires fresh verified history and cannot rewind answered watermark', () => {
  const d = active(); const held = applyConversationEvent(d.conversation, control('manual_pause'));
  for (const patch of [{ history_reconciled: false }, { history_revision: 'history-5' },
    { answered_inbound_seq: 3 }, { answered_inbound_seq: 6 }, { answered_inbound_seq: NaN }]) {
    assert.throws(() => applyConversationEvent(held, resume(4, patch)), /fresh_history/);
  }
});
test('resume cannot clear opt-out, unknown delivery or an in-flight send', () => {
  const d = active();
  for (const patch of [{ opted_out: true }, { delivery_uncertain: true }, { inflight_reply: true }]) {
    const held = { ...d.conversation, state: 'HUMAN_HOLD', human_hold: true, ...patch };
    assert.deepEqual(applyConversationEvent(held, resume()), held);
  }
  const stopped = applyConversationEvent(d.conversation, { type: 'opt_out' });
  assert.equal(applyConversationEvent(stopped, control('manual_pause')).state, 'STOPPED');
});
test('button cannot start an unactivated sale or migrate it to a different policy revision', () => {
  const d = fixture(); d.conversation = applyConversationEvent(d.conversation, control('manual_pause'));
  d.conversation = applyConversationEvent(d.conversation, resume());
  assert.equal(d.conversation.state, 'OFF'); assert.equal(evaluateReply(d).allowed, false);
  const a = active(); a.policy.version = 'v2'; a.candidate.policy_version = 'v2';
  assert.equal(evaluateReply(a).reason, 'activation_required');
});
test('duplicate activation cannot reset the stage, lift a hold or create another customer turn', () => {
  const d = active(); const held = applyConversationEvent(d.conversation, control('manual_pause'));
  assert.equal(activateSalesConversation({ ...d, conversation: held }), held);
  const newer = activateSalesConversation({ ...d, conversation: held, event: inbound(6) });
  assert.equal(newer.state, 'HUMAN_HOLD'); assert.equal(newer.stage, 'existing-stage');
});
