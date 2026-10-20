import { assertEquals } from 'jsr:@std/assert';
import { authorizeManualContinuation } from './manual-continuation.ts';
import type { AuthSuccess } from '../_shared/verified-financial-caller.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin: AuthSuccess = { ok: true, caller: { type: 'admin', actorUserId: id(1),
  actorLabel: 'verified', actorType: 'admin', actor: null } };
const body = () => ({ manualPaidContinuation: true, queueItemId: id(2), expectedUpdatedAt: '2026-01-01T00:00:00Z',
  providerSubscriptionId: 'sbs_test', recordPreflightFailure: false,
  paidContinuation: { sourceSubscriptionId: id(3), targetSubscriptionId: id(4), previousPaymentUid: 'test_uid',
    expectedProviderUpdatedAt: '2026-01-01T00:00:00Z' } });

Deno.test('verified existing admin may request only an exact continuation', () => {
  assertEquals(authorizeManualContinuation('POST', body(), admin), { ok: true, operatorUserId: id(1) });
  for (const dryRun of [true, false]) assertEquals(authorizeManualContinuation('POST', { ...body(), dryRun }, admin).ok, true);
});
Deno.test('auth failures and non-admin identities never acquire a manual path', () => {
  assertEquals(authorizeManualContinuation('POST', body(), { ok: false, status: 401,
    body: { success: false, error: 'unauthorized' } }).ok, false);
  for (const type of ['ordinary_user', 'service_role'] as const) {
    assertEquals(authorizeManualContinuation('POST', body(), { ...admin, caller: { ...admin.caller, type } }).ok, false);
  }
});
for (const [name, change] of [
  ['no explicit operation', (v: any) => delete v.manualPaidContinuation],
  ['false operation', (v: any) => v.manualPaidContinuation = false],
  ['batch request', (v: any) => v.limit = 20],
  ['spoofed operator', (v: any) => v.operatorUserId = id(99)],
  ['dry-run alias', (v: any) => v.dry_run = false],
  ['string dry-run', (v: any) => v.dryRun = 'false'],
  ['failure accounting', (v: any) => v.recordPreflightFailure = true],
  ['missing failure flag', (v: any) => delete v.recordPreflightFailure],
  ['missing queue ID', (v: any) => delete v.queueItemId],
  ['malformed queue ID', (v: any) => v.queueItemId = 'test'],
  ['missing queue CAS', (v: any) => delete v.expectedUpdatedAt],
  ['invalid queue CAS', (v: any) => v.expectedUpdatedAt = 'invalid'],
  ['missing provider ID', (v: any) => delete v.providerSubscriptionId],
  ['invalid provider ID', (v: any) => v.providerSubscriptionId = 'https://example.test'],
  ['missing continuation', (v: any) => delete v.paidContinuation],
  ['same source and target', (v: any) => v.paidContinuation.targetSubscriptionId = v.paidContinuation.sourceSubscriptionId],
  ['malformed source', (v: any) => v.paidContinuation.sourceSubscriptionId = 'test'],
  ['malformed target', (v: any) => v.paidContinuation.targetSubscriptionId = 'test'],
  ['missing previous UID', (v: any) => delete v.paidContinuation.previousPaymentUid],
  ['missing provider CAS', (v: any) => delete v.paidContinuation.expectedProviderUpdatedAt],
  ['unknown repair field', (v: any) => v.paidContinuation.actor = id(99)],
] as const) {
  Deno.test(`manual scope rejects ${name}`, () => {
    const value = body(); change(value);
    assertEquals(authorizeManualContinuation('POST', value, admin).ok, false);
  });
}
Deno.test('method, root shape and absent verified actor fail closed', () => {
  for (const method of ['GET', 'PUT', 'DELETE']) assertEquals(authorizeManualContinuation(method, body(), admin).ok, false);
  for (const value of [null, [], 'test', {}]) assertEquals(authorizeManualContinuation('POST', value, admin).ok, false);
  assertEquals(authorizeManualContinuation('POST', body(), { ...admin, caller: { ...admin.caller, actorUserId: null } }).ok, false);
});
