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

const bundledRecoveryModules = [
  'post_cancel_charge.ts',
  'rebill_builders.ts',
  'rebill_flow.ts',
  'rebill_deps_adapter.ts',
] as const;

describe('bePaid post-cancel recovery safety', () => {
  it('a provider snapshot cannot itself revive any local subscription or access', () => {
    for (const table of ['subscriptions_v2', 'entitlements', 'telegram_access_grants']) {
      expect(syncSource).not.toContain(`.from('${table}')`);
    }
    expect(syncSource).toContain('enqueueReceiptForRecovery');
    expect(syncSource).toContain('fulfillment_verified: false');
  });

  it('does not directly insert a transaction or invent a paid date/amount from a snapshot', () => {
    expect(syncSource).not.toContain(".from('payments_v2')");
    expect(syncSource).not.toContain('lastTx.amount ? lastTx.amount / 100 : null');
    expect(syncSource).not.toContain('paymentData');
    expect(syncSource).toContain('receipt_sync_missing_uid');
  });

  it('requires an exact admin-scoped queue recovery and suppresses access', () => {
    for (const field of [
      'queue_id',
      'provider_row_id',
      'provider_subscription_id',
      'expected_uid',
      'cancellation_evidence_subscription_id',
      'expected_amount',
      'expected_currency',
      'expected_paid_at',
    ]) {
      expect(recoverySource).toContain(field);
    }
    expect(recoverySource).toContain('const dryRun = body.dry_run !== false');
    expect(recoverySource).toContain('cancellation_evidence_scope_mismatch');
    expect(recoverySource).toContain(
      '.eq("id", body.cancellation_evidence_subscription_id!)',
    );
    expect(recoverySource).toContain(
      'String(cancellationEvidence.tariff_id || "") !== String(localSub.tariff_id)',
    );
    expect(recoverySource).toContain('accessPolicy: "suppress_post_cancel_charge"');
    expect(recoverySource).toContain('refund_candidate: true');
    expect(recoverySource).toContain('protected_access_unchanged: true');
    expect(recoverySource).toContain('status: "completed"');
    expect(recoverySource).not.toMatch(/\.from\(["']entitlements["']\)\s*\.\s*(insert|update|upsert|delete)/s);
    expect(recoverySource).not.toMatch(/\.from\(["']telegram_access_grants["']\)\s*\.\s*(insert|update|upsert|delete)/s);
    expect(recoverySource).not.toContain('grant-access-for-order');
  });

  it('keeps the recovery function self-contained for Lovable Edge bundling', () => {
    expect(recoverySource).not.toContain('../bepaid-webhook/');

    for (const moduleName of bundledRecoveryModules) {
      const canonical = readFileSync(
        resolve(process.cwd(), `supabase/functions/bepaid-webhook/${moduleName}`),
        'utf8',
      );
      const bundled = readFileSync(
        resolve(
          process.cwd(),
          `supabase/functions/admin-materialize-post-cancel-charge/${moduleName}`,
        ),
        'utf8',
      );
      expect(bundled.trimEnd()).toBe(canonical.trimEnd());
    }
  });

  it('classifies the known incident timeline as a blocked post-cancel charge', () => {
    expect(classifyLocalPropagation({
      providerState: 'active',
      hasCompetingActiveSubscription: false,
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
