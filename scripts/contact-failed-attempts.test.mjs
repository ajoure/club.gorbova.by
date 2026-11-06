import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeContactFailedAttempts } from '../src/lib/payments/contactFailedAttempts.ts';

const attempt = (id, uid, at = '2026-11-04T03:01:43Z') => ({
  id, provider_payment_id: uid, amount: 250, currency: 'BYN', attempted_at: at,
});
test('two failures remain separate from the later single successful payment', () => {
  const paid = { id: 'paid', provider_payment_id: 'success', paid_at: '2026-11-05T03:00:54Z', status: 'succeeded' };
  const before = structuredClone(paid);
  const rows = mergeContactFailedAttempts([paid], [attempt('a', 'failed1'), attempt('b', 'failed2', '2026-11-03T22:15:41Z')]);
  assert.deepEqual(rows.map(r => r.status), ['succeeded', 'failed', 'failed']);
  assert.equal(rows.filter(r => r.is_attempt).length, 2);
  assert.deepEqual(paid, before);
  assert.ok(rows.slice(1).every(r => r.order_id === null && r.card_last4 === null));
});
test('provider UID deduplicates canonical records and repeated attempt rows', () => {
  const rows = mergeContactFailedAttempts([{ id: 'p', provider_payment_id: 'u', paid_at: null }],
    [attempt('a', 'u'), attempt('b', 'v'), attempt('c', 'v')]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].provider_payment_id, 'v');
});
test('malformed attempt metadata never becomes a display payment', () => {
  const good = attempt('a', 'u');
  for (const patch of [{ provider_payment_id: '' }, { id: '' }, { amount: NaN }, { amount: -1 }, { currency: 'invalid' }, { attempted_at: 'bad' }]) {
    assert.deepEqual(mergeContactFailedAttempts([], [{ ...good, ...patch }]), []);
  }
});
