import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyLocalPropagation } from '../../supabase/functions/bepaid-get-subscription-details/local_propagation_guard';

const syncSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/bepaid-get-subscription-details/index.ts'),
  'utf8',
);
const recoverySource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/admin-materialize-post-cancel-charge/index.ts'),
  'utf8',
);

describe('bePaid post-cancel recovery safety', () => {
  it('blocks a proven post-cancel charge before any local access propagation', () => {
    const guardIndex = syncSource.indexOf('classifyLocalPropagation({');
    const subscriptionUpdateIndex = syncSource.indexOf("action: 'bepaid.subscription.sync_dates'");
    const entitlementUpdateIndex = syncSource.indexOf(".from('entitlements')", guardIndex);
    const telegramUpdateIndex = syncSource.indexOf(".from('telegram_access_grants')", guardIndex);

    expect(guardIndex).toBeGreaterThan(0);
    expect(subscriptionUpdateIndex).toBeGreaterThan(guardIndex);
    expect(entitlementUpdateIndex).toBeGreaterThan(guardIndex);
    expect(telegramUpdateIndex).toBeGreaterThan(guardIndex);
    expect(syncSource).toContain("local_propagation: 'blocked_post_cancel_charge'");
  });

  it('does not attempt to insert a provider transaction with no amount', () => {
    expect(syncSource).toContain('bepaid.payment.upsert_skipped_no_amount');
    expect(syncSource).toContain('provider_last_transaction_amount_missing_or_invalid');
    expect(syncSource).toContain('amount: lastTxAmountCents / 100');
    expect(syncSource).not.toContain('amount: lastTx.amount ? lastTx.amount / 100 : null');
  });

  it('requires an exact admin-scoped queue recovery and suppresses access', () => {
    for (const field of [
      'queue_id',
      'provider_row_id',
      'provider_subscription_id',
      'expected_uid',
      'expected_amount',
      'expected_currency',
      'expected_paid_at',
    ]) {
      expect(recoverySource).toContain(field);
    }
    expect(recoverySource).toContain('const dryRun = body.dry_run !== false');
    expect(recoverySource).toContain('accessPolicy: "suppress_post_cancel_charge"');
    expect(recoverySource).toContain('refund_candidate: true');
    expect(recoverySource).toContain('protected_access_unchanged: true');
    expect(recoverySource).toContain('status: "completed"');
    expect(recoverySource).not.toMatch(/\.from\(["']entitlements["']\)\s*\.\s*(insert|update|upsert|delete)/s);
    expect(recoverySource).not.toMatch(/\.from\(["']telegram_access_grants["']\)\s*\.\s*(insert|update|upsert|delete)/s);
    expect(recoverySource).not.toContain('grant-access-for-order');
  });

  it('classifies the known incident timeline as a blocked post-cancel charge', () => {
    expect(classifyLocalPropagation({
      localStatus: 'canceled',
      autoRenew: false,
      canceledAt: '2026-08-10T11:10:00Z',
      autoRenewDisabledAt: null,
      currentAccessEnd: '2026-08-10T23:59:59Z',
      transactionStatus: 'successful',
      transactionPaidAt: '2026-08-11T03:00:50Z',
      proposedAccessEnd: '2026-09-08T17:57:50Z',
    }).decision).toBe('blocked_post_cancel_charge');
  });
});
