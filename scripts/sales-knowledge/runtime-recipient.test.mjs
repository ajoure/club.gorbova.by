import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationRecipient, campaignForConversation} from '../../supabase/functions/_shared/sales-runtime/recipient.mjs';

const campaignId = '11111111-1111-4111-8111-111111111111';
const alice = '22222222-2222-4222-8222-222222222222';
const bob = '33333333-3333-4333-8333-333333333333';
const campaign = {id: campaignId, mode: 'questionnaire_customer', test_user_id: null,
  bot_id: '44444444-4444-4444-8444-444444444444',
  business_account_id: '55555555-5555-4555-8555-555555555555'};
const conversation = (user_id) => ({campaign_id: campaignId, user_id});
const inbound = (user_id) => ({user_id, telegram_user_id: 123456789,
  bot_id: campaign.bot_id,business_account_id: campaign.business_account_id,transport:'business'});

test('two customer conversations use their own contact for existing context and checkout readers', () => {
  for (const user of [alice, bob]) {
    const scoped = campaignForConversation(campaign, conversation(user), inbound(user));
    assert.equal(scoped.test_user_id, user);
    assert.equal(scoped.id, campaign.id);
  }
  assert.equal(campaign.test_user_id, null, 'stored campaign scope is never mutated');
});

test('legacy owner conversation keeps its recipient and cannot target another client', () => {
  const owner = {...campaign, mode: 'owner_test', test_user_id: alice};
  assert.equal(conversationRecipient(owner, {campaign_id: campaignId}, inbound(alice)), alice);
  assert.throws(() => conversationRecipient(owner, conversation(bob), inbound(bob)), /owner_mismatch/);
  assert.throws(() => conversationRecipient(owner, conversation(alice), inbound(bob)), /message_mismatch/);
});

test('cross-campaign jobs, cross-contact messages and absent customer identity fail before context loading', () => {
  assert.throws(() => conversationRecipient(campaign, {...conversation(alice), campaign_id: bob}, inbound(alice)), /campaign_mismatch/);
  assert.throws(() => conversationRecipient(campaign, conversation(alice), inbound(bob)), /message_mismatch/);
  assert.throws(() => conversationRecipient(campaign, {campaign_id: campaignId}, inbound(alice)), /message_mismatch/);
  assert.throws(() => conversationRecipient({...campaign, test_user_id: alice}, conversation(bob), inbound(bob)), /customer_test_scope/);
});

test('a message for the same contact in another bot or Business account cannot supply the recipient', () => {
  for (const mismatch of [{bot_id: bob},{business_account_id: bob},{transport:'bot'}]) {
    assert.throws(() => conversationRecipient(campaign, conversation(alice), {...inbound(alice),...mismatch}), /transport_mismatch/);
  }
});

test('disabled modes, malformed identities and invalid Telegram recipients fail closed', () => {
  for (const mode of ['off', 'auto', undefined]) {
    assert.throws(() => conversationRecipient({...campaign, mode}, conversation(alice), inbound(alice)), /disabled/);
  }
  for (const telegram_user_id of [null, '', 0, -1, 'not-an-id', 2 ** 53]) {
    assert.throws(() => conversationRecipient(campaign, conversation(alice), {...inbound(alice), telegram_user_id}), /telegram_invalid/);
  }
  assert.throws(() => conversationRecipient(campaign, conversation('not-an-id'), inbound('not-an-id')), /message_mismatch/);
});
