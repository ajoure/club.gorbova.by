import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifySubscriptionGrant, grantForPersistedPayment } from '../../supabase/functions/bepaid-webhook/subscription-payment-grant';

describe('subscription receipt before canonical access', () => {
  it('waits for the ledger commit before the writer can read paid_at', async () => {
    let commit!: (value: { id: string; action: 'created' }) => void;
    let paidAt: string | null = null;
    const pending = new Promise<{ id: string; action: 'created' }>(resolve => { commit = resolve; });
    const writer = vi.fn(async () => {
      expect(paidAt).toBe('2026-08-01T10:00:00Z');
      return classifySubscriptionGrant(true, 200, { success: true });
    });
    const attempt = grantForPersistedPayment(pending, writer);
    await Promise.resolve();
    expect(writer).not.toHaveBeenCalled();
    paidAt = '2026-08-01T10:00:00Z'; commit({ id: 'receipt', action: 'created' });
    expect(await attempt).toMatchObject({ outcome: 'ok' });
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it.each([{ id: null, action: 'created' }, { id: 'receipt', action: 'error' }] as const)(
    'does not grant on an unconfirmed receipt %j', async receipt => {
      const writer = vi.fn();
      expect(await grantForPersistedPayment(receipt, writer)).toMatchObject({ outcome: 'error', result: { error: 'payment_fact_not_persisted' } });
      expect(writer).not.toHaveBeenCalled();
    });

  it('leaves 409 and transport failures for durable recovery without an immediate repeat', async () => {
    const receipt = { id: 'receipt', action: 'updated' as const };
    const writer = vi.fn(async () => classifySubscriptionGrant(false, 409, { error: 'access_window_requires_paid_at' }));
    expect(await grantForPersistedPayment(receipt, writer)).toMatchObject({ outcome: 'error', status: 409 });
    expect(writer).toHaveBeenCalledTimes(1);
    const uncertain = vi.fn(async () => { throw new Error('timeout after commit'); });
    expect(await grantForPersistedPayment(receipt, uncertain)).toMatchObject({ outcome: 'error' });
    expect(uncertain).toHaveBeenCalledTimes(1);
  });

  it('preserves explicit skip/manual-review outcomes rather than treating them as fulfilled', async () => {
    for (const body of [{ skipped: true }, { reason: 'sbs_mismatch' }, { reason: 'manual_review' }, { reason: 'skip_suppressed' }]) {
      expect(classifySubscriptionGrant(true, 200, body).outcome).toBe('skip');
    }
  });

  it('wires the real renewal branch to the existing UID ledger before grant and closes only on fulfillment', () => {
    const source = readFileSync('supabase/functions/bepaid-webhook/index.ts', 'utf8');
    const branch = source.slice(source.indexOf('// Persist the payment fact'), source.indexOf('// B7 — FINAL COMPLETION'));
    expect(branch.indexOf('await upsertPaymentV2')).toBeLessThan(branch.indexOf('await grantForPersistedPayment'));
    expect(branch).toContain('provider_payment_id: transactionUid || subscriptionId');
    expect(branch).toContain('paid_at: transaction?.paid_at || now.toISOString()');
    expect(branch).toContain('finiteInternalGuardActive\n          ? originalOrderIdForGuard!');
    expect(branch).toContain('rebillHandled && rebillOrderIdFromFlow');
    expect(branch).toContain("grantOutcome === 'ok'");
    expect(branch).toContain("subPayResult?.action !== 'error'");
  });
});
