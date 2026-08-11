import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const webhook = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/functions/bepaid-webhook/index.ts'),
  'utf8',
);

describe('bePaid post-cancel charge contract', () => {
  it('classifies and handles a post-cancel charge before provider link repair', () => {
    const classifyAt = webhook.indexOf('classifyPostCancelCharge({');
    const repairAt = webhook.indexOf('decideProviderSubscriptionLinkRepair({');

    expect(classifyAt).toBeGreaterThan(0);
    expect(repairAt).toBeGreaterThan(classifyAt);
  });

  it('materializes the payment with access explicitly suppressed', () => {
    expect(webhook).toContain("accessPolicy: 'suppress_post_cancel_charge'");
    expect(webhook).toContain("status: 'post_cancel_charge_materialized_no_grant'");
    expect(webhook).toContain('readbackMeta.do_not_grant_access !== true');
    expect(webhook).toContain('readbackMeta.refund_candidate !== true');
  });

  it('stops processing instead of falling through when materialization is unavailable', () => {
    expect(webhook).toContain("reason: 'post_cancel_charge_materialization_blocked'");
    expect(webhook).toContain("reason: 'post_cancel_charge_materialization_failed'");
    expect(webhook).toContain('access_grant_suppressed: true');
  });
});
