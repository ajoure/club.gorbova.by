import type { AuthSuccess, AuthFailure } from '../_shared/verified-financial-caller.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const stamp = (v: unknown) => typeof v === 'string' && v.length <= 64 && Number.isFinite(Date.parse(v));
const rootKeys = new Set(['manualPaidContinuation', 'queueItemId', 'expectedUpdatedAt', 'providerSubscriptionId',
  'paidContinuation', 'dryRun', 'recordPreflightFailure']);
const repairKeys = new Set(['sourceSubscriptionId', 'targetSubscriptionId', 'previousPaymentUid', 'expectedProviderUpdatedAt']);

// An existing financial administrator can request only this fully guarded,
// exact manual operation. This never authorizes a batch or the normal sweep.
// Identity comes exclusively from the canonical verified caller resolver.
export function authorizeManualContinuation(method: string, body: unknown, auth: AuthSuccess | AuthFailure):
  { ok: true; operatorUserId: string } | { ok: false; status: number; body: { success: false; error: string } } {
  if (auth.ok === false) return auth;
  const deny = (status: number, error: string) => ({ ok: false as const, status, body: { success: false as const, error } });
  if (auth.caller.type !== 'admin' || !UUID.test(auth.caller.actorUserId || '')) return deny(403, 'forbidden');
  if (method !== 'POST') return deny(405, 'method_not_allowed');
  if (!isRecord(body) || body.manualPaidContinuation !== true) return deny(403, 'manual_continuation_only');
  const repair = body.paidContinuation;
  if (Object.keys(body).some(key => !rootKeys.has(key)) || !isRecord(repair) ||
      Object.keys(repair).some(key => !repairKeys.has(key)) ||
      typeof body.queueItemId !== 'string' || !UUID.test(body.queueItemId) || !stamp(body.expectedUpdatedAt) ||
      typeof body.providerSubscriptionId !== 'string' || !/^sbs_[A-Za-z0-9_-]{1,128}$/.test(body.providerSubscriptionId) ||
      typeof repair.sourceSubscriptionId !== 'string' || !UUID.test(repair.sourceSubscriptionId) ||
      typeof repair.targetSubscriptionId !== 'string' || !UUID.test(repair.targetSubscriptionId) ||
      repair.sourceSubscriptionId === repair.targetSubscriptionId ||
      typeof repair.previousPaymentUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(repair.previousPaymentUid) ||
      !stamp(repair.expectedProviderUpdatedAt) || body.recordPreflightFailure !== false ||
      (body.dryRun !== undefined && typeof body.dryRun !== 'boolean')) {
    return deny(400, 'invalid_manual_continuation');
  }
  return { ok: true, operatorUserId: auth.caller.actorUserId! };
}
