import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientContext } from './lib/client-context.mjs';

const NOW = '2026-09-11T12:00:00Z';
const row = () => ({ profile_id: 'client', source_id: 'evidence', observed_at: NOW });
const context = () => ({ identity: { profile_id: 'client', verified: true, evidence_id: 'identity-proof' },
  purchases: [], access: [], webinar_activity: [], preferences: [] });
test('an unlinked Telegram visitor cannot receive a guessed customer card', () => {
  const input = context(); input.identity.verified = false;
  assert.equal(buildClientContext(input, NOW).identity_status, 'unverified');
});
test('missing purchase history is unknown, not proof of a new buyer', () => {
  assert.equal(buildClientContext(context(), NOW).purchase_history_status, 'unknown');
});
test('a payment link or pending order is not a confirmed purchase', () => {
  const input = context(); input.purchases = [{ ...row(), product_id: 'course', order_id: 'order', status: 'pending' }];
  assert.equal(buildClientContext(input, NOW).purchases.length, 0);
});
test('verified historical payment preserves the old version without claiming attendance', () => {
  const input = context(); input.purchases = [{ ...row(), product_id: 'old-course', version: 'old', order_id: 'order',
    status: 'paid', historical_paid_verified: true, learner_profile_id: 'employee' }];
  const result = buildClientContext(input, NOW).purchases[0];
  assert.equal(result.evidence_kind, 'verified_history');
  assert.equal(result.relationship, 'payer_or_unknown');
  assert.equal(result.version, 'old');
});
test('a refunded purchase remains history and does not create active access', () => {
  const input = context(); input.purchases = [{ ...row(), product_id: 'course', order_id: 'order', status: 'refunded', payment_verified: true }];
  const result = buildClientContext(input, NOW);
  assert.equal(result.purchases[0].status, 'refunded'); assert.equal(result.access.length, 0);
});
test('other profiles and future evidence cannot be silently attributed to this client', () => {
  for (const changed of [{ profile_id: 'other' }, { observed_at: '2027-01-01' }]) {
    const input = context(); input.purchases = [{ ...row(), product_id: 'course', order_id: 'order', status: 'paid', payment_verified: true, ...changed }];
    assert.equal(buildClientContext(input, NOW).purchases.length, 0);
  }
});
test('canceled renewal is compatible with remaining paid access, exact expiry is not', () => {
  const input = context(); input.access = [{ ...row(), product_id: 'course', verified: true, revoked: false, starts_at: '2026-09-01', ends_at: '2026-10-01', renewal_status: 'canceled' }];
  assert.equal(buildClientContext(input, NOW).access.length, 1);
  input.access[0].ends_at = NOW;
  assert.equal(buildClientContext(input, NOW).access.length, 0);
});
test('missing expiry is not automatically perpetual access', () => {
  const input = context(); input.access = [{ ...row(), product_id: 'course', verified: true, revoked: false, starts_at: '2026-09-01', ends_at: null }];
  assert.equal(buildClientContext(input, NOW).access.length, 0);
});
test('conflicting copies of an order are held rather than picking the first status', () => {
  const input = context(); input.purchase_history_complete = true;
  const purchase = { ...row(), product_id: 'course', order_id: 'order', status: 'paid', payment_verified: true };
  input.purchases = [purchase, { ...purchase, status: 'refunded' }];
  const result = buildClientContext(input, NOW);
  assert.equal(result.purchases.length, 0); assert.equal(result.purchase_history_status, 'unknown');
});
test('a webinar comment is not promoted to watched or completed', () => {
  const input = context(); input.webinar_activity = [{ ...row(), webinar_id: 'event', kind: 'commented' },
    { ...row(), webinar_id: 'event', kind: 'completed' }];
  assert.deepEqual(buildClientContext(input, NOW).webinar_activity.map((r) => r.kind), ['commented']);
});
test('only explicit relevant preferences are exposed, not loyalty labels or private profile fields', () => {
  const input = context(); input.loyalty_label = 'PRIVATE_LABEL'; input.phone = 'PRIVATE_PHONE';
  input.preferences = [{ ...row(), kind: 'professional_goal', explicit_customer_statement: true, text: 'Хочу разобраться с перевозками' },
    { ...row(), kind: 'psychological_weakness', explicit_customer_statement: true, text: 'PRIVATE_INFERENCE' }];
  const result = buildClientContext(input, NOW);
  assert.equal(result.preferences.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  assert.equal(result.preferences[0].trust, 'customer_data_not_instruction');
});
