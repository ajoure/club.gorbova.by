import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDialogue, receiveInbound, pauseDialogue, resumeDialogue, handoffDialogue,
  recordManualReply, recordDeliveredReply, recordUnknownDelivery, decideReply,
  ticketIsCurrent, triggerMatches,
} from '../src/lib/autosalesDialoguePolicy.ts';

// Synthetic IDs only; never use real accounts, phrases, tariffs or customer text.
const scope = { botId: 'test-bot', businessConnectionId: 'test-connection', chatId: 'test-owner' };
const campaign = { mode: 'owner_test', revision: 'test-v1', approvedRevision: 'test-v1',
  botId: scope.botId, businessConnectionId: scope.businessConnectionId,
  allowedChatIds: [scope.chatId], triggerPhrase: 'ТЕСТ КУРСА', knowledgeReady: true, offerReady: true };
const evidence = { connectionEnabled: true, canReplyNow: true, historyComplete: true };
const inbound = (messageId, extra = {}) => ({ scope, messageId, kind: 'new', text: 'тест курса',
  preRegistrationVerified: true, optedOut: false, ...extra });
const started = () => receiveInbound(newDialogue(scope), inbound(10), campaign);
const prepare = (state) => {
  const result = decideReply(state, campaign, evidence);
  assert.equal(result.action, 'prepare');
  return result.ticket;
};
const waiting = (state, reason, config = campaign, rights = evidence) => {
  assert.deepEqual(decideReply(state, config, rights), { action: 'wait', reason });
};

test('only full phrase matches; normalization is narrow and empty never starts', () => {
  assert.equal(triggerMatches('  ТеСт   КУРСА\n', campaign.triggerPhrase), true);
  for (const value of ['тест', 'тест курса!', 'не тест курса', '']) {
    assert.equal(triggerMatches(value, campaign.triggerPhrase), false);
  }
  assert.equal(triggerMatches('', null), false);
  assert.equal(triggerMatches(' ', ' '), false);
});

test('only allowlisted owner with new inbound and verified preregistration starts', () => {
  assert.equal(started().started, true);
  for (const patch of [{ preRegistrationVerified: false }, { text: 'интересует курс' },
    { kind: 'edit' }, { kind: 'import' }, { kind: 'echo' }, { messageId: NaN }]) {
    assert.equal(receiveInbound(newDialogue(scope), inbound(10, patch), campaign).started, false);
  }
  for (const field of ['chatId', 'botId', 'businessConnectionId']) {
    assert.equal(receiveInbound(newDialogue(scope), inbound(10, { scope: { ...scope, [field]: 'other' } }), campaign).started, false);
  }
  const other = { ...scope, chatId: 'other' };
  assert.equal(receiveInbound(newDialogue(other), inbound(10, { scope: other }), campaign).started, false);
});

test('missing settings, unapproved revision, multiple test recipients and disabled mode fail closed', () => {
  for (const patch of [{ mode: 'off' }, { mode: 'invalid' }, { triggerPhrase: null },
    { approvedRevision: null }, { revision: 'v2' }, { knowledgeReady: false },
    { offerReady: false }, { allowedChatIds: [] }, { allowedChatIds: ['test-owner', 'other'] }]) {
    const config = { ...campaign, ...patch };
    const state = receiveInbound(newDialogue(scope), inbound(10), config);
    assert.equal(state.started, false);
    waiting(state, 'campaign_not_ready', config);
  }
  assert.throws(() => newDialogue({ ...scope, businessConnectionId: '' }));
});

test('no initial response from a button without trigger', () => {
  waiting(resumeDialogue(pauseDialogue(newDialogue(scope))), 'trigger_not_received');
});

test('delivered reply waits; duplicate, edit, import or echo cannot start another turn', () => {
  const state = recordDeliveredReply(started(), scope, 11);
  waiting(state, 'WAIT_CUSTOMER');
  for (const event of [inbound(10), inbound(9), inbound(12, { kind: 'edit' }),
    inbound(12, { kind: 'import' }), inbound(12, { kind: 'echo' })]) {
    waiting(receiveInbound(state, event, campaign), 'WAIT_CUSTOMER');
  }
  prepare(receiveInbound(state, inbound(12, { text: 'какая программа?' }), campaign));
});

test('a late inbound older than outbound cannot activate an idle dialog', () => {
  const state = recordManualReply(newDialogue(scope), scope, 20);
  const resumed = resumeDialogue(state);
  assert.equal(receiveInbound(resumed, inbound(10), campaign).started, false);
});

test('pause invalidates a prepared ticket even after resume', () => {
  const state = started(), ticket = prepare(state);
  assert.equal(ticketIsCurrent(ticket, state, campaign, evidence), true);
  const paused = pauseDialogue(state);
  waiting(paused, 'human');
  assert.equal(ticketIsCurrent(ticket, paused, campaign, evidence), false);
  const resumed = resumeDialogue(paused);
  assert.equal(ticketIsCurrent(ticket, resumed, campaign, evidence), false);
  prepare(resumed);
});

test('silent handoff holds the dialog and preserves stage and canonical context', () => {
  const state = { ...started(), stage: 'tariff_comparison', contextRef: 'synthetic-history-v1' };
  const held = handoffDialogue(state);
  waiting(held, 'human');
  const resumed = resumeDialogue(held);
  assert.equal(resumed.stage, state.stage);
  assert.equal(resumed.contextRef, state.contextRef);
  assert.equal(resumed.started, true);
  assert.equal(resumed.activationRevision, state.activationRevision);
  prepare(resumed);
});

test('after a human reply resume waits for the customer, preserving context', () => {
  const state = { ...started(), stage: 'offer', contextRef: 'synthetic-history-v2' };
  const resumed = resumeDialogue(recordManualReply(state, scope, 11));
  waiting(resumed, 'WAIT_CUSTOMER');
  assert.equal(resumed.stage, 'offer');
  assert.equal(resumed.contextRef, 'synthetic-history-v2');
  prepare(receiveInbound(resumed, inbound(12, { text: 'следующий вопрос' }), campaign));
});

test('inbound during pause stays silent and resume handles only the latest unanswered question', () => {
  let state = recordManualReply(started(), scope, 11);
  state = receiveInbound(state, inbound(12), campaign);
  state = receiveInbound(state, inbound(13), campaign);
  waiting(state, 'human');
  assert.equal(prepare(resumeDialogue(state)).inboundId, 13);
  waiting(resumeDialogue(recordManualReply(state, scope, 14)), 'WAIT_CUSTOMER');
});

test('new inbound and manual reply invalidate earlier generation; other dialog cannot', () => {
  const state = started(), ticket = prepare(state);
  const newer = receiveInbound(state, inbound(12), campaign);
  assert.equal(ticketIsCurrent(ticket, newer, campaign, evidence), false);
  assert.equal(ticketIsCurrent(ticket, recordManualReply(state, scope, 11), campaign, evidence), false);
  assert.equal(recordManualReply(state, { ...scope, businessConnectionId: 'other' }, 11), state);
  assert.equal(recordDeliveredReply(state, { ...scope, chatId: 'other' }, 11), state);
  assert.equal(ticketIsCurrent({ ...ticket, scope: { ...scope, chatId: 'other' } }, state, campaign, evidence), false);
});

test('revoked rights, incomplete history and revised campaign block an existing ticket', () => {
  const state = started(), ticket = prepare(state);
  for (const field of ['connectionEnabled', 'canReplyNow', 'historyComplete']) {
    assert.equal(ticketIsCurrent(ticket, state, campaign, { ...evidence, [field]: false }), false);
  }
  assert.equal(ticketIsCurrent(ticket, state, { ...campaign, mode: 'off' }, evidence), false);
  const revised = { ...campaign, revision: 'v2', approvedRevision: 'v2' };
  waiting(state, 'activation_revision_changed', revised);
});

test('out of order stop request cannot be bypassed by later inbound or resume', () => {
  const state = receiveInbound(started(), inbound(12), campaign);
  const stopped = receiveInbound(state, inbound(11, { optedOut: true }), campaign);
  waiting(resumeDialogue(stopped), 'stopped');
  waiting(receiveInbound(stopped, inbound(13), campaign), 'stopped');
  waiting(recordUnknownDelivery(stopped), 'stopped');
});

test('unknown delivery is sticky; ordinary pause, resume, inbound or late confirmation cannot clear it', () => {
  const state = recordUnknownDelivery(started());
  for (const changed of [pauseDialogue(state), resumeDialogue(state),
    receiveInbound(state, inbound(12), campaign), recordDeliveredReply(state, scope, 11)]) {
    waiting(changed, 'delivery_unknown');
  }
});

test('late send confirmation after a pause records delivery without relinquishing human control', () => {
  const held = pauseDialogue(started());
  const delivered = recordDeliveredReply(held, scope, 11);
  waiting(delivered, 'human');
  waiting(resumeDialogue(delivered), 'WAIT_CUSTOMER');
});
