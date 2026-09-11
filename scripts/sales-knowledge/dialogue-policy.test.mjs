import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConversationEvent, evaluateReply } from './lib/dialogue-policy.mjs';

function scenario() {
  return { now: '2026-09-11T12:00:00Z',
    policy: { approved: true, mode: 'auto', version: 'rules-v1', knowledge_version: 'kb-v1',
      bot_ids: ['bot'], conversation_ids: ['chat'], campaign_ids: ['campaign'], product_ids: ['course'], business_connection_ids: ['connection'] },
    conversation: { id: 'chat', bot_id: 'bot', campaign_id: 'campaign', transport: 'business', business_connection_id: 'connection',
      business_enabled: true, can_reply: true, state: 'READY', last_inbound_actor: 'customer',
      last_inbound_at: '2026-09-11T11:59:00Z', last_inbound_seq: 5, last_answered_inbound_seq: 4,
      history_revision: 'history-5', human_hold: false, human_requested: false, opted_out: false,
      delivery_uncertain: false, inflight_reply: false },
    candidate: { policy_version: 'rules-v1', knowledge_version: 'kb-v1', product_id: 'course', inbound_seq: 5,
      history_revision: 'history-5', intent: 'product_information', new_question_count: 1,
      facts_verified: true, contains_paid_instruction: false } };
}
test('reply to a new customer question requires WAIT_CUSTOMER after delivery', () => {
  const result = evaluateReply(scenario());
  assert.equal(result.allowed, true); assert.equal(result.after_delivery, 'WAIT_CUSTOMER');
});
for (const [name, change] of [
  ['off', d => { d.policy.mode = 'off'; }],
  ['shadow', d => { d.policy.mode = 'shadow'; }],
  ['draft', d => { d.policy.mode = 'draft'; }],
  ['unapproved', d => { d.policy.approved = false; }],
  ['different bot', d => { d.conversation.bot_id = 'other'; }],
  ['different conversation', d => { d.conversation.id = 'other'; }],
  ['different campaign', d => { d.conversation.campaign_id = 'other'; }],
  ['different product', d => { d.candidate.product_id = 'other'; }],
  ['different Business account', d => { d.conversation.business_connection_id = 'other'; }],
  ['revoked Business permission', d => { d.conversation.can_reply = false; }],
  ['disabled Business connection', d => { d.conversation.business_enabled = false; }],
  ['exactly 24 hours', d => { d.conversation.last_inbound_at = '2026-09-10T12:00:00Z'; }],
  ['future inbound', d => { d.conversation.last_inbound_at = '2027-01-01'; }],
  ['malformed clock', d => { d.now = 'unknown'; }],
  ['group transport', d => { d.conversation.transport = 'group'; }],
  ['already answered', d => { d.conversation.last_answered_inbound_seq = 5; }],
  ['echo from owner', d => { d.conversation.last_inbound_actor = 'owner'; }],
  ['updated incoming message', d => { d.conversation.history_revision = 'history-6'; }],
  ['updated rules', d => { d.policy.version = 'rules-v2'; }],
  ['updated knowledge', d => { d.policy.knowledge_version = 'kb-v2'; }],
  ['customer requested human', d => { d.conversation.human_requested = true; }],
  ['human replied', d => { d.conversation.human_hold = true; }],
  ['opted out', d => { d.conversation.opted_out = true; }],
  ['uncertain Telegram delivery', d => { d.conversation.delivery_uncertain = true; }],
  ['another sender owns reply', d => { d.conversation.inflight_reply = true; }],
  ['unknown hold status', d => { delete d.conversation.human_hold; }],
  ['unknown opt-out status', d => { delete d.conversation.opted_out; }],
  ['missing delivery status', d => { delete d.conversation.delivery_uncertain; }],
  ['closed dialogue', d => { d.conversation.state = 'STOPPED'; }],
  ['missing state', d => { delete d.conversation.state; }],
  ['paid solution', d => { d.candidate.contains_paid_instruction = true; }],
  ['refund request', d => { d.candidate.intent = 'refund'; }],
  ['professional consultation', d => { d.candidate.intent = 'solve_accounting_task'; }],
  ['unverified facts', d => { d.candidate.facts_verified = false; }],
  ['several new questions', d => { d.candidate.new_question_count = 2; }],
  ['unknown offer', d => { d.candidate.intent = 'checkout_link'; }],
]) test(`${name}: no autonomous outgoing`, () => {
  const data = scenario(); change(data); assert.equal(evaluateReply(data).allowed, false);
});
test('ordinary bot does not inherit Business restrictions but retains selected chat scope', () => {
  const data = scenario(); data.conversation.transport = 'bot'; delete data.conversation.business_connection_id;
  assert.equal(evaluateReply(data).allowed, true);
  data.policy.conversation_ids = []; assert.equal(evaluateReply(data).allowed, false);
});
for (const event of ['timer', 'payment_received', 'page_view', 'webinar_attendance', 'edited_message', 'bot_echo']) {
  test(`${event} cannot unlock waiting`, () => {
    const data = scenario(); data.conversation.state = 'WAIT_CUSTOMER'; data.conversation.last_answered_inbound_seq = 5;
    data.conversation = applyConversationEvent(data.conversation, { type: event, history_revision: 'edited-revision' });
    assert.equal(evaluateReply(data).allowed, false);
  });
}
test('a new incoming message invalidates the old draft without releasing human hold', () => {
  const data = scenario();
  const event = { type: 'customer_message', seq: 6, at: '2026-09-11T12:00:00Z', history_revision: 'history-6' };
  data.conversation = applyConversationEvent(data.conversation, event);
  assert.equal(evaluateReply(data).reason, 'stale_history');
  data.conversation = applyConversationEvent(data.conversation, { type: 'human_message' });
  data.conversation = applyConversationEvent(data.conversation, { ...event, seq: 7, history_revision: 'history-7' });
  assert.equal(data.conversation.state, 'HUMAN_HOLD');
});
test('editing history invalidates a drafted answer without inventing a new customer turn', () => {
  const data = scenario();
  data.conversation = applyConversationEvent(data.conversation, { type: 'edited_message', history_revision: 'edited-revision' });
  assert.equal(data.conversation.last_inbound_seq, 5);
  assert.equal(evaluateReply(data).reason, 'stale_history');
});
test('a late delivery acknowledgement cannot reactivate an administratively stopped conversation', () => {
  for (const state of ['OFF', 'STOPPED', 'HUMAN_HOLD']) {
    const data = { ...scenario().conversation, state, pending_delivery_id: 'delivery' };
    assert.equal(applyConversationEvent(data, { type: 'delivery_confirmed', delivery_id: 'delivery', inbound_seq: 5 }).state, state);
  }
});
test('delivery confirmation must match the pending attempt and preserve opt-out', () => {
  const data = scenario().conversation; data.pending_delivery_id = 'delivery'; data.inflight_reply = true;
  assert.throws(() => applyConversationEvent(data, { type: 'delivery_confirmed', delivery_id: 'other', inbound_seq: 5 }));
  const stopped = applyConversationEvent(data, { type: 'opt_out' });
  const delivered = applyConversationEvent(stopped, { type: 'delivery_confirmed', delivery_id: 'delivery', inbound_seq: 5 });
  assert.equal(delivered.state, 'STOPPED'); assert.equal(delivered.last_answered_inbound_seq, 5);
});
